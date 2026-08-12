PRAGMA foreign_keys = ON;

CREATE TABLE application_resubmission_assertion (
  value INTEGER NOT NULL CHECK (value = 1)
);

INSERT INTO va_applications
  (id,partner_customer_id,partner_key,phone_country_code,phone_number,email,
   customer_name,status,created_at,updated_at,last_submitted_at)
VALUES
  ('va_app_resubmit_check','a4f6db8b-642d-4d5b-bdd1-3af604df2195','ethan',
   '+65','81234567','resubmit-check@example.invalid','Resubmit Check','kyc_link_ready',
   '2026-08-03T00:00:00.000Z','2026-08-03T00:00:00.000Z','2026-08-03T00:00:00.000Z');

INSERT INTO va_application_reviews
  (id,application_id,submission_round,review_stage,public_reason_code,
   public_reason_text,required_fields_json,reviewed_by,reviewed_at,created_at)
VALUES
  ('review_resubmit_check','va_app_resubmit_check',1,'kyc_link_ready',
   'phone_unverifiable','Please correct the customer phone number.',
   '["phone_number"]','operator@example.invalid','2026-08-03T00:01:00.000Z',
   '2026-08-03T00:01:00.000Z');

UPDATE va_applications
SET current_review_id='review_resubmit_check',application_version=2,
    updated_at='2026-08-03T00:01:00.000Z'
WHERE id='va_app_resubmit_check';

INSERT INTO application_resubmission_assertion(value)
SELECT CASE
  WHEN status='kyc_link_ready'
   AND current_review_id='review_resubmit_check'
   AND submission_round=1
   AND application_version=2
  THEN 1 ELSE 0 END
FROM va_applications WHERE id='va_app_resubmit_check';

UPDATE va_applications
SET phone_number='81234568',status='submitted',current_review_id=NULL,
    submission_round=2,application_version=3,
    last_submitted_at='2026-08-03T00:02:00.000Z',updated_at='2026-08-03T00:02:00.000Z'
WHERE id='va_app_resubmit_check' AND current_review_id='review_resubmit_check';

UPDATE va_application_reviews
SET resolved_at='2026-08-03T00:02:00.000Z',resubmitted_at='2026-08-03T00:02:00.000Z',
    idempotency_key='resubmit-check-key',
    request_fingerprint='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
WHERE id='review_resubmit_check';

INSERT INTO application_resubmission_assertion(value)
SELECT CASE
  WHEN status='submitted' AND current_review_id IS NULL
   AND submission_round=2 AND application_version=3
  THEN 1 ELSE 0 END
FROM va_applications WHERE id='va_app_resubmit_check';

INSERT INTO application_resubmission_assertion(value)
SELECT CASE
  WHEN resolved_at IS NOT NULL AND resubmitted_at IS NOT NULL
  THEN 1 ELSE 0 END
FROM va_application_reviews WHERE id='review_resubmit_check';

DELETE FROM va_application_reviews WHERE application_id='va_app_resubmit_check';
DELETE FROM va_applications WHERE id='va_app_resubmit_check';
DROP TABLE application_resubmission_assertion;
