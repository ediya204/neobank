ALTER TABLE "Operation"
  DROP CONSTRAINT IF EXISTS "operation_maker_checker_distinct";

ALTER TABLE "Customer"
  DROP CONSTRAINT IF EXISTS "customer_creator_reviewer_distinct";

ALTER TABLE "VirtualAccountRequest"
  DROP CONSTRAINT IF EXISTS "va_request_maker_checker_distinct";

ALTER TABLE "CryptoTransfer"
  DROP CONSTRAINT IF EXISTS "CryptoTransfer_maker_checker";

CREATE OR REPLACE FUNCTION guard_operation_transition()
RETURNS trigger AS $$
BEGIN
  IF NEW."makerId" <> OLD."makerId" THEN
    RAISE EXCEPTION 'operation maker is immutable';
  END IF;

  IF OLD.status IN ('COMPLETED', 'REJECTED', 'FAILED', 'CANCELLED') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'terminal operation is immutable';
  END IF;

  IF NEW.status <> OLD.status THEN
    IF OLD.status = 'DRAFT' AND NEW.status NOT IN ('SUBMITTED', 'CANCELLED') THEN
      RAISE EXCEPTION 'invalid operation transition';
    ELSIF OLD.status = 'SUBMITTED' AND NEW.status NOT IN ('PROCESSING', 'COMPLETED', 'REJECTED') THEN
      RAISE EXCEPTION 'invalid operation transition';
    ELSIF OLD.status = 'PROCESSING' AND NEW.status NOT IN ('COMPLETED', 'FAILED') THEN
      RAISE EXCEPTION 'invalid operation transition';
    END IF;
  END IF;

  IF NEW.status IN ('PROCESSING', 'COMPLETED', 'REJECTED') THEN
    IF NEW."checkerId" IS NULL THEN
      RAISE EXCEPTION 'approver is required';
    END IF;
    IF NEW."checkerId" = NEW."makerId" AND NOT EXISTS (
      SELECT 1 FROM "User"
      WHERE id = NEW."checkerId" AND role = 'ADMIN' AND active = TRUE
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
