package main

import (
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/ediya204/neobank/server-go/internal/d1"
)

var (
	errAuditWrite        = errors.New("customer audit write failed")
	errCustomerStateRead = errors.New("customer state read failed")
)

const (
	adminCustomerFields = `id, email, display_name, status, kyc_status, operations_status,
    kyc_reviewed_by, kyc_reviewed_at, kyc_review_note, activated_by, activated_at, created_at`
	reviewCustomerKYCSQL = `UPDATE customers
    SET kyc_status=?, kyc_reviewed_by=?, kyc_reviewed_at=?, kyc_review_note=?, updated_at=?
    WHERE id=? AND tenant_id=? AND kyc_status='pending' AND operations_status='pending'`
	auditCustomerKYCReviewSQL = `INSERT INTO customer_auth_audit_events
    (id, customer_id, event_type, actor, metadata_json, created_at)
    SELECT ?, ?, 'customer.kyc_reviewed', ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM customers
      WHERE id=? AND tenant_id=? AND kyc_reviewed_by=? AND kyc_reviewed_at=?)`
	activateCustomerOperationsSQL = `UPDATE customers
    SET operations_status='active', activated_by=?, activated_at=?, updated_at=?
    WHERE id=? AND tenant_id=? AND kyc_status='approved' AND operations_status='pending'
      AND status IN ('pending_setup', 'active')`
	issueCustomerSetupCredentialSQL = `INSERT INTO customer_credentials
    (customer_id, password_iterations, setup_token_hash, setup_expires_at, updated_at)
    SELECT ?, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM customers
      WHERE id=? AND tenant_id=? AND status='pending_setup' AND kyc_status='approved'
        AND operations_status='active' AND activated_by=? AND activated_at=?)
    ON CONFLICT(customer_id) DO UPDATE SET
      password_iterations=excluded.password_iterations,
      setup_token_hash=excluded.setup_token_hash,
      setup_expires_at=excluded.setup_expires_at,
      setup_consumed_at=NULL,
      enrollment_token_hash=NULL,
      enrollment_expires_at=NULL,
      updated_at=excluded.updated_at`
	auditCustomerActivationSQL = `INSERT INTO customer_auth_audit_events
    (id, customer_id, event_type, actor, metadata_json, created_at)
    SELECT ?, ?, 'customer.operations_activated', ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM customers
      WHERE id=? AND tenant_id=? AND operations_status='active' AND activated_by=? AND activated_at=?)`
)

func adminCustomerRouteID(path, suffix string) string {
	return strings.TrimSuffix(strings.TrimPrefix(path, "/api/v1/admin/customers/"), suffix)
}

func (app *application) listAdminCustomers(w http.ResponseWriter, r *http.Request) {
	rows, err := app.db.Query(r.Context(), `SELECT `+adminCustomerFields+`
    FROM customers WHERE tenant_id=? ORDER BY created_at DESC LIMIT 200`, app.tenantID)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": rows})
}

func (app *application) reviewCustomerKYC(w http.ResponseWriter, r *http.Request, id string) {
	var input struct {
		Decision string `json:"decision"`
		Note     string `json:"note"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	note := strings.TrimSpace(input.Note)
	if !safeIdentifier.MatchString(id) || (input.Decision != "approve" && input.Decision != "reject") || len(note) > 1000 {
		validationError(w)
		return
	}
	if input.Decision == "reject" && note == "" {
		conflict(w, "kyc_rejection_reason_required")
		return
	}
	status := "approved"
	if input.Decision == "reject" {
		status = "rejected"
	}
	actor := edgeUser(r)
	now := databaseTimestamp(time.Now())
	metadata := mustJSON(map[string]string{"decision": input.Decision, "note": note})
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: reviewCustomerKYCSQL, Params: []any{status, actor, now, nullIfEmpty(note), now, id, app.tenantID}},
		d1.Statement{SQL: auditCustomerKYCReviewSQL, Params: []any{randomID("audit"), id, actor, metadata, now, id, app.tenantID, actor, now}},
	)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(results) != 2 || resultChanges(results[:1]) != 1 {
		conflict(w, "kyc_not_pending")
		return
	}
	if resultChanges(results[1:2]) != 1 {
		databaseError(app, w, errAuditWrite)
		return
	}
	app.writeAdminCustomer(w, r, id, nil)
}

func (app *application) activateCustomerOperations(w http.ResponseWriter, r *http.Request, id string) {
	if !safeIdentifier.MatchString(id) {
		validationError(w)
		return
	}
	rows, err := app.db.Query(r.Context(), `SELECT `+adminCustomerFields+`
    FROM customers WHERE id=? AND tenant_id=?`, id, app.tenantID)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(rows) != 1 {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": map[string]string{"code": "customer_not_found"}})
		return
	}
	if text(rows[0]["kyc_status"]) != "approved" {
		conflict(w, "kyc_approval_required")
		return
	}
	status := text(rows[0]["status"])
	if text(rows[0]["operations_status"]) != "pending" || (status != "pending_setup" && status != "active") {
		conflict(w, "customer_not_activatable")
		return
	}
	actor := edgeUser(r)
	now := databaseTimestamp(time.Now())
	statements := []d1.Statement{
		{SQL: activateCustomerOperationsSQL, Params: []any{actor, now, now, id, app.tenantID}},
	}
	var setup map[string]string
	if status == "pending_setup" {
		token := randomToken(32)
		expiresAt := databaseTimestamp(time.Now().Add(customerSetupDuration))
		statements = append(statements, d1.Statement{SQL: issueCustomerSetupCredentialSQL, Params: []any{
			id, customerPasswordIterations, tokenHash(token), expiresAt, now,
			id, app.tenantID, actor, now,
		}})
		setup = map[string]string{
			"setup_url":        app.portalURL + "/customer/setup#setup_token=" + url.QueryEscape(token),
			"setup_expires_at": expiresAt,
		}
	}
	statements = append(statements, d1.Statement{SQL: auditCustomerActivationSQL, Params: []any{
		randomID("audit"), id, actor, mustJSON(map[string]string{"customer_status": status}), now,
		id, app.tenantID, actor, now,
	}})
	results, err := app.db.Batch(r.Context(), statements...)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(results) != len(statements) || resultChanges(results[:1]) != 1 {
		conflict(w, "customer_not_activatable")
		return
	}
	for _, result := range results[1:] {
		if resultChanges([]d1.Result{result}) != 1 {
			databaseError(app, w, errAuditWrite)
			return
		}
	}
	app.writeAdminCustomer(w, r, id, setup)
}

func (app *application) writeAdminCustomer(w http.ResponseWriter, r *http.Request, id string, extra map[string]string) {
	rows, err := app.db.Query(r.Context(), `SELECT `+adminCustomerFields+`
    FROM customers WHERE id=? AND tenant_id=?`, id, app.tenantID)
	if err != nil || len(rows) != 1 {
		if err == nil {
			err = errCustomerStateRead
		}
		databaseError(app, w, err)
		return
	}
	for key, value := range extra {
		rows[0][key] = value
	}
	writeJSON(w, http.StatusOK, rows[0])
}
