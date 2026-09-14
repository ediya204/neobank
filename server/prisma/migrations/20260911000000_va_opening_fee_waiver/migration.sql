ALTER TABLE "Customer"
  ADD COLUMN "isInternal" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "vaFeeExempt" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "vaFeePolicyVersion" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "Customer_va_fee_policy_valid" CHECK (NOT ("isInternal" AND "vaFeeExempt"));

CREATE TABLE "VaFeePolicyEvent" (
  "id" TEXT PRIMARY KEY,
  "customerId" TEXT NOT NULL REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "version" INTEGER NOT NULL,
  "before" JSONB NOT NULL,
  "after" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "VaFeePolicyEvent_customerId_version_key" ON "VaFeePolicyEvent"("customerId", "version");

ALTER TABLE "VirtualAccountRequest"
  ADD COLUMN "openingFeeStandardUsdMinor" BIGINT,
  ADD COLUMN "openingFeeBasis" TEXT NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN "openingFeePolicyVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "openingFeeWaivedAt" TIMESTAMPTZ(6),
  ADD COLUMN "openingFeeWaivedBy" TEXT,
  ADD COLUMN "openingFeeWaiverReason" TEXT,
  ADD COLUMN "openingFeeWaiverBasis" TEXT,
  ADD CONSTRAINT "VirtualAccountRequest_standard_fee_valid" CHECK ("openingFeeStandardUsdMinor" IS NULL OR "openingFeeStandardUsdMinor" >= "openingFeeUsdMinor"),
  ADD CONSTRAINT "VirtualAccountRequest_fee_basis_valid" CHECK ("openingFeeBasis" IN ('STANDARD', 'BANK_FREE', 'INTERNAL', 'SPECIAL')),
  ADD CONSTRAINT "VirtualAccountRequest_waiver_valid" CHECK (
    ("openingFeeWaivedAt" IS NULL AND "openingFeeWaivedBy" IS NULL AND "openingFeeWaiverReason" IS NULL AND "openingFeeWaiverBasis" IS NULL)
    OR ("openingFeeWaivedAt" IS NOT NULL AND "openingFeeWaivedBy" IS NOT NULL AND "openingFeeWaiverReason" IS NOT NULL AND "openingFeeWaiverBasis" IS NOT NULL AND "openingFeeWaiverBasis" IN ('INTERNAL', 'SPECIAL') AND "openingFeeUsdMinor" > 0)
  );

-- Preserve the existing financial guard; only VA fee reservations may be cancelled
-- from SUBMITTED (customer cancellation or an administrator's full waiver).
CREATE OR REPLACE FUNCTION guard_operation_transition()
RETURNS trigger AS $$
DECLARE
  quote_expires_at timestamptz;
BEGIN
  IF NEW."makerId" <> OLD."makerId" THEN
    RAISE EXCEPTION 'operation maker is immutable';
  END IF;
  IF OLD.status IN ('COMPLETED', 'REJECTED', 'FAILED', 'CANCELLED') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'terminal operation is immutable';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF OLD.status = 'DRAFT' AND NEW.status NOT IN ('SUBMITTED', 'CANCELLED') THEN
      IF NOT (NEW.type = 'OTC' AND NEW.status = 'PROCESSING') THEN
        RAISE EXCEPTION 'invalid operation transition';
      END IF;
    ELSIF OLD.status = 'SUBMITTED' AND NEW.status NOT IN ('PROCESSING', 'COMPLETED', 'REJECTED') THEN
      IF NOT (OLD.type = 'VA_OPENING_FEE' AND NEW.type = OLD.type AND NEW.status = 'CANCELLED') THEN
        RAISE EXCEPTION 'invalid operation transition';
      END IF;
    ELSIF OLD.status = 'PROCESSING' AND NEW.status NOT IN ('COMPLETED', 'FAILED') THEN
      RAISE EXCEPTION 'invalid operation transition';
    END IF;
  END IF;
  IF NEW.type = 'OTC' AND NEW.status IN ('PROCESSING', 'COMPLETED') THEN
    IF NEW.status <> OLD.status AND (
      (NEW.status = 'PROCESSING' AND OLD.status <> 'DRAFT') OR
      (NEW.status = 'COMPLETED' AND OLD.status <> 'PROCESSING')
    ) THEN
      RAISE EXCEPTION 'invalid OTC quote transition';
    END IF;
    IF NEW."checkerId" IS NOT NULL OR NEW."approvedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'OTC quote confirmation must not use approval';
    END IF;
    IF NEW."rate" IS NULL OR NEW."quoteAmount" IS NULL OR NEW."rateVersionId" IS NULL THEN
      RAISE EXCEPTION 'OTC quote snapshot is required';
    END IF;
    IF NEW.metadata->'quoteConfirmation'->>'customerId' IS DISTINCT FROM NEW."customerId" THEN
      RAISE EXCEPTION 'OTC quote customer mismatch';
    END IF;
    BEGIN
      quote_expires_at := NULLIF(NEW.metadata->'quoteConfirmation'->>'expiresAt', '')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'OTC quote expiry is invalid';
    END;
    IF quote_expires_at IS NULL THEN
      RAISE EXCEPTION 'OTC quote expiry is required';
    END IF;
    IF OLD.status = 'DRAFT' AND quote_expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION 'OTC quote expired';
    END IF;
  ELSIF NEW.status IN ('PROCESSING', 'COMPLETED', 'REJECTED') THEN
    IF NEW."checkerId" IS NULL THEN
      RAISE EXCEPTION 'approver is required';
    END IF;
    IF NEW."checkerId" = NEW."makerId" AND NOT EXISTS (
      SELECT 1 FROM "User" WHERE id = NEW."checkerId" AND role = 'ADMIN' AND active = TRUE
    ) THEN
      RAISE EXCEPTION 'self approval requires an active admin';
    END IF;
  END IF;
  IF NEW.type = 'PAYOUT' AND NEW.status = 'COMPLETED' AND
     (NEW."externalReference" IS NULL OR btrim(NEW."externalReference") = '') THEN
    RAISE EXCEPTION 'completed payout requires external reference';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
