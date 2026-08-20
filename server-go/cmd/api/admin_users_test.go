package main

import (
	"net/http"
	"testing"
)

func TestAdminRolePermissionsAreLeastPrivilege(t *testing.T) {
	super := &adminSession{AccessRole: adminRoleSuperAdmin}
	operations := &adminSession{AccessRole: adminRoleOperations}
	compliance := &adminSession{AccessRole: adminRoleCompliance}
	viewer := &adminSession{AccessRole: adminRoleReadOnly}

	if !adminHasPermission(super, adminPermissionUsers) || adminHasPermission(operations, adminPermissionUsers) {
		t.Fatal("only the super administrator may manage administrator accounts")
	}
	if !adminHasPermission(super, adminPermissionCustomerCredentials) ||
		adminHasPermission(operations, adminPermissionCustomerCredentials) ||
		adminHasPermission(compliance, adminPermissionCustomerCredentials) ||
		adminHasPermission(viewer, adminPermissionCustomerCredentials) {
		t.Fatal("only the super administrator may change customer credentials")
	}
	if !adminHasPermission(operations, adminPermissionFundsManage) || adminHasPermission(compliance, adminPermissionFundsManage) {
		t.Fatal("fund mutation permission must remain operations-only")
	}
	if !adminHasPermission(compliance, adminPermissionCustomerReview) || adminHasPermission(viewer, adminPermissionCustomerReview) {
		t.Fatal("customer review permission must remain compliance-only")
	}
	if !adminHasPermission(viewer, adminPermissionReports) || adminHasPermission(viewer, adminPermissionSettings) {
		t.Fatal("read-only administrator permissions are incorrect")
	}
}

func TestAdminRequestPermissionsCoverGoAdminRoutes(t *testing.T) {
	operations := &adminSession{AccessRole: adminRoleOperations}
	compliance := &adminSession{AccessRole: adminRoleCompliance}
	viewer := &adminSession{AccessRole: adminRoleReadOnly}

	if !adminRequestPermitted(operations, http.MethodPost, "/api/v1/crypto/withdrawals") {
		t.Fatal("operations administrator must be able to process crypto withdrawals")
	}
	if adminRequestPermitted(compliance, http.MethodPost, "/api/v1/crypto/withdrawals") {
		t.Fatal("compliance administrator must not process crypto withdrawals")
	}
	if !adminRequestPermitted(compliance, http.MethodPatch, "/api/v1/admin/customers/customer_1/kyc") {
		t.Fatal("compliance administrator must be able to review KYC")
	}
	if adminRequestPermitted(viewer, http.MethodPatch, "/api/v1/admin/customers/customer_1/kyc") {
		t.Fatal("read-only administrator must not review KYC")
	}
	if !adminRequestPermitted(&adminSession{AccessRole: adminRoleSuperAdmin}, http.MethodPatch,
		"/api/v1/admin/customers/customer_1/password") {
		t.Fatal("super administrator must be able to change a customer password")
	}
	if adminRequestPermitted(compliance, http.MethodPatch, "/api/v1/admin/customers/customer_1/password") {
		t.Fatal("compliance administrator must not change a customer password")
	}
	if !adminRequestPermitted(&adminSession{AccessRole: adminRoleSuperAdmin}, http.MethodPost,
		"/api/v1/admin/customers/customer_1/setup-link") {
		t.Fatal("super administrator must be able to reissue a customer setup link")
	}
	if adminRequestPermitted(compliance, http.MethodPost, "/api/v1/admin/customers/customer_1/setup-link") {
		t.Fatal("compliance administrator must not reissue a customer setup link")
	}
}
