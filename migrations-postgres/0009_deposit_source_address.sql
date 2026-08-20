ALTER TABLE cregis_deposits
  ADD COLUMN IF NOT EXISTS from_address TEXT;

INSERT INTO neobank_schema_migrations (version)
VALUES ('0009_deposit_source_address')
ON CONFLICT (version) DO NOTHING;
