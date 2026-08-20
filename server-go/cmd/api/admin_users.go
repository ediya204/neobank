package main

import (
	"net/http"
	"strings"
	"time"

	"github.com/ediya204/neobank/server-go/internal/d1"
)

const (
	adminRoleSuperAdmin           = "super_admin"
	adminRoleOperations           = "operations_admin"
	adminRoleCompliance           = "compliance_admin"
	adminRoleReadOnly             = "read_only_admin"
	adminPermissionUsers          = "admin_users.manage"
	adminPermissionCustomerRead   = "customers.read"
	adminPermissionCustomerReview = "customers.review"
	adminPermissionFundsRead      = "funds.read"
	adminPermissionFundsManage    = "funds.manage"
	adminPermissionSettings       = "settings.manage"
	adminPermissionReports        = "reports.read"
)

var adminRolePermissions = map[string][]string{
	adminRoleSuperAdmin: {
		adminPermissionUsers, adminPermissionCustomerRead, adminPermissionCustomerReview,
		adminPermissionFundsRead, adminPermissionFundsManage, adminPermissionSettings,
		adminPermissionReports,
	},
	adminRoleOperations: {
		adminPermissionCustomerRead, adminPermissionFundsRead, adminPermissionFundsManage,
		adminPermissionReports,
	},
	adminRoleCompliance: {
		adminPermissionCustomerRead, adminPermissionCustomerReview, adminPermissionFundsRead,
		adminPermissionReports,
	},
	adminRoleReadOnly: {
		adminPermissionCustomerRead, adminPermissionFundsRead, adminPermissionReports,
	},
}

func validAdminAccessRole(role string) bool {
	_, ok := adminRolePermissions[role]
	return ok
}

func adminPermissions(role string) []string {
	permissions := adminRolePermissions[role]
	return append([]string(nil), permissions...)
}

func adminHasPermission(session *adminSession, permission string) bool {
	if session == nil {
		return false
	}
	for _, candidate := range adminRolePermissions[session.AccessRole] {
		if candidate == permission {
			return true
		}
	}
	return false
}

func adminSessionUser(session *adminSession) map[string]any {
	return map[string]any{
		"id":           session.UserID,
		"core_user_id": session.CoreUserID,
		"email":        session.Email,
		"display_name": session.DisplayName,
		"role":         "admin",
		"access_role":  session.AccessRole,
		"permissions":  adminPermissions(session.AccessRole),
	}
}

func adminRequestPermitted(session *adminSession, method, path string) bool {
	permission := ""
	switch {
	case strings.HasPrefix(path, "/api/v1/admin/customers"):
		if method == http.MethodGet {
			permission = adminPermissionCustomerRead
		} else {
			permission = adminPermissionCustomerReview
		}
	case path == "/api/v1/admin/market-rate":
		permission = adminPermissionFundsRead
	case strings.HasPrefix(path, "/api/v1/crypto/"):
		if method == http.MethodGet {
			permission = adminPermissionFundsRead
		} else {
			permission = adminPermissionFundsManage
		}
	default:
		return session != nil && session.AccessRole == adminRoleSuperAdmin
	}
	return adminHasPermission(session, permission)
}

func (app *application) routeAdminUsers(w http.ResponseWriter, r *http.Request, session *adminSession) bool {
	const base = "/api/v1/admin/users"
	if r.URL.Path != base && !strings.HasPrefix(r.URL.Path, base+"/") {
		return false
	}
	if !adminHasPermission(session, adminPermissionUsers) {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": map[string]string{"code": "admin_users_permission_required"}})
		return true
	}
	switch {
	case r.Method == http.MethodGet && r.URL.Path == base:
		app.listAdminUsers(w, r)
	case r.Method == http.MethodPost && r.URL.Path == base:
		app.createManagedAdminUser(w, r, session)
	case r.Method == http.MethodPatch && strings.Count(strings.TrimPrefix(r.URL.Path, base+"/"), "/") == 0:
		app.updateManagedAdminUser(w, r, session, strings.TrimPrefix(r.URL.Path, base+"/"))
	case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/setup-token"):
		userID := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, base+"/"), "/setup-token")
		app.reissueManagedAdminSetupToken(w, r, session, userID)
	default:
		writeJSON(w, http.StatusNotFound, map[string]any{"error": map[string]string{"code": "not_found"}})
	}
	return true
}

func (app *application) listAdminUsers(w http.ResponseWriter, r *http.Request) {
	rows, err := app.db.Query(r.Context(), `SELECT id, core_user_id, email, display_name, access_role, status,
	  version, totp_enabled, setup_completed_at, last_login_at, created_at, updated_at
	  FROM admin_users ORDER BY LOWER(email)`)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	users := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		users = append(users, managedAdminUser(row))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"users": users,
		"roles": []map[string]any{
			{"code": adminRoleSuperAdmin, "permissions": adminPermissions(adminRoleSuperAdmin)},
			{"code": adminRoleOperations, "permissions": adminPermissions(adminRoleOperations)},
			{"code": adminRoleCompliance, "permissions": adminPermissions(adminRoleCompliance)},
			{"code": adminRoleReadOnly, "permissions": adminPermissions(adminRoleReadOnly)},
		},
	})
}

func (app *application) createManagedAdminUser(w http.ResponseWriter, r *http.Request, session *adminSession) {
	var input struct {
		Email       string `json:"email"`
		DisplayName string `json:"display_name"`
		AccessRole  string `json:"access_role"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	email := normalizeCustomerEmail(input.Email)
	displayName := strings.TrimSpace(input.DisplayName)
	accessRole := strings.TrimSpace(input.AccessRole)
	if email == "" || displayName == "" || len(displayName) > 100 || !validAdminAccessRole(accessRole) {
		validationError(w)
		return
	}
	existing, err := app.db.Query(r.Context(), `SELECT id FROM admin_users WHERE LOWER(email)=?`, email)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(existing) != 0 {
		conflict(w, "admin_user_exists")
		return
	}
	coreRows, err := app.db.Query(r.Context(), `SELECT id, role FROM "User" WHERE LOWER(email)=?`, email)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(coreRows) != 0 {
		conflict(w, "core_identity_conflict")
		return
	}
	now := time.Now().UTC()
	nowText := databaseTimestamp(now)
	userID := randomID("admin")
	setupToken := randomToken(32)
	statements := []d1.Statement{
		{SQL: `INSERT INTO "User"
		  (id, "organizationId", email, "displayName", role, active, "createdAt", "updatedAt")
		  VALUES (?, ?, ?, ?, 'ADMIN', TRUE, ?::timestamptz, ?::timestamptz)`, Params: []any{
			userID, app.coreOrganizationID, email, displayName, nowText, nowText,
		}},
		{SQL: `INSERT INTO admin_users
		  (id, core_user_id, email, display_name, access_role, status, version, created_at, updated_at)
		  VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?)`, Params: []any{
			userID, userID, email, displayName, accessRole, nowText, nowText,
		}},
		{SQL: `INSERT INTO admin_setup_tokens (id, user_id, token_hash, expires_at, created_at)
		  VALUES (?, ?, ?, ?, ?)`, Params: []any{
			randomID("setup"), userID, tokenHash(setupToken), databaseTimestamp(now.Add(adminSetupDuration)), nowText,
		}},
		{SQL: `INSERT INTO admin_auth_audit_events
		  (id, user_id, event_type, actor, metadata_json, created_at)
		  VALUES (?, ?, 'admin_user.created', ?, ?, ?)`, Params: []any{
			randomID("audit"), userID, session.Email, mustJSON(map[string]string{"access_role": accessRole}), nowText,
		}},
	}
	results, err := app.db.Batch(r.Context(), statements...)
	if err != nil || len(results) != len(statements) {
		databaseError(app, w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"user": managedAdminUser(map[string]any{
			"id": userID, "core_user_id": userID, "email": email, "display_name": displayName,
			"access_role": accessRole, "status": "active", "version": int64(1), "totp_enabled": false,
			"setup_completed_at": "", "last_login_at": "", "created_at": nowText, "updated_at": nowText,
		}),
		"setup_token":        setupToken,
		"setup_url_fragment": "#setup_token=" + setupToken,
		"expires_at":         databaseTimestamp(now.Add(adminSetupDuration)),
	})
}

func (app *application) updateManagedAdminUser(w http.ResponseWriter, r *http.Request, session *adminSession, userID string) {
	if userID == "" {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": map[string]string{"code": "not_found"}})
		return
	}
	var input struct {
		DisplayName *string `json:"display_name"`
		AccessRole  *string `json:"access_role"`
		Status      *string `json:"status"`
		Version     int64   `json:"version"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	rows, err := app.db.Query(r.Context(), `SELECT id, core_user_id, email, display_name, access_role, status, version,
	  totp_enabled, setup_completed_at, last_login_at, created_at, updated_at
	  FROM admin_users WHERE id=?`, userID)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(rows) != 1 {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": map[string]string{"code": "admin_user_not_found"}})
		return
	}
	row := rows[0]
	displayName := text(row["display_name"])
	accessRole := text(row["access_role"])
	status := text(row["status"])
	if input.DisplayName != nil {
		displayName = strings.TrimSpace(*input.DisplayName)
	}
	if input.AccessRole != nil {
		accessRole = strings.TrimSpace(*input.AccessRole)
	}
	if input.Status != nil {
		status = strings.TrimSpace(*input.Status)
	}
	if input.Version < 1 || displayName == "" || len(displayName) > 100 || !validAdminAccessRole(accessRole) || (status != "active" && status != "disabled") {
		validationError(w)
		return
	}
	if userID == session.UserID && (accessRole != text(row["access_role"]) || status != text(row["status"])) {
		conflict(w, "cannot_change_own_admin_access")
		return
	}
	removesActiveSuperAdmin := text(row["access_role"]) == adminRoleSuperAdmin && text(row["status"]) == "active" &&
		(accessRole != adminRoleSuperAdmin || status != "active")
	nowText := databaseTimestamp(time.Now().UTC())
	updateCondition := `id=? AND version=?`
	if removesActiveSuperAdmin {
		updateCondition += ` AND (SELECT COUNT(*) FROM admin_users WHERE access_role='super_admin' AND status='active') > 1`
	}
	revokeSessions := accessRole != text(row["access_role"]) || status != text(row["status"])
	statement := d1.Statement{SQL: `WITH updated_admin AS (
	    UPDATE admin_users
	    SET display_name=?, access_role=?, status=?,
	      credential_version=credential_version + CASE WHEN ? THEN 1 ELSE 0 END,
	      version=version+1, updated_at=?
	    WHERE ` + updateCondition + `
	    RETURNING id, core_user_id
	  ), updated_core AS (
	    UPDATE "User" core_user
	    SET "displayName"=?, active=?, "updatedAt"=?::timestamptz
	    FROM updated_admin
	    WHERE core_user.id=updated_admin.core_user_id
	    RETURNING core_user.id
	  ), revoked_sessions AS (
	    UPDATE admin_sessions session
	    SET revoked_at=?
	    FROM updated_admin
	    WHERE ? AND session.user_id=updated_admin.id AND session.revoked_at IS NULL
	    RETURNING session.id
	  )
	  INSERT INTO admin_auth_audit_events
	    (id, user_id, event_type, actor, metadata_json, created_at)
	  SELECT ?, updated_admin.id, 'admin_user.updated', ?, ?, ?
	  FROM updated_admin
	  RETURNING id`, Params: []any{
		displayName, accessRole, status, revokeSessions, nowText, userID, input.Version,
		displayName, status == "active", nowText, nowText, revokeSessions,
		randomID("audit"), session.Email, mustJSON(map[string]string{"access_role": accessRole, "status": status}), nowText,
	}}
	results, err := app.db.Batch(r.Context(), statement)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(results) != 1 || len(results[0].Results) != 1 {
		if removesActiveSuperAdmin {
			conflict(w, "last_super_admin_required")
		} else {
			conflict(w, "admin_user_version_conflict")
		}
		return
	}
	row["display_name"] = displayName
	row["access_role"] = accessRole
	row["status"] = status
	row["version"] = input.Version + 1
	row["updated_at"] = nowText
	writeJSON(w, http.StatusOK, map[string]any{"user": managedAdminUser(row)})
}

func (app *application) reissueManagedAdminSetupToken(w http.ResponseWriter, r *http.Request, session *adminSession, userID string) {
	rows, err := app.db.Query(r.Context(), `SELECT id, email, setup_completed_at, status FROM admin_users WHERE id=?`, userID)
	if err != nil {
		databaseError(app, w, err)
		return
	}
	if len(rows) != 1 {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": map[string]string{"code": "admin_user_not_found"}})
		return
	}
	if text(rows[0]["setup_completed_at"]) != "" {
		conflict(w, "admin_setup_already_completed")
		return
	}
	if text(rows[0]["status"]) != "active" {
		conflict(w, "admin_user_disabled")
		return
	}
	now := time.Now().UTC()
	nowText := databaseTimestamp(now)
	token := randomToken(32)
	results, err := app.db.Batch(r.Context(),
		d1.Statement{SQL: `UPDATE admin_setup_tokens SET used_at=? WHERE user_id=? AND used_at IS NULL`, Params: []any{nowText, userID}},
		d1.Statement{SQL: `INSERT INTO admin_setup_tokens (id, user_id, token_hash, expires_at, created_at)
		  VALUES (?, ?, ?, ?, ?)`, Params: []any{randomID("setup"), userID, tokenHash(token), databaseTimestamp(now.Add(adminSetupDuration)), nowText}},
		d1.Statement{SQL: `INSERT INTO admin_auth_audit_events
		  (id, user_id, event_type, actor, metadata_json, created_at)
		  VALUES (?, ?, 'admin_user.setup_token_reissued', ?, '{}', ?)`, Params: []any{randomID("audit"), userID, session.Email, nowText}},
	)
	if err != nil || len(results) != 3 {
		databaseError(app, w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"setup_token":        token,
		"setup_url_fragment": "#setup_token=" + token,
		"expires_at":         databaseTimestamp(now.Add(adminSetupDuration)),
	})
}

func managedAdminUser(row map[string]any) map[string]any {
	return map[string]any{
		"id":                 text(row["id"]),
		"email":              text(row["email"]),
		"display_name":       text(row["display_name"]),
		"access_role":        text(row["access_role"]),
		"permissions":        adminPermissions(text(row["access_role"])),
		"status":             text(row["status"]),
		"version":            integer(row["version"]),
		"totp_enabled":       text(row["totp_enabled"]) == "true",
		"setup_completed_at": text(row["setup_completed_at"]),
		"last_login_at":      text(row["last_login_at"]),
		"created_at":         text(row["created_at"]),
		"updated_at":         text(row["updated_at"]),
	}
}
