# Test Credentials
# Agent writes here when creating/modifying auth credentials (admin accounts, test users).
# Testing agent reads this before auth tests. Fork/continuation agents read on startup.

## Demo user (seeded by backend/seed.py)
- Email: demo@splitly.app
- Password: demo1234
- Auth: POST /api/auth/login sets httpOnly `session` cookie

## Friend user (seeded) — shares demo's "Bali Trip" group (for notifications)
- Email: friend@splitly.app
- Password: friend1234

## Invite-flow test account
- invitee@splitly.app / invite1234 (name "Nina") — not a member of any group by default; use it to test /join/<token> invite links.
