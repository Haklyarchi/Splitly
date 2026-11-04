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
