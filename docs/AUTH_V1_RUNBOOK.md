# Human authentication V1 runbook

## Scope

Admin and Partner Portal users authenticate with an application-managed password
and a six-digit TOTP code. Partner machine API authentication remains on the
existing Cloudflare Access Service Token and is not part of this migration.

Configured human identities:

- `admin@example.com` — `admin`
- `security-admin@example.com` — `admin`
- `partner@example.com` — `partner`

There is no public self-service creation of an authenticated Admin or Partner
identity. `/portal/register` provides the applicant-facing individual/business
account-opening V1 UI, including KYC/KYB preparation and explicit pending-review
states. The separate Core API/admin onboarding workspace now mirrors the same
individual/business fields. The default VA profile retains separate Compliance
and Operations checkpoints. In the Neobank profile, `/portal/register` persists
the application. Individual applications then receive a short-lived server-issued
Sumsub WebSDK token for passport, passive liveness/face, and proof-of-address
checks. Sumsub `GREEN` only changes the provider state to
`ready_for_admin_review`; manual KYC approval remains the final account-opening
gate and automatically activates the customer and provisions the Cregis-verified
USDT-TRC20 wallet without a second Operations approval click. Business KYB remains
on the existing manual path.

The intended individual registration lifecycle is:

`email_submitted -> email_verified -> password_set -> application_submitted -> sumsub_pending -> ready_for_admin_review -> manual_kyc_approved -> active`

The browser must not collect KYC profile fields before email verification, and the
Go API independently refuses application completion and Sumsub token issuance until
`email_verified_at` is present. Email verification issues a fresh onboarding session
so the customer can continue safely even when the link is opened on another device.

Sumsub completion does not activate an account. Only the authenticated Admin KYC
decision does so in the Neobank profile. The existing first-login flow remains
responsible for TOTP enrollment.

The Core API implementation represents this boundary as:

- `Customer.status=PENDING_REVIEW` and `kycStatus=PENDING` after submission;
- `kycStatus=APPROVED` after manual Compliance review, while the customer
  remains `PENDING_REVIEW` and has no account or wallet;
- `Customer.status=ACTIVE` only after the explicit Operations approval route;
- `kycStatus=REJECTED` with `Customer.status=REJECTED` for a rejected manual
  KYC review.

The provider integration, Webhook boundary, status mapping, configuration, and
production migration gate are documented in `docs/SUMSUB_KYC_RUNBOOK.md`.

## Local Partner Portal bypass

For local UI and API integration testing only, the Partner Portal login can
issue a normal HttpOnly session without validating the supplied account,
password, or TOTP. This bypass has two independent server-side gates:

- the local Worker must be started with
  `npm run cf:dev:portal-bypass`, which explicitly overrides the production-safe
  `AUTH_LOCAL_BYPASS=false` default for that process only and binds the listener
  to `127.0.0.1`;
- the request URL must use plain HTTP with the exact hostname `localhost`,
  `127.0.0.1`, or IPv6 loopback.

The bypass applies only to `POST /api/auth/portal/login`. Admin login always
uses the full password and TOTP flow. The local endpoint still requires a
same-origin browser request, creates a normal expiring session, preserves CSRF
validation, and records `auth.local_portal_bypass` in the authentication audit
table.

Never change the `wrangler.jsonc` default from `false` and never add a production
secret that overrides it. `.dev.vars*` is intentionally ignored by Git and
contains only the local session material required to issue a normal cookie.

## Browser and machine boundaries

- Admin authentication UI:
  - Login: `/admin/login`
  - First-time setup: `/admin/setup#setup_token=...`
- Partner Portal authentication UI:
  - Login: `/portal/login`
  - First-time setup: `/portal/setup#setup_token=...`
- Admin entry-scoped authentication API:
  - `POST /api/auth/admin/login`
  - `POST /api/auth/admin/setup/complete`
  - `POST /api/auth/admin/totp/setup`
  - `POST /api/auth/admin/totp/verify`
  - `POST /api/auth/admin/password/change`
- Partner Portal entry-scoped authentication API:
  - `POST /api/auth/portal/login`
  - `POST /api/auth/portal/setup/complete`
  - `POST /api/auth/portal/totp/setup`
  - `POST /api/auth/portal/totp/verify`
  - `POST /api/auth/portal/password/change`
- Shared session/bootstrap API:
  - `POST /api/auth/setup-token`
  - `GET /api/auth/me`
  - `POST /api/auth/logout`
- Admin browser API: `/api/browser/v1/admin/*`
- Partner Portal browser API: `/api/browser/v1/portal/*`
- Partner machine API: `/api/v1` and `/api/v1/*`

Do not move browser traffic back under `/api/v1/*`; that prefix remains reserved
for the machine Service Token boundary.

The authentication entry path is the source of truth for the expected role.
Request bodies do not select or override a role. The retired shared entry
endpoints below must return `404 not_found`:

- `/api/auth/login`
- `/api/auth/setup/complete`
- `/api/auth/totp/setup`
- `/api/auth/totp/verify`
- `/api/auth/password/change`

Admin credentials, setup/enrollment tokens, login challenges, and recovery
codes must fail on the Portal endpoints without being consumed. The inverse
rule applies to Partner Portal credentials and intermediate tokens on Admin
endpoints.

## First-time activation

1. Operations issues a 30-minute, one-time setup token with the protected
   `POST /api/auth/setup-token` bootstrap operation, including the configured
   identity role. Omit `purpose` or send `"purpose": "initial_setup"`.
2. Deliver only the role-specific fragment link:
   - Admin: `https://your-va-portal.example/admin/setup#setup_token=...`
   - Partner Portal: `https://your-va-portal.example/portal/setup#setup_token=...`
3. The user creates a 14–128 character password containing uppercase,
   lowercase, number, and symbol.
4. The user adds the displayed TOTP key to an authenticator and confirms the
   current six-digit code.
5. The user stores the ten one-time recovery codes in a password manager.
6. Verify the role-specific login route, workspace redirect, and one
   representative authorized operation.

Setup tokens must never be placed in query strings, tickets, analytics, or
server logs.

## Password derivation V1

The Worker derives password hashes in two stages:

1. Compute a domain-separated HMAC-SHA-256 of the UTF-8 password with
   `AUTH_PASSWORD_PEPPER`.
2. Feed the 32-byte HMAC result into PBKDF2-HMAC-SHA-256 with exactly 100,000
   iterations, a random 16-byte per-user salt, and a 32-byte output.

The D1 row stores only the derived hash, salt, and iteration count. The pepper
must remain a separate Worker Secret. Authentication accepts only the current
100,000-iteration record format. A missing, malformed, or unsupported legacy
record runs the same peppered 100,000-iteration dummy derivation and returns a
credential failure instead of passing an unsafe iteration value to Web Crypto.

The 100,000 work factor is a V1 Cloudflare Web Crypto runtime compatibility
limit observed in production. Compensating controls include the separate
password pepper, per-user salt, password-attempt throttling/lockout, and
mandatory TOTP. Re-evaluate the password KDF when the runtime supports a
stronger work factor or an approved memory-hard KDF.

At this V1 cutover, no human user had completed setup, so there was no existing
password hash to migrate. A future KDF or pepper rotation requires an explicit
password-reset/migration plan.

## Secret handling

Required Worker Secrets:

- `AUTH_BOOTSTRAP_SECRET`
- `AUTH_TOTP_ENCRYPTION_KEY`
- `AUTH_PASSWORD_PEPPER`
- `AUTH_RECOVERY_CODE_PEPPER`
- `AUTH_SESSION_SECRET`

The TOTP encryption key is required to decrypt enrolled authenticators. Do not
rotate it without a data migration. Rotating the session secret invalidates
CSRF tokens and should be paired with session revocation. Rotating
`AUTH_PASSWORD_PEPPER` invalidates every existing password hash and therefore
requires a forced password reset or a migration that has access to the user's
password. Keep recoverable copies only in an approved secret manager.

## Cloudflare Access boundary

- `/admin/login`, `/admin/setup`, `/portal/login`, `/portal/setup`,
  `/api/auth*`, and `/api/browser/v1/*` use an explicit Access
  Bypass application so the Worker can enforce the custom session and role
  boundary without trusting Cloudflare identity headers.
- `POST /api/auth/setup-token` has a more-specific Access application that only
  allows the administrator and still requires the bootstrap bearer secret.
- `/dashboard*`, `/portal*`, and the bare hostname are no longer Cloudflare
  identity entry points. An unauthenticated browser is redirected by the
  application to `/admin/login` or `/portal/login` respectively.
- The old human Access applications retain only
  `/api/v1/admin/*` and `/api/v1/portal*` as legacy outer barriers. The current
  browser UI uses `/api/browser/v1/*` and a custom session instead.
- The two partner machine API Access applications for `/api/v1` and
  `/api/v1/*` remain unchanged.

After both users complete activation and production tests:

1. Verify password + TOTP login for each role without an Access cookie.
2. Verify `/dashboard` redirects only to `/admin/login` and `/portal` redirects
   only to `/portal/login` when no custom session exists.
3. Keep the two machine API Access applications unchanged.
4. Retire the two legacy human API Access applications only after confirming no
   external client uses those paths.
5. Preserve the administrator-protected setup-token endpoint and bootstrap
   secret as the audited break-glass path.

## Password change and administrator-assisted credential reset

An authenticated Admin or Partner can change the current password from the
account settings page. The role-scoped password-change endpoint requires the
current password, an unused TOTP code, the exact same-origin CSRF headers, and
the existing 14–128 character password policy. A successful change preserves
the requesting session, revokes other active sessions, consumes outstanding
login challenges, and writes `auth.password_change`. It does not replace TOTP
enrollment or recovery codes.

V1 also supports one-time recovery codes and an administrator-assisted
break-glass reset. It does not expose self-service TOTP reset. Use the
break-glass reset when the current password or authenticator is unavailable.

Only use credential reset after the operator has verified the user's identity
through an approved offline process:

1. Call `POST /api/auth/setup-token` with the bootstrap bearer secret and:

   ```json
   {
     "email": "admin@example.com",
     "role": "admin",
     "purpose": "credential_reset"
   }
   ```

2. The operation succeeds only when the configured account has completed
   activation. In one D1 transaction it creates the new one-time token, revokes
   all active sessions and login challenges, invalidates pending TOTP
   enrollments and setup tokens, and clears the old password, TOTP secret, and
   recovery codes.
3. Deliver the returned token only in the role-specific URL fragment described
   under **First-time activation**. The user must choose a new password and
   enroll a new authenticator.
4. Confirm that the old password, old authenticator, old recovery codes, old
   browser sessions, and any old login challenge no longer work.
5. Review the `auth.credential_reset` audit event. Repeated or unexpected reset
   events require investigation.

`purpose` defaults to `initial_setup`; a completed account therefore still
returns `409 setup_already_completed` unless the caller explicitly supplies
`credential_reset`. A reset cannot be used to create a new identity or to
change the configured role.

See [Authentication API contract](./AUTH_API.md) for the exact request,
response, cookie, CSRF, and error formats.

## Verification

Run only against a local or isolated test D1 database:

```bash
export AUTH_BASE_URL=http://localhost:8787
export AUTH_BOOTSTRAP_SECRET='<same isolated Worker bootstrap secret>'

AUTH_TEST_ROLE=admin \
AUTH_TEST_EMAIL=admin@example.com \
AUTH_TEST_PASSWORD='<initial strong test password>' \
AUTH_RESET_PASSWORD='<different strong reset password>' \
npm run auth:smoke

AUTH_TEST_ROLE=partner \
AUTH_TEST_EMAIL=partner@example.com \
AUTH_TEST_PASSWORD='<initial strong test password>' \
AUTH_RESET_PASSWORD='<different strong reset password>' \
npm run auth:smoke
```

Apply all repository D1 migrations, including
`0021_auth_challenge_credential_version.sql`, to the same isolated `--persist-to`
directory before starting the local Worker. Production rollout uses the same
order: apply `0021` before switching traffic to Worker code that reads the new
challenge field. The script changes authentication state and refuses a
non-local base URL unless the explicit remote-test acknowledgement is supplied.
Each role run verifies its dedicated entry endpoints, confirms all retired
shared entry endpoints return `404`, and proves cross-entry setup/enrollment
tokens, challenges, and recovery codes fail without consuming the valid
credential. It then executes a credential reset and proves the old session,
password, and challenge are invalid, the reset token cannot cross role
boundaries, the token is single-use, and a new password plus TOTP enrollment
produces a fresh session.

The smoke script uses `V1-reset-password-Aa1!` as the reset password by default.
Set `AUTH_RESET_PASSWORD` to a different strong value when required by the
isolated test environment.
