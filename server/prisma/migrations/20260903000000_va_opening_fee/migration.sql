ALTER TYPE "AccountRequestStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
ALTER TYPE "OperationType" ADD VALUE IF NOT EXISTS 'VA_OPENING_FEE';

ALTER TABLE "FundingChannel"
  ADD COLUMN IF NOT EXISTS "openingFeeUsdMinor" BIGINT,
  ADD COLUMN IF NOT EXISTS "openingFeeVersion" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "openingFeeUpdatedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "openingFeeUpdatedAt" TIMESTAMPTZ(6);

ALTER TABLE "VirtualAccountRequest"
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT,
  ADD COLUMN IF NOT EXISTS "openingFeeUsdMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "openingFeeVersion" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "feeOperationId" TEXT;

DO $$
BEGIN
  ALTER TABLE "FundingChannel"
    ADD CONSTRAINT "FundingChannel_openingFeeUsdMinor_nonnegative"
    CHECK ("openingFeeUsdMinor" IS NULL OR "openingFeeUsdMinor" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "VirtualAccountRequest"
    ADD CONSTRAINT "VirtualAccountRequest_openingFeeUsdMinor_nonnegative"
    CHECK ("openingFeeUsdMinor" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "VirtualAccountRequest_customerId_idempotencyKey_key"
  ON "VirtualAccountRequest"("customerId", "idempotencyKey");

CREATE UNIQUE INDEX IF NOT EXISTS "VirtualAccountRequest_feeOperationId_key"
  ON "VirtualAccountRequest"("feeOperationId");

DO $$
BEGIN
  ALTER TABLE "VirtualAccountRequest"
    ADD CONSTRAINT "VirtualAccountRequest_feeOperationId_fkey"
    FOREIGN KEY ("feeOperationId") REFERENCES "Operation"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
