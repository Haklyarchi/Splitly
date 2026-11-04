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
