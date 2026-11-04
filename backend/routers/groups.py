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
