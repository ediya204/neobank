package main

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/ediya204/neobank/server-go/internal/d1"
	"github.com/go-webauthn/webauthn/protocol"
	webauthnlib "github.com/go-webauthn/webauthn/webauthn"
)

const customerWebAuthnChallengeDuration = 5 * time.Minute

type customerPasskeyUser struct {
	CustomerID  string
	Handle      []byte
	Email       string
	DisplayName string
	Credentials []webauthnlib.Credential
}

func (user *customerPasskeyUser) WebAuthnID() []byte          { return user.Handle }
func (user *customerPasskeyUser) WebAuthnName() string        { return user.Email }
func (user *customerPasskeyUser) WebAuthnDisplayName() string { return user.DisplayName }
func (user *customerPasskeyUser) WebAuthnCredentials() []webauthnlib.Credential {
	return user.Credentials
}

type customerWebAuthnEnvelope struct {
	Session     webauthnlib.SessionData `json:"session"`
	DisplayName string                  `json:"display_name,omitempty"`
}

func (app *application) customerWebAuthn() (*webauthnlib.WebAuthn, error) {
	portalOrigin, err := url.Parse(app.portalURL)
	if err != nil || portalOrigin.Hostname() == "" {
		return nil, errors.New("invalid customer portal origin")
	}
	return webauthnlib.New(&webauthnlib.Config{
		RPID:                  portalOrigin.Hostname(),
		RPDisplayName:         "SSC Digital Bank",
		RPOrigins:             []string{app.portalURL},
		AttestationPreference: protocol.PreferNoAttestation,
		AuthenticatorSelection: protocol.AuthenticatorSelection{
			ResidentKey:      protocol.ResidentKeyRequirementRequired,
			UserVerification: protocol.VerificationRequired,
		},
	})
}

func (app *application) encryptCustomerSecurityPayload(purpose string, value any) (string, error) {
	plaintext, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(app.customerTOTPKey)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := randomBytes(gcm.NonceSize())
	aad := []byte(app.tenantID + "\x00customer-security-" + purpose)
	ciphertext := gcm.Seal(nil, nonce, plaintext, aad)
	return base64.RawURLEncoding.EncodeToString(append(nonce, ciphertext...)), nil
}

func (app *application) decryptCustomerSecurityPayload(purpose, encoded string, target any) error {
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return err
	}
	block, err := aes.NewCipher(app.customerTOTPKey)
	if err != nil {
		return err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil || len(raw) < gcm.NonceSize() {
		return errors.New("invalid encrypted security payload")
	}
	aad := []byte(app.tenantID + "\x00customer-security-" + purpose)
	plaintext, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], aad)
	if err != nil {
		return err
	}
	return json.Unmarshal(plaintext, target)
}

func (app *application) loadCustomerPasskeyUser(r *http.Request, customerID string) (*customerPasskeyUser, error) {
	rows, err := app.db.Query(r.Context(), `SELECT c.id, c.email, c.display_name,
	    cc.webauthn_user_handle, p.credential_ciphertext
	  FROM customers c JOIN customer_credentials cc ON cc.customer_id=c.id
	  LEFT JOIN customer_passkeys p ON p.customer_id=c.id
	  WHERE c.id=? AND c.tenant_id=? AND c.status='active' AND c.kyc_status='approved'
	    AND c.operations_status='active'
	  ORDER BY p.created_at`, customerID, app.tenantID)
	if err != nil || len(rows) == 0 {
		return nil, errors.New("passkey user unavailable")
	}
	handle, err := hex.DecodeString(text(rows[0]["webauthn_user_handle"]))
	if err != nil || len(handle) != 32 {
		return nil, errors.New("invalid passkey user handle")
	}
	user := &customerPasskeyUser{
		CustomerID:  customerID,
		Handle:      handle,
		Email:       text(rows[0]["email"]),
		DisplayName: text(rows[0]["display_name"]),
		Credentials: []webauthnlib.Credential{},
	}
	for _, row := range rows {
		ciphertext := text(row["credential_ciphertext"])
		if ciphertext == "" {
			continue
		}
		var credential webauthnlib.Credential
		if err := app.decryptCustomerSecurityPayload("passkey-v1", ciphertext, &credential); err != nil {
			return nil, err
		}
		user.Credentials = append(user.Credentials, credential)
	}
	return user, nil
}

func (app *application) beginCustomerPasskeyRegistration(w http.ResponseWriter, r *http.Request) {
	session, _, err := app.requireCustomerMutation(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "session_expired"}})
		return
	}
	var input struct {
		DisplayName     string `json:"display_name"`
		CurrentPassword string `json:"current_password"`
		TOTPCode        string `json:"totp_code"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	displayName := strings.TrimSpace(input.DisplayName)
	if len(displayName) < 1 || len(displayName) > 80 {
		writeCustomerSecurityError(w, "invalid_passkey_name")
		return
	}
	stepUp, code := app.verifyCustomerSecurityStepUp(r, session, input.CurrentPassword, input.TOTPCode)
	if code != "" {
		writeCustomerSecurityError(w, code)
		return
	}
	handleRows, err := app.db.Query(r.Context(), `SELECT webauthn_user_handle
	  FROM customer_credentials WHERE customer_id=? AND credential_version=?`, session.CustomerID, stepUp.CredentialVersion)
	if err != nil || len(handleRows) != 1 {
		writeCustomerSecurityError(w, "passkey_registration_unavailable")
		return
	}
	handleHex := text(handleRows[0]["webauthn_user_handle"])
	if handleHex == "" {
		handleHex = hex.EncodeToString(randomBytes(32))
	}
	handle, err := hex.DecodeString(handleHex)
	if err != nil || len(handle) != 32 {
		writeCustomerSecurityError(w, "passkey_registration_unavailable")
		return
	}
	user, err := app.loadCustomerPasskeyUser(r, session.CustomerID)
	if err != nil {
		user = &customerPasskeyUser{
			CustomerID:  session.CustomerID,
			Handle:      handle,
			Email:       session.Email,
			DisplayName: session.DisplayName,
			Credentials: []webauthnlib.Credential{},
		}
	}
	webauthn, err := app.customerWebAuthn()
	if err != nil {
		writeCustomerSecurityError(w, "passkey_registration_unavailable")
		return
	}
	creation, sessionData, err := webauthn.BeginRegistration(user,
		webauthnlib.WithResidentKeyRequirement(protocol.ResidentKeyRequirementRequired))
	if err != nil {
		writeCustomerSecurityError(w, "passkey_registration_unavailable")
		return
	}
	encryptedSession, err := app.encryptCustomerSecurityPayload("webauthn-session-v1", customerWebAuthnEnvelope{
		Session: *sessionData, DisplayName: displayName,
	})
	if err != nil {
		writeCustomerSecurityError(w, "passkey_registration_unavailable")
		return
	}
	now := time.Now().UTC()
	nowText := databaseTimestamp(now)
	challengeID := randomID("webauthn")
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: `UPDATE customer_credentials SET webauthn_user_handle=?,
		  totp_last_counter=?, updated_at=? WHERE customer_id=? AND credential_version=?
		  AND totp_last_counter<? AND (webauthn_user_handle IS NULL OR webauthn_user_handle=?)`, Params: []any{
			handleHex, stepUp.TOTPCounter, nowText, session.CustomerID, stepUp.CredentialVersion,
			stepUp.TOTPCounter, handleHex,
		}},
		d1.Statement{SQL: `INSERT INTO customer_webauthn_challenges
		  (id, customer_id, session_id, ceremony, session_ciphertext, expires_at, created_at)
		  VALUES (?, ?, ?, 'registration', ?, ?, ?)`, Params: []any{
			challengeID, session.CustomerID, session.ID, encryptedSession,
			databaseTimestamp(now.Add(customerWebAuthnChallengeDuration)), nowText,
		}},
		d1.Statement{SQL: `INSERT INTO customer_auth_audit_events
		  (id, customer_id, event_type, actor, metadata_json, created_at)
		  VALUES (?, ?, 'auth.passkey_registration_started', ?, '{}', ?)`, Params: []any{
			randomID("audit"), session.CustomerID, session.CustomerID, nowText,
		}},
	)
	if err != nil || len(results) != 3 || resultChanges(results[:1]) != 1 ||
		resultChanges(results[1:2]) != 1 || resultChanges(results[2:]) != 1 {
		writeCustomerSecurityError(w, "passkey_registration_conflict")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"challenge_id": challengeID,
		"options":      creation.Response,
	})
}

func (app *application) finishCustomerPasskeyRegistration(w http.ResponseWriter, r *http.Request) {
	session, _, err := app.requireCustomerMutation(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "session_expired"}})
		return
	}
	var input struct {
		ChallengeID string          `json:"challenge_id"`
		Credential  json.RawMessage `json:"credential"`
	}
	if !decodeJSON(w, r, &input) || input.ChallengeID == "" || len(input.Credential) == 0 {
		validationError(w)
		return
	}
	nowText := databaseTimestamp(time.Now().UTC())
	challengeRows, err := app.db.Query(r.Context(), `SELECT session_ciphertext
	  FROM customer_webauthn_challenges WHERE id=? AND customer_id=? AND session_id=?
	    AND ceremony='registration' AND consumed_at IS NULL AND expires_at>?`,
		input.ChallengeID, session.CustomerID, session.ID, nowText)
	if err != nil || len(challengeRows) != 1 {
		writeCustomerSecurityError(w, "invalid_passkey_challenge")
		return
	}
	var envelope customerWebAuthnEnvelope
	if err := app.decryptCustomerSecurityPayload("webauthn-session-v1", text(challengeRows[0]["session_ciphertext"]), &envelope); err != nil {
		writeCustomerSecurityError(w, "invalid_passkey_challenge")
		return
	}
	user, err := app.loadCustomerPasskeyUser(r, session.CustomerID)
	if err != nil {
		writeCustomerSecurityError(w, "passkey_registration_unavailable")
		return
	}
	webauthn, err := app.customerWebAuthn()
	if err != nil {
		writeCustomerSecurityError(w, "passkey_registration_unavailable")
		return
	}
	credentialRequest := r.Clone(r.Context())
	credentialRequest.Body = http.NoBody
	if len(input.Credential) > 0 {
		credentialRequest.Body = ioNopCloserBytes(input.Credential)
	}
	credentialRequest.Header.Set("Content-Type", "application/json")
	credential, err := webauthn.FinishRegistration(user, envelope.Session, credentialRequest)
	if err != nil {
		writeCustomerSecurityError(w, "passkey_verification_failed")
		return
	}
	credentialID := base64.RawURLEncoding.EncodeToString(credential.ID)
	encryptedCredential, err := app.encryptCustomerSecurityPayload("passkey-v1", credential)
	if err != nil {
		writeCustomerSecurityError(w, "passkey_registration_unavailable")
		return
	}
	alertPayload, _ := json.Marshal(map[string]string{"displayName": session.DisplayName, "securityEvent": "passkey_added"})
	statements := []d1.Statement{
		{SQL: `UPDATE customer_webauthn_challenges SET consumed_at=?
		  WHERE id=? AND customer_id=? AND session_id=? AND consumed_at IS NULL`, Params: []any{
			nowText, input.ChallengeID, session.CustomerID, session.ID,
		}},
		{SQL: `INSERT INTO customer_passkeys
		  (id, customer_id, credential_id, credential_ciphertext, display_name, created_at, updated_at)
		  VALUES (?, ?, ?, ?, ?, ?, ?)`, Params: []any{
			randomID("passkey"), session.CustomerID, credentialID, encryptedCredential,
			envelope.DisplayName, nowText, nowText,
		}},
		{SQL: `INSERT INTO customer_auth_audit_events
		  (id, customer_id, event_type, actor, metadata_json, created_at)
		  VALUES (?, ?, 'auth.passkey_added', ?, '{}', ?)`, Params: []any{
			randomID("audit"), session.CustomerID, session.CustomerID, nowText,
		}},
	}
	if app.emailNotifications {
		statements = append(statements, app.customerEmailOutboxStatement(input.ChallengeID+":passkey-added",
			session.CustomerID, "CUSTOMER_SECURITY_ALERT", session.Email, string(alertPayload)))
	}
	results, err := app.db.Batch(r.Context(), statements...)
	if err != nil || len(results) != len(statements) || resultChanges(results[:1]) != 1 ||
		resultChanges(results[1:2]) != 1 || resultChanges(results[2:3]) != 1 {
		writeCustomerSecurityError(w, "passkey_registration_conflict")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"registered": true})
}

func ioNopCloserBytes(value []byte) *readCloser {
	return &readCloser{Reader: bytes.NewReader(value)}
}

type readCloser struct{ *bytes.Reader }

func (reader *readCloser) Close() error { return nil }

func (app *application) beginCustomerPasskeyLogin(w http.ResponseWriter, r *http.Request) {
	var input map[string]any
	if !decodeJSON(w, r, &input) {
		return
	}
	webauthn, err := app.customerWebAuthn()
	if err != nil {
		writeCustomerSecurityError(w, "passkey_login_unavailable")
		return
	}
	assertion, sessionData, err := webauthn.BeginDiscoverableLogin(
		webauthnlib.WithUserVerification(protocol.VerificationRequired))
	if err != nil {
		writeCustomerSecurityError(w, "passkey_login_unavailable")
		return
	}
	encryptedSession, err := app.encryptCustomerSecurityPayload("webauthn-session-v1", customerWebAuthnEnvelope{Session: *sessionData})
	if err != nil {
		writeCustomerSecurityError(w, "passkey_login_unavailable")
		return
	}
	now := time.Now().UTC()
	challengeID := randomID("webauthn")
	results, err := app.db.Batch(r.Context(), d1.Statement{SQL: `INSERT INTO customer_webauthn_challenges
	  (id, ceremony, session_ciphertext, expires_at, created_at)
	  VALUES (?, 'login', ?, ?, ?)`, Params: []any{
		challengeID, encryptedSession, databaseTimestamp(now.Add(customerWebAuthnChallengeDuration)), databaseTimestamp(now),
	}})
	if err != nil || len(results) != 1 || resultChanges(results) != 1 {
		writeCustomerSecurityError(w, "passkey_login_unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"challenge_id": challengeID, "options": assertion.Response})
}

func (app *application) finishCustomerPasskeyLogin(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ChallengeID string          `json:"challenge_id"`
		Credential  json.RawMessage `json:"credential"`
	}
	if !decodeJSON(w, r, &input) || input.ChallengeID == "" || len(input.Credential) == 0 {
		validationError(w)
		return
	}
	now := time.Now().UTC()
	nowText := databaseTimestamp(now)
	challengeRows, err := app.db.Query(r.Context(), `SELECT session_ciphertext
	  FROM customer_webauthn_challenges WHERE id=? AND ceremony='login'
	    AND consumed_at IS NULL AND expires_at>?`, input.ChallengeID, nowText)
	if err != nil || len(challengeRows) != 1 {
		writeCustomerSecurityError(w, "invalid_passkey_challenge")
		return
	}
	var envelope customerWebAuthnEnvelope
	if err := app.decryptCustomerSecurityPayload("webauthn-session-v1", text(challengeRows[0]["session_ciphertext"]), &envelope); err != nil {
		writeCustomerSecurityError(w, "invalid_passkey_challenge")
		return
	}
	webauthn, err := app.customerWebAuthn()
	if err != nil {
		writeCustomerSecurityError(w, "passkey_login_unavailable")
		return
	}
	credentialRequest := r.Clone(r.Context())
	credentialRequest.Body = ioNopCloserBytes(input.Credential)
	credentialRequest.Header.Set("Content-Type", "application/json")
	var resolvedUser *customerPasskeyUser
	handler := func(rawID, userHandle []byte) (webauthnlib.User, error) {
		credentialID := base64.RawURLEncoding.EncodeToString(rawID)
		handleHex := hex.EncodeToString(userHandle)
		rows, queryErr := app.db.Query(r.Context(), `SELECT c.id
		  FROM customer_passkeys p JOIN customers c ON c.id=p.customer_id
		  JOIN customer_credentials cc ON cc.customer_id=c.id
		  WHERE p.credential_id=? AND cc.webauthn_user_handle=? AND c.tenant_id=?
		    AND c.status='active' AND c.kyc_status='approved' AND c.operations_status='active'`,
			credentialID, handleHex, app.tenantID)
		if queryErr != nil || len(rows) != 1 {
			return nil, errors.New("passkey user not found")
		}
		resolvedUser, queryErr = app.loadCustomerPasskeyUser(r, text(rows[0]["id"]))
		if queryErr != nil {
			return nil, queryErr
		}
		return resolvedUser, nil
	}
	user, credential, err := webauthn.FinishPasskeyLogin(handler, envelope.Session, credentialRequest)
	if err != nil || resolvedUser == nil || user.WebAuthnName() != resolvedUser.Email {
		writeCustomerSecurityError(w, "passkey_verification_failed")
		return
	}
	encryptedCredential, err := app.encryptCustomerSecurityPayload("passkey-v1", credential)
	if err != nil {
		writeCustomerSecurityError(w, "passkey_login_unavailable")
		return
	}
	credentialID := base64.RawURLEncoding.EncodeToString(credential.ID)
	credentialRows, err := app.db.Query(r.Context(), `SELECT credential_version
	  FROM customer_credentials WHERE customer_id=?`, resolvedUser.CustomerID)
	if err != nil || len(credentialRows) != 1 {
		writeCustomerSecurityError(w, "passkey_login_unavailable")
		return
	}
	credentialVersion := integer(credentialRows[0]["credential_version"])
	sessionID, sessionToken, csrfToken, sessionStatement := newCustomerSession(r, resolvedUser.CustomerID, credentialVersion, now)
	statements := []d1.Statement{
		{SQL: `UPDATE customer_webauthn_challenges SET consumed_at=?
		  WHERE id=? AND ceremony='login' AND consumed_at IS NULL`, Params: []any{nowText, input.ChallengeID}},
		{SQL: `UPDATE customer_passkeys SET credential_ciphertext=?, last_used_at=?, updated_at=?
		  WHERE customer_id=? AND credential_id=?`, Params: []any{
			encryptedCredential, nowText, nowText, resolvedUser.CustomerID, credentialID,
		}},
		sessionStatement,
		{SQL: `INSERT INTO customer_auth_audit_events
		  (id, customer_id, event_type, actor, metadata_json, created_at)
		  SELECT ?, ?, 'auth.passkey_login_succeeded', ?, ?, ?
		  WHERE EXISTS (SELECT 1 FROM customer_sessions WHERE id=? AND customer_id=?)`, Params: []any{
			randomID("audit"), resolvedUser.CustomerID, resolvedUser.CustomerID,
			mustJSON(map[string]string{"session_id": sessionID}), nowText, sessionID, resolvedUser.CustomerID,
		}},
	}
	results, err := app.db.Batch(r.Context(), statements...)
	if err != nil || len(results) != 4 || resultChanges(results[:1]) != 1 ||
		resultChanges(results[1:2]) != 1 || resultChanges(results[2:3]) != 1 || resultChanges(results[3:]) != 1 {
		writeCustomerSecurityError(w, "passkey_login_conflict")
		return
	}
	app.setCustomerSessionCookies(w, sessionToken, csrfToken, now.Add(customerSessionDuration))
	writeJSON(w, http.StatusOK, map[string]any{
		"next_step": "authenticated", "csrf_token": csrfToken,
		"user": map[string]any{
			"id": resolvedUser.CustomerID, "email": resolvedUser.Email,
			"display_name": resolvedUser.DisplayName, "role": "customer", "totp_enabled": true,
			"permissions": []string{"customers.read", "balances.read", "transactions.read"},
		},
	})
}

func (app *application) removeCustomerPasskey(w http.ResponseWriter, r *http.Request, passkeyID string) {
	session, _, err := app.requireCustomerMutation(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "session_expired"}})
		return
	}
	var input struct {
		CurrentPassword string `json:"current_password"`
		TOTPCode        string `json:"totp_code"`
	}
	if !decodeJSON(w, r, &input) || passkeyID == "" {
		validationError(w)
		return
	}
	stepUp, code := app.verifyCustomerSecurityStepUp(r, session, input.CurrentPassword, input.TOTPCode)
	if code != "" {
		writeCustomerSecurityError(w, code)
		return
	}
	nowText := databaseTimestamp(time.Now().UTC())
	alertPayload, _ := json.Marshal(map[string]string{"displayName": session.DisplayName, "securityEvent": "passkey_removed"})
	statements := []d1.Statement{
		{SQL: `UPDATE customer_credentials SET totp_last_counter=?, updated_at=?
		  WHERE customer_id=? AND credential_version=? AND totp_last_counter<?`, Params: []any{
			stepUp.TOTPCounter, nowText, session.CustomerID, stepUp.CredentialVersion, stepUp.TOTPCounter,
		}},
		{SQL: `DELETE FROM customer_passkeys WHERE id=? AND customer_id=?`, Params: []any{passkeyID, session.CustomerID}},
		{SQL: `INSERT INTO customer_auth_audit_events
		  (id, customer_id, event_type, actor, metadata_json, created_at)
		  VALUES (?, ?, 'auth.passkey_removed', ?, '{}', ?)`, Params: []any{
			randomID("audit"), session.CustomerID, session.CustomerID, nowText,
		}},
	}
	if app.emailNotifications {
		statements = append(statements, app.customerEmailOutboxStatement(passkeyID+":removed", session.CustomerID,
			"CUSTOMER_SECURITY_ALERT", session.Email, string(alertPayload)))
	}
	results, err := app.db.Batch(r.Context(), statements...)
	if err != nil || len(results) != len(statements) || resultChanges(results[:1]) != 1 ||
		resultChanges(results[1:2]) != 1 || resultChanges(results[2:3]) != 1 {
		writeCustomerSecurityError(w, "passkey_remove_conflict")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"removed": true})
}
