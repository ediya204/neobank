# Customer Fiat Payout TOTP-Only Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the current-password prompt from customer fiat payout confirmation while retaining TOTP verification.

**Architecture:** Keep the existing authenticated customer session, CSRF, withdrawal lock, atomic TOTP consumption, idempotency, and Core freeze flow. Add a payout-only TOTP verifier and rate-limit by both source IP and customer session so password-plus-TOTP remains unchanged for other security operations.

**Tech Stack:** React, Go, PostgreSQL, Node source-contract tests.

---

### Task 1: Specify TOTP-only payout confirmation

**Files:**
- Modify: `server-go/cmd/api/customer_fiat_payout_test.go`
- Modify: `scripts/check-neobank-isolated-profile.mjs`

1. Remove `current_password` from the successful payout request test and require the source contract to omit the password field.
2. Run the focused Go and profile tests and confirm they fail.

### Task 2: Remove payout password verification

**Files:**
- Modify: `server-go/cmd/api/customer_security.go`
- Modify: `server-go/cmd/api/customer_fiat_payout.go`
- Modify: `src/pages/portal/customer-action.tsx`
- Modify: `worker-web/index.ts`
- Modify: `docs/plans/2026-08-27-customer-fiat-payout-design.md`

1. Add an isolated TOTP-only verifier for this payout endpoint.
2. Remove the password field, state, validation, payload, and error handling from the payout dialog.
3. Add a customer-session rate-limit bucket and security failure cases.
4. Update the existing design record and run focused tests until green.

### Task 3: Verify and commit

1. Run Go tests, profile check, typecheck, i18n check, lint, Core tests, production build, whitespace, and secret checks.
2. Commit directly on `main`; do not push or deploy.
