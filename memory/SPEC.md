# Splitly — bill splitting app (SPEC)

## What it does
Users register/login (email+password, JWT in httpOnly `session` cookie). They create groups (name, currency, list of people by name), add expenses (description, amount, payer, split type), and see a settle-up summary: per-person balances + simplified (greedy min transfers) "X pays Y" list. Transfers can be marked settled (creates a Settlement; undoable).

## Split types
- `equal`: amount divided evenly among `participant_ids` (cent remainder to first)
- `exact`: `exact_amounts` {member_id: amount} must sum to amount (400 otherwise)
- `full`: `participant_ids` = [one member] who owes the full amount

## Data model (Mongo)
- users {id, name, email, password_hash}
- groups {id, name, currency, members[{id,name}], owner_id, user_ids[]}
- expenses {id, group_id, description, amount, paid_by, split_type, shares{member_id: amt}, date}
- settlements {id, group_id, from_member, to_member, amount}

## API (/api)
auth: POST /auth/register, /auth/login, /auth/logout, GET /auth/me
groups: GET/POST /groups, GET/DELETE /groups/{id}, POST /groups/{id}/members {name} (400 on duplicate name), DELETE /groups/{id}/members/{mid} (400 if member is in any expense/settlement or is the last member), POST /groups/{id}/share {email},
GET/POST /groups/{id}/expenses, DELETE /groups/{id}/expenses/{eid}, POST /groups/{id}/settlements,
DELETE /groups/{id}/settlements/{sid}, GET /groups/{id}/summary

## Frontend routes
/login, /register, /groups, /groups/:id (anything else -> /groups; unauth -> /login)

## Seed (backend/seed.py, idempotent)
demo@splitly.app / demo1234 with groups "Bali Trip" (USD; Alex, Sam, Jordan, Priya; 4 expenses incl. equal/exact/full) and "Flat 4B" (EUR; Alex, Mia, Leo; 2 equal expenses).

## Notifications (in-app)
- Adding an expense or marking a settlement creates a `notifications` doc for every account in group.user_ids except the actor.
- API: GET /notifications -> {items (latest 50), unread_count}; POST /notifications/read-all; POST /notifications/{id}/read
- UI: bell in header (polls every 15s) with unread badge, popover list, mark all read; clicking an item marks read + opens the group.
- Seed: friend@splitly.app / friend1234 shares "Bali Trip" with demo.

## Settle-up extras
- Settlement history is collapsed by default; the Show/Hide state is remembered per group in localStorage (`splitly:history-open:<groupId>`).
- Settlement notes: `SettlementCreate.note` (optional, ≤140 chars), stored on `Settlement.note`, shown under each history item and appended to the settlement notification. "Mark as settled" opens an inline note field + "Confirm settled".
- Reminders: `POST /api/groups/{id}/remind {from_member, to_member}` → `{notified, amount}`. 400 if that pair is not a current simplified transfer. Sends a `kind:"reminder"` bell notification to every group account except the sender (amber BellRing icon).

## Editing expenses & expense history
- `PUT /api/groups/{id}/expenses/{eid}` (body = ExpenseCreate) re-validates the split, keeps the original `created_at`, sets `updated_at` (UI shows an "edited" tag) and notifies other accounts. Pencil button on each expense opens AddExpenseDialog in edit mode, prefilled.
- `Expense.settled` is computed on read (`lib/splits.settled_expense_ids`): replay expenses + settlements by `created_at`; every expense created before the last moment the whole group was fully square is settled. Undoing a settlement or editing an old expense so balances no longer zero brings them back.
- Group page shows only unsettled expenses; settled ones sit in a collapsed "History · N settled expenses" section (click to show).

## Change log, search, receipts, reminder cooldown
- Edits: each PUT diffs old vs new (description, amount, payer, split type/participants, exact shares, date) and `$push`es `ExpenseEdit {at, by_name, changes[]}` onto `Expense.edits`. No-op edits are not logged. The "edited" tag opens a Change log popover.
- Search/filter (client-side): search box matches description, payer name or amount; payer Select filters by who paid. While filtering, History auto-expands so settled bills are searchable; "N of M bills match · Clear" bar.
- Receipts: `PUT/GET/DELETE /api/groups/{gid}/expenses/{eid}/receipt`. PUT body `{data_url}` (JPEG/PNG/WebP, ≤3 MB; client downsizes to 1600px JPEG). Stored in Mongo `receipts` collection (bytes), `Expense.has_receipt` flag. Paperclip attaches; amber "Receipt" chip opens viewer with Replace/Remove. Deleted with expense/group.
- Reminder cooldown: one reminder per debt pair per 24h (`reminders` collection); second → 429 with "try again in about N hours". `Transfer.last_reminded_at` disables the button ("Reminded"). Cooldown only starts if someone was actually notified.

## Receipt scanning (AI)
- `POST /api/receipts/scan {data_url}` → `ReceiptScan {amount, description, date, currency}` (all nullable). Uses Gemini `gemini-3.8-flash` via emergentintegrations + `EMERGENT_LLM_KEY` (model overridable with `RECEIPT_MODEL` in backend/.env). 502 with a friendly message if the model call fails.
- Add-expense dialog: "Scan receipt" panel → compresses photo, scans, fills amount/description/date (user reviews), warns if receipt currency ≠ group currency; the photo is auto-attached to the expense after save. Dialog also has a Date field now (empty = server today).

## Settlement receipts (proof of payment)
- `PUT/GET/DELETE /api/groups/{gid}/settlements/{sid}/receipt` (same `{data_url}` body/limits as expense receipts), stored in Mongo `settlement_receipts` (unique settlement_id); `Settlement.has_receipt` flag. Removed on settlement undo / group delete.
- "Mark as settled" form has "Attach payment receipt (optional)"; photo uploads right after the settlement is saved. Each Settlement history row shows a Receipt chip (view/replace/remove) or a paperclip to add one later. `ReceiptButton` is shared (props: path, hasReceipt, title, invalidateKey, testid prefix "settlement-").

## Itemized splitting
- `split_type: "items"` with `ExpenseCreate.items: [{name, price, member_ids}]` (stored on `Expense.items`). `lib/splits._item_shares`: each line split evenly (in cents) among who had it; the gap between the line total and the bill (tax/tip/discount) is shared pro-rata; leftover cents go to the biggest shares.
- Receipt scan now also returns `items: [{name, price}]`; when items are found the dialog switches to "By item" with everyone ticked on every line. `ItemSplitEditor` lets users edit/add/remove lines, tap member chips, and shows items subtotal, shared extra and per-person preview.

## Payment confirmation
- Members can be linked to accounts: `POST /api/groups/{id}/members/{mid}/claim` toggles "That's me" (one member per account per group; 400 if someone else claimed it). `Member.user_id`.
- Settlements record `recorded_by/recorded_by_name`; `POST /api/groups/{id}/settlements/{sid}/confirm` sets `confirmed_at/confirmed_by_name`. Who may confirm: the recipient member's linked account; if the recipient isn't linked, any group account other than the recorder. `Settlement.can_confirm` is computed per viewer in the summary. Balances count the payment immediately; confirmation is a status.
- UI: green "X says they paid Y — Received it? Got it" callout for the viewer; history rows show "Confirmed by …" or "Awaiting Y's confirmation"; history toggle shows "· N awaiting confirmation".

## Group invite links
- `POST /api/groups/{id}/invite` → `{token}` (created once, stable); `POST /api/groups/{id}/invite/reset` issues a new token (old link 404s). Stored as `groups.invite_token` (unique sparse index) + `invite_by`.
- `GET /api/invites/{token}` (login required) → InvitePreview (group name, currency, inviter, members with `claimed`/`mine`, `already_member`).
- `POST /api/invites/{token}/join {member_id | new_name}` → adds the account to `user_ids` and links it to that member (or creates a new member), unlinking any previous name of theirs in that group. 400 if the name is taken by another account or a new name duplicates an existing one. Notifies others (`kind:"member"`).
- UI: Manage dialog "Invite link" box (Copy, New link) + a link icon next to each unlinked name copying `/join/<token>?m=<memberId>` (preselects that name). `/join/:token` page: pick "Which one is you?" or "I'm not listed". Logged-out visitors are sent to `/login?next=/join/...` (banner shown; register link keeps `next`) and returned after sign-in.
