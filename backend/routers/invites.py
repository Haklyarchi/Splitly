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
