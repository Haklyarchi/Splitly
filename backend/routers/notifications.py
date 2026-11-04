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
