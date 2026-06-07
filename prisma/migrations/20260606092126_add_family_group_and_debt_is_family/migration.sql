-- AlterTable
ALTER TABLE "debts" ADD COLUMN     "is_family" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "family_group_id" TEXT;

-- CreateTable
CREATE TABLE "family_groups" (
    "id" TEXT NOT NULL,
    "invite_code" TEXT NOT NULL,
    "name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "family_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "family_groups_invite_code_key" ON "family_groups"("invite_code");

-- CreateIndex
CREATE INDEX "users_family_group_id_idx" ON "users"("family_group_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_family_group_id_fkey" FOREIGN KEY ("family_group_id") REFERENCES "family_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
