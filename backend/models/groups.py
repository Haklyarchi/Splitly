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
