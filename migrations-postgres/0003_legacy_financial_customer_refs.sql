BEGIN;

-- D1 never enforced customer foreign keys on the legacy financial tables.
-- Preserve those historical rows without inventing authentication customers;
-- application/auth tables retain their strict customer foreign keys.
ALTER TABLE cregis_wallets
  DROP CONSTRAINT IF EXISTS cregis_wallets_customer_id_fkey;
ALTER TABLE cregis_withdrawals
  DROP CONSTRAINT IF EXISTS cregis_withdrawals_customer_id_fkey;

INSERT INTO neobank_schema_migrations (version)
VALUES ('0003_legacy_financial_customer_refs')
ON CONFLICT (version) DO NOTHING;

COMMIT;
