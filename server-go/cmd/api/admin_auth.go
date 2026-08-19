package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/ediya204/neobank/server-go/internal/d1"
	"golang.org/x/crypto/argon2"
)

const (
	adminSessionCookie       = "__Host-neobank_admin"
	adminCSRFCookie          = "__Host-neobank_admin_csrf"
	adminSessionDuration     = 12 * time.Hour
	adminSessionIdleDuration = time.Hour
	sessionTouchInterval     = 30 * time.Second
	adminChallengeDuration   = 5 * time.Minute
	adminEnrollmentDuration  = 10 * time.Minute
	adminSetupDuration       = 30 * time.Minute
	adminLockDuration        = 15 * time.Minute
	adminMaxAttempts         = 8
)

type adminSession struct {
	ID                string
	UserID            string
	Email             string
	DisplayName       string
	CSRFHash          string
	CredentialVersion int64
	ExpiresAt         time.Time
}

func (app *application) routeAdminAuth(w http.ResponseWriter, r *http.Request) bool {
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/api/auth/setup-token":
		app.createAdminSetupToken(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/api/auth/admin/setup/complete":
		app.completeAdminSetup(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/api/auth/admin/totp/setup":
		app.adminTOTPSetup(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/api/auth/admin/login":
		app.adminLogin(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/api/auth/admin/totp/verify":
		app.verifyAdminTOTP(w, r)
	case r.Method == http.MethodGet && r.URL.Path == "/api/auth/me" && app.hasAdminCookie(r):
		app.adminSessionInfo(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/api/auth/logout" && app.hasAdminCookie(r):
		app.adminLogout(w, r)
	default:
		return false
	}
	return true
}

func (app *application) createAdminSetupToken(w http.ResponseWriter, r *http.Request) {
	bearer := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if bearer == r.Header.Get("Authorization") || subtle.ConstantTimeCompare([]byte(bearer), app.adminBootstrapSecret) != 1 {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "invalid_bootstrap_secret"}})
		return
	}
	var input struct {
		Email       string `json:"email"`
		DisplayName string `json:"display_name"`
		Purpose     string `json:"purpose"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	email := normalizeCustomerEmail(input.Email)
	displayName := strings.TrimSpace(input.DisplayName)
	if displayName == "" && email != "" {
		displayName = strings.Split(email, "@")[0]
	}
	if email == "" || displayName == "" || len(displayName) > 100 || (input.Purpose != "" && input.Purpose != "initial_setup" && input.Purpose != "credential_reset") {
		validationError(w)
		return
	}
	now := time.Now().UTC()
	nowText := databaseTimestamp(now)
	rows, err := app.db.Query(r.Context(), `SELECT id, setup_completed_at FROM admin_users WHERE LOWER(email)=?`, email)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	userID := randomID("admin")
	if len(rows) == 1 {
		userID = text(rows[0]["id"])
		if input.Purpose != "credential_reset" && text(rows[0]["setup_completed_at"]) != "" {
			conflict(w, "setup_already_completed")
			return
		}
	}
	token := randomToken(32)
	statements := []d1.Statement{}
	if len(rows) == 0 {
		statements = append(statements, d1.Statement{SQL: `INSERT INTO admin_users
		  (id, email, display_name, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)`, Params: []any{userID, email, displayName, nowText, nowText}})
	}
	statements = append(statements,
		d1.Statement{SQL: `UPDATE admin_setup_tokens SET used_at=? WHERE user_id=? AND used_at IS NULL`, Params: []any{nowText, userID}},
		d1.Statement{SQL: `INSERT INTO admin_setup_tokens (id, user_id, token_hash, expires_at, created_at)
		  VALUES (?, ?, ?, ?, ?)`, Params: []any{randomID("setup"), userID, tokenHash(token), databaseTimestamp(now.Add(adminSetupDuration)), nowText}},
		d1.Statement{SQL: `INSERT INTO admin_auth_audit_events
		  (id, user_id, event_type, actor, metadata_json, created_at) VALUES (?, ?, 'auth.setup_token_issued', ?, '{}', ?)`, Params: []any{randomID("audit"), userID, email, nowText}},
	)
	results, err := app.db.Batch(r.Context(), statements...)
	if err != nil || len(results) != len(statements) {
		databaseError(app, w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"setup_token": token, "email": email, "expires_at": databaseTimestamp(now.Add(adminSetupDuration))})
}

func (app *application) completeAdminSetup(w http.ResponseWriter, r *http.Request) {
	var input struct {
		SetupToken string `json:"setup_token"`
		Password   string `json:"password"`
	}
	if !decodeJSON(w, r, &input) || len(input.SetupToken) < 32 || !validCustomerPassword(input.Password) {
		validationError(w)
		return
	}
	now := time.Now().UTC()
	rows, err := app.db.Query(r.Context(), `SELECT u.id, u.email, u.display_name, u.credential_version, t.id AS setup_id
	  FROM admin_setup_tokens t JOIN admin_users u ON u.id=t.user_id
	  WHERE t.token_hash=? AND t.used_at IS NULL AND t.expires_at>? AND u.status='active'`, tokenHash(input.SetupToken), databaseTimestamp(now))
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(rows) != 1 {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "setup_token_invalid"}})
		return
	}
	userID := text(rows[0]["id"])
	salt := randomBytes(16)
	hash := app.deriveAdminPassword(input.Password, salt)
	secret := randomTOTPSecret()
	encrypted, err := app.encryptAdminTOTP(secret)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	enrollmentToken := randomToken(32)
	nowText := databaseTimestamp(now)
	newVersion := integer(rows[0]["credential_version"]) + 1
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: `UPDATE admin_setup_tokens SET used_at=? WHERE id=? AND used_at IS NULL`, Params: []any{nowText, text(rows[0]["setup_id"])}},
		d1.Statement{SQL: `UPDATE admin_users SET password_salt=?, password_hash=?, totp_secret_ciphertext=?,
		  totp_enabled=FALSE, totp_last_counter=-1, enrollment_token_hash=?, enrollment_expires_at=?,
		  credential_version=?, failed_attempts=0, locked_until=NULL, password_changed_at=?, updated_at=?
		  WHERE id=? AND status='active'`, Params: []any{hex.EncodeToString(salt), hex.EncodeToString(hash), encrypted,
			tokenHash(enrollmentToken), databaseTimestamp(now.Add(adminEnrollmentDuration)), newVersion, nowText, nowText, userID}},
		d1.Statement{SQL: `UPDATE admin_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL`, Params: []any{nowText, userID}},
		d1.Statement{SQL: `INSERT INTO admin_auth_audit_events
		  (id, user_id, event_type, actor, metadata_json, created_at) VALUES (?, ?, 'auth.password_enrolled', ?, '{}', ?)`, Params: []any{randomID("audit"), userID, text(rows[0]["email"]), nowText}},
	)
	if err != nil || len(results) != 4 || resultChanges(results[:1]) != 1 || resultChanges(results[1:2]) != 1 {
		conflict(w, "setup_state_changed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"next_step": "totp_setup_required", "enrollment_token": enrollmentToken})
}

func (app *application) adminTOTPSetup(w http.ResponseWriter, r *http.Request) {
	var input struct {
		EnrollmentToken string `json:"enrollment_token"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	rows, err := app.db.Query(r.Context(), `SELECT email, totp_secret_ciphertext FROM admin_users
	  WHERE enrollment_token_hash=? AND enrollment_expires_at>? AND status='active' AND totp_enabled=FALSE`, tokenHash(input.EnrollmentToken), databaseTimestamp(time.Now()))
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(rows) != 1 {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "invalid_enrollment_token"}})
		return
	}
	secret, err := app.decryptAdminTOTP(text(rows[0]["totp_secret_ciphertext"]))
	if err != nil {
		databaseError(app, w, err)
		return
	}
	email := text(rows[0]["email"])
	issuer := "SSC Digital Bank Admin"
	otpauth := "otpauth://totp/" + url.PathEscape(issuer+":"+email) + "?secret=" + url.QueryEscape(secret) + "&issuer=" + url.QueryEscape(issuer) + "&algorithm=SHA1&digits=6&period=30"
	writeJSON(w, http.StatusOK, map[string]any{"secret": secret, "otpauth_uri": otpauth, "issuer": issuer, "account_name": email, "enrollment_token": input.EnrollmentToken})
}

func (app *application) adminLogin(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	email := normalizeCustomerEmail(input.Email)
	rows, err := app.db.Query(r.Context(), `SELECT id, email, display_name, password_salt, password_hash,
	  credential_version, failed_attempts, locked_until, totp_enabled FROM admin_users WHERE LOWER(email)=? AND status='active'`, email)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	now := time.Now().UTC()
	valid := false
	userID := ""
	failed := int64(0)
	if len(rows) == 1 {
		userID = text(rows[0]["id"])
		failed = integer(rows[0]["failed_attempts"])
		locked, _ := time.Parse(time.RFC3339Nano, text(rows[0]["locked_until"]))
		if (locked.IsZero() || !locked.After(now)) && text(rows[0]["totp_enabled"]) == "true" {
			valid = app.verifyAdminPassword(input.Password, rows[0])
		}
	}
	if !valid {
		_ = app.deriveAdminPassword(input.Password, make([]byte, 16))
		if userID != "" {
			failed++
			lockedUntil := any(nil)
			if failed >= 5 {
				lockedUntil = databaseTimestamp(now.Add(adminLockDuration))
			}
			_, _ = app.db.Batch(r.Context(), d1.Statement{SQL: `UPDATE admin_users SET failed_attempts=?, locked_until=?, updated_at=? WHERE id=?`, Params: []any{failed, lockedUntil, databaseTimestamp(now), userID}})
		}
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "invalid_email_or_password"}})
		return
	}
	challenge := randomToken(32)
	nowText := databaseTimestamp(now)
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: `UPDATE admin_users SET failed_attempts=0, locked_until=NULL, updated_at=? WHERE id=?`, Params: []any{nowText, userID}},
		d1.Statement{SQL: `INSERT INTO admin_login_challenges
		  (id, user_id, token_hash, expires_at, credential_version, created_at) VALUES (?, ?, ?, ?, ?, ?)`, Params: []any{
			randomID("challenge"), userID, tokenHash(challenge), databaseTimestamp(now.Add(adminChallengeDuration)), integer(rows[0]["credential_version"]), nowText}},
	)
	if err != nil || len(results) != 2 || resultChanges(results[0:1]) != 1 || resultChanges(results[1:2]) != 1 {
		conflict(w, "authentication_state_changed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"next_step": "totp_required", "challenge_id": challenge})
}

func (app *application) verifyAdminTOTP(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Code            string `json:"code"`
		RecoveryCode    string `json:"recovery_code"`
		ChallengeID     string `json:"challenge_id"`
		EnrollmentToken string `json:"enrollment_token"`
	}
	if !decodeJSON(w, r, &input) || input.Code == "" || input.RecoveryCode != "" || (input.ChallengeID == "") == (input.EnrollmentToken == "") {
		validationError(w)
		return
	}
	now := time.Now().UTC()
	nowText := databaseTimestamp(now)
	enrollment := input.EnrollmentToken != ""
	var rows []map[string]any
	var err error
	if enrollment {
		rows, err = app.db.Query(r.Context(), `SELECT id, email, display_name, totp_secret_ciphertext, totp_last_counter, credential_version
		  FROM admin_users WHERE enrollment_token_hash=? AND enrollment_expires_at>? AND status='active' AND totp_enabled=FALSE`, tokenHash(input.EnrollmentToken), nowText)
	} else {
		results, batchErr := app.db.Batch(r.Context(),
			d1.Statement{SQL: `UPDATE admin_login_challenges SET attempts=attempts+1 WHERE token_hash=? AND consumed_at IS NULL AND expires_at>? AND attempts<?`, Params: []any{tokenHash(input.ChallengeID), nowText, adminMaxAttempts}},
			d1.Statement{SQL: `SELECT u.id, u.email, u.display_name, u.totp_secret_ciphertext, u.totp_last_counter,
			  u.credential_version, c.id AS challenge_row_id FROM admin_login_challenges c JOIN admin_users u ON u.id=c.user_id
			  WHERE c.token_hash=? AND c.consumed_at IS NULL AND c.expires_at>? AND c.attempts BETWEEN 1 AND ?
			    AND c.credential_version=u.credential_version AND u.status='active' AND u.totp_enabled=TRUE`, Params: []any{tokenHash(input.ChallengeID), nowText, adminMaxAttempts}},
		)
		if batchErr == nil && len(results) == 2 && resultChanges(results[:1]) == 1 {
			rows = results[1].Results
		} else {
			err = batchErr
		}
	}
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(rows) != 1 {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "invalid_challenge"}})
		return
	}
	secret, err := app.decryptAdminTOTP(text(rows[0]["totp_secret_ciphertext"]))
	counter, valid := verifyTOTPCode(secret, input.Code, now, integer(rows[0]["totp_last_counter"]))
	if err != nil || !valid {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "invalid_totp_code"}})
		return
	}
	userID := text(rows[0]["id"])
	credentialVersion := integer(rows[0]["credential_version"])
	sessionID, sessionToken, csrfToken, sessionStatement := newAdminSession(userID, credentialVersion, now)
	statements := []d1.Statement{}
	if enrollment {
		statements = append(statements, d1.Statement{SQL: `UPDATE admin_users SET totp_enabled=TRUE, totp_last_counter=?,
		  enrollment_token_hash=NULL, enrollment_expires_at=NULL, setup_completed_at=?, last_login_at=?, updated_at=?
		  WHERE id=? AND enrollment_token_hash=? AND totp_last_counter<?`, Params: []any{counter, nowText, nowText, nowText, userID, tokenHash(input.EnrollmentToken), counter}})
	} else {
		statements = append(statements,
			d1.Statement{SQL: `UPDATE admin_login_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL`, Params: []any{nowText, text(rows[0]["challenge_row_id"])}},
			d1.Statement{SQL: `UPDATE admin_users SET totp_last_counter=?, last_login_at=?, updated_at=? WHERE id=? AND totp_last_counter<?`, Params: []any{counter, nowText, nowText, userID, counter}},
		)
	}
	statements = append(statements, sessionStatement, d1.Statement{SQL: `INSERT INTO admin_auth_audit_events
	  (id, user_id, event_type, actor, metadata_json, created_at) VALUES (?, ?, 'auth.login_succeeded', ?, ?, ?)`, Params: []any{
		randomID("audit"), userID, text(rows[0]["email"]), mustJSON(map[string]string{"session_id": sessionID}), nowText}})
	results, err := app.db.Batch(r.Context(), statements...)
	if err != nil || len(results) != len(statements) {
		conflict(w, "authentication_state_changed")
		return
	}
	for index := range results {
		if resultChanges(results[index:index+1]) != 1 {
			conflict(w, "authentication_state_changed")
			return
		}
	}
	app.setAdminCookies(w, sessionToken, csrfToken, now.Add(adminSessionDuration))
	writeJSON(w, http.StatusOK, map[string]any{"next_step": "authenticated", "csrf_token": csrfToken, "user": adminUser(rows[0])})
}

func (app *application) adminSessionInfo(w http.ResponseWriter, r *http.Request) {
	session, csrf, err := app.loadAdminSession(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "session_expired"}})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"csrf_token": csrf, "user": map[string]any{
		"id": session.UserID, "email": session.Email, "display_name": session.DisplayName, "role": "admin", "permissions": []string{},
	}})
}

func (app *application) adminLogout(w http.ResponseWriter, r *http.Request) {
	session, err := app.requireAdminMutation(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": map[string]string{"code": "session_expired"}})
		return
	}
	now := databaseTimestamp(time.Now())
	_, err = app.db.Batch(r.Context(), d1.Statement{SQL: `UPDATE admin_sessions SET revoked_at=?, last_seen_at=? WHERE id=? AND revoked_at IS NULL`, Params: []any{now, now, session.ID}})
	if err != nil {
		databaseError(app, w, err)
		return
	}
	app.clearAdminCookies(w)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (app *application) requireAdminRequest(r *http.Request) (*adminSession, error) {
	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		session, _, err := app.loadAdminSession(r)
		return session, err
	}
	return app.requireAdminMutation(r)
}

func (app *application) requireAdminMutation(r *http.Request) (*adminSession, error) {
	session, _, err := app.loadAdminSession(r)
	if err != nil {
		return nil, err
	}
	csrf := strings.TrimSpace(r.Header.Get("X-CSRF-Token"))
	if csrf == "" || subtle.ConstantTimeCompare([]byte(tokenHash(csrf)), []byte(session.CSRFHash)) != 1 {
		return nil, errors.New("csrf mismatch")
	}
	if !app.validAdminOrigin(r.Header.Get("Origin")) {
		return nil, errors.New("origin mismatch")
	}
	return session, nil
}

func (app *application) loadAdminSession(r *http.Request) (*adminSession, string, error) {
	cookie, err := r.Cookie(app.adminCookieName())
	if err != nil || len(cookie.Value) < 32 {
		return nil, "", errors.New("session cookie missing")
	}
	now := time.Now().UTC()
	rows, err := app.db.Query(r.Context(), `SELECT s.id, s.user_id, s.csrf_hash, s.credential_version, s.expires_at, s.last_seen_at,
	  u.email, u.display_name, u.credential_version AS current_credential_version
	  FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id
	  WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND s.idle_expires_at>?
	    AND u.status='active' AND u.totp_enabled=TRUE`, tokenHash(cookie.Value), databaseTimestamp(now), databaseTimestamp(now))
	if err != nil || len(rows) != 1 || integer(rows[0]["credential_version"]) != integer(rows[0]["current_credential_version"]) {
		return nil, "", errors.New("session invalid")
	}
	csrfCookie, err := r.Cookie(app.adminCSRFCookieName())
	if err != nil || subtle.ConstantTimeCompare([]byte(tokenHash(csrfCookie.Value)), []byte(text(rows[0]["csrf_hash"]))) != 1 {
		return nil, "", errors.New("csrf cookie invalid")
	}
	expires, err := time.Parse(time.RFC3339Nano, text(rows[0]["expires_at"]))
	if err != nil {
		return nil, "", err
	}
	lastSeen, err := time.Parse(time.RFC3339Nano, text(rows[0]["last_seen_at"]))
	if err != nil || lastSeen.After(now.Add(30*time.Second)) {
		return nil, "", errors.New("session last seen invalid")
	}
	session := &adminSession{ID: text(rows[0]["id"]), UserID: text(rows[0]["user_id"]), Email: text(rows[0]["email"]), DisplayName: text(rows[0]["display_name"]), CSRFHash: text(rows[0]["csrf_hash"]), CredentialVersion: integer(rows[0]["credential_version"]), ExpiresAt: expires}
	if now.Sub(lastSeen) < sessionTouchInterval {
		return session, csrfCookie.Value, nil
	}
	idle := now.Add(adminSessionIdleDuration)
	if idle.After(expires) {
		idle = expires
	}
	results, touchErr := app.db.Batch(r.Context(), d1.Statement{SQL: `UPDATE admin_sessions SET last_seen_at=?, idle_expires_at=?
	  WHERE id=? AND revoked_at IS NULL AND expires_at>? AND idle_expires_at>? AND last_seen_at<?`, Params: []any{
		databaseTimestamp(now), databaseTimestamp(idle), session.ID, databaseTimestamp(now), databaseTimestamp(now),
		databaseTimestamp(now.Add(-sessionTouchInterval)),
	}})
	if touchErr != nil || len(results) != 1 || resultChanges(results) != 1 {
		verified, verifyErr := app.db.Query(r.Context(), `SELECT s.id
		  FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id
		  WHERE s.id=? AND s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND s.idle_expires_at>?
		    AND s.credential_version=u.credential_version AND u.status='active' AND u.totp_enabled=TRUE`,
			session.ID, tokenHash(cookie.Value), databaseTimestamp(now), databaseTimestamp(now))
		if verifyErr != nil || len(verified) != 1 {
			return nil, "", errors.New("session touch failed")
		}
	}
	return session, csrfCookie.Value, nil
}

func (app *application) deriveAdminPassword(password string, salt []byte) []byte {
	mac := hmac.New(sha256.New, app.adminPasswordPepper)
	_, _ = mac.Write([]byte("neobank-admin-password-v1\x00" + password))
	return argon2.IDKey(mac.Sum(nil), salt, customerArgonTimeCost, customerArgonMemoryKiB, customerArgonParallelism, 32)
}

func (app *application) verifyAdminPassword(password string, row map[string]any) bool {
	salt, saltErr := hex.DecodeString(text(row["password_salt"]))
	expected, hashErr := hex.DecodeString(text(row["password_hash"]))
	if saltErr != nil || hashErr != nil || len(salt) != 16 || len(expected) != 32 {
		return false
	}
	return subtle.ConstantTimeCompare(app.deriveAdminPassword(password, salt), expected) == 1
}

func (app *application) encryptAdminTOTP(secret string) (string, error) {
	block, err := aes.NewCipher(app.adminTOTPKey)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := randomBytes(gcm.NonceSize())
	sealed := gcm.Seal(nil, nonce, []byte(secret), []byte("neobank-admin-totp-v1"))
	return base64.RawURLEncoding.EncodeToString(append(nonce, sealed...)), nil
}

func (app *application) decryptAdminTOTP(encoded string) (string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(app.adminTOTPKey)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil || len(raw) < gcm.NonceSize() {
		return "", errors.New("invalid TOTP ciphertext")
	}
	plain, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], []byte("neobank-admin-totp-v1"))
	return string(plain), err
}

func newAdminSession(userID string, credentialVersion int64, now time.Time) (string, string, string, d1.Statement) {
	id := randomID("admin_session")
	token := randomToken(32)
	csrf := randomToken(32)
	return id, token, csrf, d1.Statement{SQL: `INSERT INTO admin_sessions
	  (id, user_id, token_hash, csrf_hash, credential_version, expires_at, idle_expires_at, created_at, last_seen_at)
	  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, Params: []any{id, userID, tokenHash(token), tokenHash(csrf), credentialVersion,
		databaseTimestamp(now.Add(adminSessionDuration)), databaseTimestamp(now.Add(adminSessionIdleDuration)), databaseTimestamp(now), databaseTimestamp(now)}}
}

func (app *application) validAdminOrigin(raw string) bool {
	expected, err := url.Parse(app.portalURL)
	if err != nil {
		return false
	}
	actual, err := url.Parse(raw)
	return err == nil && actual.Scheme == expected.Scheme && actual.Host == expected.Host
}

func (app *application) hasAdminCookie(r *http.Request) bool {
	_, err := r.Cookie(app.adminCookieName())
	return err == nil
}

func (app *application) adminCookieName() string {
	if strings.HasPrefix(app.portalURL, "https://") {
		return adminSessionCookie
	}
	return "neobank_admin"
}

func (app *application) adminCSRFCookieName() string {
	if strings.HasPrefix(app.portalURL, "https://") {
		return adminCSRFCookie
	}
	return "neobank_admin_csrf"
}

func (app *application) setAdminCookies(w http.ResponseWriter, token, csrf string, expires time.Time) {
	secure := strings.HasPrefix(app.portalURL, "https://")
	maxAge := int(time.Until(expires).Seconds())
	http.SetCookie(w, &http.Cookie{Name: app.adminCookieName(), Value: token, Path: "/", Expires: expires, MaxAge: maxAge, HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode})
	http.SetCookie(w, &http.Cookie{Name: app.adminCSRFCookieName(), Value: csrf, Path: "/", Expires: expires, MaxAge: maxAge, Secure: secure, SameSite: http.SameSiteLaxMode})
}

func (app *application) clearAdminCookies(w http.ResponseWriter) {
	secure := strings.HasPrefix(app.portalURL, "https://")
	http.SetCookie(w, &http.Cookie{Name: app.adminCookieName(), Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode})
	http.SetCookie(w, &http.Cookie{Name: app.adminCSRFCookieName(), Value: "", Path: "/", MaxAge: -1, Secure: secure, SameSite: http.SameSiteLaxMode})
}

func adminUser(row map[string]any) map[string]any {
	return map[string]any{"id": text(row["id"]), "email": text(row["email"]), "display_name": text(row["display_name"]), "role": "admin", "permissions": []string{}}
}
