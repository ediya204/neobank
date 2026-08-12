CREATE TYPE "KycStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "Customer"
  ADD COLUMN "phoneCountryCode" TEXT,
  ADD COLUMN "nationality" TEXT,
  ADD COLUMN "contactName" TEXT,
  ADD COLUMN "contactRole" TEXT,
  ADD COLUMN "beneficialOwnerName" TEXT,
  ADD COLUMN "beneficialOwnerOwnership" DECIMAL(5,2),
  ADD COLUMN "kycStatus" "KycStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "kycReviewerId" TEXT,
  ADD COLUMN "kycReviewedAt" TIMESTAMP(3),
  ADD COLUMN "kycReviewNote" TEXT;

UPDATE "Customer"
SET "kycStatus" = 'APPROVED',
    "kycReviewedAt" = COALESCE("reviewedAt", "updatedAt"),
    "kycReviewNote" = COALESCE("reviewNote", 'Legacy active customer backfill')
WHERE status IN ('ACTIVE', 'SUSPENDED');

ALTER TABLE "Customer"
  ADD CONSTRAINT "Customer_kycReviewerId_fkey"
  FOREIGN KEY ("kycReviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Customer_organizationId_kycStatus_idx"
  ON "Customer"("organizationId", "kycStatus");
