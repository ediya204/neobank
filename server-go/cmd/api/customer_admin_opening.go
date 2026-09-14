package main

import (
	"encoding/hex"
	"net/http"
	"time"
)

// The approved value is the existing account-access gate; the source and audit
// event distinguish an explicit Admin exemption from an actual KYC review.
const adminOpeningSource = "admin_direct_opening"

const adminOpeningSQL = `WITH customer AS (
  INSERT INTO customers (id, tenant_id, email, display_name, status, kyc_status,
    operations_status, created_by, activated_by, activated_at, created_at, updated_at)
  VALUES ($1,$2,$3,$4,'active','approved','active','admin_direct_opening',$5,$6,$6,$6)
  RETURNING id
), credential AS (
  INSERT INTO customer_credentials (customer_id,password_salt,password_hash,password_algorithm,
    password_iterations,password_memory_kib,password_time_cost,password_parallelism,
    password_changed_at,credential_version,updated_at)
  SELECT id,$7,$8,$9,0,$10,$11,$12,$6,1,$6 FROM customer RETURNING customer_id
), application AS (
  INSERT INTO customer_applications (id,tenant_id,customer_id,application_reference,
    idempotency_key,request_fingerprint,account_type,phone_country_code,phone,residence_country,
    full_name,date_of_birth,nationality,legal_name,registration_number,incorporation_country,
    contact_name,contact_role,beneficial_owner_name,beneficial_owner_ownership,
    kyc_consent_at,terms_accepted_at,submitted_at,updated_at)
  SELECT $13,$2,id,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
    '', '', $6,$6 FROM customer RETURNING customer_id
), audit AS (
  INSERT INTO customer_auth_audit_events (id,customer_id,event_type,actor,metadata_json,created_at)
  SELECT $31,id,'customer.admin_opened',$5,
    '{"source":"admin_direct_opening","kyc":"exempt","password_set":true}',$6
  FROM customer RETURNING customer_id
) SELECT customer.id FROM customer JOIN credential ON credential.customer_id=customer.id
  JOIN application ON application.customer_id=customer.id JOIN audit ON audit.customer_id=customer.id`

func normalizeAdminOpening(input *customerRegistrationInput) bool {
	// Reuse profile/password validation without asserting customer consent.
	input.KYCConsent, input.TermsAccepted = true, true
	valid := normalizeRegistrationInput(input)
	input.KYCConsent, input.TermsAccepted = false, false
	return valid
}

func (app *application) openAdminCustomer(w http.ResponseWriter, r *http.Request) {
	var input customerRegistrationInput
	if !decodeJSON(w, r, &input) {
		return
	}
	key := r.Header.Get("Idempotency-Key")
	if !customerIdempotencyPattern.MatchString(key) || !normalizeAdminOpening(&input) {
		validationError(w)
		return
	}
	fingerprint := app.registrationFingerprint(input)
	rows, err := app.db.Query(r.Context(), `SELECT ca.customer_id, ca.request_fingerprint,
      c.status, c.kyc_status, c.operations_status, c.created_by
      FROM customer_applications ca JOIN customers c ON c.id=ca.customer_id AND c.tenant_id=ca.tenant_id
      WHERE ca.tenant_id=? AND ca.idempotency_key=? AND c.created_by='admin_direct_opening'`, app.tenantID, key)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(rows) > 0 {
		if text(rows[0]["request_fingerprint"]) != fingerprint {
			conflict(w, "idempotency_key_conflict")
			return
		}
		if customerLoginStateCode(rows[0]) != "" {
			conflict(w, "customer_account_not_available")
			return
		}
		app.finishAdminOpening(w, r, text(rows[0]["customer_id"]))
		return
	}
	id := randomID("customer")
	now := databaseTimestamp(time.Now().UTC())
	salt := randomBytes(16)
	hash := app.deriveCustomerArgon2id(input.Password, salt)
	name := input.FullName
	if input.AccountType == "business" {
		name = input.LegalName
	}
	rows, err = app.db.Query(r.Context(), adminOpeningSQL, id, app.tenantID, input.Email, name,
		edgeUser(r), now, hex.EncodeToString(salt), hex.EncodeToString(hash), customerPasswordAlgorithm,
		customerArgonMemoryKiB, customerArgonTimeCost, customerArgonParallelism,
		randomID("application"), randomID("ADM"), key, fingerprint, input.AccountType,
		input.PhoneCountryCode, input.Phone, input.ResidenceCountry,
		nullIfEmpty(input.FullName), nullIfEmpty(input.DateOfBirth), nullIfEmpty(input.Nationality),
		nullIfEmpty(input.LegalName), nullIfEmpty(input.RegistrationNumber), nullIfEmpty(input.IncorporationCountry),
		nullIfEmpty(input.ContactName), nullIfEmpty(input.ContactRole), nullIfEmpty(input.BeneficialOwnerName),
		nullIfEmpty(input.BeneficialOwnerOwnership), randomID("audit"))
	if err != nil {
		if isExistingCustomerEmailViolation(err) {
			conflict(w, "customer_already_exists")
			return
		}
		databaseError(app, w, err)
		return
	}
	if len(rows) != 1 || text(rows[0]["id"]) != id {
		databaseError(app, w, errCustomerStateRead)
		return
	}
	app.finishAdminOpening(w, r, id)
}

func (app *application) finishAdminOpening(w http.ResponseWriter, r *http.Request, id string) {
	wallet, _, provisionErr := app.provisionCregisWallet(r.Context(), id,
		automaticWalletAlias(id), automaticWalletIdempotency(id), edgeUser(r))
	extra := map[string]any{"login_ready": true, "opening_source": adminOpeningSource}
	if provisionErr != nil {
		extra["wallet_provisioning"] = walletProvisioningRetryMetadata(provisionErr)
	} else {
		extra["wallet"] = wallet
	}
	app.writeAdminCustomer(w, r, id, extra)
}
