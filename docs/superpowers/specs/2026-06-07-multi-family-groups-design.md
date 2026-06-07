# Multi Family Groups — Design Spec

**Date:** 2026-06-07
**Status:** Approved by user, ready for implementation plan

## Problem

Today a user can belong to **at most one** family group (`User.familyGroupId`,
a single nullable FK). The user wants to support **multiple** groups per user
— e.g. "ครอบครัวกับแฟน" (family with partner) and "ครอบครัวกับพ่อแม่" (family
with parents) — as separate, isolated groups with separate shared data.

This is the last item in the Settings backlog (see `project_state` memory)
before the Wallet/Credit Card system.

## Scope decisions (confirmed with user)

1. **Family data view = switcher, not merge.** When viewing shared family data
   (dashboard "ครอบครัว" tab, transactions family filter), the user picks ONE
   group at a time from a dropdown — never a merged view across groups. This
   avoids leaking e.g. in-laws' shared spending into the parents-group view.
2. **Family-tagged transactions/debts belong to ONE specific group**, chosen
   via an explicit dropdown at entry time — not inferred from a global
   "active group". A grocery run shared with the in-laws should be invisible
   to the parents group and vice versa.
3. **Three independent group-pickers, no shared "active group" state:**
   - Settings management page dropdown — picks which group's *settings* to view/edit
   - Dashboard/transactions family filter dropdown — picks which group's *data* to view
   - Transaction/debt entry form dropdown — picks which group to *tag this entry to*
   These do not sync with each other. Confirmed explicitly by the user after
   an initial proposal to link them was rejected.
4. **Group naming mirrors the existing private-member-alias pattern**
   (`FamilyMemberAlias`): the creator sets a required default name everyone
   sees; any member may additionally set a private nickname for the group,
   visible only to themselves. Resolution order:
   `groupDisplayName = my private group-nickname ?? group's default name`

## Data model changes

### New table `UserFamilyGroup` (replaces `User.familyGroupId`)
```
userId    String
groupId   String
joinedAt  DateTime @default(now())
@@unique([userId, groupId])
```
A user can now belong to N groups; a group can have N members. Replaces the
single nullable FK + its `@@index([familyGroupId])`.

### `FamilyGroup.name` becomes required
Was `String?` (optional, fell back to showing the invite code). Now `String`
— creator must type a name at creation time. This becomes the default
display name every member sees unless they set a private override.

### New table `FamilyGroupAlias` (mirrors `FamilyMemberAlias`)
```
viewerId  String  // User who set the private nickname
groupId   String  // The group being privately renamed
nickname  String
@@unique([viewerId, groupId])
```
Same isolation guarantee as member aliases: invisible to anyone but the
viewer, never affects what the group's default name shows to others.

### `Transaction.familyGroupId` / `Debt.familyGroupId` (new, nullable FK)
The existing `isFamily: Boolean` is **kept as-is** — it already serves a
dual purpose (personal family-tagging + cross-user sync trigger) and works
fine for users in zero groups. `familyGroupId` is an *additional* optional
field, populated only when the user is in ≥1 group AND explicitly picks one
from the new entry-form dropdown.

Cross-user visibility for the family filter changes from
`isFamily=true AND userId IN <group member ids>` to simply
`familyGroupId = <selected group id>` (plus a membership check for
authorization on the selected group).

`onDelete: SetNull` on both — if a group is deleted (last member left),
previously-shared transactions/debts simply revert to "personal
family-tagged" with no data loss.

## API changes

### `GET /api/v1/family` — now returns a LIST
```ts
{ groups: [{ id, inviteCode, name, displayName, members: [...] }] }
```
Each `members[]` entry keeps the existing `myAlias` / `displayName` / `isMe`
resolution — just nested per-group now instead of flat.

### `POST /api/v1/family/create`
- Drop the "already in a group" `ALREADY_IN_GROUP` block — unlimited groups
- Add required `name` to the request body (new Zod field)

### `POST /api/v1/family/join`
- Drop the "already in a group" block
- Keep the existing duplicate-membership guard (unique `userId+groupId` —
  can't join the same group twice, but can join different ones)

### `DELETE /api/v1/family/leave`
- Now requires `groupId` in the body (was implicit, single-group)
- Same cascade: delete the group if it becomes empty

### `PATCH /api/v1/family/group-nickname` (new)
- `{ groupId, nickname }` — sets/clears caller's private nickname for a
  specific group, upserts into `FamilyGroupAlias`
- Mirrors `PATCH /api/v1/family/alias` exactly (same validation shape,
  trim-to-null-deletes semantics)

### `PATCH /api/v1/family/alias`
- "Same group" validation (`me.familyGroupId === target.familyGroupId`)
  becomes "share at least one group" — query `UserFamilyGroup` for overlap
  between viewer and target. Alias itself stays global per (viewer, target)
  pair regardless of how many groups they share.

### `getFamilyMemberIds(userId)` → replaced by `getUserFamilyGroups(userId)`
New helper returns `[{ id, name, displayName }]` — feeds the 3
dropdowns. Family-data routes (`transactions`, `dashboard/summary`,
`dashboard/by-category`) take a `familyGroupId` query param instead of
deriving a member-id list; filter becomes `WHERE familyGroupId = <selected>`.

**Call sites needing this update** (found via grep):
- `src/app/api/v1/transactions/route.ts`
- `src/app/api/v1/dashboard/summary/route.ts`
- `src/app/api/v1/dashboard/by-category/route.ts`
- `src/lib/family.ts` (the helper itself)

## UI changes

### Settings page
The embedded "กลุ่มครอบครัว" card is replaced by a single link row "ครอบครัว"
(chevron, same pattern as the existing "หมวดหมู่" / "ช่องทางชำระเงิน" rows
added in the category/payment-method work) → opens the new page below.

### New page `/settings/family`
- Top: "+ สร้างกลุ่ม" / "เข้าร่วมด้วยรหัส" actions — always visible, user can
  always create or join more groups
- Group-picker dropdown — choose which of the user's groups to view/manage
- Selected-group panel:
  - Invite code + copy button
  - Member list — existing inline private-member-alias editor, unchanged
  - Private group-nickname editor — pencil icon → inline input, same UX as
    member alias ("ตั้งชื่อกลุ่มที่อยากเรียก (ส่วนตัว)", placeholder shows
    the creator's default name, helper text "เห็นเฉพาะคุณคนเดียว")
  - "ออกจากกลุ่ม" button + confirm dialog (existing pattern, now passes
    the selected `groupId`)

### Dashboard "ครอบครัว" tab
When the user belongs to ≥1 group, a dropdown appears (placed under the
mode toggle) to pick which group's shared data to display. Passes
`familyFilter=family&familyGroupId=<id>` to the summary/by-category APIs.
Zero groups → existing empty state, unchanged.

### Transactions page family filter
Same dropdown pattern, replacing/augmenting the flat "ครอบครัว" pill button
when the user has ≥1 group.

### Transaction form & DebtForm
When the "รายการครอบครัว" / "หนี้สินครอบครัว" toggle is ON AND the user
belongs to ≥1 group, a group-select dropdown appears beneath it:
"บันทึกเข้ากลุ่มครอบครัวไหน — ไม่ระบุ / <group display names...>".
Leaving it on "ไม่ระบุ" preserves today's behavior exactly (personal
family-tag only, no cross-user sync — `familyGroupId` stays null).
Zero groups → dropdown hidden, current behavior unchanged.

## Migration plan

Prisma migration, ordered to avoid data loss:

1. Create `UserFamilyGroup` join table; backfill one row per user from the
   existing `User.familyGroupId` (where not null)
2. Add `Transaction.familyGroupId` / `Debt.familyGroupId` (nullable);
   backfill `WHERE isFamily = true` using the OLD `User.familyGroupId` of
   the owning user — **must run before step 3 drops that column**
3. Drop `User.familyGroupId` column, its FK, and `@@index([familyGroupId])`
4. Backfill any `FamilyGroup.name IS NULL` rows with their `inviteCode`,
   then alter the column to required (`String`, was `String?`)
5. Create `FamilyGroupAlias` table (empty — brand new feature, nothing to
   backfill)

## Edge cases

- **Leaving a group** with shared transactions/debts referencing it via
  `familyGroupId`: rows keep the FK if the group still has other members.
  If it was the last member, the group is deleted and `onDelete: SetNull`
  reverts those rows to "personal family-tagged" — no data loss.
- **Joining a new group**: no retroactive tagging. Only new entries created
  afterward get the group-select dropdown for that group.
- **`getFamilyMemberIds` call sites**: 3 API routes + the helper itself need
  updating to the new `familyGroupId`-scoped filter shape (listed above
  under the helper-replacement section).

## Verification plan

After implementation, set up two fixture accounts (`test` / `test2`) with:
- Both accounts in a shared group (so the cross-sync, switcher, and entry
  dropdown can all be exercised together)
- At least one account also belonging to a SECOND, separate group (to prove
  isolation — group-A members must never see group-B's shared data)
- A few `isFamily=true` transactions/debts tagged to each group, to verify
  the dashboard/transactions switcher correctly scopes by `familyGroupId`
  and that group-A data never leaks into group-B's view

Verify end-to-end via Playwright (matching the pattern used for the original
Family Group cross-user sync and the private-alias features): create groups,
join, tag entries to specific groups, switch the dashboard/transactions
filter between groups, confirm isolation, confirm private group-nickname
and member-alias resolution all work per-viewer.
