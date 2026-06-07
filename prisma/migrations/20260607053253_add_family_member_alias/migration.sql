-- CreateTable
CREATE TABLE "family_member_aliases" (
    "id" TEXT NOT NULL,
    "viewer_id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "family_member_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "family_member_aliases_target_id_idx" ON "family_member_aliases"("target_id");

-- CreateIndex
CREATE UNIQUE INDEX "family_member_aliases_viewer_id_target_id_key" ON "family_member_aliases"("viewer_id", "target_id");

-- AddForeignKey
ALTER TABLE "family_member_aliases" ADD CONSTRAINT "family_member_aliases_viewer_id_fkey" FOREIGN KEY ("viewer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_member_aliases" ADD CONSTRAINT "family_member_aliases_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
