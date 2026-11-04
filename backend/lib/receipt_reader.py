"""Reads a receipt photo with Gemini (via the Emergent LLM key) and returns structured fields."""

import json
import logging
import os
import re
import uuid
from datetime import date

from emergentintegrations.llm.chat import ImageContent, LlmChat, UserMessage

from models.groups import ReceiptScan, ScannedItem

logger = logging.getLogger(__name__)

PROMPT = """Read this receipt photo and reply with ONLY a JSON object, no markdown:
{"items": [{"name": string, "price": number}], "amount": number|null, "description": string|null, "date": "YYYY-MM-DD"|null, "currency": "ISO 4217 code"|null}
- items: every purchased line item with its line total (quantity x unit price). Skip subtotal, tax, tip, service, payment and change lines. Short readable names.
- amount: the final total actually paid (after tax/tip/discounts), as a plain number.
- description: short label for a bill-splitting app, max 40 characters, e.g. "Countdown groceries" or "Dinner at Luigi's". Use the merchant name in title case.
- date: the purchase date, or null if not printed.
- currency: only if a currency symbol/code is clearly shown, else null.
If the image is not a receipt, return all nulls."""


def _parse(text: str) -> ReceiptScan:
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return ReceiptScan()
    raw = json.loads(m.group(0))
    out = ReceiptScan()
    try:
        amt = float(raw.get("amount")) if raw.get("amount") is not None else None
        out.amount = round(amt, 2) if amt and amt > 0 else None
    except (TypeError, ValueError):
        pass
    desc = (raw.get("description") or "").strip()
    out.description = desc[:120] or None
    d = raw.get("date")
    if isinstance(d, str):
        try:
            out.date = date.fromisoformat(d).isoformat()
        except ValueError:
            pass
    for it in raw.get("items") or []:
        try:
            name = str(it.get("name") or "").strip()[:80]
            price = round(float(it.get("price")), 2)
        except (TypeError, ValueError, AttributeError):
            continue
        if name and price > 0:
            out.items.append(ScannedItem(name=name, price=price))
    cur = raw.get("currency")
    if isinstance(cur, str) and re.fullmatch(r"[A-Za-z]{3}", cur.strip()):
        out.currency = cur.strip().upper()
    return out


async def read_receipt(image_b64: str) -> ReceiptScan:
    chat = LlmChat(
        api_key=os.environ["EMERGENT_LLM_KEY"],
        session_id=f"receipt-{uuid.uuid4()}",
        system_message="You extract data from receipt photos and answer with strict JSON.",
    ).with_model("gemini", os.environ.get("RECEIPT_MODEL", "gemini-3.8-flash"))
    reply = await chat.send_message(UserMessage(text=PROMPT, file_contents=[ImageContent(image_base64=image_b64)]))
    try:
        return _parse(reply)
    except (json.JSONDecodeError, AttributeError) as exc:
        logger.warning("receipt parse failed: %s | %r", exc, reply[:200])
        return ReceiptScan()
