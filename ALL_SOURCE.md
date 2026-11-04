# Splitly — full source

Generated 2026-11-03. Secrets (.env values) are NOT included.

## `backend/server.py`

```python
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, APIRouter
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List
import uuid
from datetime import datetime


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
from lib.db import client, db, ensure_indexes


# Startup runs before the yield, shutdown after it. Add your own setup/teardown here.
@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.index_task = asyncio.create_task(ensure_indexes())  # background: a big index build must not block boot
    yield
    client.close()


# Create the main app without a prefix
app = FastAPI(lifespan=lifespan)

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# Define Models
class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class StatusCheckCreate(BaseModel):
    client_name: str

# Add your routes to the router instead of directly to app
@api_router.get("/")
async def root():
    return {"message": "Hello World"}

@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_dict = input.model_dump()
    status_obj = StatusCheck(**status_dict)
    _ = await db.status_checks.insert_one(status_obj.model_dump())
    return status_obj

@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find().to_list(1000)
    return [StatusCheck(**status_check) for status_check in status_checks]

from routers.auth import router as auth_router  # noqa: E402
from routers.groups import router as groups_router  # noqa: E402

api_router.include_router(auth_router)
api_router.include_router(groups_router)
from routers.notifications import router as notifications_router  # noqa: E402
api_router.include_router(notifications_router)
from routers.receipts import router as receipts_router, scan_router as receipt_scan_router, settlement_router as settlement_receipt_router  # noqa: E402
api_router.include_router(receipts_router)
api_router.include_router(receipt_scan_router)
api_router.include_router(settlement_receipt_router)
from routers.invites import router as invites_router  # noqa: E402
api_router.include_router(invites_router)

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)
```

## `backend/seed.py`

```python
"""Idempotent demo seed: demo user + two groups. Run: cd /app/backend && python seed.py"""
import asyncio
import uuid
from datetime import datetime, timezone

from lib.auth import hash_password
from lib.db import db, ensure_indexes
from lib.splits import compute_shares

DEMO_EMAIL = "demo@splitly.app"
FRIEND_EMAIL = "friend@splitly.app"


async def main():
    await ensure_indexes()
    user = await db.users.find_one({"email": DEMO_EMAIL})
    if user:
        print("demo user exists; skipping demo groups")
        await seed_friend(user["id"])
        return
    uid = str(uuid.uuid4())
    await db.users.insert_one({"id": uid, "name": "Demo", "email": DEMO_EMAIL,
                               "password_hash": hash_password("demo1234"),
                               "created_at": datetime.now(timezone.utc)})

    async def group(name, currency, members, expenses):
        gid = str(uuid.uuid4())
        mem = [{"id": str(uuid.uuid4()), "name": n} for n in members]
        ids = {m["name"]: m["id"] for m in mem}
        await db.groups.insert_one({"id": gid, "name": name, "currency": currency, "members": mem,
                                    "owner_id": uid, "user_ids": [uid],
                                    "created_at": datetime.now(timezone.utc)})
        for desc, amt, payer, st, parts, exact, date in expenses:
            shares = compute_shares(amt, st, set(ids.values()), [ids[p] for p in parts],
                                    {ids[k]: v for k, v in exact.items()})
            await db.expenses.insert_one({"id": str(uuid.uuid4()), "group_id": gid, "description": desc,
                                          "amount": amt, "paid_by": ids[payer], "split_type": st,
                                          "shares": shares, "date": date,
                                          "created_at": datetime.now(timezone.utc)})

    await group("Bali Trip", "USD", ["Alex", "Sam", "Jordan", "Priya"], [
        ("Villa booking", 640.0, "Alex", "equal", ["Alex", "Sam", "Jordan", "Priya"], {}, "2026-01-10"),
        ("Scooter rental", 90.0, "Sam", "equal", ["Sam", "Jordan", "Priya"], {}, "2026-01-11"),
        ("Dinner at Jimbaran", 120.0, "Priya", "exact", [], {"Alex": 40, "Sam": 30, "Jordan": 25, "Priya": 25}, "2026-01-12"),
        ("Jordan's surf lesson", 55.0, "Alex", "full", ["Jordan"], {}, "2026-01-13"),
    ])
    await group("Flat 4B", "EUR", ["Alex", "Mia", "Leo"], [
        ("Electricity — Jan", 96.30, "Mia", "equal", ["Alex", "Mia", "Leo"], {}, "2026-01-05"),
        ("Groceries", 64.75, "Leo", "equal", ["Alex", "Mia", "Leo"], {}, "2026-01-08"),
    ])
    print("seeded demo@splitly.app / demo1234")
    await seed_friend(uid)


async def seed_friend(demo_id: str):
    """Second account sharing Demo's 'Bali Trip' so notifications can be seen end to end."""
    friend = await db.users.find_one({"email": FRIEND_EMAIL})
    if not friend:
        friend = {"id": str(uuid.uuid4()), "name": "Sam", "email": FRIEND_EMAIL,
                  "password_hash": hash_password("friend1234"), "created_at": datetime.now(timezone.utc)}
        await db.users.insert_one(friend)
    await db.groups.update_one({"name": "Bali Trip", "owner_id": demo_id}, {"$addToSet": {"user_ids": friend["id"]}})
    print("friend@splitly.app / friend1234 shares Bali Trip")


if __name__ == "__main__":
    asyncio.run(main())
```

## `backend/requirements.txt`

```text
fastapi==0.141.1
uvicorn==0.52.1
boto3>=1.34.129
requests-oauthlib>=2.0.0
cryptography>=42.0.8
python-dotenv>=1.0.1
pymongo==4.18.2
pydantic>=2.6.4
email-validator>=2.2.0
pyjwt>=2.10.1
passlib>=1.7.4
# passlib 1.7.4 needs bcrypt<4.1
bcrypt==4.0.1
tzdata>=2024.2
motor==3.7.1
pytest>=8.0.0
pytest-xdist>=3.6.0
pytest-asyncio>=0.24.0
httpx>=0.27.0
black>=24.1.1
isort>=5.13.2
flake8>=7.0.0
mypy>=1.8.0
python-jose>=3.3.0
requests>=2.31.0
pandas>=2.2.0
openpyxl>=3.1.5
numpy>=1.26.0
python-multipart>=0.0.9
jq>=1.6.0
typer>=0.9.0
emergentintegrations==0.2.2
```

## `backend/lib/__init__.py`

```python
```

## `backend/lib/auth.py`

```python
import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import HTTPException, Request
from passlib.hash import pbkdf2_sha256

from lib.db import db

COOKIE = "session"
TTL_DAYS = 14


def hash_password(pw: str) -> str:
    return pbkdf2_sha256.hash(pw)


def verify_password(pw: str, hashed: str) -> bool:
    return pbkdf2_sha256.verify(pw, hashed)


def make_token(user_id: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(days=TTL_DAYS)
    return jwt.encode({"sub": user_id, "exp": exp}, os.environ["JWT_SECRET"], algorithm="HS256")


async def current_user(request: Request) -> dict:
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, os.environ["JWT_SECRET"], algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid session")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user
```

## `backend/lib/dates.py`

```python
"""Server-side date helpers. The pod clock is UTC — anchor "today" here, never in the browser."""

import os
from datetime import datetime
from zoneinfo import ZoneInfo


def today_iso(tz: str | None = None) -> str:
    """Today's date as YYYY-MM-DD in `tz` (default: APP_TZ env, else UTC)."""
    zone = tz or os.environ.get("APP_TZ", "UTC")
    return datetime.now(ZoneInfo(zone)).strftime("%Y-%m-%d")
```

## `backend/lib/db.py`

```python
"""Shared Mongo handle — import `client`/`db` from here (server.py, routers, seed.py)."""

import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ASCENDING, DESCENDING, IndexModel

load_dotenv(Path(__file__).parent.parent / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

logger = logging.getLogger(__name__)

# One entry per collection: every field a route filters, sorts, or dedupes on. Applied by ensure_indexes() at startup.
INDEXES: dict[str, list[IndexModel]] = {
    "status_checks": [IndexModel([("timestamp", DESCENDING)], name="timestamp_desc")],
    "users": [IndexModel([("id", ASCENDING)], name="id", unique=True),
              IndexModel([("email", ASCENDING)], name="email", unique=True)],
    "groups": [IndexModel([("id", ASCENDING)], name="id", unique=True),
               IndexModel([("invite_token", ASCENDING)], name="invite_token", unique=True, sparse=True),
               IndexModel([("user_ids", ASCENDING), ("created_at", DESCENDING)], name="user_created")],
    "expenses": [IndexModel([("id", ASCENDING)], name="id", unique=True),
                 IndexModel([("group_id", ASCENDING), ("date", DESCENDING)], name="group_date")],
    "notifications": [IndexModel([("id", ASCENDING)], name="id", unique=True),
                      IndexModel([("user_id", ASCENDING), ("read", ASCENDING), ("created_at", DESCENDING)],
                                 name="user_read_created")],
    "receipts": [IndexModel([("expense_id", ASCENDING)], name="expense_id", unique=True)],
    "settlement_receipts": [IndexModel([("settlement_id", ASCENDING)], name="settlement_id", unique=True)],
    "reminders": [IndexModel([("group_id", ASCENDING), ("from_member", ASCENDING), ("to_member", ASCENDING),
                              ("at", DESCENDING)], name="group_pair_at")],
    "settlements": [IndexModel([("id", ASCENDING)], name="id", unique=True),
                    IndexModel([("group_id", ASCENDING), ("created_at", DESCENDING)], name="group_created")],
}


async def ensure_indexes() -> None:
    for collection, models in INDEXES.items():
        for model in models:  # one at a time so a bad spec skips only itself
            try:
                await db[collection].create_indexes([model])
            except Exception as exc:  # never block boot on an index; the log line names what to fix
                logger.error("ensure_indexes(%s.%s): %s", collection, model.document["name"], exc)
```

## `backend/lib/receipt_reader.py`

```python
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
```

## `backend/lib/splits.py`

```python
"""Pure split / balance / debt-simplification math. All money handled in integer cents."""

from fastapi import HTTPException


def cents(x: float) -> int:
    return int(round(x * 100))


def compute_shares(amount: float, split_type: str, member_ids: set[str],
                   participant_ids: list[str], exact_amounts: dict[str, float],
                   items: list | None = None) -> dict[str, float]:
    total = cents(amount)
    if split_type == "items":
        return _item_shares(total, items or [], member_ids)
    if split_type == "equal":
        ids = list(dict.fromkeys(participant_ids))
        if not ids:
            raise HTTPException(400, "Select at least one person to split with")
        _check(ids, member_ids)
        base, rem = divmod(total, len(ids))
        return {m: (base + (1 if i < rem else 0)) / 100 for i, m in enumerate(ids)}
    if split_type == "full":
        if len(participant_ids) != 1:
            raise HTTPException(400, "Pick exactly one person who owes the full amount")
        _check(participant_ids, member_ids)
        return {participant_ids[0]: total / 100}
    # exact
    shares = {m: cents(v) for m, v in exact_amounts.items() if cents(v) > 0}
    if not shares:
        raise HTTPException(400, "Enter at least one amount")
    if any(v < 0 for v in exact_amounts.values()):
        raise HTTPException(400, "Amounts cannot be negative")
    _check(list(shares), member_ids)
    if sum(shares.values()) != total:
        raise HTTPException(400, f"Exact amounts add up to {sum(shares.values()) / 100:.2f}, not {total / 100:.2f}")
    return {m: v / 100 for m, v in shares.items()}


def _item_shares(total: int, items: list, member_ids: set[str]) -> dict[str, float]:
    """Each line is split evenly among whoever had it; the gap between the line total and the bill
    (tax, tip, service, discounts) is shared in proportion to each person's items."""
    if not items:
        raise HTTPException(400, "Add at least one item")
    sub: dict[str, int] = {}
    for it in items:
        ids = list(dict.fromkeys(it.member_ids))
        if not ids:
            raise HTTPException(400, f'Pick who had "{it.name}"')
        _check(ids, member_ids)
        base, rem = divmod(cents(it.price), len(ids))
        for i, m in enumerate(ids):
            sub[m] = sub.get(m, 0) + base + (1 if i < rem else 0)
    items_total = sum(sub.values())
    extra = total - items_total
    if extra < 0 and -extra > items_total // 2:
        raise HTTPException(400, f"Items add up to {items_total / 100:.2f}, far more than the total {total / 100:.2f}")
    shares = {m: v + (extra * v) // items_total for m, v in sub.items()}
    # hand leftover cents to the biggest shares so the sum is exact
    drift = total - sum(shares.values())
    for m in sorted(shares, key=lambda k: -sub[k])[: abs(drift)]:
        shares[m] += 1 if drift > 0 else -1
    return {m: v / 100 for m, v in shares.items() if v}


def _check(ids: list[str], member_ids: set[str]) -> None:
    if not set(ids) <= member_ids:
        raise HTTPException(400, "Unknown member in split")


def net_balances(member_ids: list[str], expenses: list[dict], settlements: list[dict]):
    """Returns (paid, share, net) dicts in cents. net>0 means member should receive."""
    paid = {m: 0 for m in member_ids}
    share = {m: 0 for m in member_ids}
    net = {m: 0 for m in member_ids}
    for e in expenses:
        paid[e["paid_by"]] = paid.get(e["paid_by"], 0) + cents(e["amount"])
        net[e["paid_by"]] = net.get(e["paid_by"], 0) + cents(e["amount"])
        for m, v in e["shares"].items():
            share[m] = share.get(m, 0) + cents(v)
            net[m] = net.get(m, 0) - cents(v)
    for s in settlements:
        net[s["from_member"]] = net.get(s["from_member"], 0) + cents(s["amount"])
        net[s["to_member"]] = net.get(s["to_member"], 0) - cents(s["amount"])
    return paid, share, net


def settled_expense_ids(expenses: list[dict], settlements: list[dict]) -> set[str]:
    """Replay expenses + settlements in creation order; every expense created before the last
    moment the whole group was fully square counts as settled."""
    events = [(e["created_at"], 0, e) for e in expenses] + [(s["created_at"], 1, s) for s in settlements]
    events.sort(key=lambda x: (x[0], x[1]))
    net: dict[str, int] = {}
    seen: list[str] = []
    settled: list[str] = []
    for _, kind, doc in events:
        if kind == 0:
            net[doc["paid_by"]] = net.get(doc["paid_by"], 0) + cents(doc["amount"])
            for m, v in doc["shares"].items():
                net[m] = net.get(m, 0) - cents(v)
            seen.append(doc["id"])
        else:
            net[doc["from_member"]] = net.get(doc["from_member"], 0) + cents(doc["amount"])
            net[doc["to_member"]] = net.get(doc["to_member"], 0) - cents(doc["amount"])
        if seen and all(v == 0 for v in net.values()):
            settled = list(seen)
    return set(settled)


def simplify(net: dict[str, int]) -> list[tuple[str, str, int]]:
    """Greedy: repeatedly match largest debtor with largest creditor -> minimal-ish transfers."""
    debtors = sorted(((m, -v) for m, v in net.items() if v < 0), key=lambda x: -x[1])
    creditors = sorted(((m, v) for m, v in net.items() if v > 0), key=lambda x: -x[1])
    out: list[tuple[str, str, int]] = []
    i = j = 0
    debtors = [list(d) for d in debtors]
    creditors = [list(c) for c in creditors]
    while i < len(debtors) and j < len(creditors):
        amt = min(debtors[i][1], creditors[j][1])
        if amt > 0:
            out.append((debtors[i][0], creditors[j][0], amt))
        debtors[i][1] -= amt
        creditors[j][1] -= amt
        if debtors[i][1] == 0:
            i += 1
        if creditors[j][1] == 0:
            j += 1
    return out
```

## `backend/models/__init__.py`

```python
```

## `backend/models/auth.py`

```python
from pydantic import BaseModel, EmailStr, Field


class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    name: str
    email: str
```

## `backend/models/groups.py`

```python
import uuid
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field, field_validator

Currency = Literal["NZD", "AUD", "USD", "EUR", "GBP", "JPY", "CAD", "SGD", "INR"]
SplitType = Literal["equal", "exact", "full", "items"]


def _id() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Member(BaseModel):
    id: str = Field(default_factory=_id)
    name: str
    user_id: str | None = None  # account that claimed "this is me"


class ExpenseItem(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    price: float = Field(gt=0)
    member_ids: list[str] = Field(min_length=1)


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    currency: Currency = "USD"
    members: list[str] = Field(min_length=1)


class MemberAdd(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class ShareIn(BaseModel):
    email: str


class Group(BaseModel):
    id: str = Field(default_factory=_id)
    name: str
    currency: Currency
    members: list[Member]
    owner_id: str
    user_ids: list[str]
    created_at: datetime = Field(default_factory=_now)


class GroupListItem(Group):
    expense_count: int
    total_spent: float
    unsettled_count: int


class ExpenseCreate(BaseModel):
    description: str = Field(min_length=1, max_length=120)
    amount: float = Field(gt=0)
    paid_by: str
    split_type: SplitType
    # equal: members sharing; full: exactly one member who owes everything
    participant_ids: list[str] = []
    # exact: member_id -> amount, must sum to amount
    exact_amounts: dict[str, float] = {}
    # items: receipt lines, each split evenly among its member_ids; tax/tip remainder shared pro-rata
    items: list[ExpenseItem] = Field(default=[], max_length=100)
    date: str | None = None  # YYYY-MM-DD; defaults to server today


def _utc(v: datetime | None) -> datetime | None:
    """Mongo returns naive UTC datetimes; tag them so JSON carries the offset."""
    return v.replace(tzinfo=timezone.utc) if v is not None and v.tzinfo is None else v


class ExpenseEdit(BaseModel):
    at: datetime = Field(default_factory=_now)
    by_name: str
    changes: list[str]

    _aware = field_validator("at")(_utc)


class Expense(BaseModel):
    id: str = Field(default_factory=_id)
    group_id: str
    description: str
    amount: float
    paid_by: str
    split_type: SplitType
    shares: dict[str, float]
    items: list[ExpenseItem] = []
    date: str
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime | None = None
    edits: list[ExpenseEdit] = []
    has_receipt: bool = False
    settled: bool = False

    _aware = field_validator("created_at", "updated_at")(_utc)  # computed on read: covered by a moment when the whole group was square


class SettlementCreate(BaseModel):
    from_member: str
    to_member: str
    amount: float = Field(gt=0)
    note: str | None = Field(default=None, max_length=140)


class ReminderCreate(BaseModel):
    from_member: str
    to_member: str


class ReceiptIn(BaseModel):
    data_url: str = Field(max_length=4_500_000)  # data:image/...;base64,... (client compresses first)


class ScannedItem(BaseModel):
    name: str
    price: float


class ReceiptScan(BaseModel):
    items: list[ScannedItem] = []
    amount: float | None = None
    description: str | None = None
    date: str | None = None  # YYYY-MM-DD
    currency: str | None = None  # ISO code as printed on the receipt, if any


class ReminderOut(BaseModel):
    notified: int
    amount: float


class Settlement(BaseModel):
    id: str = Field(default_factory=_id)
    group_id: str
    from_member: str
    to_member: str
    amount: float
    note: str | None = None
    has_receipt: bool = False
    recorded_by: str | None = None
    recorded_by_name: str | None = None
    confirmed_at: datetime | None = None
    confirmed_by_name: str | None = None
    can_confirm: bool = False  # computed per viewer
    created_at: datetime = Field(default_factory=_now)

    _aware = field_validator("created_at", "confirmed_at")(_utc)


class MemberBalance(BaseModel):
    member_id: str
    name: str
    paid: float
    share: float
    net: float  # >0 gets back, <0 owes


class Transfer(BaseModel):
    from_member: str
    from_name: str
    to_member: str
    to_name: str
    amount: float
    last_reminded_at: datetime | None = None


class GroupSummary(BaseModel):
    currency: Currency
    total_spent: float
    balances: list[MemberBalance]
    transfers: list[Transfer]
    settlements: list[Settlement]


class InviteLink(BaseModel):
    token: str


class InviteMember(BaseModel):
    id: str
    name: str
    claimed: bool  # linked to some other account
    mine: bool  # linked to the viewer


class InvitePreview(BaseModel):
    group_id: str
    group_name: str
    currency: Currency
    invited_by: str | None = None
    members: list[InviteMember]
    already_member: bool


class InviteJoin(BaseModel):
    member_id: str | None = None  # pick an existing name...
    new_name: str | None = Field(default=None, max_length=60)  # ...or add yourself
```

## `backend/models/notifications.py`

```python
import uuid
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field


class Notification(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    group_id: str
    group_name: str
    kind: Literal["expense", "settlement", "reminder", "member"]
    actor_name: str
    message: str
    read: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class NotificationList(BaseModel):
    items: list[Notification]
    unread_count: int
```

## `backend/routers/__init__.py`

```python
```

## `backend/routers/auth.py`

```python
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response

from lib.auth import COOKIE, TTL_DAYS, current_user, hash_password, make_token, verify_password
from lib.db import db
from models.auth import LoginIn, RegisterIn, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


def _set_cookie(resp: Response, user_id: str) -> None:
    resp.set_cookie(COOKIE, make_token(user_id), httponly=True, samesite="lax",
                    max_age=TTL_DAYS * 86400, path="/")


@router.post("/register", response_model=UserOut)
async def register(body: RegisterIn, response: Response):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "An account with this email already exists")
    user = {"id": str(uuid.uuid4()), "name": body.name.strip(), "email": email,
            "password_hash": hash_password(body.password), "created_at": datetime.now(timezone.utc)}
    await db.users.insert_one(user)
    _set_cookie(response, user["id"])
    return UserOut(**user)


@router.post("/login", response_model=UserOut)
async def login(body: LoginIn, response: Response):
    user = await db.users.find_one({"email": body.email.lower()})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    _set_cookie(response, user["id"])
    return UserOut(**user)


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.get("/me", response_model=UserOut)
async def me(user: dict = Depends(current_user)):
    return UserOut(**user)
```

## `backend/routers/groups.py`

```python
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import current_user
from lib.dates import today_iso
from lib.db import db
from lib.splits import compute_shares, net_balances, settled_expense_ids, simplify
from routers.notifications import notify
from models.groups import (
    Expense, ExpenseCreate, ExpenseEdit, Group, GroupCreate, GroupListItem, GroupSummary, Member,
    MemberAdd, MemberBalance, ReminderCreate, ReminderOut, Settlement, SettlementCreate, ShareIn, Transfer,
)

router = APIRouter(prefix="/groups", tags=["groups"])


async def _group_for(group_id: str, user: dict) -> dict:
    g = await db.groups.find_one({"id": group_id, "user_ids": user["id"]}, {"_id": 0})
    if not g:
        raise HTTPException(404, "Group not found")
    return g


async def _load(group_id: str):
    exps = await db.expenses.find({"group_id": group_id}, {"_id": 0}).sort("date", -1).to_list(5000)
    sets = await db.settlements.find({"group_id": group_id}, {"_id": 0}).sort("created_at", -1).to_list(5000)
    return exps, sets


@router.get("", response_model=list[GroupListItem])
async def list_groups(user: dict = Depends(current_user)):
    groups = await db.groups.find({"user_ids": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    out = []
    for g in groups:
        exps, sets = await _load(g["id"])
        _, _, net = net_balances([m["id"] for m in g["members"]], exps, sets)
        out.append(GroupListItem(**g, expense_count=len(exps),
                                 total_spent=round(sum(e["amount"] for e in exps), 2),
                                 unsettled_count=len(simplify(net))))
    return out


@router.post("", response_model=Group)
async def create_group(body: GroupCreate, user: dict = Depends(current_user)):
    names = [n.strip() for n in body.members if n.strip()]
    if not names:
        raise HTTPException(400, "Add at least one member")
    g = Group(name=body.name.strip(), currency=body.currency, members=[Member(name=n) for n in names],
              owner_id=user["id"], user_ids=[user["id"]])
    await db.groups.insert_one(g.model_dump())
    return g


@router.get("/{group_id}", response_model=Group)
async def get_group(group_id: str, user: dict = Depends(current_user)):
    return Group(**await _group_for(group_id, user))


@router.delete("/{group_id}")
async def delete_group(group_id: str, user: dict = Depends(current_user)):
    g = await _group_for(group_id, user)
    if g["owner_id"] != user["id"]:
        raise HTTPException(403, "Only the group owner can delete it")
    await db.groups.delete_one({"id": group_id})
    await db.expenses.delete_many({"group_id": group_id})
    await db.settlements.delete_many({"group_id": group_id})
    await db.receipts.delete_many({"group_id": group_id})
    await db.settlement_receipts.delete_many({"group_id": group_id})
    await db.reminders.delete_many({"group_id": group_id})
    return {"ok": True}


@router.post("/{group_id}/members", response_model=Group)
async def add_member(group_id: str, body: MemberAdd, user: dict = Depends(current_user)):
    g = await _group_for(group_id, user)
    if any(x["name"].lower() == body.name.strip().lower() for x in g["members"]):
        raise HTTPException(400, f"{body.name.strip()} is already in this group")
    m = Member(name=body.name.strip())
    await db.groups.update_one({"id": group_id}, {"$push": {"members": m.model_dump()}})
    g["members"].append(m.model_dump())
    return Group(**g)


@router.delete("/{group_id}/members/{member_id}", response_model=Group)
async def remove_member(group_id: str, member_id: str, user: dict = Depends(current_user)):
    g = await _group_for(group_id, user)
    member = next((m for m in g["members"] if m["id"] == member_id), None)
    if not member:
        raise HTTPException(404, "Member not found")
    if len(g["members"]) <= 1:
        raise HTTPException(400, "A group needs at least one member")
    used = await db.expenses.find_one(
        {"group_id": group_id, "$or": [{"paid_by": member_id}, {f"shares.{member_id}": {"$exists": True}}]})
    used = used or await db.settlements.find_one(
        {"group_id": group_id, "$or": [{"from_member": member_id}, {"to_member": member_id}]})
    if used:
        raise HTTPException(400, f'{member["name"]} is part of existing expenses or settlements — delete those first')
    await db.groups.update_one({"id": group_id}, {"$pull": {"members": {"id": member_id}}})
    g["members"] = [m for m in g["members"] if m["id"] != member_id]
    return Group(**g)


@router.post("/{group_id}/share", response_model=Group)
async def share_group(group_id: str, body: ShareIn, user: dict = Depends(current_user)):
    g = await _group_for(group_id, user)
    other = await db.users.find_one({"email": body.email.strip().lower()})
    if not other:
        raise HTTPException(404, "No account with that email — ask them to sign up first")
    if other["id"] not in g["user_ids"]:
        await db.groups.update_one({"id": group_id}, {"$addToSet": {"user_ids": other["id"]}})
        g["user_ids"].append(other["id"])
    return Group(**g)


@router.get("/{group_id}/expenses", response_model=list[Expense])
async def list_expenses(group_id: str, user: dict = Depends(current_user)):
    await _group_for(group_id, user)
    exps, sets = await _load(group_id)
    done = settled_expense_ids(exps, sets)
    return [Expense(**{**e, "settled": e["id"] in done}) for e in exps]


def _shares_for(g: dict, body: ExpenseCreate) -> dict[str, float]:
    member_ids = {m["id"] for m in g["members"]}
    if body.paid_by not in member_ids:
        raise HTTPException(400, "Payer is not a group member")
    return compute_shares(body.amount, body.split_type, member_ids, body.participant_ids, body.exact_amounts,
                          body.items)


@router.put("/{group_id}/expenses/{expense_id}", response_model=Expense)
async def edit_expense(group_id: str, expense_id: str, body: ExpenseCreate, user: dict = Depends(current_user)):
    g = await _group_for(group_id, user)
    old = await db.expenses.find_one({"id": expense_id, "group_id": group_id}, {"_id": 0})
    if not old:
        raise HTTPException(404, "Expense not found")
    shares = _shares_for(g, body)
    update = {"description": body.description.strip(), "amount": round(body.amount, 2), "paid_by": body.paid_by,
              "split_type": body.split_type, "shares": shares, "date": body.date or old["date"],
              "items": [i.model_dump() for i in body.items] if body.split_type == "items" else []}
    changes = _diff(old, update, g)
    if not changes:
        return Expense(**old)
    edit = ExpenseEdit(by_name=user["name"], changes=changes)
    update["updated_at"] = edit.at
    await db.expenses.update_one({"id": expense_id}, {"$set": update, "$push": {"edits": edit.model_dump()}})
    e = Expense(**{**old, **update, "edits": [*old.get("edits", []), edit.model_dump()]})
    await notify(g, user, "expense", f'{user["name"]} edited "{e.description}": {"; ".join(changes)}')
    return e


SPLIT_NAMES = {"equal": "Split equally", "exact": "Exact amounts", "full": "Owed in full", "items": "By item"}


def _diff(old: dict, new: dict, g: dict) -> list[str]:
    """Human-readable list of what changed between two expense versions."""
    names = {m["id"]: m["name"] for m in g["members"]}
    cur = g["currency"]
    out: list[str] = []
    if old["description"] != new["description"]:
        out.append(f'Description "{old["description"]}" → "{new["description"]}"')
    if round(old["amount"], 2) != new["amount"]:
        out.append(f'Amount {cur} {old["amount"]:.2f} → {cur} {new["amount"]:.2f}')
    if old["paid_by"] != new["paid_by"]:
        out.append(f'Paid by {names.get(old["paid_by"], "?")} → {names.get(new["paid_by"], "?")}')
    if old["split_type"] != new["split_type"]:
        out.append(f'Split {SPLIT_NAMES[old["split_type"]]} → {SPLIT_NAMES[new["split_type"]]}')
    elif set(old["shares"]) != set(new["shares"]):
        before = ", ".join(names.get(m, "?") for m in old["shares"])
        after = ", ".join(names.get(m, "?") for m in new["shares"])
        out.append(f"Split between {before} → {after}")
    elif new["split_type"] in ("exact", "items") and any(round(old["shares"][m], 2) != round(v, 2) for m, v in new["shares"].items()):
        out.append("Shares " + ", ".join(
            f'{names.get(m, "?")} {old["shares"][m]:.2f} → {v:.2f}'
            for m, v in new["shares"].items() if round(old["shares"][m], 2) != round(v, 2)))
    if new["split_type"] == "items" and old["split_type"] == "items" and old.get("items", []) != new["items"]:
        out.append("Receipt items updated")
    if old["date"] != new["date"]:
        out.append(f'Date {old["date"]} → {new["date"]}')
    return out


@router.post("/{group_id}/expenses", response_model=Expense)
async def add_expense(group_id: str, body: ExpenseCreate, user: dict = Depends(current_user)):
    g = await _group_for(group_id, user)
    shares = _shares_for(g, body)
    e = Expense(group_id=group_id, description=body.description.strip(), amount=round(body.amount, 2),
                paid_by=body.paid_by, split_type=body.split_type, shares=shares,
                items=body.items if body.split_type == "items" else [], date=body.date or today_iso())
    await db.expenses.insert_one(e.model_dump(exclude={"settled"}))
    names = {m["id"]: m["name"] for m in g["members"]}
    await notify(g, user, "expense",
                 f'{user["name"]} added "{e.description}" ({g["currency"]} {e.amount:.2f}, paid by {names[e.paid_by]})')
    return e


@router.delete("/{group_id}/expenses/{expense_id}")
async def delete_expense(group_id: str, expense_id: str, user: dict = Depends(current_user)):
    await _group_for(group_id, user)
    res = await db.expenses.delete_one({"id": expense_id, "group_id": group_id})
    if not res.deleted_count:
        raise HTTPException(404, "Expense not found")
    await db.receipts.delete_one({"expense_id": expense_id})
    return {"ok": True}


@router.post("/{group_id}/settlements", response_model=Settlement)
async def settle(group_id: str, body: SettlementCreate, user: dict = Depends(current_user)):
    g = await _group_for(group_id, user)
    ids = {m["id"] for m in g["members"]}
    if body.from_member not in ids or body.to_member not in ids or body.from_member == body.to_member:
        raise HTTPException(400, "Invalid settlement members")
    s = Settlement(group_id=group_id, from_member=body.from_member, to_member=body.to_member,
                   amount=round(body.amount, 2), note=(body.note or "").strip() or None,
                   recorded_by=user["id"], recorded_by_name=user["name"])
    await db.settlements.insert_one(s.model_dump(exclude={"can_confirm"}))
    s.can_confirm = _can_confirm(s.model_dump(), g, user)
    names = {m["id"]: m["name"] for m in g["members"]}
    await notify(g, user, "settlement",
                 f'{user["name"]} marked {names[s.from_member]} → {names[s.to_member]} '
                 f'({g["currency"]} {s.amount:.2f}) as settled' + (f' — "{s.note}"' if s.note else "")
                 + f' — {names[s.to_member]}, tap "Got it" to confirm')
    return s


def _can_confirm(s: dict, g: dict, user: dict) -> bool:
    """The recipient's linked account confirms; if nobody claimed the recipient, any account other than
    the one that recorded the payment may confirm."""
    if s.get("confirmed_at"):
        return False
    owner = next((m.get("user_id") for m in g["members"] if m["id"] == s["to_member"]), None)
    if owner:
        return owner == user["id"]
    return s.get("recorded_by") != user["id"]


@router.post("/{group_id}/settlements/{settlement_id}/confirm", response_model=Settlement)
async def confirm_settlement(group_id: str, settlement_id: str, user: dict = Depends(current_user)):
    g = await _group_for(group_id, user)
    s = await db.settlements.find_one({"id": settlement_id, "group_id": group_id}, {"_id": 0})
    if not s:
        raise HTTPException(404, "Settlement not found")
    names = {m["id"]: m["name"] for m in g["members"]}
    if s.get("confirmed_at"):
        raise HTTPException(400, "This payment is already confirmed")
    if not _can_confirm(s, g, user):
        to = names.get(s["to_member"], "the person being paid")
        claimed = any(m["id"] == s["to_member"] and m.get("user_id") for m in g["members"])
        raise HTTPException(403, f"Only {to} can confirm this payment" if claimed else
                            f"You recorded this payment, so someone else ({to}) needs to confirm it")
    upd = {"confirmed_at": datetime.now(timezone.utc), "confirmed_by_name": user["name"]}
    await db.settlements.update_one({"id": settlement_id}, {"$set": upd})
    await notify(g, user, "settlement",
                 f'{user["name"]} confirmed {names.get(s["to_member"], "?")} received {g["currency"]} {s["amount"]:.2f} '
                 f'from {names.get(s["from_member"], "?")}')
    return Settlement(**{**s, **upd})


@router.post("/{group_id}/members/{member_id}/claim", response_model=Group)
async def claim_member(group_id: str, member_id: str, user: dict = Depends(current_user)):
    """Toggle "this is me": links the caller's account to one member of the group."""
    g = await _group_for(group_id, user)
    m = next((m for m in g["members"] if m["id"] == member_id), None)
    if not m:
        raise HTTPException(404, "Member not found")
    if m.get("user_id") and m["user_id"] != user["id"]:
        raise HTTPException(400, f'{m["name"]} is already linked to another account')
    mine = m.get("user_id") == user["id"]
    for x in g["members"]:
        if x.get("user_id") == user["id"]:
            x["user_id"] = None
    if not mine:
        m["user_id"] = user["id"]
    await db.groups.update_one({"id": group_id}, {"$set": {"members": g["members"]}})
    return Group(**g)


REMINDER_COOLDOWN = timedelta(hours=24)


@router.post("/{group_id}/remind", response_model=ReminderOut)
async def remind(group_id: str, body: ReminderCreate, user: dict = Depends(current_user)):
    g = await _group_for(group_id, user)
    names = {m["id"]: m["name"] for m in g["members"]}
    exps, sets = await _load(group_id)
    _, _, net = net_balances(list(names), exps, sets)
    owed = next((a for f, t, a in simplify(net) if f == body.from_member and t == body.to_member), None)
    if owed is None:
        raise HTTPException(400, "There is no open debt between these people")
    amount = owed / 100
    pair = {"group_id": group_id, "from_member": body.from_member, "to_member": body.to_member}
    last = await db.reminders.find_one(pair, {"_id": 0, "at": 1}, sort=[("at", -1)])
    if last:
        wait = last["at"].replace(tzinfo=timezone.utc) + REMINDER_COOLDOWN - datetime.now(timezone.utc)
        if wait.total_seconds() > 0:
            hours = max(1, round(wait.total_seconds() / 3600))
            raise HTTPException(429, f'{names[body.from_member]} was already reminded today — '
                                     f'try again in about {hours} hour{"s" if hours != 1 else ""}')
    count = await notify(g, user, "reminder",
                         f'Reminder from {user["name"]}: {names[body.from_member]} still owes '
                         f'{names[body.to_member]} {g["currency"]} {amount:.2f}')
    if count:  # only start the 24h cooldown when someone actually received it
        await db.reminders.insert_one({**pair, "by": user["id"], "at": datetime.now(timezone.utc)})
    return ReminderOut(notified=count, amount=amount)


@router.delete("/{group_id}/settlements/{settlement_id}")
async def undo_settlement(group_id: str, settlement_id: str, user: dict = Depends(current_user)):
    await _group_for(group_id, user)
    res = await db.settlements.delete_one({"id": settlement_id, "group_id": group_id})
    if not res.deleted_count:
        raise HTTPException(404, "Settlement not found")
    await db.settlement_receipts.delete_one({"settlement_id": settlement_id})
    return {"ok": True}


@router.get("/{group_id}/summary", response_model=GroupSummary)
async def summary(group_id: str, user: dict = Depends(current_user)):
    g = await _group_for(group_id, user)
    exps, sets = await _load(group_id)
    names = {m["id"]: m["name"] for m in g["members"]}
    paid, share, net = net_balances(list(names), exps, sets)
    balances = [MemberBalance(member_id=m, name=n, paid=paid[m] / 100, share=share[m] / 100, net=net[m] / 100)
                for m, n in names.items()]
    balances.sort(key=lambda b: -b.net)
    since = datetime.now(timezone.utc) - REMINDER_COOLDOWN
    recent: dict[tuple[str, str], datetime] = {}
    async for r in db.reminders.find({"group_id": group_id, "at": {"$gte": since}}, {"_id": 0}).sort("at", 1):
        recent[(r["from_member"], r["to_member"])] = r["at"].replace(tzinfo=timezone.utc)
    transfers = [Transfer(from_member=f, from_name=names.get(f, "?"), to_member=t, to_name=names.get(t, "?"),
                          amount=a / 100, last_reminded_at=recent.get((f, t))) for f, t, a in simplify(net)]
    return GroupSummary(currency=g["currency"], total_spent=round(sum(e["amount"] for e in exps), 2),
                        balances=balances, transfers=transfers, settlements=[Settlement(**{**s, "can_confirm": _can_confirm(s, g, user)}) for s in sets])
```

## `backend/routers/invites.py`

```python
"""Group invite links: anyone with the link (and an account) can join and link themselves to a name."""

import secrets

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import current_user
from lib.db import db
from models.groups import Group, InviteJoin, InviteLink, InviteMember, InvitePreview, Member
from routers.groups import _group_for
from routers.notifications import notify

router = APIRouter(tags=["invites"])


def _new_token() -> str:
    return secrets.token_urlsafe(12)


@router.post("/groups/{group_id}/invite", response_model=InviteLink)
async def get_invite(group_id: str, user: dict = Depends(current_user)):
    """Returns the group's invite token, creating one on first use."""
    g = await _group_for(group_id, user)
    token = g.get("invite_token")
    if not token:
        token = _new_token()
        await db.groups.update_one({"id": group_id}, {"$set": {"invite_token": token, "invite_by": user["name"]}})
    return InviteLink(token=token)


@router.post("/groups/{group_id}/invite/reset", response_model=InviteLink)
async def reset_invite(group_id: str, user: dict = Depends(current_user)):
    """Issue a fresh token; the old link stops working."""
    await _group_for(group_id, user)
    token = _new_token()
    await db.groups.update_one({"id": group_id}, {"$set": {"invite_token": token, "invite_by": user["name"]}})
    return InviteLink(token=token)


async def _by_token(token: str) -> dict:
    g = await db.groups.find_one({"invite_token": token}, {"_id": 0})
    if not g:
        raise HTTPException(404, "This invite link is invalid or has been reset — ask for a new one")
    return g


@router.get("/invites/{token}", response_model=InvitePreview)
async def preview_invite(token: str, user: dict = Depends(current_user)):
    g = await _by_token(token)
    return InvitePreview(
        group_id=g["id"], group_name=g["name"], currency=g["currency"], invited_by=g.get("invite_by"),
        members=[InviteMember(id=m["id"], name=m["name"],
                              claimed=bool(m.get("user_id")) and m.get("user_id") != user["id"],
                              mine=m.get("user_id") == user["id"]) for m in g["members"]],
        already_member=user["id"] in g["user_ids"],
    )


@router.post("/invites/{token}/join", response_model=Group)
async def join_invite(token: str, body: InviteJoin, user: dict = Depends(current_user)):
    g = await _by_token(token)
    new_name = (body.new_name or "").strip()
    if bool(body.member_id) == bool(new_name):
        raise HTTPException(400, "Pick your name or enter a new one")
    for m in g["members"]:  # an account is one person per group
        if m.get("user_id") == user["id"]:
            m["user_id"] = None
    if body.member_id:
        target = next((m for m in g["members"] if m["id"] == body.member_id), None)
        if not target:
            raise HTTPException(404, "That person is no longer in the group")
        if target.get("user_id"):
            raise HTTPException(400, f'{target["name"]} is already linked to another account')
        target["user_id"] = user["id"]
    else:
        if any(m["name"].lower() == new_name.lower() for m in g["members"]):
            raise HTTPException(400, f"{new_name} is already in this group — pick that name instead")
        target = Member(name=new_name, user_id=user["id"]).model_dump()
        g["members"].append(target)
    joined = user["id"] not in g["user_ids"]
    if joined:
        g["user_ids"].append(user["id"])
    await db.groups.update_one({"id": g["id"]}, {"$set": {"members": g["members"], "user_ids": g["user_ids"]}})
    if joined:
        await notify(g, user, "member", f'{user["name"]} joined {g["name"]} as {target["name"]}')
    return Group(**g)
```

## `backend/routers/notifications.py`

```python
from datetime import timezone

from fastapi import APIRouter, Depends, HTTPException

from lib.auth import current_user
from lib.db import db
from models.notifications import Notification, NotificationList

router = APIRouter(prefix="/notifications", tags=["notifications"])


async def notify(group: dict, actor: dict, kind: str, message: str) -> int:
    """Fan out one notification to every account on the group except the actor."""
    docs = [
        Notification(user_id=uid, group_id=group["id"], group_name=group["name"], kind=kind,
                     actor_name=actor["name"], message=message).model_dump()
        for uid in group["user_ids"] if uid != actor["id"]
    ]
    if docs:
        await db.notifications.insert_many(docs)
    return len(docs)


def _aware(doc: dict) -> dict:
    doc["created_at"] = doc["created_at"].replace(tzinfo=timezone.utc)
    return doc


@router.get("", response_model=NotificationList)
async def list_notifications(user: dict = Depends(current_user)):
    docs = await db.notifications.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    unread = await db.notifications.count_documents({"user_id": user["id"], "read": False})
    return NotificationList(items=[Notification(**_aware(d)) for d in docs], unread_count=unread)


@router.post("/read-all")
async def read_all(user: dict = Depends(current_user)):
    await db.notifications.update_many({"user_id": user["id"], "read": False}, {"$set": {"read": True}})
    return {"ok": True}


@router.post("/{notification_id}/read")
async def read_one(notification_id: str, user: dict = Depends(current_user)):
    res = await db.notifications.update_one({"id": notification_id, "user_id": user["id"]}, {"$set": {"read": True}})
    if not res.matched_count:
        raise HTTPException(404, "Notification not found")
    return {"ok": True}
```

## `backend/routers/receipts.py`

```python
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
```

## `frontend/index.html`

```html
<!doctype html>
<html lang="en">
  <!-- <html lang="en" class="dark"> — uncomment for dark-by-default (replace the tag above; `dark` is a Tailwind variant, never `@apply` it) -->
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="icon" href="/favicon.ico" sizes="any" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Splitly — split bills, settle up</title>
    <meta name="description" content="Split group expenses equally, by exact amounts, or in full, and see who owes whom with simplified settle-up." />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

## `frontend/vite.config.ts`

```tsx
import path from "node:path";
import { defineConfig, type UserConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { visualEdits } from "@emergentbase/visual-edits/vite";

// Supervisor exports DISABLE_HOT_RELOAD=true when the platform sets ENABLE_RELOAD=false.
const hotReloadDisabled = process.env.DISABLE_HOT_RELOAD === "true";

// Visual Edits (x-* JSX tagging, overlay, /edit-file endpoint) is dev-server-only by
// default (apply: serve); escape hatch mirrors DISABLE_HOT_RELOAD.
const visualEditsDisabled = process.env.DISABLE_VISUAL_EDITS === "true";

// Branded error overlay (build + runtime errors); escape hatch mirrors the two above.
const emergentOverlayDisabled = process.env.DISABLE_EMERGENT_OVERLAY === "true";

// Fails open: a broken overlay package must degrade to "no overlay" (Vite's own overlay
// takes over), never to "no dev server". Never let a preview aid take the app down.
async function loadEmergentOverlay() {
  if (emergentOverlayDisabled) return null;
  try {
    const mod = await import("@emergentbase/overlay/vite");
    return mod.emergentOverlay();
  } catch (e) {
    console.warn("[emergent-overlay] plugin failed to load; using Vite's overlay instead:", e instanceof Error ? e.message : e);
    return null;
  }
}

// Pod inotify quota is node-shared and routinely exhausted; native fs.watch EMFILEs at
// boot. Polling is the load-bearing default (set before Vite evaluates the config).
if (!hotReloadDisabled) {
  process.env.CHOKIDAR_USEPOLLING = "true";
}

// https://vite.dev/config/
export default defineConfig(async () => {
  const emergentOverlay = await loadEmergentOverlay();
  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(visualEditsDisabled ? [] : [visualEdits()]),
      // No isServe guard: this factory takes no ConfigEnv arg, so build purity here rests
      // on the package's own `apply: "serve"`.
      ...(emergentOverlay ? [emergentOverlay] : []),
    ],
    resolve: {
      alias: [
        { find: "@", replacement: path.resolve(__dirname, "./src") },
        // lucide 1.x dropped brand logos; src/lib/lucide-react.tsx restores them on top of the real package.
        { find: /^lucide-react$/, replacement: path.resolve(__dirname, "./src/lib/lucide-react.tsx") },
        { find: "lucide-react-upstream", replacement: path.resolve(__dirname, "./node_modules/lucide-react") },
        // recharts 3's Tooltip callback types reject the annotations agents write; src/lib/recharts.tsx adapts them.
        { find: /^recharts$/, replacement: path.resolve(__dirname, "./src/lib/recharts.tsx") },
        { find: "recharts-upstream", replacement: path.resolve(__dirname, "./node_modules/recharts") },
      ],
    },
    // Every shipped dep, pre-bundled up front. Vite discovers deps lazily, so the first
    // import outside the initial graph would trigger a re-optimize + reload mid-session.
    optimizeDeps: {
      include: [
        "@base-ui/react/button",
        "@base-ui/react/checkbox",
        "@base-ui/react/dialog",
        "@base-ui/react/input",
        "@base-ui/react/menu",
        "@base-ui/react/merge-props",
        "@base-ui/react/popover",
        "@base-ui/react/select",
        "@base-ui/react/tabs",
        "@base-ui/react/use-render",
        "@tanstack/react-query",
        "class-variance-authority",
        "clsx",
        "date-fns",
        "@icons-pack/react-simple-icons",
        "lucide-react-upstream",
        "motion/react",
        "next-themes",
        "react",
        "react-day-picker",
        "react-dom/client",
        "react-is",
        "react-router-dom",
        "recharts-upstream",
        "sonner",
        "tailwind-merge",
      ],
    },
    server: {
      host: true,
      port: 3000,
      allowedHosts: true,
      // Preview probe + /edit-file are cross-origin from the Emergent tab; Vite defaults to localhost-only CORS.
      cors: true,
      // No hmr.clientPort override: Vite infers the WS target from window.location, which
      // is correct on both localhost:3000 (smoke) and the https/:443 preview proxy.
      // Build-error rendering: emergent-overlay when it loaded, else Vite's own overlay.
      hmr: hotReloadDisabled ? false : { overlay: !emergentOverlay },
      watch: hotReloadDisabled ? null : { usePolling: true, interval: 300 },
      // The /api proxy convention: frontend code calls relative /api/*, never an
      // absolute backend URL. Target is the FastAPI dev server (supervisor: backend).
      proxy: {
        "/api": {
          target: "http://localhost:8001",
          changeOrigin: true,
        },
      },
    },
  } satisfies UserConfig;
});
```

## `frontend/src/index.css`

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@import "@fontsource-variable/jetbrains-mono";
@import "@fontsource-variable/plus-jakarta-sans";

@custom-variant dark (&:is(.dark *));

@theme inline {
    --font-heading: var(--font-sans);
    --font-sans: 'Plus Jakarta Sans Variable', sans-serif;
    --font-mono: 'JetBrains Mono Variable', monospace;
    --color-sidebar-ring: var(--sidebar-ring);
    --color-sidebar-border: var(--sidebar-border);
    --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
    --color-sidebar-accent: var(--sidebar-accent);
    --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
    --color-sidebar-primary: var(--sidebar-primary);
    --color-sidebar-foreground: var(--sidebar-foreground);
    --color-sidebar: var(--sidebar);
    --color-chart-5: var(--chart-5);
    --color-chart-4: var(--chart-4);
    --color-chart-3: var(--chart-3);
    --color-chart-2: var(--chart-2);
    --color-chart-1: var(--chart-1);
    --color-ring: var(--ring);
    --color-input: var(--input);
    --color-border: var(--border);
    --color-destructive: var(--destructive);
    --color-accent-foreground: var(--accent-foreground);
    --color-accent: var(--accent);
    --color-muted-foreground: var(--muted-foreground);
    --color-muted: var(--muted);
    --color-secondary-foreground: var(--secondary-foreground);
    --color-secondary: var(--secondary);
    --color-primary-foreground: var(--primary-foreground);
    --color-primary: var(--primary);
    --color-popover-foreground: var(--popover-foreground);
    --color-popover: var(--popover);
    --color-card-foreground: var(--card-foreground);
    --color-card: var(--card);
    --color-foreground: var(--foreground);
    --color-background: var(--background);
    --radius-sm: calc(var(--radius) * 0.6);
    --radius-md: calc(var(--radius) * 0.8);
    --radius-lg: var(--radius);
    --radius-xl: calc(var(--radius) * 1.4);
    --radius-2xl: calc(var(--radius) * 1.8);
    --radius-3xl: calc(var(--radius) * 2.2);
    --radius-4xl: calc(var(--radius) * 2.6);
}

:root {
    --background: #F8FAFC;
    --foreground: #0F172A;
    --card: #FFFFFF;
    --card-foreground: #0F172A;
    --popover: #FFFFFF;
    --popover-foreground: #0F172A;
    --primary: #0D9488;
    --primary-foreground: #FFFFFF;
    --secondary: #F1F5F9;
    --secondary-foreground: #0F172A;
    --muted: #F1F5F9;
    --muted-foreground: #475569;
    --accent: #F0FDFA;
    --accent-foreground: #134E4A;
    --destructive: #E11D48;
    --border: #E2E8F0;
    --input: #E2E8F0;
    --ring: #0D9488;
    --chart-1: oklch(0.87 0 0);
    --chart-2: oklch(0.556 0 0);
    --chart-3: oklch(0.439 0 0);
    --chart-4: oklch(0.371 0 0);
    --chart-5: oklch(0.269 0 0);
    --radius: 0.75rem;
    --sidebar: oklch(0.985 0 0);
    --sidebar-foreground: oklch(0.145 0 0);
    --sidebar-primary: oklch(0.205 0 0);
    --sidebar-primary-foreground: oklch(0.985 0 0);
    --sidebar-accent: oklch(0.97 0 0);
    --sidebar-accent-foreground: oklch(0.205 0 0);
    --sidebar-border: oklch(0.922 0 0);
    --sidebar-ring: oklch(0.708 0 0);
}

.dark {
    --background: oklch(0.145 0 0);
    --foreground: oklch(0.985 0 0);
    --card: oklch(0.205 0 0);
    --card-foreground: oklch(0.985 0 0);
    --popover: oklch(0.205 0 0);
    --popover-foreground: oklch(0.985 0 0);
    --primary: oklch(0.922 0 0);
    --primary-foreground: oklch(0.205 0 0);
    --secondary: oklch(0.269 0 0);
    --secondary-foreground: oklch(0.985 0 0);
    --muted: oklch(0.269 0 0);
    --muted-foreground: oklch(0.708 0 0);
    --accent: oklch(0.269 0 0);
    --accent-foreground: oklch(0.985 0 0);
    --destructive: oklch(0.704 0.191 22.216);
    --border: oklch(1 0 0 / 10%);
    --input: oklch(1 0 0 / 15%);
    --ring: oklch(0.556 0 0);
    --chart-1: oklch(0.87 0 0);
    --chart-2: oklch(0.556 0 0);
    --chart-3: oklch(0.439 0 0);
    --chart-4: oklch(0.371 0 0);
    --chart-5: oklch(0.269 0 0);
    --sidebar: oklch(0.205 0 0);
    --sidebar-foreground: oklch(0.985 0 0);
    --sidebar-primary: oklch(0.488 0.243 264.376);
    --sidebar-primary-foreground: oklch(0.985 0 0);
    --sidebar-accent: oklch(0.269 0 0);
    --sidebar-accent-foreground: oklch(0.985 0 0);
    --sidebar-border: oklch(1 0 0 / 10%);
    --sidebar-ring: oklch(0.556 0 0);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
    }
  body {
    @apply bg-background text-foreground;
    }
  html {
    @apply font-sans;
    }
}
@keyframes settle-pop {
  0% { transform: scale(1); }
  40% { transform: scale(1.04); background-color: #DCFCE7; }
  100% { transform: scale(1); }
}
@keyframes rise-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.animate-rise-in { animation: rise-in 320ms cubic-bezier(.2,.7,.2,1) both; }
.animate-settle-pop { animation: settle-pop 500ms ease-out; }
.money { font-family: var(--font-mono); font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
@media (prefers-reduced-motion: reduce) { .animate-rise-in, .animate-settle-pop { animation: none; } }
@keyframes bell-ring {
  0%, 100% { transform: rotate(0); }
  15% { transform: rotate(14deg); }
  30% { transform: rotate(-12deg); }
  45% { transform: rotate(8deg); }
  60% { transform: rotate(-4deg); }
}
```

## `frontend/src/main.tsx`

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { queryClient } from './lib/queryClient'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
```

## `frontend/src/App.tsx`

```tsx
import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import AppShell from "@/components/AppShell";
import AuthPage from "@/pages/Auth";
import Groups from "@/pages/Groups";
import GroupDetail from "@/pages/GroupDetail";
import JoinGroup from "@/pages/Join";

// One <Route> per page in src/pages; BrowserRouter already wraps this in main.tsx.
export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route element={<AppShell />}>
          <Route path="/groups" element={<Groups />} />
          <Route path="/groups/:id" element={<GroupDetail />} />
          <Route path="/join/:token" element={<JoinGroup />} />
        </Route>
        <Route path="*" element={<Navigate to="/groups" replace />} />
      </Routes>
      <Toaster richColors />
    </>
  );
}
```

## `frontend/src/lib/api.ts`

```tsx
// Typed fetch layer over the FastAPI backend. Base is the relative "/api" prefix so the
// same code works in dev (Vite proxies /api → :8001) and behind a single origin in prod.
const BASE = "/api";

// Fields are declared, not constructor parameter properties: tsconfig sets
// erasableSyntaxOnly, which rejects `constructor(readonly status: number)`.
export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`request failed with ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type JsonBody = unknown;

async function request<T>(method: string, path: string, body?: JsonBody): Promise<T> {
  // Auth rides the httpOnly session cookie automatically — never add auth headers here.
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  // FastAPI reports request-validation failures as 422 with a {detail: [...]} body.
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new ApiError(res.status, errBody);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// The response type is yours to declare: nothing infers across the Python boundary, so a
// TS interface here mirrors the endpoint's Pydantic model by hand — keep the two in sync.
export const apiGet = <T>(path: string) => request<T>("GET", path);
export const apiPost = <T>(path: string, body?: JsonBody) => request<T>("POST", path, body ?? null);
export const apiPut = <T>(path: string, body?: JsonBody) => request<T>("PUT", path, body ?? null);
export const apiPatch = <T>(path: string, body?: JsonBody) =>
  request<T>("PATCH", path, body ?? null);
export const apiDelete = <T>(path: string) => request<T>("DELETE", path);
```

## `frontend/src/lib/format.ts`

```tsx
import { ApiError } from "@/lib/api";
import type { Currency } from "@/lib/types";

export const CURRENCIES: { code: Currency; label: string }[] = [
  { code: "USD", label: "USD — US Dollar ($)" },
  { code: "EUR", label: "EUR — Euro (€)" },
  { code: "GBP", label: "GBP — British Pound (£)" },
  { code: "INR", label: "INR — Indian Rupee (₹)" },
  { code: "NZD", label: "NZD — NZ Dollar ($)" },
  { code: "AUD", label: "AUD — Australian Dollar ($)" },
  { code: "CAD", label: "CAD — Canadian Dollar ($)" },
  { code: "SGD", label: "SGD — Singapore Dollar ($)" },
  { code: "JPY", label: "JPY — Japanese Yen (¥)" },
];

export function money(amount: number, currency: Currency): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function errorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (err instanceof ApiError) {
    const body = err.body as { detail?: unknown } | null;
    if (typeof body?.detail === "string") return body.detail;
    if (Array.isArray(body?.detail)) {
      const first = body.detail[0] as { msg?: string } | undefined;
      if (first?.msg) return first.msg;
    }
  }
  return fallback;
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
```

## `frontend/src/lib/image.ts`

```tsx
const MAX_SIDE = 1600;

/** Downscale to MAX_SIDE and re-encode as JPEG so uploads stay small. Returns a data URL. */
export async function compressImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}
```

## `frontend/src/lib/queryClient.ts`

```tsx
import { QueryClient } from "@tanstack/react-query";

// Exported so lib/session can wipe it at session boundaries — cached data outlives logout.
export const queryClient = new QueryClient();
```

## `frontend/src/lib/session.ts`

```tsx
// Session boundary: auth is an httpOnly cookie the backend owns; the frontend's one
// duty is wiping the react-query cache so one account's data never renders for the next.
import { queryClient } from "./queryClient";
import { apiPost } from "./api";

// Call after every successful login/signup.
export function beginSession(): void {
  queryClient.clear();
}

// Call from every sign-out control; the hard redirect resets all in-memory state.
export async function endSession(redirectTo: string = "/login"): Promise<void> {
  try {
    await apiPost("/auth/logout");
  } finally {
    queryClient.clear();
    window.location.assign(redirectTo);
  }
}
```

## `frontend/src/lib/types.ts`

```tsx
// Hand-written mirrors of backend/models/*.py — keep in sync.
export interface User {
  id: string;
  name: string;
  email: string;
}

export type Currency = "NZD" | "AUD" | "USD" | "EUR" | "GBP" | "JPY" | "CAD" | "SGD" | "INR";
export type SplitType = "equal" | "exact" | "full" | "items";

export interface Member {
  id: string;
  name: string;
  user_id: string | null;
}

export interface ExpenseItem {
  name: string;
  price: number;
  member_ids: string[];
}

export interface Group {
  id: string;
  name: string;
  currency: Currency;
  members: Member[];
  owner_id: string;
  user_ids: string[];
  created_at: string;
}

export interface GroupListItem extends Group {
  expense_count: number;
  total_spent: number;
  unsettled_count: number;
}

export interface GroupCreate {
  name: string;
  currency: Currency;
  members: string[];
}

export interface ExpenseCreate {
  description: string;
  amount: number;
  paid_by: string;
  split_type: SplitType;
  participant_ids: string[];
  exact_amounts: Record<string, number>;
  items?: ExpenseItem[];
  date?: string | null;
}

export interface ExpenseEdit {
  at: string;
  by_name: string;
  changes: string[];
}

export interface Expense {
  id: string;
  group_id: string;
  description: string;
  amount: number;
  paid_by: string;
  split_type: SplitType;
  shares: Record<string, number>;
  items: ExpenseItem[];
  date: string;
  created_at: string;
  updated_at: string | null;
  edits: ExpenseEdit[];
  has_receipt: boolean;
  settled: boolean;
}

export interface SettlementCreate {
  from_member: string;
  to_member: string;
  amount: number;
  note?: string | null;
}

export interface ReminderCreate {
  from_member: string;
  to_member: string;
}

export interface ReceiptIn {
  data_url: string;
}

export interface ScannedItem {
  name: string;
  price: number;
}

export interface ReceiptScan {
  items: ScannedItem[];
  amount: number | null;
  description: string | null;
  date: string | null;
  currency: string | null;
}

export interface ReminderOut {
  notified: number;
  amount: number;
}

export interface Settlement {
  id: string;
  group_id: string;
  from_member: string;
  to_member: string;
  amount: number;
  note: string | null;
  has_receipt: boolean;
  recorded_by: string | null;
  recorded_by_name: string | null;
  confirmed_at: string | null;
  confirmed_by_name: string | null;
  can_confirm: boolean;
  created_at: string;
}

export interface MemberBalance {
  member_id: string;
  name: string;
  paid: number;
  share: number;
  net: number;
}

export interface Transfer {
  from_member: string;
  from_name: string;
  to_member: string;
  to_name: string;
  amount: number;
  last_reminded_at: string | null;
}

export interface GroupSummary {
  currency: Currency;
  total_spent: number;
  balances: MemberBalance[];
  transfers: Transfer[];
  settlements: Settlement[];
}

// mirrors backend/models/notifications.py
export interface Notification {
  id: string;
  user_id: string;
  group_id: string;
  group_name: string;
  kind: "expense" | "settlement" | "reminder" | "member";
  actor_name: string;
  message: string;
  read: boolean;
  created_at: string;
}

export interface NotificationList {
  items: Notification[];
  unread_count: number;
}

export interface InviteLink {
  token: string;
}

export interface InviteMember {
  id: string;
  name: string;
  claimed: boolean;
  mine: boolean;
}

export interface InvitePreview {
  group_id: string;
  group_name: string;
  currency: Currency;
  invited_by: string | null;
  members: InviteMember[];
  already_member: boolean;
}

export interface InviteJoin {
  member_id?: string | null;
  new_name?: string | null;
}
```

## `frontend/src/lib/useMe.ts`

```tsx
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { User } from "@/lib/types";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => apiGet<User>("/auth/me"),
    retry: false,
    staleTime: 60_000,
  });
}
```

## `frontend/src/lib/utils.ts`

```tsx
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

## `frontend/src/components/AddExpenseDialog.tsx`

```tsx
import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Equal, ListChecks, ListOrdered, Loader2, Pencil, Plus, ScanLine, User as UserIcon, X } from "lucide-react";
import ItemSplitEditor, { newDraftItem, type DraftItem } from "@/components/ItemSplitEditor";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiPost, apiPut } from "@/lib/api";
import { errorMessage, money } from "@/lib/format";
import { compressImage } from "@/lib/image";
import type { Expense, ExpenseCreate, Group, ReceiptIn, ReceiptScan, SplitType } from "@/lib/types";
import { cn } from "@/lib/utils";

const SPLITS: { type: SplitType; label: string; hint: string; icon: typeof Equal }[] = [
  { type: "equal", label: "Equally", hint: "Divide evenly among selected people", icon: Equal },
  { type: "exact", label: "Exact", hint: "Enter what each person owes", icon: ListOrdered },
  { type: "full", label: "In full", hint: "One person owes the whole amount", icon: UserIcon },
  { type: "items", label: "By item", hint: "Tick who had each item on the receipt", icon: ListChecks },
];

export default function AddExpenseDialog({ group, expense }: { group: Group; expense?: Expense }) {
  const isEdit = !!expense;
  const qc = useQueryClient();
  const allIds = group.members.map((m) => m.id);
  const nameOf = (id: string) => group.members.find((m) => m.id === id)?.name ?? "?";

  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState(allIds[0] ?? "");
  const [splitType, setSplitType] = useState<SplitType>("equal");
  const [selected, setSelected] = useState<string[]>(allIds);
  const [exact, setExact] = useState<Record<string, string>>({});
  const [fullOwer, setFullOwer] = useState(allIds[1] ?? allIds[0] ?? "");
  const [date, setDate] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    if (expense) {
      const ids = Object.keys(expense.shares);
      setDescription(expense.description); setAmount(String(expense.amount));
      setPaidBy(expense.paid_by); setSplitType(expense.split_type);
      setSelected(expense.split_type === "equal" ? ids : allIds);
      setExact(expense.split_type === "exact"
        ? Object.fromEntries(Object.entries(expense.shares).map(([k, v]) => [k, String(v)]))
        : {});
      setFullOwer(expense.split_type === "full" ? ids[0]! : allIds[1] ?? allIds[0] ?? "");
      setDate(expense.date); setReceipt(null); setScanNote(null);
      setItems((expense.items ?? []).map((it) => newDraftItem(it.name, String(it.price), it.member_ids)));
      return;
    }
    setDate(""); setReceipt(null); setScanNote(null); setItems([]);
    setDescription(""); setAmount(""); setPaidBy(allIds[0] ?? ""); setSplitType("equal");
    setSelected(allIds); setExact({}); setFullOwer(allIds[1] ?? allIds[0] ?? "");
  };

  const total = Number(amount) || 0;
  const exactSum = useMemo(
    () => Object.values(exact).reduce((s, v) => s + (Number(v) || 0), 0),
    [exact],
  );
  const remaining = Math.round((total - exactSum) * 100) / 100;
  const perHead = selected.length ? total / selected.length : 0;

  const scan = useMutation({
    mutationFn: async (file: File) => {
      if (!file.type.startsWith("image/")) throw new Error("not-image");
      const data_url = await compressImage(file);
      setReceipt(data_url);
      return apiPost<ReceiptScan>("/receipts/scan", { data_url } satisfies ReceiptIn);
    },
    onSuccess: (r) => {
      const found: string[] = [];
      if (r.amount) { setAmount(r.amount.toFixed(2)); found.push("amount"); }
      if (r.description) { setDescription(r.description); found.push("description"); }
      if (r.date) { setDate(r.date); found.push("date"); }
      if (r.items.length) {
        setItems(r.items.map((it) => newDraftItem(it.name, it.price.toFixed(2), allIds)));
        setSplitType("items");
        found.push(`${r.items.length} items`);
      }
      const curWarn = r.currency && r.currency !== group.currency
        ? ` Heads up: the receipt looks like ${r.currency}, this group uses ${group.currency}.` : "";
      setScanNote(found.length
        ? `Filled in ${found.join(", ")} from the receipt — please double-check${r.items.length ? " and tick who had each item" : ""}.${curWarn}`
        : "Couldn't read this receipt clearly — please type the details. The photo will still be attached.");
      if (found.length) toast.success("Receipt scanned");
    },
    onError: (e) => {
      setScanNote(null);
      toast.error(e instanceof Error && e.message === "not-image" ? "Please pick an image file" : errorMessage(e, "Could not scan receipt"));
    },
  });

  const mut = useMutation({
    mutationFn: async (body: ExpenseCreate) => {
      if (expense) return apiPut<Expense>(`/groups/${group.id}/expenses/${expense.id}`, body);
      const created = await apiPost<Expense>(`/groups/${group.id}/expenses`, body);
      if (receipt) {
        await apiPut(`/groups/${group.id}/expenses/${created.id}/receipt`, { data_url: receipt } satisfies ReceiptIn)
          .catch(() => toast.error("Expense saved, but the receipt photo couldn't be attached"));
      }
      return created;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["group", group.id] });
      qc.invalidateQueries({ queryKey: ["groups"] });
      toast.success(isEdit ? "Expense updated" : "Expense added");
      setOpen(false);
    },
    onError: (e) => toast.error(errorMessage(e, isEdit ? "Could not update expense" : "Could not add expense")),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (total <= 0) return toast.error("Enter an amount above zero");
    if (splitType === "equal" && !selected.length) return toast.error("Select at least one person");
    if (splitType === "exact" && Math.abs(remaining) >= 0.005) return toast.error(`Amounts must add up to ${money(total, group.currency)}`);
    if (splitType === "items") {
      if (!items.length) return toast.error("Add at least one item");
      const bad = items.find((it) => !it.name.trim() || !(Number(it.price) > 0));
      if (bad) return toast.error("Every item needs a name and a price");
      const nobody = items.find((it) => !it.member_ids.length);
      if (nobody) return toast.error(`Pick who had "${nobody.name}"`);
    }
    mut.mutate({
      description,
      amount: total,
      paid_by: paidBy,
      split_type: splitType,
      participant_ids: splitType === "equal" ? selected : splitType === "full" ? [fullOwer] : [],
      exact_amounts: splitType === "exact"
        ? Object.fromEntries(Object.entries(exact).map(([k, v]) => [k, Number(v) || 0]))
        : {},
      items: splitType === "items"
        ? items.map((it) => ({ name: it.name.trim(), price: Number(it.price), member_ids: it.member_ids }))
        : [],
      date: date || null,
    });
  };

  const memberSelect = (value: string, onChange: (v: string) => void, testid: string) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full" data-testid={testid}>
        <SelectValue>{(v) => nameOf(v as string)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {group.members.map((m) => (
          <SelectItem key={m.id} value={m.id} data-testid={`${testid}-option-${m.name}`}>{m.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {isEdit ? (
        <DialogTrigger
          onClick={reset}
          render={<Button size="icon-sm" variant="ghost" aria-label="Edit expense" className="text-slate-400 hover:text-teal-700" data-testid="edit-expense-button" />}
        >
          <Pencil className="h-4 w-4" />
        </DialogTrigger>
      ) : (
        <DialogTrigger onClick={reset} render={<Button className="h-11 px-5 font-semibold" data-testid="add-expense-button" />}>
          <Plus className="h-4 w-4" /> Add expense
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle className="text-xl font-black tracking-tight">{isEdit ? "Edit expense" : "Add an expense"}</DialogTitle>
            <DialogDescription>Who paid, how much, and how it should be split.</DialogDescription>
          </DialogHeader>

          {!isEdit && (
            <div className="rounded-xl border border-dashed border-teal-300 bg-teal-50/60 p-3" data-testid="receipt-scan-panel">
              <input
                ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={(ev) => { const f = ev.target.files?.[0]; ev.target.value = ""; if (f) scan.mutate(f); }}
                data-testid="scan-receipt-file-input"
              />
              <div className="flex items-center gap-3">
                {receipt ? (
                  <img src={receipt} alt="Receipt preview" className="h-14 w-11 shrink-0 rounded-md border border-teal-200 object-cover" data-testid="scan-receipt-preview" />
                ) : (
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-white text-teal-700 ring-1 ring-teal-200">
                    <ScanLine className="h-5 w-5" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-teal-950">
                    {scan.isPending ? "Reading your receipt…" : receipt ? "Receipt attached" : "Have a receipt?"}
                  </p>
                  <p className="text-xs text-teal-800/80" data-testid="scan-receipt-note">
                    {scan.isPending ? "This takes a few seconds." : scanNote ?? "Snap or upload it and we'll fill in the amount, description and date."}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button type="button" size="sm" variant="outline" className="border-teal-300 bg-white text-teal-800 hover:bg-teal-100"
                    disabled={scan.isPending} onClick={() => fileRef.current?.click()} data-testid="scan-receipt-button">
                    {scan.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
                    {receipt ? "Rescan" : "Scan receipt"}
                  </Button>
                  {receipt && !scan.isPending && (
                    <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove receipt" onClick={() => { setReceipt(null); setScanNote(null); }} data-testid="scan-receipt-remove">
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-[1fr_9rem] gap-3">
            <div className="space-y-2">
              <Label htmlFor="exp-desc">Description</Label>
              <Input id="exp-desc" placeholder="Dinner, taxi, rent…" value={description} onChange={(e) => setDescription(e.target.value)} required data-testid="expense-description-input" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="exp-amount">Amount ({group.currency})</Label>
              <Input id="exp-amount" type="number" inputMode="decimal" step="0.01" min="0" placeholder="0.00" className="money" value={amount} onChange={(e) => setAmount(e.target.value)} required data-testid="expense-amount-input" />
            </div>
          </div>

          <div className="grid grid-cols-[1fr_11rem] gap-3">
            <div className="space-y-2">
              <Label>Paid by</Label>
              {memberSelect(paidBy, setPaidBy, "expense-payer-select")}
            </div>
            <div className="space-y-2">
              <Label htmlFor="exp-date">Date</Label>
              <Input id="exp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="money" data-testid="expense-date-input" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Split</Label>
            <div className="grid grid-cols-4 gap-2" role="radiogroup">
              {SPLITS.map(({ type, label, icon: Icon }) => (
                <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={splitType === type}
                  onClick={() => setSplitType(type)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-semibold transition-[background-color,border-color,color] duration-150",
                    splitType === type ? "border-teal-600 bg-teal-50 text-teal-900" : "border-slate-200 text-slate-600 hover:bg-slate-50",
                  )}
                  data-testid={`split-type-${type}`}
                >
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{SPLITS.find((s) => s.type === splitType)?.hint}</p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3" data-testid="split-details">
            {splitType === "equal" && (
              <div className="space-y-1">
                {group.members.map((m) => {
                  const on = selected.includes(m.id);
                  return (
                    <label key={m.id} className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 hover:bg-white">
                      <span className="flex items-center gap-2.5 text-sm font-medium">
                        <Checkbox
                          checked={on}
                          onCheckedChange={(c) => setSelected(c ? [...selected, m.id] : selected.filter((x) => x !== m.id))}
                          data-testid={`equal-member-checkbox-${m.name}`}
                        />
                        {m.name}
                      </span>
                      <span className="money text-sm text-slate-500">{on ? money(perHead, group.currency) : "—"}</span>
                    </label>
                  );
                })}
              </div>
            )}
            {splitType === "exact" && (
              <div className="space-y-2">
                {group.members.map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-3 px-2">
                    <span className="text-sm font-medium">{m.name}</span>
                    <Input
                      type="number" step="0.01" min="0" placeholder="0.00"
                      className="money h-8 w-28 bg-white text-right"
                      value={exact[m.id] ?? ""}
                      onChange={(e) => setExact({ ...exact, [m.id]: e.target.value })}
                      data-testid={`exact-amount-input-${m.name}`}
                    />
                  </div>
                ))}
                <p className={cn("px-2 pt-1 text-right text-xs font-semibold", Math.abs(remaining) < 0.005 ? "text-green-700" : "text-rose-600")} data-testid="exact-remaining">
                  {Math.abs(remaining) < 0.005 ? "Adds up ✓" : remaining > 0 ? `${money(remaining, group.currency)} left to assign` : `${money(-remaining, group.currency)} over`}
                </p>
              </div>
            )}
            {splitType === "full" && (
              <div className="space-y-2">
                <Label>Who owes the full amount?</Label>
                {memberSelect(fullOwer, setFullOwer, "full-ower-select")}
                <p className="text-xs text-muted-foreground">
                  {nameOf(fullOwer)} owes {nameOf(paidBy)} {money(total, group.currency)}
                </p>
              </div>
            )}
            {splitType === "items" && (
              <ItemSplitEditor items={items} setItems={setItems} members={group.members} total={total} currency={group.currency} />
            )}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={mut.isPending || scan.isPending} className="w-full sm:w-auto" data-testid="expense-submit-button">
              {mut.isPending ? "Saving…" : isEdit ? "Save changes" : "Save expense"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

## `frontend/src/components/AppShell.tsx`

```tsx
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { LogOut, Split } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMe } from "@/lib/useMe";
import { endSession } from "@/lib/session";
import { ApiError } from "@/lib/api";
import { initials } from "@/lib/format";
import NotificationBell from "@/components/NotificationBell";

export function Brand() {
  return (
    <Link to="/groups" className="flex items-center gap-2 group" data-testid="brand-link">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-900 text-teal-300 transition-transform duration-200 group-hover:-rotate-6">
        <Split className="h-5 w-5" />
      </span>
      <span className="text-lg font-black tracking-tight">Splitly</span>
    </Link>
  );
}

export default function AppShell() {
  const me = useMe();
  const loc = useLocation();
  if (me.isError && me.error instanceof ApiError && me.error.status === 401) {
    return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  }
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/85 shadow-xs backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Brand />
          <div className="flex items-center gap-3">
            {me.data && <NotificationBell />}
            {me.data && (
              <div className="hidden items-center gap-2 sm:flex" data-testid="header-user">
                <span className="grid h-8 w-8 place-items-center rounded-full border border-slate-200 bg-slate-100 text-xs font-bold">
                  {initials(me.data.name)}
                </span>
                <span className="text-sm font-semibold text-slate-700">{me.data.name}</span>
              </div>
            )}
            <Button variant="ghost" size="sm" onClick={() => void endSession()} data-testid="logout-button">
              <LogOut className="h-4 w-4" /> Log out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <Outlet />
      </main>
    </div>
  );
}
```

## `frontend/src/components/CreateGroupDialog.tsx`

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiPost } from "@/lib/api";
import { CURRENCIES, errorMessage } from "@/lib/format";
import type { Currency, Group, GroupCreate } from "@/lib/types";
import { useMe } from "@/lib/useMe";

export default function CreateGroupDialog() {
  const me = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [members, setMembers] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  const reset = () => {
    setName(""); setCurrency("USD"); setDraft("");
    setMembers(me.data ? [me.data.name] : []);
  };

  const mut = useMutation({
    mutationFn: (body: GroupCreate) => apiPost<Group>("/groups", body),
    onSuccess: (g) => {
      qc.invalidateQueries({ queryKey: ["groups"] });
      toast.success(`Group "${g.name}" created`);
      setOpen(false);
      nav(`/groups/${g.id}`);
    },
    onError: (e) => toast.error(errorMessage(e, "Could not create group")),
  });

  const addMember = () => {
    const n = draft.trim();
    if (!n) return;
    if (members.some((m) => m.toLowerCase() === n.toLowerCase())) return toast.error("Already added");
    setMembers([...members, n]);
    setDraft("");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const all = draft.trim() ? [...members, draft.trim()] : members;
    if (all.length < 2) return toast.error("Add at least two people");
    mut.mutate({ name, currency, members: all });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger onClick={reset} render={<Button className="h-11 px-5 font-semibold" data-testid="create-group-btn" />}>
        <Plus className="h-4 w-4" /> New group
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle className="text-xl font-black tracking-tight">New group</DialogTitle>
            <DialogDescription>A trip, a flat, a dinner club — anything you share costs in.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="group-name">Group name</Label>
            <Input id="group-name" placeholder="e.g. Lisbon weekend" value={name} onChange={(e) => setName(e.target.value)} required data-testid="group-name-input" />
          </div>
          <div className="space-y-2">
            <Label>Currency</Label>
            <Select value={currency} onValueChange={(v: string) => setCurrency(v as Currency)}>
              <SelectTrigger className="w-full" data-testid="group-currency-select">
                <SelectValue>{(v) => CURRENCIES.find((c) => c.code === v)?.label ?? String(v)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c.code} value={c.code} data-testid={`currency-option-${c.code}`}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="member-name">People</Label>
            <div className="flex gap-2">
              <Input
                id="member-name"
                placeholder="Add a name and press Enter"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMember(); } }}
                data-testid="group-member-input"
              />
              <Button type="button" variant="outline" onClick={addMember} data-testid="group-member-add-btn">Add</Button>
            </div>
            <div className="flex flex-wrap gap-2 pt-1" data-testid="group-member-chips">
              {members.map((m) => (
                <span key={m} className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-3 py-1 text-sm font-medium text-teal-900">
                  {m}
                  <button type="button" aria-label={`Remove ${m}`} onClick={() => setMembers(members.filter((x) => x !== m))} className="rounded-full p-0.5 hover:bg-teal-100" data-testid={`remove-member-${m}`}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={mut.isPending} className="w-full sm:w-auto" data-testid="create-group-submit">
              {mut.isPending ? "Creating…" : "Create group"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

## `frontend/src/components/ExpenseChangeLog.tsx`

```tsx
import { formatDistanceToNow } from "date-fns";
import { History } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Expense } from "@/lib/types";

export default function ExpenseChangeLog({ expense }: { expense: Expense }) {
  const edits = [...expense.edits].reverse();
  if (!expense.updated_at) return null;
  return (
    <Popover>
      <PopoverTrigger
        className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium text-slate-400 underline decoration-dotted underline-offset-2 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-700"
        data-testid="expense-edited-tag"
      >
        edited{edits.length > 1 ? ` ×${edits.length}` : ""}
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-80 p-0" data-testid="expense-change-log">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <History className="h-4 w-4 text-teal-700" />
          <p className="text-sm font-black tracking-tight">Change log</p>
        </div>
        {edits.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">This expense was edited before change tracking was added.</p>
        ) : (
          <ol className="max-h-72 space-y-3 overflow-y-auto px-4 py-3">
            {edits.map((ed, i) => (
              <li key={`${ed.at}-${i}`} className="border-l-2 border-teal-200 pl-3" data-testid="expense-change-entry">
                <ul className="space-y-0.5">
                  {ed.changes.map((c) => (
                    <li key={c} className="text-sm text-slate-800" data-testid="expense-change-line">{c}</li>
                  ))}
                </ul>
                <p className="mt-1 text-[11px] text-slate-500">
                  edited by <span className="font-semibold text-slate-700">{ed.by_name}</span> ·{" "}
                  {formatDistanceToNow(new Date(ed.at), { addSuffix: true })}
                </p>
              </li>
            ))}
          </ol>
        )}
      </PopoverContent>
    </Popover>
  );
}
```

## `frontend/src/components/ItemSplitEditor.tsx`

```tsx
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { initials, money } from "@/lib/format";
import type { Currency, Member } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface DraftItem {
  key: string;
  name: string;
  price: string;
  member_ids: string[];
}

let seq = 0;
export const newDraftItem = (name = "", price = "", member_ids: string[] = []): DraftItem => ({
  key: `item-${++seq}`, name, price, member_ids,
});

/** Per-person preview: items split evenly among who had them, extra (tax/tip) shared pro-rata. */
export function previewItemShares(items: DraftItem[], total: number): Record<string, number> {
  const sub: Record<string, number> = {};
  for (const it of items) {
    const p = Number(it.price) || 0;
    if (p <= 0 || !it.member_ids.length) continue;
    for (const m of it.member_ids) sub[m] = (sub[m] ?? 0) + p / it.member_ids.length;
  }
  const itemsTotal = Object.values(sub).reduce((a, b) => a + b, 0);
  if (!itemsTotal) return {};
  return Object.fromEntries(Object.entries(sub).map(([m, v]) => [m, v + ((total - itemsTotal) * v) / itemsTotal]));
}

interface Props {
  items: DraftItem[];
  setItems: (items: DraftItem[]) => void;
  members: Member[];
  total: number;
  currency: Currency;
}

export default function ItemSplitEditor({ items, setItems, members, total, currency }: Props) {
  const update = (key: string, patch: Partial<DraftItem>) =>
    setItems(items.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  const toggle = (it: DraftItem, mid: string) =>
    update(it.key, { member_ids: it.member_ids.includes(mid) ? it.member_ids.filter((x) => x !== mid) : [...it.member_ids, mid] });

  const itemsTotal = items.reduce((s, it) => s + (Number(it.price) || 0), 0);
  const extra = Math.round((total - itemsTotal) * 100) / 100;
  const preview = previewItemShares(items, total);

  return (
    <div className="space-y-3" data-testid="item-split-editor">
      <p className="text-xs text-muted-foreground">Tap the people who had each item. Tax, tip or service is shared in proportion.</p>
      <ul className="space-y-2">
        {items.map((it, i) => (
          <li key={it.key} className="rounded-lg border border-slate-200 bg-white p-2.5" data-testid={`item-row-${i}`}>
            <div className="flex items-center gap-2">
              <Input
                value={it.name} placeholder="Item" onChange={(e) => update(it.key, { name: e.target.value })}
                className="h-8 flex-1 text-sm" data-testid={`item-name-input-${i}`}
              />
              <Input
                type="number" step="0.01" min="0" placeholder="0.00" value={it.price}
                onChange={(e) => update(it.key, { price: e.target.value })}
                className="money h-8 w-24 text-right text-sm" data-testid={`item-price-input-${i}`}
              />
              <Button
                type="button" size="icon-xs" variant="ghost" aria-label="Remove item"
                className="text-slate-400 hover:text-rose-600"
                onClick={() => setItems(items.filter((x) => x.key !== it.key))}
                data-testid={`item-remove-button-${i}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {members.map((m) => {
                const on = it.member_ids.includes(m.id);
                return (
                  <button
                    key={m.id} type="button" aria-pressed={on} onClick={() => toggle(it, m.id)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold transition-[background-color,border-color,color] duration-150",
                      on ? "border-teal-600 bg-teal-600 text-white" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300",
                    )}
                    data-testid={`item-${i}-member-${m.name}`}
                  >
                    <span className="text-[9px] opacity-80">{initials(m.name)}</span> {m.name}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => update(it.key, { member_ids: it.member_ids.length === members.length ? [] : members.map((m) => m.id) })}
                className="px-1 text-[11px] font-semibold text-slate-400 hover:text-slate-700"
                data-testid={`item-${i}-toggle-all`}
              >
                {it.member_ids.length === members.length ? "none" : "everyone"}
              </button>
            </div>
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" size="sm" onClick={() => setItems([...items, newDraftItem()])} data-testid="add-item-button">
        <Plus className="h-4 w-4" /> Add item
      </Button>
      <div className="space-y-1 border-t border-slate-200 pt-2 text-xs">
        <div className="flex justify-between text-slate-500">
          <span>Items</span><span className="money" data-testid="items-subtotal">{money(itemsTotal, currency)}</span>
        </div>
        <div className="flex justify-between text-slate-500">
          <span>{extra >= 0 ? "Tax, tip & other (shared)" : "Discount (shared)"}</span>
          <span className={cn("money", extra < 0 && "text-green-700")} data-testid="items-extra">{money(extra, currency)}</span>
        </div>
        {Object.keys(preview).length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1" data-testid="items-share-preview">
            {members.filter((m) => preview[m.id]).map((m) => (
              <span key={m.id} className="font-medium text-slate-700">
                {m.name} <span className="money">{money(preview[m.id]!, currency)}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

## `frontend/src/components/ManageGroupDialog.tsx`

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Link2, RefreshCw, Settings2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiDelete, apiPost } from "@/lib/api";
import { errorMessage, initials } from "@/lib/format";
import type { Group, InviteLink } from "@/lib/types";
import { useMe } from "@/lib/useMe";

export default function ManageGroupDialog({ group }: { group: Group }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const me = useMe();
  const [member, setMember] = useState("");
  const [email, setEmail] = useState("");
  const [open, setOpen] = useState(false);
  const invite = useQuery({
    queryKey: ["group", group.id, "invite"],
    queryFn: () => apiPost<InviteLink>(`/groups/${group.id}/invite`),
    enabled: open,
    staleTime: Infinity,
  });
  const inviteUrl = (memberId?: string) =>
    invite.data ? `${window.location.origin}/join/${invite.data.token}${memberId ? `?m=${memberId}` : ""}` : "";
  const copy = async (url: string, label: string) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(`${label} copied — send it to your friend`);
    } catch {
      window.prompt("Copy this invite link:", url);
    }
  };
  const resetInvite = useMutation({
    mutationFn: () => apiPost<InviteLink>(`/groups/${group.id}/invite/reset`),
    onSuccess: (l) => { qc.setQueryData(["group", group.id, "invite"], l); toast.success("New link created — the old one no longer works"); },
    onError: (e) => toast.error(errorMessage(e, "Could not reset link")),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["group", group.id] });

  const addMember = useMutation({
    mutationFn: () => apiPost<Group>(`/groups/${group.id}/members`, { name: member }),
    onSuccess: () => { toast.success(`${member} added`); setMember(""); refresh(); qc.invalidateQueries({ queryKey: ["groups"] }); },
    onError: (e) => toast.error(errorMessage(e, "Could not add person")),
  });
  const removeMember = useMutation({
    mutationFn: (m: { id: string; name: string }) => apiDelete<Group>(`/groups/${group.id}/members/${m.id}`),
    onSuccess: (_g, m) => { toast.success(`${m.name} removed`); refresh(); qc.invalidateQueries({ queryKey: ["groups"] }); },
    onError: (e) => toast.error(errorMessage(e, "Could not remove person")),
  });
  const claim = useMutation({
    mutationFn: (m: { id: string; name: string }) => apiPost<Group>(`/groups/${group.id}/members/${m.id}/claim`),
    onSuccess: (g) => {
      const mine = g.members.find((x) => x.user_id === me.data?.id);
      toast.success(mine ? `You're now ${mine.name} in this group` : "Unlinked from this group");
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e, "Could not link")),
  });
  const share = useMutation({
    mutationFn: () => apiPost<Group>(`/groups/${group.id}/share`, { email }),
    onSuccess: () => { toast.success(`Shared with ${email}`); setEmail(""); refresh(); },
    onError: (e) => toast.error(errorMessage(e, "Could not share")),
  });
  const del = useMutation({
    mutationFn: () => apiDelete(`/groups/${group.id}`),
    onSuccess: () => { toast("Group deleted"); qc.invalidateQueries({ queryKey: ["groups"] }); nav("/groups"); },
    onError: (e) => toast.error(errorMessage(e, "Could not delete")),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" className="h-11" data-testid="manage-group-button" />}>
        <Settings2 className="h-4 w-4" /> Manage
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-black tracking-tight">Manage group</DialogTitle>
          <DialogDescription>Add people to split with, or give another account access.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <p className="text-sm font-medium">People in this group <span className="text-muted-foreground">({group.members.length})</span></p>
          <ul className="max-h-52 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200" data-testid="member-list">
            {group.members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 px-3 py-2" data-testid={`member-row-${m.name}`}>
                <span className="flex items-center gap-2.5 text-sm font-medium">
                  <span className="grid h-7 w-7 place-items-center rounded-full border border-slate-200 bg-slate-100 text-[10px] font-bold">{initials(m.name)}</span>
                  {m.name}
                  {m.user_id && m.user_id === me.data?.id && (
                    <span className="rounded-full bg-teal-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white" data-testid={`member-you-badge-${m.name}`}>You</span>
                  )}
                  {m.user_id && m.user_id !== me.data?.id && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500" data-testid={`member-linked-badge-${m.name}`}>has account</span>
                  )}
                </span>
                <span className="flex items-center gap-1">
                {!m.user_id && (
                  <Button
                    type="button" size="icon-xs" variant="ghost" aria-label={`Copy invite link for ${m.name}`}
                    className="text-slate-400 hover:bg-teal-50 hover:text-teal-700"
                    disabled={!invite.data}
                    onClick={() => void copy(inviteUrl(m.id), `Invite link for ${m.name}`)}
                    data-testid={`copy-member-invite-${m.name}`}
                  >
                    <Link2 className="h-3.5 w-3.5" />
                  </Button>
                )}
                {(!m.user_id || m.user_id === me.data?.id) && (
                  <Button
                    type="button" size="xs" variant="ghost"
                    className={m.user_id ? "text-slate-500" : "text-teal-700 hover:bg-teal-50"}
                    disabled={claim.isPending}
                    onClick={() => claim.mutate(m)}
                    data-testid={`claim-member-button-${m.name}`}
                  >
                    {m.user_id ? "Not me" : "That's me"}
                  </Button>
                )}
                <Button
                  type="button" size="icon-xs" variant="ghost" aria-label={`Remove ${m.name}`}
                  className="text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  disabled={removeMember.isPending || group.members.length <= 1}
                  onClick={() => { if (window.confirm(`Remove ${m.name} from ${group.name}?`)) removeMember.mutate(m); }}
                  data-testid={`remove-member-button-${m.name}`}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Tap "That's me" on your name so payments to you wait for your "Got it". People who are part of an expense or settlement can't be removed until those are deleted.</p>
        </div>
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (member.trim()) addMember.mutate(); }}>
          <Label htmlFor="add-person">Add a person</Label>
          <div className="flex gap-2">
            <Input id="add-person" placeholder="Name" value={member} onChange={(e) => setMember(e.target.value)} data-testid="add-person-input" />
            <Button type="submit" disabled={addMember.isPending} data-testid="add-person-submit">Add</Button>
          </div>
        </form>
        <div className="space-y-2 rounded-xl border border-teal-200 bg-teal-50/60 p-3" data-testid="invite-link-section">
          <p className="flex items-center gap-1.5 text-sm font-medium text-teal-950"><Link2 className="h-4 w-4" /> Invite link</p>
          <div className="flex gap-2">
            <Input readOnly value={invite.isPending ? "Creating link…" : inviteUrl()} onFocus={(e) => e.currentTarget.select()}
              className="money h-9 bg-white text-xs" data-testid="invite-link-input" />
            <Button type="button" disabled={!invite.data} onClick={() => void copy(inviteUrl(), "Invite link")} data-testid="copy-invite-link-button">
              <Copy className="h-4 w-4" /> Copy
            </Button>
          </div>
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-teal-900/80">Friends open it, sign in, pick their name and join. Use the <Link2 className="inline h-3 w-3" /> next to a name to send a link just for that person.</p>
            <button type="button" onClick={() => { if (window.confirm("Make a new link? The current one will stop working.")) resetInvite.mutate(); }}
              disabled={resetInvite.isPending}
              className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-800" data-testid="reset-invite-link-button">
              <RefreshCw className="h-3 w-3" /> New link
            </button>
          </div>
        </div>
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (email.trim()) share.mutate(); }}>
          <Label htmlFor="share-email">Share with an account</Label>
          <div className="flex gap-2">
            <Input id="share-email" type="email" placeholder="friend@email.com" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="share-email-input" />
            <Button type="submit" variant="secondary" disabled={share.isPending} data-testid="share-submit">Share</Button>
          </div>
          <p className="text-xs text-muted-foreground">They'll see this group and can add expenses.</p>
        </form>
        {me.data?.id === group.owner_id && (
          <Button
            variant="ghost"
            className="justify-start text-rose-600 hover:bg-rose-50 hover:text-rose-700"
            onClick={() => { if (window.confirm(`Delete "${group.name}" and all its expenses?`)) del.mutate(); }}
            data-testid="delete-group-button"
          >
            <Trash2 className="h-4 w-4" /> Delete group
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

## `frontend/src/components/MemberBalances.tsx`

```tsx
import { initials, money } from "@/lib/format";
import type { Currency, MemberBalance } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function MemberBalances({ balances, currency }: { balances: MemberBalance[]; currency: Currency }) {
  const max = Math.max(1, ...balances.map((b) => Math.abs(b.net)));
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_2px_8px_rgba(15,23,42,0.04)]" data-testid="member-balances">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Balances</p>
      <ul className="mt-3 space-y-3">
        {balances.map((b) => {
          const pos = b.net > 0.004;
          const neg = b.net < -0.004;
          return (
            <li key={b.member_id} data-testid={`balance-row-${b.name}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 place-items-center rounded-full border border-slate-200 bg-slate-100 text-[11px] font-bold">{initials(b.name)}</span>
                  <span>
                    <span className="block text-sm font-semibold">{b.name}</span>
                    <span className="block text-[11px] text-slate-500">
                      paid <span className="money">{money(b.paid, currency)}</span> · share <span className="money">{money(b.share, currency)}</span>
                    </span>
                  </span>
                </span>
                <span
                  className={cn(
                    "money rounded-full px-2.5 py-1 text-xs font-semibold",
                    pos && "bg-green-100 text-green-900",
                    neg && "bg-rose-100 text-rose-900",
                    !pos && !neg && "bg-slate-100 text-slate-600",
                  )}
                  data-testid={`balance-net-${b.name}`}
                >
                  {pos ? `gets ${money(b.net, currency)}` : neg ? `owes ${money(-b.net, currency)}` : "settled"}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={cn("h-full rounded-full transition-[width] duration-500", pos ? "bg-green-500" : "bg-rose-500")}
                  style={{ width: `${(Math.abs(b.net) / max) * 100}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

## `frontend/src/components/NotificationBell.tsx`

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Bell, BellRing, CheckCheck, HandCoins, Receipt, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiGet, apiPost } from "@/lib/api";
import type { Notification, NotificationList } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function NotificationBell() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiGet<NotificationList>("/notifications"),
    refetchInterval: 15_000,
  });
  const data = q.isError ? undefined : q.data;
  const unread = data?.unread_count ?? 0;
  const refresh = () => qc.invalidateQueries({ queryKey: ["notifications"] });

  const readAll = useMutation({ mutationFn: () => apiPost("/notifications/read-all"), onSuccess: refresh });
  const readOne = useMutation({ mutationFn: (id: string) => apiPost(`/notifications/${id}/read`), onSuccess: refresh });

  const openItem = (n: Notification) => {
    if (!n.read) readOne.mutate(n.id);
    qc.invalidateQueries({ queryKey: ["group", n.group_id] });
    setOpen(false);
    nav(`/groups/${n.group_id}`);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon" aria-label="Notifications" className="relative" data-testid="notification-bell" />}
      >
        <Bell className={cn("h-5 w-5 transition-transform duration-200", unread > 0 && "origin-top animate-[bell-ring_1.2s_ease-in-out_1]")} />
        {unread > 0 && (
          <span
            className="money absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white ring-2 ring-white"
            data-testid="notification-unread-count"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[22rem] p-0" data-testid="notification-panel">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <p className="text-sm font-black tracking-tight">Notifications</p>
          <Button
            variant="ghost" size="xs" disabled={unread === 0 || readAll.isPending}
            onClick={() => readAll.mutate()} data-testid="notification-mark-all-read"
          >
            <CheckCheck className="h-3.5 w-3.5" /> Mark all read
          </Button>
        </div>
        <ul className="max-h-96 overflow-y-auto" data-testid="notification-list">
          {(data?.items ?? []).length === 0 && (
            <li className="px-4 py-10 text-center text-sm text-muted-foreground" data-testid="notification-empty">
              You're all caught up.
            </li>
          )}
          {data?.items.map((n) => {
            const Icon = n.kind === "expense" ? Receipt : n.kind === "reminder" ? BellRing : n.kind === "member" ? UserPlus : HandCoins;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => openItem(n)}
                  className={cn(
                    "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-slate-50",
                    !n.read && "bg-teal-50/60",
                  )}
                  data-testid="notification-item"
                >
                  <span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full", n.kind === "expense" || n.kind === "member" ? "bg-slate-900 text-teal-300" : n.kind === "reminder" ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800")}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm leading-snug text-slate-800" data-testid="notification-message">{n.message}</span>
                    <span className="mt-1 block text-[11px] text-slate-500">
                      {n.group_name} · {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                    </span>
                  </span>
                  {!n.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-teal-600" data-testid="notification-unread-dot" />}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
```

## `frontend/src/components/ReceiptButton.tsx`

```tsx
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ImageUp, Paperclip, Receipt, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { apiDelete, apiPut } from "@/lib/api";
import { errorMessage } from "@/lib/format";
import { compressImage } from "@/lib/image";
import type { ReceiptIn } from "@/lib/types";

interface Props {
  /** API path of the receipt resource, e.g. /groups/{g}/expenses/{e}/receipt */
  path: string;
  hasReceipt: boolean;
  title: string;
  invalidateKey: readonly unknown[];
  /** data-testid prefix so expense and settlement receipts stay distinguishable */
  testid?: string;
}

export default function ReceiptButton({ path, hasReceipt, title, invalidateKey, testid = "" }: Props) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const url = `/api${path}?v=${version}`;
  const refresh = () => qc.invalidateQueries({ queryKey: invalidateKey });
  const tid = (name: string) => `${testid}${name}`;

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!file.type.startsWith("image/")) throw new Error("not-image");
      const data_url = await compressImage(file);
      return apiPut(path, { data_url } satisfies ReceiptIn);
    },
    onSuccess: () => { toast.success("Receipt attached"); setVersion((v) => v + 1); refresh(); },
    onError: (e) => toast.error(e instanceof Error && e.message === "not-image" ? "Please pick an image file" : errorMessage(e, "Could not upload receipt")),
  });
  const remove = useMutation({
    mutationFn: () => apiDelete(path),
    onSuccess: () => { toast("Receipt removed"); setOpen(false); refresh(); },
    onError: (e) => toast.error(errorMessage(e, "Could not remove receipt")),
  });

  const picker = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) upload.mutate(f);
      }}
      data-testid={tid("receipt-file-input")}
    />
  );

  if (!hasReceipt) {
    return (
      <>
        {picker}
        <Button
          size="icon-sm" variant="ghost" aria-label="Attach receipt photo"
          className="text-slate-400 hover:text-teal-700"
          disabled={upload.isPending}
          onClick={() => fileRef.current?.click()}
          data-testid={tid("attach-receipt-button")}
        >
          <Paperclip className={upload.isPending ? "h-4 w-4 animate-pulse" : "h-4 w-4"} />
        </Button>
      </>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {picker}
      <DialogTrigger
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 ring-1 ring-amber-200 transition-colors duration-150 hover:bg-amber-100"
        data-testid={tid("view-receipt-button")}
      >
        <Receipt className="h-3 w-3" /> Receipt
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-black tracking-tight">{title}</DialogTitle>
          <DialogDescription>Everyone in the group can see this photo.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto rounded-xl border border-slate-200 bg-slate-50">
          <img src={url} alt={title} className="mx-auto block max-w-full" data-testid={tid("receipt-image")} />
        </div>
        <div className="flex justify-between gap-2">
          <Button
            variant="ghost" className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
            disabled={remove.isPending}
            onClick={() => { if (window.confirm("Remove this receipt photo?")) remove.mutate(); }}
            data-testid={tid("remove-receipt-button")}
          >
            <Trash2 className="h-4 w-4" /> Remove
          </Button>
          <Button variant="outline" disabled={upload.isPending} onClick={() => fileRef.current?.click()} data-testid={tid("replace-receipt-button")}>
            <ImageUp className="h-4 w-4" /> {upload.isPending ? "Uploading…" : "Replace photo"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

## `frontend/src/components/SettleUpSummary.tsx`

```tsx
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight, BadgeCheck, BellRing, Clock, CheckCircle2, ChevronDown, Loader2, Paperclip, PartyPopper, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiDelete, apiPost, apiPut } from "@/lib/api";
import { compressImage } from "@/lib/image";
import ReceiptButton from "@/components/ReceiptButton";
import { errorMessage, money } from "@/lib/format";
import type { Group, GroupSummary, ReceiptIn, ReminderCreate, ReminderOut, Settlement, SettlementCreate, Transfer } from "@/lib/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const historyKey = (groupId: string) => `splitly:history-open:${groupId}`;
const transferKey = (t: Transfer) => `${t.from_member}-${t.to_member}`;

export default function SettleUpSummary({ group, summary }: { group: Group; summary?: GroupSummary }) {
  const qc = useQueryClient();
  const [popKey, setPopKey] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(() => localStorage.getItem(historyKey(group.id)) === "1");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [proof, setProof] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const proofRef = useRef<HTMLInputElement>(null);
  const pickProof = async (file: File) => {
    if (!file.type.startsWith("image/")) return toast.error("Please pick an image file");
    setPreparing(true);
    try { setProof(await compressImage(file)); } catch { toast.error("Could not read that image"); } finally { setPreparing(false); }
  };
  const nameOf = (id: string) => group.members.find((m) => m.id === id)?.name ?? "?";
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["group", group.id] });
    qc.invalidateQueries({ queryKey: ["groups"] });
  };

  const toggleHistory = () => {
    const next = !showHistory;
    setShowHistory(next);
    localStorage.setItem(historyKey(group.id), next ? "1" : "0");
  };

  const settle = useMutation({
    mutationFn: async (t: Transfer) => {
      const s = await apiPost<Settlement>(`/groups/${group.id}/settlements`, {
        from_member: t.from_member, to_member: t.to_member, amount: t.amount, note: note.trim() || null,
      } satisfies SettlementCreate);
      if (proof) {
        await apiPut(`/groups/${group.id}/settlements/${s.id}/receipt`, { data_url: proof } satisfies ReceiptIn)
          .catch(() => toast.error("Settled, but the receipt photo couldn't be attached"));
      }
      return s;
    },
    onSuccess: (s) => {
      setPopKey(s.id);
      setConfirming(null);
      setNote("");
      setProof(null);
      toast.success(`${nameOf(s.from_member)} paid ${nameOf(s.to_member)} ${money(s.amount, group.currency)}`);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e, "Could not settle")),
  });

  const remind = useMutation({
    mutationFn: (t: Transfer) =>
      apiPost<ReminderOut>(`/groups/${group.id}/remind`, {
        from_member: t.from_member, to_member: t.to_member,
      } satisfies ReminderCreate),
    onSuccess: (r, t) => {
      invalidate();
      if (r.notified === 0) toast("No one else has access to this group yet — share it from Manage so they get reminders");
      else toast.success(`Reminder sent: ${t.from_name} owes ${t.to_name} ${money(r.amount, group.currency)}`);
    },
    onError: (e) => { toast.error(errorMessage(e, "Could not send reminder")); invalidate(); },
  });

  const undo = useMutation({
    mutationFn: (id: string) => apiDelete(`/groups/${group.id}/settlements/${id}`),
    onSuccess: () => { toast("Settlement undone"); invalidate(); },
    onError: (e) => toast.error(errorMessage(e, "Could not undo")),
  });

  const confirm = useMutation({
    mutationFn: (s: Settlement) => apiPost<Settlement>(`/groups/${group.id}/settlements/${s.id}/confirm`),
    onSuccess: (s) => { toast.success(`Confirmed — ${nameOf(s.to_member)} received ${money(s.amount, group.currency)}`); invalidate(); },
    onError: (e) => { toast.error(errorMessage(e, "Could not confirm")); invalidate(); },
  });

  const transfers = summary?.transfers ?? [];
  const settlements = summary?.settlements ?? [];
  const pendingCount = settlements.filter((s) => !s.confirmed_at).length;
  const mine = settlements.filter((s) => s.can_confirm);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_2px_8px_rgba(15,23,42,0.04)]" data-testid="settle-up-card">
      <div className="bg-slate-900 px-6 py-5 text-slate-50">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal-300">Settle up</p>
        <h2 className="mt-1 text-xl font-black tracking-tight">Who pays whom</h2>
        <p className="mt-1 text-xs text-slate-400">Simplified to the fewest transfers across all bills.</p>
      </div>
      <div className="space-y-3 p-5">
        {summary && transfers.length === 0 && (
          <div key={popKey ?? "none"} className="animate-settle-pop flex items-center gap-3 rounded-xl bg-green-50 p-4 text-green-900" data-testid="all-settled">
            <PartyPopper className="h-5 w-5" />
            <p className="text-sm font-semibold">Everyone is square. Nothing to settle!</p>
          </div>
        )}
        {transfers.map((t) => {
          const key = transferKey(t);
          const isConfirming = confirming === key;
          const remindedRecently = !!t.last_reminded_at && Date.now() - new Date(t.last_reminded_at).getTime() < DAY_MS;
          return (
            <div key={key} className="animate-rise-in rounded-xl border border-teal-200 bg-teal-50/70 p-4" data-testid="transfer-row">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-teal-950">
                  <span className="truncate" data-testid="transfer-from">{t.from_name}</span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-teal-600" />
                  <span className="truncate" data-testid="transfer-to">{t.to_name}</span>
                </div>
                <span className="money text-base font-semibold text-teal-950" data-testid="transfer-amount">{money(t.amount, group.currency)}</span>
              </div>
              {isConfirming ? (
                <form
                  className="animate-rise-in mt-3 space-y-2"
                  onSubmit={(e) => { e.preventDefault(); settle.mutate(t); }}
                  data-testid="settle-note-form"
                >
                  <Input
                    autoFocus
                    maxLength={140}
                    placeholder="Add a note (optional) — e.g. paid by bank transfer"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="h-9 bg-white text-sm"
                    data-testid="settle-note-input"
                  />
                  <input
                    ref={proofRef} type="file" accept="image/*" className="hidden"
                    onChange={(ev) => { const f = ev.target.files?.[0]; ev.target.value = ""; if (f) void pickProof(f); }}
                    data-testid="settle-receipt-file-input"
                  />
                  {proof ? (
                    <div className="flex items-center gap-2 rounded-lg border border-teal-200 bg-white p-1.5 pr-2" data-testid="settle-receipt-preview">
                      <img src={proof} alt="Payment receipt preview" className="h-10 w-8 rounded object-cover" />
                      <span className="flex-1 text-xs font-medium text-teal-900">Receipt photo will be attached</span>
                      <Button type="button" size="icon-xs" variant="ghost" aria-label="Remove receipt photo" onClick={() => setProof(null)} data-testid="settle-receipt-remove">
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => proofRef.current?.click()}
                      disabled={preparing}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-800 transition-colors duration-150 hover:text-teal-950 hover:underline"
                      data-testid="settle-attach-receipt-button"
                    >
                      {preparing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
                      Attach payment receipt (optional)
                    </button>
                  )}
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" className="flex-1" disabled={settle.isPending || preparing} data-testid="confirm-settle-button">
                      <CheckCircle2 className="h-4 w-4" /> {settle.isPending ? "Saving…" : "Confirm settled"}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => { setConfirming(null); setNote(""); setProof(null); }} data-testid="cancel-settle-button">
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm" variant="outline"
                    className="flex-1 border-teal-300 bg-white text-teal-800 hover:bg-teal-100"
                    onClick={() => { setConfirming(key); setNote(""); setProof(null); }}
                    data-testid="mark-settled-button"
                  >
                    <CheckCircle2 className="h-4 w-4" /> Mark as settled
                  </Button>
                  <Button
                    size="sm" variant="outline"
                    className="border-amber-300 bg-white text-amber-800 hover:bg-amber-50"
                    disabled={remind.isPending || remindedRecently}
                    title={remindedRecently ? `Reminded ${formatDistanceToNow(new Date(t.last_reminded_at!), { addSuffix: true })} — you can remind again after 24 hours` : undefined}
                    onClick={() => remind.mutate(t)}
                    data-testid="remind-button"
                  >
                    <BellRing className="h-4 w-4" /> {remindedRecently ? "Reminded" : "Remind"}
                  </Button>
                </div>
              )}
            </div>
          );
        })}

        {mine.map((s) => (
          <div key={s.id} className="animate-rise-in flex items-center justify-between gap-3 rounded-xl border border-green-200 bg-green-50 p-3" data-testid="confirm-callout">
            <p className="text-sm text-green-950">
              <span className="font-semibold">{nameOf(s.from_member)}</span> says they paid{" "}
              <span className="font-semibold">{nameOf(s.to_member)}</span>{" "}
              <span className="money font-semibold">{money(s.amount, group.currency)}</span>. Received it?
            </p>
            <Button size="sm" className="shrink-0 bg-green-700 hover:bg-green-800" disabled={confirm.isPending}
              onClick={() => confirm.mutate(s)} data-testid="callout-confirm-button">
              <BadgeCheck className="h-4 w-4" /> Got it
            </Button>
          </div>
        ))}

        {settlements.length > 0 && (
          <div className="pt-3">
            <button
              type="button"
              onClick={toggleHistory}
              aria-expanded={showHistory}
              className="flex w-full items-center justify-between rounded-lg px-1 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400 transition-colors duration-150 hover:text-slate-700"
              data-testid="settlement-history-toggle"
            >
              <span>
                Settlement history ({settlements.length})
                {pendingCount > 0 && <span className="ml-2 normal-case tracking-normal text-amber-700" data-testid="settlement-pending-count">· {pendingCount} awaiting confirmation</span>}
              </span>
              <span className="flex items-center gap-1 normal-case tracking-normal">
                {showHistory ? "Hide" : "Show"}
                <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${showHistory ? "rotate-180" : ""}`} />
              </span>
            </button>
            {showHistory && (
              <ul className="animate-rise-in mt-1 divide-y divide-slate-100" data-testid="settlement-history">
                {settlements.map((s) => (
                  <li key={s.id} className="py-2 text-sm" data-testid="settlement-item">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-600">
                        <span className="font-semibold text-slate-800">{nameOf(s.from_member)}</span> paid{" "}
                        <span className="font-semibold text-slate-800">{nameOf(s.to_member)}</span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <ReceiptButton
                          path={`/groups/${group.id}/settlements/${s.id}/receipt`}
                          hasReceipt={s.has_receipt}
                          title={`Payment receipt · ${nameOf(s.from_member)} → ${nameOf(s.to_member)}`}
                          invalidateKey={["group", group.id, "summary"]}
                          testid="settlement-"
                        />
                        <span className="money font-semibold">{money(s.amount, group.currency)}</span>
                        <Button size="icon-xs" variant="ghost" aria-label="Undo settlement" onClick={() => undo.mutate(s.id)} data-testid="undo-settlement-button">
                          <Undo2 className="h-3.5 w-3.5" />
                        </Button>
                      </span>
                    </div>
                    {s.note && (
                      <p className="mt-0.5 text-xs italic text-slate-500" data-testid="settlement-note">“{s.note}”</p>
                    )}
                    <div className="mt-1 flex items-center justify-between gap-2">
                      {s.confirmed_at ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-700" data-testid="settlement-confirmed">
                          <BadgeCheck className="h-3.5 w-3.5" /> Confirmed by {s.confirmed_by_name}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700" data-testid="settlement-pending">
                          <Clock className="h-3.5 w-3.5" /> Awaiting {nameOf(s.to_member)}'s confirmation
                        </span>
                      )}
                      {s.can_confirm && (
                        <Button size="xs" variant="outline" className="border-green-300 text-green-800 hover:bg-green-50"
                          disabled={confirm.isPending} onClick={() => confirm.mutate(s)} data-testid="confirm-received-button">
                          <BadgeCheck className="h-3.5 w-3.5" /> Got it
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

## `frontend/src/pages/Auth.tsx`

```tsx
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, Equal, ListOrdered, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiPost } from "@/lib/api";
import { beginSession } from "@/lib/session";
import { errorMessage } from "@/lib/format";
import type { User } from "@/lib/types";
import { Brand } from "@/components/AppShell";

export default function AuthPage({ mode }: { mode: "login" | "register" }) {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const rawNext = params.get("next") ?? "";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/groups";
  const isInvite = next.startsWith("/join/");
  const nextQs = next !== "/groups" ? `?next=${encodeURIComponent(next)}` : "";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const isLogin = mode === "login";

  const mut = useMutation({
    mutationFn: (body: Record<string, string>) =>
      apiPost<User>(isLogin ? "/auth/login" : "/auth/register", body),
    onSuccess: () => {
      beginSession();
      nav(next);
    },
    onError: (e) => toast.error(errorMessage(e, isLogin ? "Login failed" : "Sign up failed")),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    mut.mutate(isLogin ? { email, password } : { name, email, password });
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-slate-900 p-12 text-slate-50 lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-teal-500/20 blur-3xl" />
        <div className="relative [&_span]:text-slate-50 [&_a>span:first-child]:bg-teal-400 [&_a>span:first-child]:text-slate-900">
          <Brand />
        </div>
        <div className="relative max-w-md">
          <p className="mb-4 text-xs font-bold uppercase tracking-[0.18em] text-teal-300">Split it. Settle it.</p>
          <h1 className="text-5xl font-black leading-[1.05] tracking-tight">
            Fewer awkward money chats. More trips.
          </h1>
          <div className="mt-10 space-y-3">
            {[
              { icon: Equal, t: "Equal split", d: "Divide evenly among whoever was there" },
              { icon: ListOrdered, t: "Exact amounts", d: "Type each person's share, we check the sum" },
              { icon: UserIcon, t: "One person owes all", d: "Covered someone? Log it in one tap" },
            ].map(({ icon: Icon, t, d }) => (
              <div key={t} className="flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-800/40 p-4">
                <Icon className="mt-0.5 h-5 w-5 text-teal-300" />
                <div>
                  <p className="font-semibold">{t}</p>
                  <p className="text-sm text-slate-400">{d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="relative text-sm text-slate-500">Debts simplified to the fewest possible transfers.</p>
      </aside>

      <section className="flex items-center justify-center px-6 py-12">
        <form onSubmit={submit} className="animate-rise-in w-full max-w-sm space-y-6" data-testid="auth-form">
          <div className="lg:hidden"><Brand /></div>
          <div>
            <h2 className="text-3xl font-black tracking-tight">{isLogin ? "Welcome back" : "Create your account"}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {isLogin ? "Log in to see who owes what." : "Start splitting bills in under a minute."}
            </p>
            {isInvite && (
              <p className="mt-3 rounded-xl bg-teal-50 px-4 py-3 text-sm font-medium text-teal-900" data-testid="auth-invite-banner">
                You've been invited to a group. {isLogin ? "Log in to join — new here? Create an account below." : "Create an account to join — it takes a few seconds."}
              </p>
            )}
          </div>
          {!isLogin && (
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required data-testid="register-name-input" />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required data-testid="auth-email-input" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" value={password} minLength={isLogin ? undefined : 6} onChange={(e) => setPassword(e.target.value)} required data-testid="auth-password-input" />
          </div>
          <Button type="submit" className="h-11 w-full text-base font-semibold" disabled={mut.isPending} data-testid="login-submit-btn">
            {mut.isPending ? "Please wait…" : isLogin ? "Log in" : "Create account"} <ArrowRight className="h-4 w-4" />
          </Button>
          {isLogin && (
            <button
              type="button"
              onClick={() => { setEmail("demo@splitly.app"); setPassword("demo1234"); }}
              className="w-full rounded-xl border border-dashed border-teal-300 bg-teal-50 px-4 py-3 text-left text-sm text-teal-900 transition-colors duration-150 hover:bg-teal-100"
              data-testid="fill-demo-credentials"
            >
              <span className="font-semibold">Try the demo:</span> <span className="money">demo@splitly.app / demo1234</span>
            </button>
          )}
          <p className="text-sm text-muted-foreground">
            {isLogin ? "New here? " : "Already have an account? "}
            <Link to={(isLogin ? "/register" : "/login") + nextQs} className="font-semibold text-primary hover:underline" data-testid="auth-switch-link">
              {isLogin ? "Create an account" : "Log in"}
            </Link>
          </p>
        </form>
      </section>
    </div>
  );
}
```

## `frontend/src/pages/GroupDetail.tsx`

```tsx
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, ChevronDown, History, Receipt, Search, Trash2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ExpenseChangeLog from "@/components/ExpenseChangeLog";
import ReceiptButton from "@/components/ReceiptButton";
import { Button } from "@/components/ui/button";
import { apiDelete, apiGet } from "@/lib/api";
import { format, parseISO } from "date-fns";
import { errorMessage, money } from "@/lib/format";
import type { Expense, Group, GroupSummary } from "@/lib/types";
import AddExpenseDialog from "@/components/AddExpenseDialog";
import SettleUpSummary from "@/components/SettleUpSummary";
import MemberBalances from "@/components/MemberBalances";
import ManageGroupDialog from "@/components/ManageGroupDialog";

const ALL = "__all__";
const SPLIT_LABEL = { equal: "Split equally", exact: "Exact amounts", full: "Owed in full", items: "By item" } as const;

export default function GroupDetail() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const group = useQuery({ queryKey: ["group", id], queryFn: () => apiGet<Group>(`/groups/${id}`) });
  const expenses = useQuery({ queryKey: ["group", id, "expenses"], queryFn: () => apiGet<Expense[]>(`/groups/${id}/expenses`) });
  const summary = useQuery({ queryKey: ["group", id, "summary"], queryFn: () => apiGet<GroupSummary>(`/groups/${id}/summary`) });

  const del = useMutation({
    mutationFn: (eid: string) => apiDelete(`/groups/${id}/expenses/${eid}`),
    onSuccess: () => {
      toast("Expense deleted");
      qc.invalidateQueries({ queryKey: ["group", id] });
      qc.invalidateQueries({ queryKey: ["groups"] });
    },
    onError: (e) => toast.error(errorMessage(e, "Could not delete")),
  });

  const g = group.isError ? undefined : group.data;
  const list = expenses.isError ? [] : expenses.data ?? [];
  const sum = summary.isError ? undefined : summary.data;
  const nameOf = (mid: string) => g?.members.find((m) => m.id === mid)?.name ?? "?";
  const [search, setSearch] = useState("");
  const [payer, setPayer] = useState<string>(ALL);
  const q = search.trim().toLowerCase();
  const filtering = q !== "" || payer !== ALL;
  const matches = (e: Expense) =>
    (payer === ALL || e.paid_by === payer) &&
    (!q || e.description.toLowerCase().includes(q) || nameOf(e.paid_by).toLowerCase().includes(q) || e.amount.toFixed(2).includes(q));
  const shown = list.filter(matches);
  const active = shown.filter((e) => !e.settled);
  const history = shown.filter((e) => e.settled);
  const [showHistory, setShowHistory] = useState(false);
  const toggleHistory = () => setShowHistory((v) => !v);
  const historyOpen = showHistory || filtering;
  const clearFilters = () => { setSearch(""); setPayer(ALL); };

  const receiptFor = (e: Expense, grp: Group) => (
    <ReceiptButton
      path={`/groups/${grp.id}/expenses/${e.id}/receipt`}
      hasReceipt={e.has_receipt}
      title={`Receipt · ${e.description}`}
      invalidateKey={["group", grp.id, "expenses"]}
    />
  );

  const renderExpense = (e: Expense, i: number, grp: Group) => (
    <article
      key={e.id}
      style={{ animationDelay: `${i * 40}ms` }}
      className={`animate-rise-in group flex items-center gap-4 rounded-2xl border p-4 transition-shadow duration-200 ${
        e.settled
          ? "border-slate-200/70 bg-slate-50 text-slate-500"
          : "border-slate-200 bg-white shadow-[0_2px_8px_rgba(15,23,42,0.04)] hover:shadow-[0_8px_24px_rgba(15,23,42,0.08)]"
      }`}
      data-testid={e.settled ? "settled-expense-item" : "expense-item"}
    >
      <div className="hidden w-12 shrink-0 text-center sm:block">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{e.date.length === 10 ? format(parseISO(e.date), "MMM") : ""}</p>
        <p className="text-xl font-black leading-none">{e.date.length === 10 ? format(parseISO(e.date), "d") : e.date}</p>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 font-bold" data-testid="expense-item-description">
          <span className="truncate">{e.description}</span>
          {e.settled && <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-green-800" data-testid="expense-settled-badge">Settled</span>}
          {e.has_receipt && receiptFor(e, grp)}
          <ExpenseChangeLog expense={e} />
        </div>
        <p className="mt-0.5 text-xs text-slate-500">
          <span className="font-semibold text-slate-700">{nameOf(e.paid_by)}</span> paid ·{" "}
          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium">{SPLIT_LABEL[e.split_type]}</span>
        </p>
        <p className="mt-1 truncate text-[11px] text-slate-400">
          {Object.entries(e.shares).map(([m, v]) => `${nameOf(m)} ${money(v, grp.currency)}`).join(" · ")}
        </p>
      </div>
      <p className="money shrink-0 text-lg font-semibold" data-testid="expense-item-amount">{money(e.amount, grp.currency)}</p>
      <div className="flex shrink-0 items-center opacity-100 transition-opacity duration-150 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
        {!e.has_receipt && receiptFor(e, grp)}
        <AddExpenseDialog group={grp} expense={e} />
        <Button
          size="icon-sm" variant="ghost" aria-label="Delete expense"
          className="text-slate-300 hover:text-rose-600"
          onClick={() => { if (window.confirm(`Delete "${e.description}"?`)) del.mutate(e.id); }}
          data-testid="delete-expense-button"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </article>
  );

  return (
    <div className="space-y-8">
      <Link to="/groups" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors duration-150 hover:text-slate-900" data-testid="back-to-groups">
        <ArrowLeft className="h-4 w-4" /> All groups
      </Link>

      <section className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">{g ? `${g.currency} · ${g.members.length} people` : "Group"}</p>
          <h1 className="mt-2 text-4xl font-black tracking-tight sm:text-5xl" data-testid="group-title">
            {g?.name ?? (group.isError ? "Group unavailable" : "Loading…")}
          </h1>
          {sum && g && (
            <p className="mt-2 text-sm text-slate-500">
              Total spent <span className="money font-semibold text-slate-900" data-testid="group-total-spent">{money(sum.total_spent, g.currency)}</span>
            </p>
          )}
        </div>
        {g && (
          <div className="flex gap-2">
            <ManageGroupDialog group={g} />
            <AddExpenseDialog group={g} />
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12">
        <section className="space-y-3 lg:col-span-7" data-testid="expense-list">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Expenses</p>
            {g && list.length > 0 && (
              <div className="flex gap-2" data-testid="expense-filters">
                <div className="relative flex-1 sm:w-56 sm:flex-none">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={search}
                    onChange={(ev) => setSearch(ev.target.value)}
                    placeholder="Search bills…"
                    className="h-9 bg-white pl-9"
                    data-testid="expense-search-input"
                  />
                </div>
                <Select value={payer} onValueChange={(v) => setPayer((v as string) ?? ALL)}>
                  <SelectTrigger className="h-9 w-36 bg-white" data-testid="expense-payer-filter">
                    <SelectValue>{(v) => (v === ALL ? "Anyone paid" : `${nameOf(v as string)} paid`)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL} data-testid="payer-filter-option-all">Anyone paid</SelectItem>
                    {g.members.map((m) => (
                      <SelectItem key={m.id} value={m.id} data-testid={`payer-filter-option-${m.name}`}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          {filtering && (
            <div className="flex items-center justify-between rounded-xl bg-teal-50 px-4 py-2 text-sm text-teal-900" data-testid="expense-filter-summary">
              <span>{shown.length} of {list.length} bills match{history.length ? ` · ${history.length} in History` : ""}</span>
              <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 text-xs font-semibold hover:underline" data-testid="clear-expense-filters">
                <X className="h-3.5 w-3.5" /> Clear
              </button>
            </div>
          )}
          {filtering && shown.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-muted-foreground" data-testid="expense-no-matches">
              No bills match your search.
            </div>
          )}
          {expenses.isPending && [0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-slate-200/60" />)}
          {!expenses.isPending && list.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center" data-testid="expenses-empty">
              <Receipt className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-3 font-bold">No expenses yet</p>
              <p className="text-sm text-muted-foreground">Add the first bill to start tracking.</p>
            </div>
          )}
          {!expenses.isPending && !filtering && active.length === 0 && history.length > 0 && (
            <div className="flex items-center gap-3 rounded-2xl border border-green-200 bg-green-50 p-5 text-green-900" data-testid="expenses-all-settled">
              <CheckCircle2 className="h-5 w-5" />
              <p className="text-sm font-semibold">All expenses are settled. New bills will show up here.</p>
            </div>
          )}
          {g && active.map((e, i) => renderExpense(e, i, g))}

          {g && history.length > 0 && (
            <div className="pt-4" data-testid="expense-history">
              <button
                type="button"
                onClick={toggleHistory}
                disabled={filtering}
                aria-expanded={historyOpen}
                className="flex w-full items-center justify-between rounded-xl border border-dashed border-slate-300 bg-white/60 px-4 py-3 text-sm font-semibold text-slate-600 transition-colors duration-150 hover:bg-white hover:text-slate-900"
                data-testid="expense-history-toggle"
              >
                <span className="flex items-center gap-2">
                  <History className="h-4 w-4" /> History · {history.length} settled {history.length === 1 ? "expense" : "expenses"}
                </span>
                <span className="flex items-center gap-1 text-xs text-slate-500">
                  {filtering ? "Showing matches" : showHistory ? "Hide" : "Show"}
                  <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${historyOpen ? "rotate-180" : ""}`} />
                </span>
              </button>
              {historyOpen && (
                <div className="mt-3 space-y-3" data-testid="expense-history-list">
                  {history.map((e, i) => renderExpense(e, i, g))}
                </div>
              )}
            </div>
          )}
        </section>

        <aside className="space-y-6 lg:sticky lg:top-24 lg:col-span-5">
          {g && <SettleUpSummary key={g.id} group={g} summary={sum} />}
          {g && sum && <MemberBalances balances={sum.balances} currency={g.currency} />}
        </aside>
      </div>
    </div>
  );
}
```

## `frontend/src/pages/Groups.tsx`

```tsx
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Receipt, Users } from "lucide-react";
import { apiGet } from "@/lib/api";
import { money } from "@/lib/format";
import type { GroupListItem } from "@/lib/types";
import CreateGroupDialog from "@/components/CreateGroupDialog";
import { useMe } from "@/lib/useMe";

export default function Groups() {
  const me = useMe();
  const groups = useQuery({ queryKey: ["groups"], queryFn: () => apiGet<GroupListItem[]>("/groups") });
  const list = groups.isError ? [] : groups.data ?? [];

  return (
    <div className="space-y-10">
      <section className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Your groups</p>
          <h1 className="mt-2 text-4xl font-black tracking-tight sm:text-5xl" data-testid="groups-heading">
            {me.data ? `Hey ${me.data.name.split(" ")[0]},` : "Hey,"}<br />
            <span className="text-slate-400">who owes whom?</span>
          </h1>
        </div>
        <CreateGroupDialog />
      </section>

      {groups.isPending && (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-44 animate-pulse rounded-2xl bg-slate-200/60" />)}
        </div>
      )}

      {!groups.isPending && list.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center" data-testid="groups-empty">
          <Users className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-4 text-lg font-bold">No groups yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Create one for your next trip, flat or dinner.</p>
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3" data-testid="groups-list">
        {list.map((g, i) => (
          <Link
            key={g.id}
            to={`/groups/${g.id}`}
            style={{ animationDelay: `${i * 50}ms` }}
            className="animate-rise-in group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_2px_8px_rgba(15,23,42,0.04)] transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(15,23,42,0.08)]"
            data-testid="group-card"
          >
            <div className="flex items-start justify-between">
              <div>
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold tracking-wide text-slate-600">{g.currency}</span>
                <h3 className="mt-3 text-xl font-black tracking-tight" data-testid="group-card-name">{g.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{g.members.map((m) => m.name).join(", ")}</p>
              </div>
              <ArrowUpRight className="h-5 w-5 text-slate-300 transition-[color,transform] duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-teal-600" />
            </div>
            <div className="mt-6 flex items-end justify-between border-t border-slate-100 pt-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Total spent</p>
                <p className="money text-lg font-semibold" data-testid="group-card-total">{money(g.total_spent, g.currency)}</p>
              </div>
              <div className="text-right text-xs text-slate-500">
                <p className="flex items-center justify-end gap-1"><Receipt className="h-3.5 w-3.5" /> {g.expense_count} expenses</p>
                <p className={g.unsettled_count ? "mt-1 font-semibold text-rose-600" : "mt-1 font-semibold text-green-700"} data-testid="group-card-status">
                  {g.unsettled_count ? `${g.unsettled_count} to settle` : "All settled"}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

## `frontend/src/pages/Join.tsx`

```tsx
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, Check, Link2Off, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiGet, apiPost } from "@/lib/api";
import { errorMessage, initials } from "@/lib/format";
import type { Group, InviteJoin, InvitePreview } from "@/lib/types";
import { useMe } from "@/lib/useMe";
import { cn } from "@/lib/utils";

const NEW = "__new__";

export default function JoinGroup() {
  const { token = "" } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const invite = useQuery({ queryKey: ["invite", token], queryFn: () => apiGet<InvitePreview>(`/invites/${token}`), retry: false });
  const data = invite.isError ? undefined : invite.data;

  const preferred = params.get("m");
  const [choice, setChoice] = useState<string | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const mine = data?.members.find((m) => m.mine);
  const available = data?.members.filter((m) => !m.claimed) ?? [];
  const defaultChoice = mine?.id ?? (preferred && available.some((m) => m.id === preferred) ? preferred : null);
  const selected = choice ?? defaultChoice;
  const name = newName ?? me.data?.name ?? "";
  const selectedName = selected === NEW ? name.trim() : data?.members.find((m) => m.id === selected)?.name;

  const join = useMutation({
    mutationFn: () => apiPost<Group>(`/invites/${token}/join`, (selected === NEW ? { new_name: name.trim() } : { member_id: selected }) satisfies InviteJoin),
    onSuccess: (g) => {
      qc.invalidateQueries({ queryKey: ["groups"] });
      qc.invalidateQueries({ queryKey: ["group", g.id] });
      toast.success(`You're in ${g.name} as ${selectedName}`);
      nav(`/groups/${g.id}`);
    },
    onError: (e) => { toast.error(errorMessage(e, "Could not join")); invite.refetch(); },
  });

  if (invite.isError) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center" data-testid="invite-invalid">
        <Link2Off className="mx-auto h-10 w-10 text-slate-300" />
        <p className="mt-4 text-lg font-bold">Invite link not working</p>
        <p className="mt-1 text-sm text-muted-foreground">{errorMessage(invite.error, "This link is invalid.")}</p>
        <Button className="mt-6" render={<Link to="/groups" />} data-testid="invite-go-groups">Go to my groups</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg animate-rise-in">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
        <div className="bg-slate-900 px-6 py-6 text-slate-50">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal-300">You're invited</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight" data-testid="invite-group-name">{data?.group_name ?? "Loading…"}</h1>
          {data && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-400">
              <Users className="h-4 w-4" /> {data.members.length} people · {data.currency}
              {data.invited_by && <> · invited by {data.invited_by}</>}
            </p>
          )}
        </div>
        {data && (
          <div className="space-y-5 p-6">
            {data.already_member && mine && (
              <p className="rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-900" data-testid="invite-already-member">
                You're already in this group as {mine.name}. You can switch names below or just open it.
              </p>
            )}
            <div>
              <p className="text-sm font-semibold">Which one is you?</p>
              <p className="text-xs text-muted-foreground">Picking your name means payments to you wait for your "Got it".</p>
              <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup">
                {data.members.map((m) => {
                  const active = selected === m.id;
                  return (
                    <button
                      key={m.id} type="button" role="radio" aria-checked={active} disabled={m.claimed}
                      onClick={() => setChoice(m.id)}
                      className={cn(
                        "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm font-semibold transition-[background-color,border-color] duration-150",
                        active ? "border-teal-600 bg-teal-50 text-teal-950" : "border-slate-200 hover:bg-slate-50",
                        m.claimed && "cursor-not-allowed opacity-50 hover:bg-transparent",
                      )}
                      data-testid={`invite-member-option-${m.name}`}
                    >
                      <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-bold", active ? "bg-teal-600 text-white" : "bg-slate-100")}>
                        {active ? <Check className="h-4 w-4" /> : initials(m.name)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate">{m.name}</span>
                        {m.claimed && <span className="block text-[11px] font-medium text-slate-500">already taken</span>}
                        {m.mine && <span className="block text-[11px] font-medium text-teal-700">you</span>}
                      </span>
                    </button>
                  );
                })}
                <button
                  type="button" role="radio" aria-checked={selected === NEW} onClick={() => setChoice(NEW)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-xl border border-dashed px-3 py-2.5 text-left text-sm font-semibold transition-[background-color,border-color] duration-150",
                    selected === NEW ? "border-teal-600 bg-teal-50 text-teal-950" : "border-slate-300 text-slate-600 hover:bg-slate-50",
                  )}
                  data-testid="invite-member-option-new"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100"><UserPlus className="h-4 w-4" /></span>
                  I'm not listed
                </button>
              </div>
              {selected === NEW && (
                <Input className="mt-3" placeholder="Your name" value={name} onChange={(e) => setNewName(e.target.value)} maxLength={60} data-testid="invite-new-name-input" />
              )}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
              {data.already_member ? (
                <Button variant="ghost" render={<Link to={`/groups/${data.group_id}`} />} data-testid="invite-open-group">Open group</Button>
              ) : <span />}
              <Button
                className="h-11 px-5 font-semibold"
                disabled={!selected || (selected === NEW && !name.trim()) || join.isPending || (selected === mine?.id)}
                onClick={() => join.mutate()}
                data-testid="invite-join-button"
              >
                {join.isPending ? "Joining…" : selectedName ? `Join as ${selectedName}` : "Pick your name"} <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

## backend/.env keys (values hidden)
```
MONGO_URL=<set-me>
DB_NAME=<set-me>
CORS_ORIGINS=<set-me>
APP_URL=<set-me>
JWT_SECRET=<set-me>

EMERGENT_LLM_KEY=<set-me>
RECEIPT_MODEL=<set-me>
```
