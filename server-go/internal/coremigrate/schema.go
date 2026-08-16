package coremigrate

import (
	"context"
	"errors"
	"fmt"

	"github.com/ediya204/neobank/server-go/internal/d1"
)

const customerApplicationsMigration = "0002_customer_applications"
const legacyFinancialCustomerRefsMigration = "0003_legacy_financial_customer_refs"

const createCustomerApplicationsTableSQL = `CREATE TABLE IF NOT EXISTS customer_applications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  application_reference TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('individual', 'business')),
  phone_country_code TEXT NOT NULL,
  phone TEXT NOT NULL,
  residence_country TEXT NOT NULL,
  full_name TEXT,
  date_of_birth TEXT,
  nationality TEXT,
  legal_name TEXT,
  registration_number TEXT,
  incorporation_country TEXT,
  contact_name TEXT,
  contact_role TEXT,
  beneficial_owner_name TEXT,
  beneficial_owner_ownership TEXT,
  kyc_consent_at TEXT NOT NULL,
  terms_accepted_at TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, customer_id),
  UNIQUE (tenant_id, application_reference),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (
    (account_type = 'individual' AND full_name IS NOT NULL AND date_of_birth IS NOT NULL
      AND nationality IS NOT NULL AND legal_name IS NULL)
    OR
    (account_type = 'business' AND legal_name IS NOT NULL AND registration_number IS NOT NULL
      AND incorporation_country IS NOT NULL AND contact_name IS NOT NULL
      AND contact_role IS NOT NULL AND beneficial_owner_name IS NOT NULL
      AND beneficial_owner_ownership IS NOT NULL AND full_name IS NULL)
  )
)`

const createCustomerApplicationsIndexSQL = `CREATE INDEX IF NOT EXISTS idx_customer_applications_submitted
  ON customer_applications (tenant_id, submitted_at DESC)`

func ensureTargetSchema(ctx context.Context, target Database) error {
	version, err := target.Query(ctx,
		`SELECT version FROM neobank_schema_migrations WHERE version=?`,
		customerApplicationsMigration,
	)
	if err != nil {
		return fmt.Errorf("read target schema migration %s: %w", customerApplicationsMigration, err)
	}
	if len(version) == 1 {
		return nil
	}
	if len(version) != 0 {
		return errors.New("target schema migration lookup returned duplicate rows")
	}

	for _, table := range tables {
		if table.Name == "customer_applications" {
			continue
		}
		rows, countErr := target.Query(ctx, fmt.Sprintf("SELECT COUNT(*) AS count FROM %s", table.Name))
		if countErr != nil || len(rows) != 1 || integer(rows[0]["count"]) != 0 {
			return fmt.Errorf("target must be empty before applying %s", customerApplicationsMigration)
		}
	}

	if _, err := target.Batch(ctx,
		d1.Statement{SQL: createCustomerApplicationsTableSQL},
		d1.Statement{SQL: createCustomerApplicationsIndexSQL},
		d1.Statement{
			SQL:    `INSERT INTO neobank_schema_migrations (version) VALUES (?) ON CONFLICT (version) DO NOTHING`,
			Params: []any{customerApplicationsMigration},
		},
	); err != nil {
		return fmt.Errorf("apply target schema migration %s: %w", customerApplicationsMigration, err)
	}

	version, err = target.Query(ctx,
		`SELECT version FROM neobank_schema_migrations WHERE version=?`,
		customerApplicationsMigration,
	)
	if err != nil || len(version) != 1 {
		return fmt.Errorf("verify target schema migration %s", customerApplicationsMigration)
	}
	return nil
}

func ensureLegacyFinancialCustomerRefs(ctx context.Context, target Database) error {
	version, err := target.Query(ctx,
		`SELECT version FROM neobank_schema_migrations WHERE version=?`,
		legacyFinancialCustomerRefsMigration,
	)
	if err != nil {
		return fmt.Errorf("read target schema migration %s: %w", legacyFinancialCustomerRefsMigration, err)
	}
	if len(version) == 1 {
		return nil
	}
	if len(version) != 0 {
		return errors.New("target schema migration lookup returned duplicate rows")
	}

	for _, table := range tables {
		rows, countErr := target.Query(ctx, fmt.Sprintf("SELECT COUNT(*) AS count FROM %s", table.Name))
		if countErr != nil || len(rows) != 1 || integer(rows[0]["count"]) != 0 {
			return fmt.Errorf("target must be empty before applying %s", legacyFinancialCustomerRefsMigration)
		}
	}

	if _, err := target.Batch(ctx,
		d1.Statement{SQL: `ALTER TABLE cregis_wallets DROP CONSTRAINT IF EXISTS cregis_wallets_customer_id_fkey`},
		d1.Statement{SQL: `ALTER TABLE cregis_withdrawals DROP CONSTRAINT IF EXISTS cregis_withdrawals_customer_id_fkey`},
		d1.Statement{
			SQL:    `INSERT INTO neobank_schema_migrations (version) VALUES (?) ON CONFLICT (version) DO NOTHING`,
			Params: []any{legacyFinancialCustomerRefsMigration},
		},
	); err != nil {
		return fmt.Errorf("apply target schema migration %s: %w", legacyFinancialCustomerRefsMigration, err)
	}

	version, err = target.Query(ctx,
		`SELECT version FROM neobank_schema_migrations WHERE version=?`,
		legacyFinancialCustomerRefsMigration,
	)
	if err != nil || len(version) != 1 {
		return fmt.Errorf("verify target schema migration %s", legacyFinancialCustomerRefsMigration)
	}
	return nil
}
