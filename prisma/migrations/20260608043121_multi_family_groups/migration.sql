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
