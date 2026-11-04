import base64
import binascii
import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from lib.auth import current_user
from lib.db import db
from lib.receipt_reader import read_receipt
from models.groups import ReceiptIn, ReceiptScan
from routers.groups import _group_for

router = APIRouter(prefix="/groups/{group_id}/expenses/{expense_id}/receipt", tags=["receipts"])
scan_router = APIRouter(prefix="/receipts", tags=["receipts"])

DATA_URL = re.compile(r"^data:(image/(?:jpeg|png|webp));base64,(.+)$", re.S)
MAX_BYTES = 3 * 1024 * 1024
logger = logging.getLogger(__name__)


def _decode(data_url: str) -> tuple[str, bytes, str]:
    m = DATA_URL.match(data_url)
    if not m:
        raise HTTPException(400, "Receipt must be a JPEG, PNG or WebP image")
    try:
        data = base64.b64decode(m.group(2), validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(400, "Could not read that image")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Receipt photo is too large (max 3 MB)")
    return m.group(1), data, m.group(2)


@scan_router.post("/scan", response_model=ReceiptScan)
async def scan_receipt(body: ReceiptIn, user: dict = Depends(current_user)):
    _, _, b64 = _decode(body.data_url)
    try:
        return await read_receipt(b64)
    except Exception as exc:  # upstream LLM failure — let the user type it in
        logger.error("receipt scan failed: %s", exc)
        raise HTTPException(502, "Couldn't read the receipt right now — please enter the details manually")


async def _expense(group_id: str, expense_id: str, user: dict) -> dict:
    await _group_for(group_id, user)
    e = await db.expenses.find_one({"id": expense_id, "group_id": group_id}, {"_id": 0, "id": 1})
    if not e:
        raise HTTPException(404, "Expense not found")
    return e


@router.put("")
async def upload_receipt(group_id: str, expense_id: str, body: ReceiptIn, user: dict = Depends(current_user)):
    await _expense(group_id, expense_id, user)
    content_type, data, _ = _decode(body.data_url)
    await db.receipts.update_one(
        {"expense_id": expense_id},
        {"$set": {"expense_id": expense_id, "group_id": group_id, "content_type": content_type, "data": data,
                  "uploaded_by": user["name"]}},
        upsert=True,
    )
    await db.expenses.update_one({"id": expense_id}, {"$set": {"has_receipt": True}})
    return {"ok": True}


@router.get("")
async def get_receipt(group_id: str, expense_id: str, user: dict = Depends(current_user)):
    await _expense(group_id, expense_id, user)
    r = await db.receipts.find_one({"expense_id": expense_id}, {"_id": 0})
    if not r:
        raise HTTPException(404, "No receipt for this expense")
    return Response(content=r["data"], media_type=r["content_type"], headers={"Cache-Control": "private, max-age=60"})


@router.delete("")
async def delete_receipt(group_id: str, expense_id: str, user: dict = Depends(current_user)):
    await _expense(group_id, expense_id, user)
    await db.receipts.delete_one({"expense_id": expense_id})
    await db.expenses.update_one({"id": expense_id}, {"$set": {"has_receipt": False}})
    return {"ok": True}


# ---- Proof-of-payment photos on settlements ----
settlement_router = APIRouter(prefix="/groups/{group_id}/settlements/{settlement_id}/receipt", tags=["receipts"])


async def _settlement(group_id: str, settlement_id: str, user: dict) -> None:
    await _group_for(group_id, user)
    if not await db.settlements.find_one({"id": settlement_id, "group_id": group_id}, {"_id": 1}):
        raise HTTPException(404, "Settlement not found")


@settlement_router.put("")
async def upload_settlement_receipt(group_id: str, settlement_id: str, body: ReceiptIn,
                                    user: dict = Depends(current_user)):
    await _settlement(group_id, settlement_id, user)
    content_type, data, _ = _decode(body.data_url)
    await db.settlement_receipts.update_one(
        {"settlement_id": settlement_id},
        {"$set": {"settlement_id": settlement_id, "group_id": group_id, "content_type": content_type, "data": data,
                  "uploaded_by": user["name"]}},
        upsert=True,
    )
    await db.settlements.update_one({"id": settlement_id}, {"$set": {"has_receipt": True}})
    return {"ok": True}


@settlement_router.get("")
async def get_settlement_receipt(group_id: str, settlement_id: str, user: dict = Depends(current_user)):
    await _settlement(group_id, settlement_id, user)
    r = await db.settlement_receipts.find_one({"settlement_id": settlement_id}, {"_id": 0})
    if not r:
        raise HTTPException(404, "No receipt for this settlement")
    return Response(content=r["data"], media_type=r["content_type"], headers={"Cache-Control": "private, max-age=60"})


@settlement_router.delete("")
async def delete_settlement_receipt(group_id: str, settlement_id: str, user: dict = Depends(current_user)):
    await _settlement(group_id, settlement_id, user)
    await db.settlement_receipts.delete_one({"settlement_id": settlement_id})
    await db.settlements.update_one({"id": settlement_id}, {"$set": {"has_receipt": False}})
    return {"ok": True}
