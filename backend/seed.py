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
