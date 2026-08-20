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
      RAISE EXCEPTION 'invalid operation transition';
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
      quote_expires_at := NULLIF(
        NEW.metadata->'quoteConfirmation'->>'expiresAt',
        ''
      )::timestamptz;
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
