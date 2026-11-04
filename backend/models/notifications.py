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
