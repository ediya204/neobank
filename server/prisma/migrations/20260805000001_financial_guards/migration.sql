ALTER TABLE "Operation"
  ADD CONSTRAINT "operation_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "operation_fee_nonnegative" CHECK ("feeAmount" >= 0),
  ADD CONSTRAINT "operation_maker_checker_distinct" CHECK ("checkerId" IS NULL OR "checkerId" <> "makerId");

ALTER TABLE "Customer"
  ADD CONSTRAINT "customer_creator_reviewer_distinct" CHECK ("reviewerId" IS NULL OR "reviewerId" <> "creatorId");

ALTER TABLE "VirtualAccountRequest"
  ADD CONSTRAINT "va_request_maker_checker_distinct" CHECK ("checkerId" IS NULL OR "checkerId" <> "makerId");

ALTER TABLE "JournalLine"
  ADD CONSTRAINT "journal_line_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "Account"
  ADD CONSTRAINT "account_available_nonnegative" CHECK ("availableBalance" >= 0),
  ADD CONSTRAINT "account_frozen_nonnegative" CHECK ("frozenBalance" >= 0);

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
    IF NEW."checkerId" IS NULL OR NEW."checkerId" = NEW."makerId" THEN
      RAISE EXCEPTION 'independent checker is required';
    END IF;
  END IF;

  IF NEW.type = 'PAYOUT' AND NEW.status = 'COMPLETED' AND
     (NEW."externalReference" IS NULL OR btrim(NEW."externalReference") = '') THEN
    RAISE EXCEPTION 'completed payout requires external reference';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "operation_transition_guard"
BEFORE UPDATE ON "Operation"
FOR EACH ROW EXECUTE FUNCTION guard_operation_transition();

CREATE OR REPLACE FUNCTION prevent_ledger_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'posted journal records are immutable; create a compensating entry';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "journal_entry_no_update"
BEFORE UPDATE OR DELETE ON "JournalEntry"
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

CREATE TRIGGER "journal_line_no_update"
BEFORE UPDATE OR DELETE ON "JournalLine"
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

CREATE OR REPLACE FUNCTION validate_balanced_journal()
RETURNS trigger AS $$
DECLARE
  entry_id text;
BEGIN
  entry_id := COALESCE(NEW."journalEntryId", OLD."journalEntryId");
  IF EXISTS (
    SELECT 1
    FROM "JournalLine"
    WHERE "journalEntryId" = entry_id
    GROUP BY currency
    HAVING SUM(CASE WHEN side = 'DEBIT' THEN amount ELSE -amount END) <> 0
  ) THEN
    RAISE EXCEPTION 'journal entry % is not balanced by currency', entry_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "journal_must_balance"
AFTER INSERT OR UPDATE OR DELETE ON "JournalLine"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_balanced_journal();
