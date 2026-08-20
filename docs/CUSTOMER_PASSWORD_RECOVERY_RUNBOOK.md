# Customer password recovery runbook

Updated: 20 August 2026 (Asia/Hong_Kong)

## Scope

Customer Online Banking supports self-service recovery through a verified email
address. The implementation uses Render PostgreSQL, the Go customer-auth service,
the existing PostgreSQL `EmailOutbox`, and the Render Zoho email worker.

This source change is local and undeployed until migration `0012_customer_password_recovery`
is reviewed and applied, both Render services are configured, and live acceptance is
explicitly approved. A code deployment, PostgreSQL migration, environment change,
email-worker release, and real email send are separate operations.

## Customer flow

1. The customer opens `/customer/forgot-password` and submits the account email.
2. `POST /api/auth/customer/password-reset/request` always returns the same `202`
   response for valid email syntax. It does not reveal whether an account exists,
   is active, or has verified its email.
3. If the active account email is not verified, the newest email contains a
   30-minute, one-time `/customer/verify-email#verification_token=...` link. After
   verification, the customer requests recovery again.
4. A verified account receives a 30-minute, one-time
   `/customer/reset-password#reset_token=...` link.
5. Accounts with TOTP enabled must also provide a current TOTP code or one unused
   recovery code. Password-only accounts use the verified email link.
6. A successful reset creates a new salted Argon2id password hash, increments
   `credential_version`, clears password lockout state, revokes every customer
   session, consumes outstanding login challenges, consumes/cancels reset requests,
   and records `auth.password_reset_completed`.
7. The customer is not signed in automatically. Existing TOTP enrollment and unused
   recovery codes remain valid.

The direct Admin customer-password change remains a break-glass operation. Normal
customer recovery should use the customer-owned email flow so staff never know or
choose the customer's password.

## Token and data handling

- PostgreSQL stores a random request ID, customer ID, credential version, expiry,
  state, attempt count, and hashed request context. It never stores a raw reset or
  verification token.
- The Go service and email worker share `CUSTOMER_PASSWORD_RESET_SECRET` through
  their approved Render secret configuration. The worker derives the fragment token
  from the request ID with a purpose-separated HMAC-SHA-256.
- Reset and email-verification tokens cannot be exchanged across purposes.
- Links use URL fragments, not query strings. The browser removes the fragment from
  the visible URL immediately after loading it.
- Email outbox payloads contain the request ID only. They must never contain a raw
  reset token, password, TOTP secret, recovery code, balance, bank account, or wallet
  address.
- The Cloudflare Worker limits requests by source plus normalized email or recovery
  request ID. The Go service additionally caps completion attempts at eight.

## API contract

| Operation | Endpoint | Success |
| --- | --- | --- |
| Request recovery | `POST /api/auth/customer/password-reset/request` | `202 {"accepted":true}` |
| Inspect reset link | `POST /api/auth/customer/password-reset/inspect` | `200` with `totp_required` and `expires_at` |
| Complete reset | `POST /api/auth/customer/password-reset/complete` | `200` with `sessions_revoked=true` |
| Verify email | `POST /api/auth/customer/email-verification/complete` | `200` with `email_verified=true` |

All responses use `Cache-Control: no-store`. Invalid, expired, consumed, cancelled,
email-changed, or credential-version-stale links fail closed.

## Configuration

Set the same secret, at least 32 bytes, on the Go service and email worker without
printing it in logs or copying it into Git:

- `CUSTOMER_PASSWORD_RESET_SECRET`

Both services also require:

- `EMAIL_NOTIFICATIONS_ENABLED=true`

Keep notifications disabled until the migration, worker configuration, controlled
recipient test, and business acceptance are complete. The Go service does not need
Zoho OAuth credentials; the email worker does.

## PostgreSQL migration gate

Do not apply `migrations-postgres/0012_customer_password_recovery.sql` merely because
local tests pass.

1. Take a complete production PostgreSQL backup outside the repository.
2. Record and independently recheck its SHA-256 checksum.
3. Restore the backup into an isolated PostgreSQL database and verify integrity,
   table counts, authentication row counts, and financial invariants.
4. Review the exact `0012` SQL and record its SHA-256 for the migration command.
5. Obtain explicit manual approval for the exact database and migration digest.
6. Apply the migration separately from code deployment.
7. Verify the migration row, new columns/tables/indexes, enum values, existing customer
   and credential counts, and that no email was queued by the schema migration.

## Acceptance

- Existing, nonexistent, inactive, and unverified emails receive the same HTTP body
  and materially uniform response timing.
- An unverified active account receives only a verification email; after verifying,
  a new request receives the reset email.
- The email outbox stores only request IDs, never raw recovery tokens.
- Reset and verification links expire after 30 minutes and are single-use.
- A stale credential version, changed email, cancelled request, or ninth attempt fails.
- TOTP and recovery-code paths both work; replaying either fails.
- The old password and every old session fail after reset; the new password works only
  through a fresh login.
- No reset path changes KYC, account activation, balances, wallet bindings, or any
  financial state.
