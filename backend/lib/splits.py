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
