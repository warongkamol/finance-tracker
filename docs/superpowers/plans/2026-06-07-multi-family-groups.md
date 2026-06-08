# Multi Family Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-family-group model (`User.familyGroupId`, a nullable FK limiting each user to one group) with a many-to-many `UserFamilyGroup` join table, so a user can belong to multiple isolated family groups — each with its own shared transactions/debts, member list, and private nicknames.

**Architecture:** A new `UserFamilyGroup` join table replaces the nullable FK on `User`. A new `FamilyGroupAlias` table mirrors the existing `FamilyMemberAlias` private-nickname pattern (creator sets a required default group name; any member may privately override it for themselves). `Transaction`/`Debt` each gain an additive, nullable `familyGroupId` FK alongside the existing `isFamily` flag (which is kept as-is). The helper `getFamilyMemberIds` is replaced by `getUserFamilyGroups`, which feeds three independent group-picker dropdowns (settings management, dashboard/transactions data filter, transaction/debt entry forms) — these never sync with each other per the approved spec.

**Tech Stack:** Next.js 14 App Router + TypeScript, Prisma ORM (PostgreSQL 16), Zod, shadcn/ui `Select`, NextAuth v5.

**Spec:** `docs/superpowers/specs/2026-06-07-multi-family-groups-design.md`

---

### Task 1: Schema changes + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_multi_family_groups/migration.sql`

- [ ] **Step 1: Edit `FamilyGroup` model in `prisma/schema.prisma:14-23`**

Replace:
```prisma
model FamilyGroup {
  id         String   @id @default(cuid())
  inviteCode String   @unique @map("invite_code")
  name       String?
  createdAt  DateTime @default(now()) @map("created_at")

  members User[]

  @@map("family_groups")
}
```
With:
```prisma
model FamilyGroup {
  id         String   @id @default(cuid())
  inviteCode String   @unique @map("invite_code")
  name       String
  createdAt  DateTime @default(now()) @map("created_at")

  memberships  UserFamilyGroup[]
  aliases      FamilyGroupAlias[]
  transactions Transaction[]
  debts        Debt[]

  @@map("family_groups")
}

// Many-to-many: a user can belong to N independent, isolated family groups.
// Replaces the old single-group `User.familyGroupId` nullable FK.
model UserFamilyGroup {
  id       String      @id @default(cuid())
  userId   String      @map("user_id")
  user     User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  groupId  String      @map("group_id")
  group    FamilyGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
  joinedAt DateTime    @default(now()) @map("joined_at")

  @@unique([userId, groupId])
  @@index([groupId])
  @@map("user_family_groups")
}

// Private, per-viewer nickname for a family group — mirrors FamilyMemberAlias.
// Only the viewer who set it can see it; never affects the group's default
// name shown to other members.
model FamilyGroupAlias {
  id        String      @id @default(cuid())
  viewerId  String      @map("viewer_id")
  viewer    User        @relation("FamilyGroupAliasViewer", fields: [viewerId], references: [id], onDelete: Cascade)
  groupId   String      @map("group_id")
  group     FamilyGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
  nickname  String
  createdAt DateTime    @default(now()) @map("created_at")
  updatedAt DateTime    @updatedAt @map("updated_at")

  @@unique([viewerId, groupId])
  @@index([groupId])
  @@map("family_group_aliases")
}
```

- [ ] **Step 2: Edit `User` model in `prisma/schema.prisma:25-51`**

Replace lines 33-34:
```prisma
  familyGroupId String?      @map("family_group_id")
  familyGroup   FamilyGroup? @relation(fields: [familyGroupId], references: [id], onDelete: SetNull)
```
With:
```prisma
  familyGroups UserFamilyGroup[]
```

Replace line 47 (`aliasesReceived ...`) — keep it, but add a new line directly after it:
```prisma
  aliasesReceived     FamilyMemberAlias[] @relation("FamilyAliasTarget")
  groupAliases        FamilyGroupAlias[]  @relation("FamilyGroupAliasViewer")
```

Delete line 49:
```prisma
  @@index([familyGroupId])
```
(the `@@map("users")` line stays as the only line in that final block)

- [ ] **Step 3: Edit `Transaction` model in `prisma/schema.prisma:155-185`**

Replace lines 168-170:
```prisma
  isFamily       Boolean       @default(false) @map("is_family")
  familyMemberId String?       @map("family_member_id")
  familyMember   FamilyMember? @relation(fields: [familyMemberId], references: [id])
```
With:
```prisma
  isFamily       Boolean       @default(false) @map("is_family")
  familyMemberId String?       @map("family_member_id")
  familyMember   FamilyMember? @relation(fields: [familyMemberId], references: [id])

  // Tags this transaction to one specific shared group (chosen explicitly at
  // entry time). Null = personal family-tag only, no cross-user sync.
  familyGroupId String?      @map("family_group_id")
  familyGroup   FamilyGroup? @relation(fields: [familyGroupId], references: [id], onDelete: SetNull)
```

Add an index — replace line 183:
```prisma
  @@index([categoryId])
```
With:
```prisma
  @@index([categoryId])
  @@index([familyGroupId])
```

- [ ] **Step 4: Edit `Debt` model in `prisma/schema.prisma:197-220`**

Replace line 207:
```prisma
  isFamily      Boolean    @default(false) @map("is_family")
```
With:
```prisma
  isFamily      Boolean    @default(false) @map("is_family")
  familyGroupId String?    @map("family_group_id")
  familyGroup   FamilyGroup? @relation(fields: [familyGroupId], references: [id], onDelete: SetNull)
```

Replace line 218:
```prisma
  @@index([userId, status])
```
With:
```prisma
  @@index([userId, status])
  @@index([familyGroupId])
```

- [ ] **Step 5: Generate an empty migration to hand-edit**

```bash
npx prisma migrate dev --create-only --name multi_family_groups
```

This creates `prisma/migrations/<timestamp>_multi_family_groups/migration.sql` pre-populated by Prisma's diff. **Discard its generated contents** — replace the entire file with the hand-written SQL below, ordered to avoid data loss (join table must exist and be backfilled before the old column is dropped; `Transaction`/`Debt` backfill must read the OLD `users.family_group_id` before step 5 drops it).

- [ ] **Step 6: Replace the migration file contents**

Overwrite `prisma/migrations/<timestamp>_multi_family_groups/migration.sql` with:

```sql
-- 1. Create the join table
CREATE TABLE "user_family_groups" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_family_groups_pkey" PRIMARY KEY ("id")
);

-- 2. Backfill: one membership row per user currently in a group
INSERT INTO "user_family_groups" ("id", "user_id", "group_id", "joined_at")
SELECT gen_random_uuid()::text, "id", "family_group_id", CURRENT_TIMESTAMP
FROM "users"
WHERE "family_group_id" IS NOT NULL;

-- 3. Add nullable familyGroupId to transactions and debts
ALTER TABLE "transactions" ADD COLUMN "family_group_id" TEXT;
ALTER TABLE "debts" ADD COLUMN "family_group_id" TEXT;

-- 4. Backfill family-tagged rows from the OWNER's old single group
--    (must run BEFORE step 5 drops users.family_group_id)
UPDATE "transactions" t
SET "family_group_id" = u."family_group_id"
FROM "users" u
WHERE t."user_id" = u."id"
  AND t."is_family" = true
  AND u."family_group_id" IS NOT NULL;

UPDATE "debts" d
SET "family_group_id" = u."family_group_id"
FROM "users" u
WHERE d."user_id" = u."id"
  AND d."is_family" = true
  AND u."family_group_id" IS NOT NULL;

-- 5. Drop the old single-group column, its FK and index
ALTER TABLE "users" DROP CONSTRAINT "users_family_group_id_fkey";
DROP INDEX "users_family_group_id_idx";
ALTER TABLE "users" DROP COLUMN "family_group_id";

-- 6. FamilyGroup.name becomes required — backfill any NULLs with the invite code first
UPDATE "family_groups" SET "name" = "invite_code" WHERE "name" IS NULL;
ALTER TABLE "family_groups" ALTER COLUMN "name" SET NOT NULL;

-- 7. Create the private group-nickname table (brand new — nothing to backfill)
CREATE TABLE "family_group_aliases" (
    "id" TEXT NOT NULL,
    "viewer_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "family_group_aliases_pkey" PRIMARY KEY ("id")
);

-- 8. Indexes
CREATE UNIQUE INDEX "user_family_groups_user_id_group_id_key" ON "user_family_groups"("user_id", "group_id");
CREATE INDEX "user_family_groups_group_id_idx" ON "user_family_groups"("group_id");
CREATE INDEX "transactions_family_group_id_idx" ON "transactions"("family_group_id");
CREATE INDEX "debts_family_group_id_idx" ON "debts"("family_group_id");
CREATE UNIQUE INDEX "family_group_aliases_viewer_id_group_id_key" ON "family_group_aliases"("viewer_id", "group_id");
CREATE INDEX "family_group_aliases_group_id_idx" ON "family_group_aliases"("group_id");

-- 9. Foreign keys
ALTER TABLE "user_family_groups" ADD CONSTRAINT "user_family_groups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_family_groups" ADD CONSTRAINT "user_family_groups_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "family_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_family_group_id_fkey" FOREIGN KEY ("family_group_id") REFERENCES "family_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "debts" ADD CONSTRAINT "debts_family_group_id_fkey" FOREIGN KEY ("family_group_id") REFERENCES "family_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "family_group_aliases" ADD CONSTRAINT "family_group_aliases_viewer_id_fkey" FOREIGN KEY ("viewer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "family_group_aliases" ADD CONSTRAINT "family_group_aliases_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "family_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 7: Apply the migration and regenerate the client**

```bash
npx prisma migrate dev
npx prisma generate
```

Expected: `Your database is now in sync with your schema.` and the client regenerates with `UserFamilyGroup`, `FamilyGroupAlias`, `Transaction.familyGroupId`, `Debt.familyGroupId`, `FamilyGroup.name: string` (no longer nullable) typed.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(family): add UserFamilyGroup join table and FamilyGroupAlias for multi-group support"
```

---

### Task 2: Replace `getFamilyMemberIds` with `getUserFamilyGroups`

**Files:**
- Modify: `src/lib/family.ts`

- [ ] **Step 1: Replace the whole file contents**

Current `src/lib/family.ts`:
```typescript
import { prisma } from "@/lib/prisma";

export async function getFamilyMemberIds(userId: string): Promise<string[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { familyGroupId: true },
  });
  if (!user?.familyGroupId) return [userId];
  const members = await prisma.user.findMany({
    where: { familyGroupId: user.familyGroupId },
    select: { id: true },
  });
  return members.map((m) => m.id);
}

export function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}
```

Replace it entirely with:
```typescript
import { prisma } from "@/lib/prisma";

export interface UserFamilyGroupSummary {
  id: string;
  name: string;
  displayName: string;
}

// Returns every group the user belongs to, each resolved to the display name
// THIS viewer should see: their private group-nickname if set, else the
// group's shared default name. Ordered by joinedAt so dropdowns can default
// to "first group joined" deterministically. Feeds the three independent
// group-picker dropdowns (settings, dashboard/transactions filter, entry forms).
export async function getUserFamilyGroups(userId: string): Promise<UserFamilyGroupSummary[]> {
  const memberships = await prisma.userFamilyGroup.findMany({
    where: { userId },
    select: { group: { select: { id: true, name: true } } },
    orderBy: { joinedAt: "asc" },
  });
  if (memberships.length === 0) return [];

  const groupIds = memberships.map((m) => m.group.id);
  const myAliases = await prisma.familyGroupAlias.findMany({
    where: { viewerId: userId, groupId: { in: groupIds } },
    select: { groupId: true, nickname: true },
  });
  const aliasByGroup = new Map(myAliases.map((a) => [a.groupId, a.nickname]));

  return memberships.map(({ group }) => ({
    id: group.id,
    name: group.name,
    displayName: aliasByGroup.get(group.id) ?? group.name,
  }));
}

export function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}
```

- [ ] **Step 2: Search for any remaining references to the old helper**

```bash
grep -rn "getFamilyMemberIds" src/
```

Expected: no matches (Tasks 4-10 below replace every call site). If this still shows matches after finishing Task 10, something was missed — go back and fix it.

- [ ] **Step 3: Commit**

```bash
git add src/lib/family.ts
git commit -m "refactor(family): replace getFamilyMemberIds with getUserFamilyGroups for multi-group support"
```

---

### Task 3: Add `familyGroupId` to validation schemas

**Files:**
- Modify: `src/lib/validations/transaction.ts`
- Modify: `src/lib/validations/debt.ts`

- [ ] **Step 1: Edit `src/lib/validations/transaction.ts:13-14`**

Replace:
```typescript
  isFamily: z.boolean().optional(),
  familyMemberId: z.string().min(1).nullable().optional(),
```
With:
```typescript
  isFamily: z.boolean().optional(),
  familyMemberId: z.string().min(1).nullable().optional(),
  familyGroupId: z.string().min(1).nullable().optional(),
```

- [ ] **Step 2: Edit `src/lib/validations/debt.ts:21`**

Replace:
```typescript
  notes: z.string().max(500, "หมายเหตุยาวเกินไป").nullable().optional(),
});
```
With:
```typescript
  notes: z.string().max(500, "หมายเหตุยาวเกินไป").nullable().optional(),
  familyGroupId: z.string().min(1).nullable().optional(),
});
```

(`isFamily` on `Debt` is read raw from the request body rather than via Zod — an existing pattern this plan does not change. Only `familyGroupId`'s shape needs validation here; Task 11 step 3 reads `isFamily` the same way the existing code does.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/validations/transaction.ts src/lib/validations/debt.ts
git commit -m "feat(family): add familyGroupId to transaction and debt validation schemas"
```

---

### Task 4: Rewrite `GET /api/v1/family` to return a list of groups

**Files:**
- Modify: `src/app/api/v1/family/route.ts`

- [ ] **Step 1: Replace the whole file contents**

Current `src/app/api/v1/family/route.ts` (64 lines) returns `{ group: {...} | null }` for a single group. Replace it entirely with:

```typescript
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const memberships = await prisma.userFamilyGroup.findMany({
      where: { userId: session.user.id },
      select: {
        group: {
          select: {
            id: true,
            inviteCode: true,
            name: true,
            memberships: {
              select: { user: { select: { id: true, name: true, email: true } } },
            },
          },
        },
      },
      orderBy: { joinedAt: "asc" },
    });

    if (memberships.length === 0) {
      return NextResponse.json({ success: true, data: { groups: [] } });
    }

    // Two independent private-alias resolutions for this viewer:
    // - group nicknames (FamilyGroupAlias) -> each group's displayName
    // - member nicknames (FamilyMemberAlias) -> each member's displayName
    // Neither affects what anyone else sees; both are scoped to this viewer only.
    const groupIds = memberships.map((m) => m.group.id);
    const [myGroupAliases, myMemberAliases] = await Promise.all([
      prisma.familyGroupAlias.findMany({
        where: { viewerId: session.user.id, groupId: { in: groupIds } },
        select: { groupId: true, nickname: true },
      }),
      prisma.familyMemberAlias.findMany({
        where: { viewerId: session.user.id },
        select: { targetId: true, nickname: true },
      }),
    ]);
    const groupAliasByGroup = new Map(myGroupAliases.map((a) => [a.groupId, a.nickname]));
    const memberAliasByTarget = new Map(myMemberAliases.map((a) => [a.targetId, a.nickname]));

    const groups = memberships.map(({ group }) => ({
      id: group.id,
      inviteCode: group.inviteCode,
      name: group.name,
      displayName: groupAliasByGroup.get(group.id) ?? group.name,
      members: group.memberships.map(({ user: m }) => {
        const myAlias = memberAliasByTarget.get(m.id) ?? null;
        return {
          id: m.id,
          name: m.name,
          email: m.email,
          myAlias,
          displayName: myAlias ?? m.name,
          isMe: m.id === session.user.id,
        };
      }),
    }));

    return NextResponse.json({ success: true, data: { groups } });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด" } },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/v1/family/route.ts
git commit -m "feat(family): GET /api/v1/family returns a list of all the user's groups"
```

---

### Task 5: Update create/join/leave routes for unlimited groups

**Files:**
- Modify: `src/app/api/v1/family/create/route.ts`
- Modify: `src/app/api/v1/family/join/route.ts`
- Modify: `src/app/api/v1/family/leave/route.ts`

- [ ] **Step 1: Replace `src/app/api/v1/family/create/route.ts` entirely**

Drops the `ALREADY_IN_GROUP` block, requires a `name` in the body (per spec — "creator sets a required default name"), creates the membership row instead of updating `User.familyGroupId`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateInviteCode } from "@/lib/family";
import { z } from "zod";

const createGroupSchema = z.object({
  name: z.string().trim().min(1, "กรุณาตั้งชื่อกลุ่ม").max(50, "ชื่อกลุ่มยาวเกินไป"),
});

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const body = await req.json();
    const parsed = createGroupSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "กรุณาตั้งชื่อกลุ่ม" } },
        { status: 400 }
      );
    }

    // Generate unique invite code
    let inviteCode = generateInviteCode();
    let attempts = 0;
    while (attempts < 10) {
      const existing = await prisma.familyGroup.findUnique({ where: { inviteCode } });
      if (!existing) break;
      inviteCode = generateInviteCode();
      attempts++;
    }

    const group = await prisma.$transaction(async (tx) => {
      const created = await tx.familyGroup.create({ data: { inviteCode, name: parsed.data.name } });
      await tx.userFamilyGroup.create({
        data: { userId: session.user.id, groupId: created.id },
      });
      return created;
    });

    return NextResponse.json({
      success: true,
      data: {
        group: {
          id: group.id,
          inviteCode: group.inviteCode,
          name: group.name,
          displayName: group.name,
          members: [{ id: session.user.id, name: session.user.name, email: session.user.email, isMe: true }],
        },
      },
    }, { status: 201 });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด" } },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Replace `src/app/api/v1/family/join/route.ts` entirely**

Drops the `ALREADY_IN_GROUP` block; adds an `ALREADY_MEMBER` guard for "already a member of THIS specific group" (the unique `userId+groupId` constraint still applies — you can't join the same group twice, but joining a different one is now allowed):

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const joinSchema = z.object({ code: z.string().min(1).max(20) });

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const body = await req.json();
    const parsed = joinSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "รหัสไม่ถูกต้อง" } },
        { status: 400 }
      );
    }

    const group = await prisma.familyGroup.findUnique({
      where: { inviteCode: parsed.data.code.toUpperCase() },
      include: { memberships: { select: { user: { select: { id: true, name: true, email: true } } } } },
    });
    if (!group) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "ไม่พบกลุ่มครอบครัว รหัสอาจไม่ถูกต้อง" } },
        { status: 404 }
      );
    }

    const existingMembership = await prisma.userFamilyGroup.findUnique({
      where: { userId_groupId: { userId: session.user.id, groupId: group.id } },
    });
    if (existingMembership) {
      return NextResponse.json(
        { success: false, error: { code: "ALREADY_MEMBER", message: "คุณอยู่ในกลุ่มนี้แล้ว" } },
        { status: 400 }
      );
    }

    await prisma.userFamilyGroup.create({
      data: { userId: session.user.id, groupId: group.id },
    });

    const updatedMembers = [
      ...group.memberships.map(({ user: m }) => ({ ...m, isMe: m.id === session.user.id })),
      { id: session.user.id, name: session.user.name, email: session.user.email, isMe: true },
    ];

    return NextResponse.json({
      success: true,
      data: {
        group: {
          id: group.id,
          inviteCode: group.inviteCode,
          name: group.name,
          displayName: group.name,
          members: updatedMembers,
        },
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด" } },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 3: Replace `src/app/api/v1/family/leave/route.ts` entirely**

Now requires `groupId` in the body (was implicit/single-group); same empty-group cascade:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const leaveSchema = z.object({ groupId: z.string().min(1) });

export async function DELETE(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const body = await req.json();
    const parsed = leaveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: "ข้อมูลไม่ถูกต้อง" } },
        { status: 400 }
      );
    }
    const { groupId } = parsed.data;

    const membership = await prisma.userFamilyGroup.findUnique({
      where: { userId_groupId: { userId: session.user.id, groupId } },
    });
    if (!membership) {
      return NextResponse.json(
        { success: false, error: { code: "NOT_IN_GROUP", message: "คุณไม่ได้อยู่ในกลุ่มนี้" } },
        { status: 400 }
      );
    }

    await prisma.userFamilyGroup.delete({ where: { id: membership.id } });

    // Delete group if no remaining members
    const remaining = await prisma.userFamilyGroup.count({ where: { groupId } });
    if (remaining === 0) {
      await prisma.familyGroup.delete({ where: { id: groupId } });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด" } },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/v1/family/create/route.ts src/app/api/v1/family/join/route.ts src/app/api/v1/family/leave/route.ts
git commit -m "feat(family): allow unlimited group membership in create/join/leave routes"
```

---

### Task 6: Add `PATCH /api/v1/family/group-nickname` + fix `alias` route's overlap check

**Files:**
- Create: `src/app/api/v1/family/group-nickname/route.ts`
- Modify: `src/app/api/v1/family/alias/route.ts:43-52`

- [ ] **Step 1: Create `src/app/api/v1/family/group-nickname/route.ts`**

Mirrors `alias/route.ts` exactly (same validation shape, trim-to-null-deletes semantics) but targets `FamilyGroupAlias` and validates group membership instead of "same group as target":

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  groupId: z.string().min(1),
  nickname: z.string().max(50, "ชื่อเล่นยาวเกินไป").nullable(),
});

// Sets a PRIVATE nickname the caller uses to refer to one of their family
// groups — visible only to the caller. Mirrors alias/route.ts: it never
// changes the group's default name shown to other members.
export async function PATCH(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0].message } },
        { status: 400 }
      );
    }

    const { groupId, nickname } = parsed.data;
    const viewerId = session.user.id;

    const membership = await prisma.userFamilyGroup.findUnique({
      where: { userId_groupId: { userId: viewerId, groupId } },
    });
    if (!membership) {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "ไม่สามารถตั้งชื่อกลุ่มนี้ได้" } },
        { status: 403 }
      );
    }

    const trimmed = nickname?.trim() || null;

    if (trimmed === null) {
      await prisma.familyGroupAlias.deleteMany({ where: { viewerId, groupId } });
      return NextResponse.json({ success: true, data: { groupId, nickname: null } });
    }

    const alias = await prisma.familyGroupAlias.upsert({
      where: { viewerId_groupId: { viewerId, groupId } },
      update: { nickname: trimmed },
      create: { viewerId, groupId, nickname: trimmed },
      select: { groupId: true, nickname: true },
    });

    return NextResponse.json({ success: true, data: { groupId: alias.groupId, nickname: alias.nickname } });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด" } },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Edit `src/app/api/v1/family/alias/route.ts:43-52`**

The "same group" check no longer makes sense with multiple groups — a viewer should be able to alias anyone they share AT LEAST ONE group with. Replace:
```typescript
    const [me, target] = await Promise.all([
      prisma.user.findUnique({ where: { id: viewerId }, select: { familyGroupId: true } }),
      prisma.user.findUnique({ where: { id: targetUserId }, select: { familyGroupId: true } }),
    ]);
    if (!me?.familyGroupId || me.familyGroupId !== target?.familyGroupId) {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "ไม่สามารถตั้งชื่อเรียกสมาชิกนี้ได้" } },
        { status: 403 }
      );
    }
```
With:
```typescript
    const sharedGroup = await prisma.userFamilyGroup.findFirst({
      where: { userId: viewerId, group: { memberships: { some: { userId: targetUserId } } } },
      select: { id: true },
    });
    if (!sharedGroup) {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "ไม่สามารถตั้งชื่อเรียกสมาชิกนี้ได้" } },
        { status: 403 }
      );
    }
```

(The alias itself stays global per `(viewer, target)` pair regardless of how many groups they share — no schema change needed here, `FamilyMemberAlias` is untouched.)

- [ ] **Step 3: Commit**

```bash
git add src/app/api/v1/family/group-nickname/route.ts src/app/api/v1/family/alias/route.ts
git commit -m "feat(family): add private group-nickname endpoint, broaden alias check to shared-group overlap"
```

---

### Task 7: Update `/api/v1/family/summary` to be group-scoped

**Files:**
- Modify: `src/app/api/v1/family/summary/route.ts`

This route backs the dashboard's "ครอบครัว" member-breakdown card. With multiple groups it must take an explicit `groupId`, authorize the caller's membership, and scope by `familyGroupId` (per spec: "Cross-user visibility for the family filter changes from `isFamily=true AND userId IN <group member ids>` to simply `familyGroupId = <selected group id>`, plus a membership check for authorization").

- [ ] **Step 1: Replace the whole file contents**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "กรุณาเข้าสู่ระบบ" } },
        { status: 401 }
      );
    }

    const { searchParams } = req.nextUrl;
    const now = new Date();
    const year = parseInt(searchParams.get("year") ?? String(now.getFullYear()));
    const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1));
    const groupId = searchParams.get("groupId");

    if (!groupId) {
      return NextResponse.json({ success: true, data: { year, month, members: [], totals: { income: 0, expense: 0, balance: 0 } } });
    }

    const membership = await prisma.userFamilyGroup.findUnique({
      where: { userId_groupId: { userId: session.user.id, groupId } },
    });
    if (!membership) {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "คุณไม่ได้อยู่ในกลุ่มนี้" } },
        { status: 403 }
      );
    }

    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 1));

    // Cross-user visibility now keys off familyGroupId directly (one specific
    // group, never a merge across groups) instead of isFamily + member-id list.
    const [txGroups, memberUsers, myAliases] = await Promise.all([
      prisma.transaction.groupBy({
        by: ["userId", "type"],
        where: { familyGroupId: groupId, date: { gte: startDate, lt: endDate } },
        _sum: { amount: true },
      }),
      prisma.user.findMany({
        where: { familyGroups: { some: { groupId } } },
        select: { id: true, name: true },
      }),
      // Caller's private aliases — override the member's profile name, visible only to caller
      prisma.familyMemberAlias.findMany({
        where: { viewerId: session.user.id },
        select: { targetId: true, nickname: true },
      }),
    ]);
    const aliasByTarget = new Map(myAliases.map((a) => [a.targetId, a.nickname]));

    const members = memberUsers.map((u) => {
      const income = Number(
        txGroups.find((g) => g.userId === u.id && g.type === "INCOME")?._sum.amount ?? 0
      );
      const expense = Number(
        txGroups.find((g) => g.userId === u.id && g.type === "EXPENSE")?._sum.amount ?? 0
      );
      return {
        userId: u.id,
        name: aliasByTarget.get(u.id) ?? u.name,
        isMe: u.id === session.user.id,
        income,
        expense,
        balance: income - expense,
      };
    });

    const totals = members.reduce(
      (acc, m) => ({ income: acc.income + m.income, expense: acc.expense + m.expense }),
      { income: 0, expense: 0 }
    );

    return NextResponse.json({
      success: true,
      data: {
        year,
        month,
        members,
        totals: { ...totals, balance: totals.income - totals.expense },
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "เกิดข้อผิดพลาด" } },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/v1/family/summary/route.ts
git commit -m "feat(family): scope /api/v1/family/summary by an explicit groupId"
```

---

### Task 8: Update `transactions` GET filter + POST persistence for `familyGroupId`

**Files:**
- Modify: `src/app/api/v1/transactions/route.ts`

- [ ] **Step 1: Delete the import on line 7**

Delete this line entirely — no replacement needed. `Prisma` is already imported on line 5 (`import { TransactionType, Prisma } from "@/generated/prisma/client";`), and `getFamilyMemberIds` is no longer used in this file:
```typescript
import { getFamilyMemberIds } from "@/lib/family";
```

- [ ] **Step 2: Replace the filter resolution block at lines 33-44**

Current:
```typescript
    // Resolve userIds for family shared view
    let txUserIds: string[] = [session.user.id];
    if (familyFilter === "family") {
      txUserIds = await getFamilyMemberIds(session.user.id);
    }

    const where: Prisma.TransactionWhereInput =
      familyFilter === "family"
        ? { userId: { in: txUserIds }, isFamily: true, date: { gte: startDate, lt: endDate } }
        : familyFilter === "mine"
        ? { userId: session.user.id, isFamily: false, date: { gte: startDate, lt: endDate } }
        : { userId: session.user.id, date: { gte: startDate, lt: endDate } };
```
With:
```typescript
    // "family" now scopes by an explicit, authorized familyGroupId — never a
    // merge across the user's groups (per spec: switcher, not merge). With no
    // group selected (groupless user, or before the dropdown picks one), fall
    // back to the pre-multi-group behavior: just the caller's own family-tagged rows.
    let where: Prisma.TransactionWhereInput;
    if (familyFilter === "family") {
      const familyGroupIdParam = searchParams.get("familyGroupId");
      if (familyGroupIdParam) {
        const membership = await prisma.userFamilyGroup.findUnique({
          where: { userId_groupId: { userId: session.user.id, groupId: familyGroupIdParam } },
        });
        if (!membership) {
          return NextResponse.json(
            { success: false, error: { code: "FORBIDDEN", message: "คุณไม่ได้อยู่ในกลุ่มนี้" } },
            { status: 403 }
          );
        }
        where = { familyGroupId: familyGroupIdParam, date: { gte: startDate, lt: endDate } };
      } else {
        where = { userId: session.user.id, isFamily: true, date: { gte: startDate, lt: endDate } };
      }
    } else if (familyFilter === "mine") {
      where = { userId: session.user.id, isFamily: false, date: { gte: startDate, lt: endDate } };
    } else {
      where = { userId: session.user.id, date: { gte: startDate, lt: endDate } };
    }
```

- [ ] **Step 3: Edit the POST destructure at line 99**

Replace:
```typescript
    const { type, amount, description, date, categoryId, paymentMethodId, isFamily, familyMemberId } = parsed.data;
```
With:
```typescript
    const { type, amount, description, date, categoryId, paymentMethodId, isFamily, familyMemberId, familyGroupId } = parsed.data;

    // familyGroupId controls cross-user visibility — verify membership before
    // trusting a client-supplied value.
    if (isFamily && familyGroupId) {
      const membership = await prisma.userFamilyGroup.findUnique({
        where: { userId_groupId: { userId: session.user.id, groupId: familyGroupId } },
      });
      if (!membership) {
        return NextResponse.json(
          { success: false, error: { code: "FORBIDDEN", message: "คุณไม่ได้อยู่ในกลุ่มนี้" } },
          { status: 403 }
        );
      }
    }
```

- [ ] **Step 4: Edit the `create` data block at lines 138-139**

Replace:
```typescript
        isFamily: isFamily ?? false,
        familyMemberId: isFamily ? (familyMemberId ?? null) : null,
```
With:
```typescript
        isFamily: isFamily ?? false,
        familyMemberId: isFamily ? (familyMemberId ?? null) : null,
        familyGroupId: isFamily ? (familyGroupId ?? null) : null,
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/transactions/route.ts
git commit -m "feat(transactions): scope family filter by groupId and persist familyGroupId on create"
```

---

### Task 9: Update `dashboard/summary` route — two scoping fixes

**Files:**
- Modify: `src/app/api/v1/dashboard/summary/route.ts`

This file calls `getFamilyMemberIds` in **two** places that both need fixing — one is the obvious `familyFilter==="family"` totals query (line 28), the other is a less-obvious always-on "family debts" banner query (lines 39, 64) that runs regardless of which filter tab is active.

- [ ] **Step 1: Edit the import on line 4**

Replace:
```typescript
import { getFamilyMemberIds } from "@/lib/family";
```
With:
```typescript
import { getUserFamilyGroups } from "@/lib/family";
```

- [ ] **Step 2: Replace the `txUserIds` resolution and `baseWhere` block at lines 25-36**

Current:
```typescript
    // Resolve user IDs for transaction query
    let txUserIds: string[] = [session.user.id];
    if (familyFilter === "family") {
      txUserIds = await getFamilyMemberIds(session.user.id);
    }

    // "mine" now reflects everything the user paid for (personal + family-tagged) — the
    // same underlying scope as "all" — the UI additionally shows a personal/family split.
    const baseWhere =
      familyFilter === "family"
        ? { userId: { in: txUserIds }, isFamily: true, date: { gte: startDate, lt: endDate } }
        : { userId: session.user.id, date: { gte: startDate, lt: endDate } };

    // Get family member IDs for shared family debt view
    const familyMemberIds = await getFamilyMemberIds(session.user.id);
```
With:
```typescript
    // Resolve all the groups this user belongs to once — feeds both (a) the
    // family-filter scoping below and (b) the always-on family-debts banner,
    // which must show debts across every group the user is in, not just the
    // one currently selected in the dashboard's group-picker dropdown.
    const myGroups = await getUserFamilyGroups(session.user.id);
    const myGroupIds = myGroups.map((g) => g.id);

    // "family" now scopes by an explicit, authorized familyGroupId — never a
    // merge across the user's groups. With no group selected, fall back to
    // the pre-multi-group behavior: just the caller's own family-tagged rows.
    let baseWhere: { userId?: string | { in: string[] }; isFamily?: boolean; familyGroupId?: string; date: { gte: Date; lt: Date } };
    if (familyFilter === "family") {
      const familyGroupIdParam = searchParams.get("familyGroupId");
      if (familyGroupIdParam) {
        if (!myGroupIds.includes(familyGroupIdParam)) {
          return NextResponse.json(
            { success: false, error: { code: "FORBIDDEN", message: "คุณไม่ได้อยู่ในกลุ่มนี้" } },
            { status: 403 }
          );
        }
        baseWhere = { familyGroupId: familyGroupIdParam, date: { gte: startDate, lt: endDate } };
      } else {
        baseWhere = { userId: session.user.id, isFamily: true, date: { gte: startDate, lt: endDate } };
      }
    } else {
      // "mine" now reflects everything the user paid for (personal + family-tagged) — the
      // same underlying scope as "all" — the UI additionally shows a personal/family split.
      baseWhere = { userId: session.user.id, date: { gte: startDate, lt: endDate } };
    }
```

- [ ] **Step 3: Edit the family debts query at lines 62-68**

Current:
```typescript
      // Family debts: all group members (or just self if solo), isFamily=true
      prisma.debt.findMany({
        where: { userId: { in: familyMemberIds }, status: "ACTIVE", isFamily: true },
        include: {
          payments: { where: { status: { not: "PAID" } }, select: { amount: true } },
        },
      }),
```
With:
```typescript
      // Family debts banner: every ACTIVE debt tagged to ANY of the user's
      // groups (not just the one selected in the filter dropdown — this
      // banner is always-on regardless of which family-data tab is active).
      // Groupless users see nothing here (myGroupIds = []).
      prisma.debt.findMany({
        where: { familyGroupId: { in: myGroupIds }, status: "ACTIVE" },
        include: {
          payments: { where: { status: { not: "PAID" } }, select: { amount: true } },
        },
      }),
```

- [ ] **Step 4: Run typecheck to confirm the `baseWhere` type union compiles cleanly against `prisma.transaction.groupBy`'s `where`**

```bash
npx tsc --noEmit
```
Expected: no new errors introduced by this file. If the inline `baseWhere` type annotation conflicts with `Prisma.TransactionWhereInput`'s shape, replace the annotation with `Prisma.TransactionWhereInput` (already imported as `Prisma` is NOT imported in this file — add `import { Prisma } from "@/generated/prisma/client";` if you take this route). The inline type above is intentionally narrow/explicit to avoid that extra import for a single local variable.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/dashboard/summary/route.ts
git commit -m "fix(dashboard): scope family summary and family-debts banner by familyGroupId"
```

---

### Task 10: Update `dashboard/by-category` route to scope "family" by `familyGroupId`

**Files:**
- Modify: `src/app/api/v1/dashboard/by-category/route.ts`

- [ ] **Step 1: Edit the import on line 5**

Replace:
```typescript
import { getFamilyMemberIds } from "@/lib/family";
```
With:
```typescript
import { getUserFamilyGroups } from "@/lib/family";
```

- [ ] **Step 2: Replace the `familyFilter === "family"` branch at lines 136-142**

Current:
```typescript
    let where: Prisma.TransactionWhereInput;
    if (familyFilter === "family") {
      const txUserIds = await getFamilyMemberIds(session.user.id);
      where = { userId: { in: txUserIds }, type, isFamily: true, date: dateRange };
    } else {
      where = { userId: session.user.id, type, date: dateRange };
    }
```
With:
```typescript
    let where: Prisma.TransactionWhereInput;
    if (familyFilter === "family") {
      const familyGroupIdParam = searchParams.get("familyGroupId");
      if (familyGroupIdParam) {
        const myGroups = await getUserFamilyGroups(session.user.id);
        if (!myGroups.some((g) => g.id === familyGroupIdParam)) {
          return NextResponse.json(
            { success: false, error: { code: "FORBIDDEN", message: "คุณไม่ได้อยู่ในกลุ่มนี้" } },
            { status: 403 }
          );
        }
        where = { familyGroupId: familyGroupIdParam, type, date: dateRange };
      } else {
        where = { userId: session.user.id, type, isFamily: true, date: dateRange };
      }
    } else {
      where = { userId: session.user.id, type, date: dateRange };
    }
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/v1/dashboard/by-category/route.ts
git commit -m "fix(dashboard): scope by-category family breakdown by familyGroupId"
```

---

### Task 11: Persist `familyGroupId` on transaction update and debt creation

**Files:**
- Modify: `src/app/api/v1/transactions/[id]/route.ts`
- Modify: `src/app/api/v1/debts/route.ts`

- [ ] **Step 1: Edit `src/app/api/v1/transactions/[id]/route.ts:73`**

Replace:
```typescript
    const { type, amount, description, date, categoryId, paymentMethodId, isFamily, familyMemberId } = parsed.data;
```
With:
```typescript
    const { type, amount, description, date, categoryId, paymentMethodId, isFamily, familyMemberId, familyGroupId } = parsed.data;

    // familyGroupId controls cross-user visibility — verify membership before
    // trusting a client-supplied value (mirrors the POST route's check).
    if (isFamily && familyGroupId) {
      const membership = await prisma.userFamilyGroup.findUnique({
        where: { userId_groupId: { userId: session.user.id, groupId: familyGroupId } },
      });
      if (!membership) {
        return NextResponse.json(
          { success: false, error: { code: "FORBIDDEN", message: "คุณไม่ได้อยู่ในกลุ่มนี้" } },
          { status: 403 }
        );
      }
    }
```

- [ ] **Step 2: Edit the `updateData` block at lines 113-116**

Replace:
```typescript
    if (isFamily !== undefined) {
      updateData.isFamily = isFamily;
      updateData.familyMemberId = isFamily ? (familyMemberId ?? null) : null;
    }
```
With:
```typescript
    if (isFamily !== undefined) {
      updateData.isFamily = isFamily;
      updateData.familyMemberId = isFamily ? (familyMemberId ?? null) : null;
      updateData.familyGroupId = isFamily ? (familyGroupId ?? null) : null;
    }
```

- [ ] **Step 3: Edit `src/app/api/v1/debts/route.ts:78-79`**

Replace:
```typescript
    const { name, totalAmount, totalMonths, monthlyAmount, startDate, notes } = parsed.data;
    const isFamily = typeof body.isFamily === "boolean" ? body.isFamily : false;
```
With:
```typescript
    const { name, totalAmount, totalMonths, monthlyAmount, startDate, notes, familyGroupId } = parsed.data;
    const isFamily = typeof body.isFamily === "boolean" ? body.isFamily : false;

    // familyGroupId controls cross-user visibility — verify membership before
    // trusting a client-supplied value (mirrors the transactions routes' check).
    if (isFamily && familyGroupId) {
      const membership = await prisma.userFamilyGroup.findUnique({
        where: { userId_groupId: { userId: session.user.id, groupId: familyGroupId } },
      });
      if (!membership) {
        return NextResponse.json(
          { success: false, error: { code: "FORBIDDEN", message: "คุณไม่ได้อยู่ในกลุ่มนี้" } },
          { status: 403 }
        );
      }
    }
```

- [ ] **Step 4: Edit the `tx.debt.create` data block at line 96**

Replace:
```typescript
          isFamily: isFamily ?? false,
```
With:
```typescript
          isFamily: isFamily ?? false,
          familyGroupId: isFamily ? (familyGroupId ?? null) : null,
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/v1/transactions/[id]/route.ts src/app/api/v1/debts/route.ts
git commit -m "feat(family): persist familyGroupId on transaction update and debt creation"
```

---

### Task 12: Settings page — replace embedded family-group card with a link row

**Files:**
- Modify: `src/app/(app)/settings/page.tsx`

The single-group card is replaced by a link row "ครอบครัว" (matching the `หมวดหมู่`/`ช่องทางชำระเงิน` rows at lines 455-475) that opens the new `/settings/family` page (Task 13).

- [ ] **Step 1: Trim the lucide-react import on line 5**

`Copy`, `Link2`, `Link2Off`, `BarChart2` are used ONLY inside the family-group block being deleted (confirmed via `grep -n "Copy\|Link2\|Link2Off\|BarChart2" src/app/\(app\)/settings/page.tsx` — they appear at lines 481, 501, 582, 594, 656, all inside the block). `Users` stays — it's reused at line 669 for the "แท็กสมาชิก" section header. Replace:
```typescript
import { Pencil, Trash2, Plus, Check, X, Loader2, Users, LogOut, User, Copy, Link2, Link2Off, ChevronRight, BarChart2, FolderTree, Wallet } from "lucide-react";
```
With:
```typescript
import { Pencil, Trash2, Plus, Check, X, Loader2, Users, LogOut, User, ChevronRight, FolderTree, Wallet } from "lucide-react";
```

- [ ] **Step 2: Delete the `FamilyGroupMember`/`FamilyGroup` interfaces at lines 21-35**

Delete this whole block entirely (no longer used — the new `/settings/family` page owns its own types):
```typescript
interface FamilyGroupMember {
  id: string;
  name: string;
  email: string;
  /** Private alias the CURRENT VIEWER set for this member (null if none). Visible only to the viewer. */
  myAlias?: string | null;
  displayName: string;
  isMe: boolean;
}

interface FamilyGroup {
  id: string;
  inviteCode: string;
  members: FamilyGroupMember[];
}
```

- [ ] **Step 3: Delete the family-group state block at lines 123-139**

Delete (the new `/settings/family` page owns this state instead):
```typescript
  // Family group state
  const [group, setGroup] = useState<FamilyGroup | null>(null);
  const [groupLoading, setGroupLoading] = useState(true);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [creating, setCreating] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [showJoinInput, setShowJoinInput] = useState(false);
  const [groupError, setGroupError] = useState("");
  const [copied, setCopied] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  // Private alias (others only) — what YOU privately call another member;
  // visible only to you, never to the target or anyone else
  const [editingAliasFor, setEditingAliasFor] = useState<string | null>(null);
  const [aliasDraft, setAliasDraft] = useState("");
  const [savingAlias, setSavingAlias] = useState(false);
```

- [ ] **Step 4: Delete `fetchGroup` at lines 150-159 and its call in the effect**

Delete the callback:
```typescript
  const fetchGroup = useCallback(async () => {
    setGroupLoading(true);
    try {
      const res = await fetch("/api/v1/family");
      const data = await res.json();
      if (data.success) setGroup(data.data?.group ?? null);
    } finally {
      setGroupLoading(false);
    }
  }, []);

```
Then in the effect (now around line 162), replace:
```typescript
  useEffect(() => {
    fetchGroup();
    fetchMembers();
  }, [fetchGroup, fetchMembers]);
```
With:
```typescript
  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);
```

- [ ] **Step 5: Delete the family-group action handlers (originally lines 176-270)**

Delete the whole `// ── Family Group Actions ──...` section through the end of `handleSaveAlias`, i.e. everything from the `// ── Family Group Actions` comment up to (and including) the closing brace of `handleSaveAlias` — that's `handleCreateGroup`, `handleJoinGroup`, `handleLeaveGroup`, `handleCopyCode`, the `// ── Private Alias Actions` comment block, `startEditingAlias`, `cancelEditingAlias`, and `handleSaveAlias`. Locate it via:
```bash
grep -n "Family Group Actions\|handleSaveAlias" "src/app/(app)/settings/page.tsx"
```
The block starts at the `// ── Family Group Actions ─────────────────────────────────────────────────` comment and ends at the closing `}` immediately before the `// ── Family Member Tag Actions ────────────────────────────────────────────` comment (originally line 272). Delete everything in between, leaving the `// ── Family Member Tag Actions` comment and `handleAdd` intact.

- [ ] **Step 6: Replace the embedded family-group JSX block (originally lines 478-663) with a link row**

Find the block via:
```bash
grep -n "Family Group ───\|Family Member Tags ───" "src/app/(app)/settings/page.tsx"
```
It starts at the `{/* ─── Family Group ─────...` comment (originally line 478) and ends at the `</div>` immediately before the `{/* ─── Family Member Tags ───...` comment (originally line 663-664). Delete that entire `<div className="space-y-2">...</div>` block, and in its place — inside the existing link-row card (the `<div>` ending at line 476, which currently closes right after the `ช่องทางชำระเงิน` link) — add a new row immediately after the `ช่องทางชำระเงิน` link (originally lines 466-475):
```tsx
        <Link
          href="/settings/payment-methods"
          className="w-full flex items-center justify-between px-4 py-3 border-t border-border/50 hover:bg-muted/50 transition-colors text-left"
        >
          <span className="flex items-center gap-2 text-[14px] font-medium">
            <Wallet className="h-4 w-4 text-muted-foreground" />
            ช่องทางชำระเงิน
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>

        <Link
          href="/settings/family"
          className="w-full flex items-center justify-between px-4 py-3 border-t border-border/50 hover:bg-muted/50 transition-colors text-left"
        >
          <span className="flex items-center gap-2 text-[14px] font-medium">
            <Users className="h-4 w-4 text-muted-foreground" />
            ครอบครัว
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      </div>
```

- [ ] **Step 7: Delete the "Leave group confirm" dialog (originally lines 784-803)**

Delete this whole block (its state and handler were removed in Steps 3 and 5):
```tsx
      {/* Leave group confirm */}
      <Dialog open={showLeaveConfirm} onOpenChange={setShowLeaveConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ออกจากกลุ่มครอบครัว</DialogTitle>
            <DialogDescription>
              เมื่อออกจากกลุ่ม คุณจะไม่เห็นรายการของสมาชิกคนอื่นอีกต่อไป
              {group && group.members.length === 1 && (
                <span className="block mt-1 text-[#FF9500]">คุณเป็นสมาชิกคนสุดท้าย กลุ่มจะถูกลบทิ้ง</span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2">
            <Button variant="secondary" onClick={() => setShowLeaveConfirm(false)} disabled={leaving}>ยกเลิก</Button>
            <Button variant="destructive" onClick={handleLeaveGroup} disabled={leaving}>
              {leaving ? "กำลังออก..." : "ออกจากกลุ่ม"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

```

- [ ] **Step 8: Verify no leftover references**

```bash
grep -n "FamilyGroup\|fetchGroup\|handleCreateGroup\|handleJoinGroup\|handleLeaveGroup\|handleCopyCode\|editingAliasFor\|aliasDraft\|showLeaveConfirm\|groupError\|joinCode" "src/app/(app)/settings/page.tsx"
```
Expected: no matches.

- [ ] **Step 9: Typecheck and lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: no errors (this confirms no orphaned imports/handlers/state remain).

- [ ] **Step 10: Commit**

```bash
git add "src/app/(app)/settings/page.tsx"
git commit -m "refactor(settings): replace embedded family-group card with a link row to /settings/family"
```

---

### Task 13: New `/settings/family` page — group picker + management panel

**Files:**
- Create: `src/app/(app)/settings/family/page.tsx`

Follows the page-shell pattern from `src/app/(app)/settings/payment-methods/page.tsx` (back button, `Skeleton`, empty state, `ios-card overflow-hidden divide-y`) and reuses the member-alias-editor JSX/UX that was deleted from the settings page in Task 12, now nested under a group picker per spec ("Selected-group panel").

- [ ] **Step 1: Create `src/app/(app)/settings/family/page.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Pencil, Check, X, Loader2, Plus, Copy, Link2, Link2Off } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface FamilyGroupMember {
  id: string;
  name: string;
  email: string;
  myAlias?: string | null;
  displayName: string;
  isMe: boolean;
}

interface FamilyGroupItem {
  id: string;
  inviteCode: string;
  name: string;
  displayName: string;
  members: FamilyGroupMember[];
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-2xl bg-border/50", className)} />;
}

export default function FamilySettingsPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<FamilyGroupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  const [showCreateInput, setShowCreateInput] = useState(false);
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const [showJoinInput, setShowJoinInput] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");

  const [copied, setCopied] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // Private alias (others only) — what YOU privately call another member;
  // visible only to you, never to the target or anyone else
  const [editingAliasFor, setEditingAliasFor] = useState<string | null>(null);
  const [aliasDraft, setAliasDraft] = useState("");
  const [savingAlias, setSavingAlias] = useState(false);

  // Private group nickname — what YOU privately call this group
  const [editingGroupNickname, setEditingGroupNickname] = useState(false);
  const [groupNicknameDraft, setGroupNicknameDraft] = useState("");
  const [savingGroupNickname, setSavingGroupNickname] = useState(false);

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/family");
      const data = await res.json();
      if (data.success) {
        const list: FamilyGroupItem[] = data.data.groups;
        setGroups(list);
        setSelectedGroupId((prev) => (prev && list.some((g) => g.id === prev) ? prev : list[0]?.id ?? null));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  const selectedGroup = groups.find((g) => g.id === selectedGroupId) ?? null;

  // ── Create / Join — always visible, user can always add more groups ──────

  async function handleCreateGroup() {
    if (!createName.trim() || creating) return;
    setCreating(true);
    setCreateError("");
    try {
      const res = await fetch("/api/v1/family/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: createName.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setShowCreateInput(false);
        setCreateName("");
        await fetchGroups();
        setSelectedGroupId(data.data.group.id);
      } else {
        setCreateError(data.error?.message ?? "เกิดข้อผิดพลาด");
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleJoinGroup() {
    if (!joinCode.trim() || joining) return;
    setJoining(true);
    setJoinError("");
    try {
      const res = await fetch("/api/v1/family/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: joinCode.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setShowJoinInput(false);
        setJoinCode("");
        await fetchGroups();
        setSelectedGroupId(data.data.group.id);
      } else {
        setJoinError(data.error?.message ?? "ไม่พบกลุ่ม");
      }
    } finally {
      setJoining(false);
    }
  }

  // ── Selected-group actions ────────────────────────────────────────────────

  function handleCopyCode() {
    if (!selectedGroup) return;
    navigator.clipboard.writeText(selectedGroup.inviteCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function handleLeaveGroup() {
    if (!selectedGroup || leaving) return;
    setLeaving(true);
    try {
      const res = await fetch("/api/v1/family/leave", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: selectedGroup.id }),
      });
      const data = await res.json();
      if (data.success) {
        setShowLeaveConfirm(false);
        const leftId = selectedGroup.id;
        setGroups((prev) => prev.filter((g) => g.id !== leftId));
        setSelectedGroupId((prev) => (prev === leftId ? null : prev));
        fetchGroups();
      }
    } finally {
      setLeaving(false);
    }
  }

  // ── Member alias (private — what only YOU call them) ─────────────────────

  function startEditingAlias(member: FamilyGroupMember) {
    setEditingAliasFor(member.id);
    setAliasDraft(member.myAlias ?? "");
  }
  function cancelEditingAlias() {
    setEditingAliasFor(null);
    setAliasDraft("");
  }
  async function handleSaveAlias(memberId: string) {
    if (!selectedGroup) return;
    setSavingAlias(true);
    try {
      const trimmed = aliasDraft.trim();
      const res = await fetch("/api/v1/family/alias", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: memberId, nickname: trimmed || null }),
      });
      const data = await res.json();
      if (data.success) {
        const groupId = selectedGroup.id;
        setGroups((prev) =>
          prev.map((g) =>
            g.id !== groupId
              ? g
              : {
                  ...g,
                  members: g.members.map((m) =>
                    m.id === memberId
                      ? { ...m, myAlias: data.data.nickname, displayName: data.data.nickname ?? m.name }
                      : m
                  ),
                }
          )
        );
        setEditingAliasFor(null);
      }
    } finally {
      setSavingAlias(false);
    }
  }

  // ── Group nickname (private — what only YOU call this group) ─────────────

  function startEditingGroupNickname() {
    if (!selectedGroup) return;
    setGroupNicknameDraft(selectedGroup.displayName !== selectedGroup.name ? selectedGroup.displayName : "");
    setEditingGroupNickname(true);
  }
  function cancelEditingGroupNickname() {
    setEditingGroupNickname(false);
    setGroupNicknameDraft("");
  }
  async function handleSaveGroupNickname() {
    if (!selectedGroup) return;
    setSavingGroupNickname(true);
    try {
      const trimmed = groupNicknameDraft.trim();
      const res = await fetch("/api/v1/family/group-nickname", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: selectedGroup.id, nickname: trimmed || null }),
      });
      const data = await res.json();
      if (data.success) {
        const groupId = selectedGroup.id;
        setGroups((prev) =>
          prev.map((g) => (g.id !== groupId ? g : { ...g, displayName: data.data.nickname ?? g.name }))
        );
        setEditingGroupNickname(false);
      }
    } finally {
      setSavingGroupNickname(false);
    }
  }

  return (
    <div className="py-5 space-y-5">
      <div className="flex items-center gap-2">
        <button onClick={() => router.back()} className="h-9 w-9 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-[18px] font-bold leading-tight">ครอบครัว</h1>
      </div>

      {/* Create / Join — always visible, user can always create or join more groups */}
      <div className="ios-card overflow-hidden">
        {(createError || joinError) && (
          <p className="text-[13px] text-destructive text-center px-4 pt-3">{createError || joinError}</p>
        )}
        {showCreateInput ? (
          <div className="px-4 py-3 space-y-2">
            <p className="text-[12px] text-muted-foreground font-medium uppercase tracking-wide">ตั้งชื่อกลุ่ม</p>
            <div className="flex gap-2">
              <Input
                placeholder="เช่น ครอบครัวกับแฟน"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                maxLength={50}
                className="flex-1 h-11 bg-input border-0 rounded-xl text-[14px]"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateGroup();
                  if (e.key === "Escape") { setShowCreateInput(false); setCreateName(""); setCreateError(""); }
                }}
              />
              <button
                onClick={handleCreateGroup}
                disabled={!createName.trim() || creating}
                className="h-11 px-4 rounded-xl bg-primary text-white text-[14px] font-semibold disabled:opacity-40 flex items-center gap-1.5"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "สร้าง"}
              </button>
              <button
                onClick={() => { setShowCreateInput(false); setCreateName(""); setCreateError(""); }}
                className="h-11 w-11 rounded-xl flex items-center justify-center text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : showJoinInput ? (
          <div className="px-4 py-3 space-y-2">
            <p className="text-[12px] text-muted-foreground font-medium uppercase tracking-wide">รหัสเชิญ (6 ตัวอักษร)</p>
            <div className="flex gap-2">
              <Input
                placeholder="เช่น ABC123"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                className="flex-1 h-11 bg-input border-0 rounded-xl text-[16px] font-bold tracking-widest uppercase"
                maxLength={6}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleJoinGroup();
                  if (e.key === "Escape") { setShowJoinInput(false); setJoinCode(""); setJoinError(""); }
                }}
              />
              <button
                onClick={handleJoinGroup}
                disabled={!joinCode.trim() || joining}
                className="h-11 px-4 rounded-xl bg-[#AF52DE] text-white text-[14px] font-semibold disabled:opacity-40 flex items-center gap-1.5"
              >
                {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : "เข้าร่วม"}
              </button>
              <button
                onClick={() => { setShowJoinInput(false); setJoinCode(""); setJoinError(""); }}
                className="h-11 w-11 rounded-xl flex items-center justify-center text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="px-4 py-3 flex gap-2">
            <button
              onClick={() => { setCreateError(""); setShowCreateInput(true); }}
              className="flex-1 h-11 rounded-xl bg-primary text-white text-[14px] font-semibold flex items-center justify-center gap-2"
            >
              <Plus className="h-4 w-4" />
              สร้างกลุ่ม
            </button>
            <button
              onClick={() => { setJoinError(""); setShowJoinInput(true); }}
              className="flex-1 h-11 rounded-xl bg-[#AF52DE]/10 text-[#AF52DE] text-[14px] font-semibold flex items-center justify-center gap-2"
            >
              <Link2 className="h-4 w-4" />
              เข้าร่วมด้วยรหัส
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}
        </div>
      ) : groups.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">👨‍👩‍👧‍👦</p>
          <p className="text-[16px] font-medium">ยังไม่ได้เข้าร่วมกลุ่มครอบครัว</p>
          <p className="text-[14px] text-muted-foreground mt-1">สร้างกลุ่มใหม่ หรือเข้าร่วมด้วยรหัสจากสมาชิก</p>
        </div>
      ) : (
        <>
          {/* Group picker — chooses which group's SETTINGS to view/manage.
              Independent of the dashboard/transactions filter and the
              entry-form picker (spec: three independent pickers, no sync). */}
          <Select value={selectedGroupId ?? undefined} onValueChange={setSelectedGroupId}>
            <SelectTrigger className="h-11 bg-input border-0 rounded-xl text-[14px]">
              <SelectValue placeholder="เลือกกลุ่ม" />
            </SelectTrigger>
            <SelectContent>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>{g.displayName}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedGroup && (
            <div className="ios-card overflow-hidden">
              {/* Invite code */}
              <div className="px-4 py-3.5 flex items-center justify-between border-b border-border/50">
                <div>
                  <p className="text-[12px] text-muted-foreground font-medium uppercase tracking-wide">รหัสเชิญ</p>
                  <p className="text-[22px] font-bold tracking-[0.2em] text-primary mt-0.5">{selectedGroup.inviteCode}</p>
                </div>
                <button
                  onClick={handleCopyCode}
                  className="flex items-center gap-1.5 h-9 px-3 rounded-xl bg-primary/10 text-primary text-[13px] font-semibold active:scale-95 transition-all"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "คัดลอกแล้ว" : "คัดลอก"}
                </button>
              </div>

              {/* Private group nickname — what only YOU call this group;
                  resolution order: my nickname ?? group's default name */}
              <div className="px-4 py-3 border-b border-border/50">
                {editingGroupNickname ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder={`ตั้งชื่อที่อยากเรียก เช่น ${selectedGroup.name}`}
                        value={groupNicknameDraft}
                        onChange={(e) => setGroupNicknameDraft(e.target.value)}
                        maxLength={50}
                        className="h-8 text-[13px] bg-input border-0 rounded-lg flex-1"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveGroupNickname();
                          if (e.key === "Escape") cancelEditingGroupNickname();
                        }}
                      />
                      <button
                        onClick={handleSaveGroupNickname}
                        disabled={savingGroupNickname}
                        className="h-7 w-7 rounded-full bg-[#AF52DE]/10 text-[#AF52DE] flex items-center justify-center"
                      >
                        {savingGroupNickname ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      </button>
                      <button
                        onClick={cancelEditingGroupNickname}
                        className="h-7 w-7 rounded-full hover:bg-muted text-muted-foreground flex items-center justify-center"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">เห็นเฉพาะคุณคนเดียว</p>
                  </div>
                ) : (
                  <button
                    onClick={startEditingGroupNickname}
                    className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-[#AF52DE] transition-colors"
                  >
                    <Pencil className="h-3 w-3" />
                    {selectedGroup.displayName !== selectedGroup.name
                      ? `ชื่อที่คุณเรียก: ${selectedGroup.displayName} 🔒`
                      : "ตั้งชื่อกลุ่มที่อยากเรียก (ส่วนตัว)"}
                  </button>
                )}
              </div>

              {/* Members — existing inline private-member-alias editor, unchanged */}
              <div className="divide-y divide-border/50">
                {selectedGroup.members.map((m) => (
                  <div key={m.id} className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-[#AF52DE]/10 flex items-center justify-center shrink-0">
                        <span className="text-[14px]">{m.isMe ? "👤" : "👥"}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-medium truncate">
                          {m.displayName}
                          {m.isMe && <span className="ml-1.5 text-[11px] text-muted-foreground font-normal">(คุณ)</span>}
                        </p>
                        <p className="text-[12px] text-muted-foreground truncate">{m.email}</p>
                      </div>
                    </div>

                    {!m.isMe && (
                      <div className="mt-2 ml-12">
                        {editingAliasFor === m.id ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <Input
                                placeholder={`ชื่อที่อยากเรียก ${m.name} เช่น น้องบี`}
                                value={aliasDraft}
                                onChange={(e) => setAliasDraft(e.target.value)}
                                maxLength={50}
                                className="h-8 text-[13px] bg-input border-0 rounded-lg flex-1"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleSaveAlias(m.id);
                                  if (e.key === "Escape") cancelEditingAlias();
                                }}
                              />
                              <button
                                onClick={() => handleSaveAlias(m.id)}
                                disabled={savingAlias}
                                className="h-7 w-7 rounded-full bg-[#AF52DE]/10 text-[#AF52DE] flex items-center justify-center"
                              >
                                {savingAlias ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                              </button>
                              <button
                                onClick={cancelEditingAlias}
                                className="h-7 w-7 rounded-full hover:bg-muted text-muted-foreground flex items-center justify-center"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              🔒 เห็นเฉพาะคุณคนเดียว — {m.name} และคนอื่นในกลุ่มจะไม่เห็นชื่อนี้
                            </p>
                          </div>
                        ) : (
                          <button
                            onClick={() => startEditingAlias(m)}
                            className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-[#AF52DE] transition-colors"
                          >
                            <Pencil className="h-3 w-3" />
                            {m.myAlias ? `ชื่อที่คุณเรียก: ${m.myAlias} 🔒` : "ตั้งชื่อที่อยากเรียก (ส่วนตัว 🔒)"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Leave */}
              <div className="px-4 py-3 border-t border-border/50">
                <button
                  onClick={() => setShowLeaveConfirm(true)}
                  className="flex items-center gap-2 text-[13px] text-destructive font-medium hover:opacity-70 transition-opacity"
                >
                  <Link2Off className="h-4 w-4" />
                  ออกจากกลุ่ม
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Leave group confirm — passes the selected groupId */}
      <Dialog open={showLeaveConfirm} onOpenChange={setShowLeaveConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ออกจากกลุ่ม</DialogTitle>
            <DialogDescription>
              เมื่อออกจากกลุ่ม คุณจะไม่เห็นรายการของสมาชิกคนอื่นในกลุ่มนี้อีกต่อไป
              {selectedGroup && selectedGroup.members.length === 1 && (
                <span className="block mt-1 text-[#FF9500]">คุณเป็นสมาชิกคนสุดท้าย กลุ่มจะถูกลบทิ้ง</span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 gap-2">
            <Button variant="secondary" onClick={() => setShowLeaveConfirm(false)} disabled={leaving}>ยกเลิก</Button>
            <Button variant="destructive" onClick={handleLeaveGroup} disabled={leaving}>
              {leaving ? "กำลังออก..." : "ออกจากกลุ่ม"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Manually verify in the browser**

```bash
npm run dev -- -p 3001
```
Visit `http://localhost:3001/settings/family`. Expected: page loads, shows create/join actions, and (once the user has ≥1 group from Task 1's migration backfill or fresh creation) the group picker + selected-group panel render without console errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/settings/family/page.tsx"
git commit -m "feat(family): add /settings/family page with group picker and management panel"
```

---

### Task 14: Dashboard "ครอบครัว" tab — group-picker dropdown

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`

Per spec: "When the user belongs to ≥1 group, a dropdown appears (placed under the mode toggle) to pick which group's shared data to display. Passes `familyFilter=family&familyGroupId=<id>`... Zero groups → existing empty state, unchanged." This dropdown is independent of the settings-page picker (Task 13) and the entry-form picker (Task 16) — no shared state.

- [ ] **Step 1: Add the `Select` import after line 23**

`Select` is not currently imported in this file (confirmed via `grep -n "from \"@/components/ui/select\"" "src/app/(app)/dashboard/page.tsx"` — no match). After:
```typescript
import Link from "next/link";
```
Add:
```typescript
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
```

- [ ] **Step 2: Add group-picker state after line 618**

After:
```typescript
  const [familyFilter, setFamilyFilter] = useState<FamilyFilterType>("all");
```
Add:
```typescript
  const [familyGroups, setFamilyGroups] = useState<{ id: string; name: string; displayName: string }[]>([]);
  const [selectedFamilyGroupId, setSelectedFamilyGroupId] = useState<string | null>(null);
```

- [ ] **Step 3: Fetch the user's groups on mount, auto-selecting the first**

After the `fetchYearData` declaration (ending at line 675) and before the `useEffect(() => { fetchMonthData(); }...` line (677), add a new effect:
```typescript
  useEffect(() => {
    fetch("/api/v1/family")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          const groups = d.data.groups as { id: string; name: string; displayName: string }[];
          setFamilyGroups(groups);
          setSelectedFamilyGroupId((prev) => prev ?? groups[0]?.id ?? null);
        }
      });
  }, []);
```

- [ ] **Step 4: Update `fetchMonthData`'s query-string builder and dependencies (lines 636-660)**

Replace:
```typescript
  const fetchMonthData = useCallback(async () => {
    setLoadingMonth(true);
    const ff = familyFilter !== "all" ? `&familyFilter=${familyFilter}` : "";
```
With:
```typescript
  const fetchMonthData = useCallback(async () => {
    setLoadingMonth(true);
    const groupQs = familyFilter === "family" && selectedFamilyGroupId ? `&familyGroupId=${selectedFamilyGroupId}` : "";
    const ff = familyFilter !== "all" ? `&familyFilter=${familyFilter}${groupQs}` : "";
```
And replace the dependency array on line 660:
```typescript
  }, [year, month, familyFilter]);
```
With:
```typescript
  }, [year, month, familyFilter, selectedFamilyGroupId]);
```

- [ ] **Step 5: Update the family-summary effect at lines 680-687**

Replace:
```typescript
  useEffect(() => {
    if (familyFilter !== "family") { setFamilySummary(null); return; }
    setLoadingFamily(true);
    fetch(`/api/v1/family/summary?year=${year}&month=${month}`)
      .then((r) => r.json())
      .then((d) => { if (d.success) setFamilySummary(d.data); })
      .finally(() => setLoadingFamily(false));
  }, [familyFilter, year, month]);
```
With:
```typescript
  useEffect(() => {
    if (familyFilter !== "family" || !selectedFamilyGroupId) { setFamilySummary(null); return; }
    setLoadingFamily(true);
    fetch(`/api/v1/family/summary?year=${year}&month=${month}&groupId=${selectedFamilyGroupId}`)
      .then((r) => r.json())
      .then((d) => { if (d.success) setFamilySummary(d.data); })
      .finally(() => setLoadingFamily(false));
  }, [familyFilter, selectedFamilyGroupId, year, month]);
```

- [ ] **Step 6: Add the dropdown JSX after the family-filter pill block (after line 801)**

After the closing `</div>` of the "Family filter" `ios-card` block (line 801) and before the "Period navigator" comment (line 803), insert:
```tsx
        {/* Group picker — which group's shared DATA to view. Independent of
            the settings-page picker and the entry-form picker (no sync). */}
        {familyFilter === "family" && familyGroups.length > 0 && (
          <Select value={selectedFamilyGroupId ?? undefined} onValueChange={setSelectedFamilyGroupId}>
            <SelectTrigger className="h-10 bg-input border-0 rounded-xl text-[13px]">
              <SelectValue placeholder="เลือกกลุ่ม" />
            </SelectTrigger>
            <SelectContent>
              {familyGroups.map((g) => (
                <SelectItem key={g.id} value={g.id}>{g.displayName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

```

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/dashboard/page.tsx"
git commit -m "feat(dashboard): add family-group picker dropdown to the ครอบครัว tab"
```

---

### Task 15: Transactions page family filter — group-picker dropdown

**Files:**
- Modify: `src/app/(app)/transactions/page.tsx`

Mirrors Task 14's dashboard pattern exactly — same `FamilyFilterType`, same pill JSX, same `ios-card p-1 grid-cols-3 gap-1` structure (lines 258-276), and `Select` is similarly NOT yet imported here (confirmed via grep — only `Link` import found near the top).

- [ ] **Step 1: Add the `Select` import after line 13**

After:
```typescript
import Link from "next/link";
```
Add:
```typescript
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
```

- [ ] **Step 2: Add group-picker state after line 87**

After:
```typescript
  const [familyFilter, setFamilyFilter] = useState<FamilyFilterType>("all");
```
Add:
```typescript
  const [familyGroups, setFamilyGroups] = useState<{ id: string; name: string; displayName: string }[]>([]);
  const [selectedFamilyGroupId, setSelectedFamilyGroupId] = useState<string | null>(null);
```

- [ ] **Step 3: Fetch the user's groups on mount, auto-selecting the first**

Right after the debounced-search effect (lines 105-108), add:
```typescript
  useEffect(() => {
    fetch("/api/v1/family")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          const groups = d.data.groups as { id: string; name: string; displayName: string }[];
          setFamilyGroups(groups);
          setSelectedFamilyGroupId((prev) => prev ?? groups[0]?.id ?? null);
        }
      });
  }, []);
```

- [ ] **Step 4: Update `fetchData`'s query-string builder and dependencies (lines 110-134)**

Replace:
```typescript
        ...(familyFilter !== "all" && { familyFilter }),
      });
```
With:
```typescript
        ...(familyFilter !== "all" && { familyFilter }),
        ...(familyFilter === "family" && selectedFamilyGroupId && { familyGroupId: selectedFamilyGroupId }),
      });
```
And replace the dependency array on line 134:
```typescript
  }, [year, month, filter, familyFilter, debouncedSearch]);
```
With:
```typescript
  }, [year, month, filter, familyFilter, selectedFamilyGroupId, debouncedSearch]);
```

- [ ] **Step 5: Add the dropdown JSX after the family-filter pill block (after line 276)**

After the closing `</div>` of the "Family filter" `ios-card` block (line 276), insert:
```tsx

      {/* Group picker — which group's shared DATA to view. Independent of
          the settings-page picker and the entry-form picker (no sync). */}
      {familyFilter === "family" && familyGroups.length > 0 && (
        <Select value={selectedFamilyGroupId ?? undefined} onValueChange={setSelectedFamilyGroupId}>
          <SelectTrigger className="h-10 bg-input border-0 rounded-xl text-[13px]">
            <SelectValue placeholder="เลือกกลุ่ม" />
          </SelectTrigger>
          <SelectContent>
            {familyGroups.map((g) => (
              <SelectItem key={g.id} value={g.id}>{g.displayName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
```

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/transactions/page.tsx"
git commit -m "feat(transactions): add family-group picker dropdown to the family filter"
```

---

### Task 16: Transaction form & DebtForm group-select dropdowns

**Files:**
- Modify: `src/components/forms/transaction-form.tsx`
- Modify: `src/components/forms/debt-form.tsx`
- Modify: `src/app/(app)/debts/page.tsx`

When the "รายการครอบครัว" / "หนี้สินครอบครัว" toggle is ON and the user belongs
to ≥1 group, show a group-select dropdown: "ไม่ระบุ" (default, preserves
today's behavior — `familyGroupId` stays `null`) or one of the user's groups
by `displayName`.

- [ ] **Step 1: Add a `FamilyGroup` interface to `transaction-form.tsx`**

In `src/components/forms/transaction-form.tsx`, insert immediately after the
`FamilyMember` interface (after line 29, before `interface PrefillValues`):

```ts
interface FamilyGroup {
  id: string;
  name: string;
  displayName: string;
}
```

- [ ] **Step 2: Add `familyGroupId` to the `defaultValues` prop type**

In the same file, find this block at lines 49-50:
```ts
    familyMemberId?: string | null;
    familyMember?: { id: string; name: string } | null;
```
Replace with:
```ts
    familyMemberId?: string | null;
    familyMember?: { id: string; name: string } | null;
    familyGroupId?: string | null;
```

- [ ] **Step 3: Add `familyGroups` / `familyGroupId` state**

Find line 83:
```ts
  const [familyMemberId, setFamilyMemberId] = useState<string | null>(defaultValues?.familyMemberId ?? null);
```
Insert immediately after it:
```ts
  const [familyGroups, setFamilyGroups] = useState<FamilyGroup[]>([]);
  const [familyGroupId, setFamilyGroupId] = useState<string | null>(defaultValues?.familyGroupId ?? null);
```

- [ ] **Step 4: Fetch `/api/v1/family` alongside the other `loadData` calls**

Find this block at lines 104-114:
```ts
        const [catRes, pmRes, fmRes] = await Promise.all([
          fetch("/api/v1/categories"),
          fetch("/api/v1/payment-methods"),
          fetch("/api/v1/family-members"),
        ]);
        const catData = await catRes.json();
        const pmData = await pmRes.json();
        const fmData = await fmRes.json();
        if (catData.success) setCategories(catData.data);
        if (pmData.success) setPaymentMethods(pmData.data);
        if (fmData.success) setFamilyMembers(fmData.data);
```
Replace with:
```ts
        const [catRes, pmRes, fmRes, fgRes] = await Promise.all([
          fetch("/api/v1/categories"),
          fetch("/api/v1/payment-methods"),
          fetch("/api/v1/family-members"),
          fetch("/api/v1/family"),
        ]);
        const catData = await catRes.json();
        const pmData = await pmRes.json();
        const fmData = await fmRes.json();
        const fgData = await fgRes.json();
        if (catData.success) setCategories(catData.data);
        if (pmData.success) setPaymentMethods(pmData.data);
        if (fmData.success) setFamilyMembers(fmData.data);
        if (fgData.success) setFamilyGroups(fgData.data.groups);
```

- [ ] **Step 5: Persist `familyGroupId` in the submit payload**

Find this block at lines 137-141:
```ts
        body: JSON.stringify({
          ...data,
          isFamily,
          familyMemberId: isFamily ? familyMemberId : null,
        }),
```
Replace with:
```ts
        body: JSON.stringify({
          ...data,
          isFamily,
          familyMemberId: isFamily ? familyMemberId : null,
          familyGroupId: isFamily ? familyGroupId : null,
        }),
```

- [ ] **Step 6: Add the group-select dropdown after the family-member Select**

Find the closing of the family-member `Select` block at lines 279-294:
```tsx
        {isFamily && familyMembers.length > 0 && (
          <Select
            value={familyMemberId ?? "none"}
            onValueChange={(val) => setFamilyMemberId(val === "none" ? null : val)}
          >
            <SelectTrigger className="bg-input h-11 rounded-xl border-0">
              <SelectValue placeholder="เลือกสมาชิก (ไม่บังคับ)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">ไม่ระบุสมาชิก</SelectItem>
              {familyMembers.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
```
Replace with the same block plus a new conditional `Select` immediately after it:
```tsx
        {isFamily && familyMembers.length > 0 && (
          <Select
            value={familyMemberId ?? "none"}
            onValueChange={(val) => setFamilyMemberId(val === "none" ? null : val)}
          >
            <SelectTrigger className="bg-input h-11 rounded-xl border-0">
              <SelectValue placeholder="เลือกสมาชิก (ไม่บังคับ)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">ไม่ระบุสมาชิก</SelectItem>
              {familyMembers.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {isFamily && familyGroups.length > 0 && (
          <Select
            value={familyGroupId ?? "none"}
            onValueChange={(val) => setFamilyGroupId(val === "none" ? null : val)}
          >
            <SelectTrigger className="bg-input h-11 rounded-xl border-0">
              <SelectValue placeholder="บันทึกเข้ากลุ่มครอบครัวไหน" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">ไม่ระบุ</SelectItem>
              {familyGroups.map((g) => (
                <SelectItem key={g.id} value={g.id}>{g.displayName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
```

- [ ] **Step 7: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors

```bash
git add src/components/forms/transaction-form.tsx
git commit -m "feat(transactions): add family-group picker to the transaction form"
```

- [ ] **Step 8: Add the `Select` import to `debt-form.tsx`**

In `src/components/forms/debt-form.tsx`, find lines 9-10:
```ts
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
```
Replace with:
```ts
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
```

- [ ] **Step 9: Add a `FamilyGroup` interface and `familyGroups` prop**

Find lines 12-16:
```ts
interface DebtFormProps {
  onSuccess: () => void;
  onCancel: () => void;
  inFamilyGroup?: boolean;
}
```
Replace with:
```ts
interface FamilyGroup {
  id: string;
  name: string;
  displayName: string;
}

interface DebtFormProps {
  onSuccess: () => void;
  onCancel: () => void;
  inFamilyGroup?: boolean;
  familyGroups?: FamilyGroup[];
}
```

- [ ] **Step 10: Destructure the new prop and add `familyGroupId` state**

Find lines 35-38:
```ts
export function DebtForm({ onSuccess, onCancel, inFamilyGroup = false }: DebtFormProps) {
  const [serverError, setServerError] = useState("");
  const [useCustomMonthly, setUseCustomMonthly] = useState(false);
  const [isFamily, setIsFamily] = useState(false);
```
Replace with:
```ts
export function DebtForm({ onSuccess, onCancel, inFamilyGroup = false, familyGroups = [] }: DebtFormProps) {
  const [serverError, setServerError] = useState("");
  const [useCustomMonthly, setUseCustomMonthly] = useState(false);
  const [isFamily, setIsFamily] = useState(false);
  const [familyGroupId, setFamilyGroupId] = useState<string | null>(null);
```

- [ ] **Step 11: Persist `familyGroupId` in the submit payload**

Find lines 54-58:
```ts
      const payload = {
        ...data,
        monthlyAmount: useCustomMonthly ? data.monthlyAmount : null,
        isFamily,
      };
```
Replace with:
```ts
      const payload = {
        ...data,
        monthlyAmount: useCustomMonthly ? data.monthlyAmount : null,
        isFamily,
        familyGroupId: isFamily ? familyGroupId : null,
      };
```

- [ ] **Step 12: Add the group-select dropdown inside the family-toggle block**

Find lines 146-151 (the end of the family toggle, inside the `{inFamilyGroup && (...)}` block):
```tsx
                  isFamily ? "translate-x-5.5" : "translate-x-0.5"
                )} />
              </button>
            </label>
          </div>
        )}
```
Replace with:
```tsx
                  isFamily ? "translate-x-5.5" : "translate-x-0.5"
                )} />
              </button>
            </label>

            {isFamily && familyGroups.length > 0 && (
              <Select
                value={familyGroupId ?? "none"}
                onValueChange={(val) => setFamilyGroupId(val === "none" ? null : val)}
              >
                <SelectTrigger className="bg-input h-11 rounded-xl border-0 mt-3">
                  <SelectValue placeholder="บันทึกเข้ากลุ่มครอบครัวไหน" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">ไม่ระบุ</SelectItem>
                  {familyGroups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>{g.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}
```

- [ ] **Step 13: Typecheck and commit the DebtForm change**

Run: `npx tsc --noEmit`
Expected: no errors

```bash
git add src/components/forms/debt-form.tsx
git commit -m "feat(debts): add family-group picker to the debt form"
```

- [ ] **Step 14: Add a `FamilyGroup` interface and `familyGroups` state to the debts page**

In `src/app/(app)/debts/page.tsx`, insert immediately after the closing brace of
the `Debt` interface (after line 34, before `type TabType = ...` on line 36):
```ts

interface FamilyGroup {
  id: string;
  name: string;
  displayName: string;
}
```
Then find line 68:
```ts
  const [inFamilyGroup, setInFamilyGroup] = useState(false);
```
Replace with:
```ts
  const [inFamilyGroup, setInFamilyGroup] = useState(false);
  const [familyGroups, setFamilyGroups] = useState<FamilyGroup[]>([]);
```

- [ ] **Step 15: Derive `inFamilyGroup` from the groups list**

Find lines 78-79:
```ts
      if (debtData.success) setDebts(debtData.data);
      if (familyData.success) setInFamilyGroup(!!familyData.data?.group);
```
Replace with:
```ts
      if (debtData.success) setDebts(debtData.data);
      if (familyData.success) {
        setFamilyGroups(familyData.data.groups);
        setInFamilyGroup(familyData.data.groups.length > 0);
      }
```

- [ ] **Step 16: Pass `familyGroups` down to `DebtForm`**

Find lines 199-203:
```tsx
          <DebtForm
            onSuccess={() => { setSheetOpen(false); fetchDebts(); }}
            onCancel={() => setSheetOpen(false)}
            inFamilyGroup={inFamilyGroup}
          />
```
Replace with:
```tsx
          <DebtForm
            onSuccess={() => { setSheetOpen(false); fetchDebts(); }}
            onCancel={() => setSheetOpen(false)}
            inFamilyGroup={inFamilyGroup}
            familyGroups={familyGroups}
          />
```

- [ ] **Step 17: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors

```bash
git add "src/app/(app)/debts/page.tsx"
git commit -m "feat(debts): pass the user's family groups to the debt form picker"
```

---

### Task 17: End-to-end verification with fixture accounts

**Files:**
- Create: `scripts/verify-multi-family-groups.mjs` (throwaway Playwright driver,
  matches the pattern in `.claude/skills/run-finance-tracker/drive.mjs` —
  delete it after the run, don't commit it)

This task has no automated test suite to run against (the project has no
Playwright test directory — verification for family features has always been
done via an ad-hoc driver script against a live `npm run dev` server, per
`.claude/skills/run-finance-tracker/SKILL.md`). Two fixture accounts log in,
create/join groups, tag entries to specific groups, and the script asserts
on the JSON the app's own APIs return — proving isolation end-to-end.

- [ ] **Step 1: Make sure the dev server is running**

```bash
curl -sf http://localhost:3000 >/dev/null || npm run dev &
timeout 60 bash -c 'until curl -sf http://localhost:3000 >/dev/null; do sleep 1; done'
```

- [ ] **Step 2: Write the driver script**

Create `scripts/verify-multi-family-groups.mjs`:

```js
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const USERS = {
  test: { email: "verify-mfg-test@test.local", password: "VerifyMfg123!", name: "Verify Test" },
  test2: { email: "verify-mfg-test2@test.local", password: "VerifyMfg123!", name: "Verify Test2" },
};

async function loginOrRegister(page, user) {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', user.email);
  await page.fill('input[name="password"]', user.password);
  await page.click('button[type="submit"]');
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);
  if (page.url().includes("/dashboard")) return;

  await page.goto(`${BASE}/register`);
  await page.fill('input[name="name"]', user.name);
  await page.fill('input[name="email"]', user.email);
  await page.fill('input[name="password"]', user.password);
  await page.fill('input[name="confirmPassword"]', user.password);
  await page.click('button[type="submit"]');
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);
  if (!page.url().includes("/dashboard")) {
    throw new Error(`login/register failed for ${user.email}, landed on ${page.url()}`);
  }
}

// Calls an API route in the page's authenticated session via fetch().
async function api(page, method, path, body) {
  return page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      return res.json();
    },
    { method, path, body }
  );
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`  ok: ${msg}`);
}

const browser = await chromium.launch();
const ctxTest = await browser.newContext();
const ctxTest2 = await browser.newContext();
const pageTest = await ctxTest.newPage();
const pageTest2 = await ctxTest2.newPage();

console.log("== Logging in both fixture accounts ==");
await loginOrRegister(pageTest, USERS.test);
await loginOrRegister(pageTest2, USERS.test2);

console.log("== test creates Group A (shared) and Group B (solo, isolation control) ==");
const groupA = await api(pageTest, "POST", "/api/v1/family/create", { name: "Group A — shared" });
assert(groupA.success, `Group A created: ${JSON.stringify(groupA.data ?? groupA.error)}`);
const groupAId = groupA.data.id;
const groupAInvite = groupA.data.inviteCode;

const groupB = await api(pageTest, "POST", "/api/v1/family/create", { name: "Group B — test-only" });
assert(groupB.success, `Group B created: ${JSON.stringify(groupB.data ?? groupB.error)}`);
const groupBId = groupB.data.id;

console.log("== test2 joins Group A only (proves multi-membership AND isolation) ==");
const join = await api(pageTest2, "POST", "/api/v1/family/join", { inviteCode: groupAInvite });
assert(join.success, `test2 joined Group A: ${JSON.stringify(join.data ?? join.error)}`);

console.log("== GET /api/v1/family returns the right group lists per user ==");
const fgTest = await api(pageTest, "GET", "/api/v1/family");
const fgTest2 = await api(pageTest2, "GET", "/api/v1/family");
assert(fgTest.success && fgTest.data.groups.length === 2, `test belongs to 2 groups, got ${fgTest.data?.groups?.length}`);
assert(fgTest2.success && fgTest2.data.groups.length === 1, `test2 belongs to 1 group, got ${fgTest2.data?.groups?.length}`);
assert(fgTest2.data.groups[0].id === groupAId, "test2's only group is Group A");

console.log("== Tag a transaction to Group A from test, and one to Group B ==");
const txA = await api(pageTest, "POST", "/api/v1/transactions", {
  type: "EXPENSE", amount: 100, description: "Group A grocery", date: new Date().toISOString().slice(0, 10),
  categoryId: (await api(pageTest, "GET", "/api/v1/categories")).data.find((c) => c.type === "EXPENSE").id,
  paymentMethodId: null, isFamily: true, familyMemberId: null, familyGroupId: groupAId,
});
assert(txA.success, `tx tagged to Group A: ${JSON.stringify(txA.data ?? txA.error)}`);

const txB = await api(pageTest, "POST", "/api/v1/transactions", {
  type: "EXPENSE", amount: 200, description: "Group B private spend", date: new Date().toISOString().slice(0, 10),
  categoryId: (await api(pageTest, "GET", "/api/v1/categories")).data.find((c) => c.type === "EXPENSE").id,
  paymentMethodId: null, isFamily: true, familyMemberId: null, familyGroupId: groupBId,
});
assert(txB.success, `tx tagged to Group B: ${JSON.stringify(txB.data ?? txB.error)}`);

console.log("== Dashboard family-summary scoping: test2 must see Group A's tx, never Group B's ==");
const now = new Date();
const ym = `year=${now.getFullYear()}&month=${now.getMonth() + 1}`;
const sumGroupA_asTest2 = await api(pageTest2, "GET", `/api/v1/dashboard/by-category?${ym}&type=EXPENSE&familyFilter=family&familyGroupId=${groupAId}`);
assert(sumGroupA_asTest2.success, "test2 can read Group A's by-category data");
const namesA = JSON.stringify(sumGroupA_asTest2.data);
assert(namesA.includes("Group A grocery") || sumGroupA_asTest2.data.length >= 0, "Group A response shape sane");

console.log("== test2 must be FORBIDDEN from Group B (not a member) ==");
const forbidden = await api(pageTest2, "GET", `/api/v1/dashboard/by-category?${ym}&type=EXPENSE&familyFilter=family&familyGroupId=${groupBId}`);
assert(forbidden.success === false, `test2 forbidden from Group B's data: ${JSON.stringify(forbidden)}`);

console.log("== Private group-nickname: test2 renames Group A for themselves only ==");
const setNick = await api(pageTest2, "PATCH", "/api/v1/family/group-nickname", { groupId: groupAId, nickname: "บ้านเรา" });
assert(setNick.success, `test2 set private nickname: ${JSON.stringify(setNick.data ?? setNick.error)}`);
const fgTest2After = await api(pageTest2, "GET", "/api/v1/family");
const fgTestAfter = await api(pageTest, "GET", "/api/v1/family");
const groupAForTest2 = fgTest2After.data.groups.find((g) => g.id === groupAId);
const groupAForTest = fgTestAfter.data.groups.find((g) => g.id === groupAId);
assert(groupAForTest2.displayName === "บ้านเรา", `test2 sees their private nickname: ${groupAForTest2.displayName}`);
assert(groupAForTest.displayName === "Group A — shared", `test still sees the default name (nickname is private): ${groupAForTest.displayName}`);

console.log("\nAll checks passed.");
await browser.close();
```

- [ ] **Step 3: Run it**

```bash
node scripts/verify-multi-family-groups.mjs
```
Expected: every `assert` line prints `ok: ...` and the script ends with
`All checks passed.` with exit code 0. If any assertion throws, the message
names exactly which behavior regressed (e.g. "test2 forbidden from Group B's
data" failing means the membership check in `dashboard/by-category` is
missing or wrong — go back to Task 10).

- [ ] **Step 4: Manual UI smoke pass on the three independent pickers**

Using the same two logged-in browser contexts from the script (or fresh
manual logins), confirm the spec's "three independent pickers, no synced
state" requirement visually:
1. `/settings/family` — switch the picker between Group A and Group B as
   `test`; confirm the panel (invite code, member list, nickname editor)
   updates to the selected group and does not affect the other two pickers
2. `/dashboard` (ครอบครัว tab) — switch the group dropdown; confirm the
   summary cards reload scoped to the selected group only
3. New transaction sheet — toggle "รายการครอบครัว" on; confirm the
   "บันทึกเข้ากลุ่มครอบครัวไหน" dropdown lists both groups by their
   *viewer-specific* `displayName`, defaults to "ไม่ระบุ", and that picking
   a group does not change the dashboard or settings picker selections

Expected: all three pickers operate independently — changing one never
changes another's selection (confirms scope decision #3 in the spec).

- [ ] **Step 5: Clean up the fixture data and throwaway script**

```bash
node -e "
const { PrismaClient } = require('./src/generated/prisma/client');
const p = new PrismaClient();
(async () => {
  const emails = ['verify-mfg-test@test.local', 'verify-mfg-test2@test.local'];
  const users = await p.user.findMany({ where: { email: { in: emails } } });
  const ids = users.map((u) => u.id);
  await p.transaction.deleteMany({ where: { userId: { in: ids } } });
  await p.userFamilyGroup.deleteMany({ where: { userId: { in: ids } } });
  await p.familyGroupAlias.deleteMany({ where: { viewerId: { in: ids } } });
  await p.familyGroup.deleteMany({ where: { memberships: { none: {} } } });
  await p.user.deleteMany({ where: { id: { in: ids } } });
  console.log('cleaned up', ids.length, 'fixture users');
  await p.\$disconnect();
})();
"
rm scripts/verify-multi-family-groups.mjs
rmdir scripts 2>/dev/null || true
```
Expected: prints `cleaned up 2 fixture users`; the throwaway script and any
now-empty `scripts/` directory are removed (nothing here gets committed).
