# Neobank Cregis deployment runbook

This runbook covers the isolated Neobank wallet service only. It does not claim
that the existing application backend has been fully replaced by Go.

## Isolation boundary

- Cloudflare Worker: `neobank-web`
- Authoritative database: Render PostgreSQL `neobank-postgres`
- Legacy D1 `neobank-core-v1`: historical migration evidence only; no runtime writes
- Render service: `neobank`
- Tenant identifier: `neobank`
- Cregis calls remain disabled until the credential, outbound IP allowlist, and
  callback checks are complete.

The production Go runtime must refuse every `DATABASE_BACKEND` value other than
`postgres`. Do not restore D1 as a runtime fallback and do not dual-write.

## Production web profile

The production web build is an explicit allowlist, selected at compile time with
`REACT_APP_NEOBANK_DEPLOYMENT_MODE=isolated-wallet`. It exposes only:

| Audience      | Browser routes                                                        | Authentication source                              |
| ------------- | --------------------------------------------------------------------- | -------------------------------------------------- |
| Customer      | `/customer/register`, `/customer/login`, `/customer/setup`            | Public application password; legacy setup fallback |
| Customer      | `/portal/home`; wallet actions remain under `/portal/crypto-wallet/*` | Same validated customer session                    |
| Administrator | `/admin/login`, `/admin/setup`, `/admin`                              | Application password + TOTP session                |

For compatibility with saved links, `/portal/crypto-wallet` redirects to
`/portal/home`, and `/admin/neobank-crypto` redirects to `/admin`. These aliases
do not change the authentication boundary.

All Partner Portal, general Dashboard, and other Nest-only routes render the
safe 404 page in this profile. The default
local build remains the complete Nest application and must not be used as the
Neobank production artifact.

Use only the Neobank-prefixed commands for this deployment:

```bash
npm run neobank:profile:check
npm run neobank:typecheck
npm run neobank:build
npm run neobank:deploy:dry-run
# Manual deployment approval is required before:
npm run neobank:deploy
```

Every Wrangler command above names `wrangler.neobank.jsonc` and therefore targets
the deployed `neobank-web` Worker bound to `portal.sscdigitalbank.com`. None uses
the separate default VA configuration in `wrangler.jsonc`; `npm run cf:release`
is not a Neobank release command and must not be used for this deployment.

The Render Go API owns the administrator password + TOTP boundary and stores
accounts, setup tokens, login challenges, sessions, and audit events in
PostgreSQL. Browser admin APIs require the `__Host-neobank_admin` HttpOnly
cookie, the paired CSRF cookie/header, and a same-origin mutation. The web
Worker performs rate limiting and signed transport only; it never derives or
accepts an administrator identity from browser headers.

The first administrator is provisioned through the bootstrap-secret protected
`POST /api/auth/setup-token` flow and completes password and TOTP enrollment at
`/admin/setup#setup_token=...`. Never place the setup token, password, TOTP
secret, recovery codes, or bootstrap secret in source control or chat.

## Required Render environment variables

Set values in the Render dashboard. Never commit or paste secret values into a
ticket, chat, log, or repository.

| Name                             | Secret    | Initial value or source                                  |
| -------------------------------- | --------- | -------------------------------------------------------- |
| `DATABASE_BACKEND`               | No        | Must be `postgres`; every other value fails startup      |
| `DATABASE_URL`                   | Yes       | Render PostgreSQL internal connection                    |
| `EDGE_SHARED_SECRET`             | Yes       | Same random value as the web Worker secret               |
| `PUBLIC_BASE_URL`                | No        | Render service origin, without a trailing slash          |
| `CUSTOMER_PORTAL_BASE_URL`       | No        | Public customer Portal origin, without a trailing slash  |
| `TENANT_ID`                      | No        | `neobank`                                                |
| `CUSTOMER_PASSWORD_PEPPER`       | Yes       | Separate random value of at least 32 bytes               |
| `CUSTOMER_TOTP_KEY`              | Yes       | Random 32-byte AES key encoded as hex or Base64          |
| `CUSTOMER_RECOVERY_PEPPER`       | Yes       | Separate random value of at least 32 bytes               |
| `ADMIN_PASSWORD_PEPPER`          | Yes       | Separate random value of at least 32 bytes               |
| `ADMIN_TOTP_KEY`                 | Yes       | Random 32-byte AES key encoded as hex or Base64          |
| `ADMIN_BOOTSTRAP_SECRET`         | Yes       | Setup-token bearer secret of at least 32 bytes           |
| `FASTFOREX_API_KEY`              | Yes       | Rotated FastForex key; configure directly in Render      |
| `CREGIS_BASE_URL`                | No        | Test gateway while commissioning                         |
| `CREGIS_ENABLED`                 | No        | `false` until the acceptance gate passes                 |
| `CREGIS_PROJECT_ID`              | Sensitive | Cregis project configuration                             |
| `CREGIS_PROJECT_SECRET`          | Yes       | Newly rotated Cregis secret                              |
| `CREGIS_RELAY_URL`               | No        | Dedicated HTTPS origin for the Neobank-only egress relay |
| `CREGIS_RELAY_SECRET`            | Yes       | Separate random HMAC secret shared only with the relay   |

## Required web Worker bindings

Configure these on `neobank-web`, not on Render:

| Name                         | Secret | Purpose                                      |
| ---------------------------- | ------ | -------------------------------------------- |
| `GO_EDGE_SHARED_SECRET`      | Yes    | Signed Worker-to-Go transport                |
| `ADMIN_AUTH_RATE_LIMITER`    | No     | Edge Admin login and TOTP request throttling |
| `CUSTOMER_AUTH_RATE_LIMITER` | No     | Edge customer auth request throttling        |

The Neobank Worker must have no D1 binding.

`CREGIS_RELAY_URL` affects only the Cregis client. Do not configure a global
`HTTP_PROXY` or `HTTPS_PROXY`.
The relay accepts only the Cregis address-create, address-ownership,
address-legality, and payout
paths, authenticates the complete request body, rejects replayed nonces, and
pins its upstream to the configured Cregis test gateway.

`GET /api/v1/admin/market-rate?base=USD&quote=HKD` and the customer-session
equivalent `GET /api/v1/customer/market-rate` read FastForex midpoint spot
reference rates through the Render service. The endpoints are restricted to
the product's USD, HKD, and USDT pairs, use a short server-side cache, and do
not update settlement settings, create a rate version, or write a ledger entry.
Configure `FASTFOREX_API_KEY` only as a Render secret; never put its value in
`render.yaml`, a frontend variable, a URL query parameter, or a Worker variable.

## Callback endpoints

The Go service supplies distinct callback URLs on Cregis requests:

- `POST /api/v1/callbacks/cregis/deposit`
- `POST /api/v1/callbacks/cregis/payout`

Cregis callbacks are verified using the Cregis signature protocol and must
return the literal response `success` only after the notification is accepted.
Keep retry notifications enabled in Cregis.

## Deposit-address exposure gate

A Cregis address-create response is not sufficient on its own. The Go service
must immediately call `POST /api/v1/address/inner` with the same authenticated
project and chain. Only a `true` project-membership response may set
`custody_provider=cregis`, record `ownership_verified_at`, and expose the address
to the Portal. Existing rows without that evidence remain non-depositable even
when their historical status is `active`; their address, copy control, and QR
code stay hidden.

## Withdrawal state machine

`submitted -> approved -> executing -> submitted_to_cregis -> completed`

The exception paths are `rejected`, `failed`, `exception`, and `cancelled`.
Submission is not settlement. Submission, approval, and execution remain
separate explicit actions, but the same authenticated administrator may perform
all three. The maker, checker, and operator identity and timestamp remain stored
for audit, and a Cregis callback is required for the final result.

## Customer test-account boundary

Customer identity, credential metadata, sessions, wallet ownership, and audit
events are stored in Render PostgreSQL. Passwords are never
stored: new records use a random salt and a peppered Argon2id result. A valid
legacy peppered PBKDF2 login is upgraded transactionally to versioned Argon2id.
TOTP secrets for legacy enrolled customers are encrypted with the dedicated AES
key. Session tokens, CSRF tokens, setup tokens, and login challenges are stored
only as hashes.

The customer routes use the application session instead of Cloudflare Access:

- Login: `/customer/login`
- Legacy/admin-created account activation: `/customer/setup#setup_token=...`
- Customer auth API: `/api/auth/customer/*`, `/api/auth/me`, `/api/auth/logout`
- Customer-scoped wallet API: `/api/v1/customer/*`

The Worker protects `/admin*` and administrator `/api/*` routes with the
application Admin session, while the isolated React router still returns 404
for Nest-only pages. Cregis callbacks remain public but signature-verified. A
customer ID supplied by a browser is never used as the authorization scope;
the API derives the customer ID from the validated session.

Only USDT on TRON TRC20 is accepted:

- Cregis chain ID: `195`
- Cregis token ID: `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`
- Cregis currency ID: `195@TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`

Do not change the existing legacy wallet row to these identifiers. Create a
new customer, then create a new wallet using that new customer ID. Public
applicants choose their password during registration; only its salted, peppered
Argon2id result is stored. The password cannot authenticate until both manual
approval gates have passed. Admin-created customers without a password retain
the 30-minute setup-link and TOTP fallback flow.

The rollout order is mandatory:

1. Back up Render PostgreSQL, record SHA-256, restore it into an isolated
   PostgreSQL 17 database, and assert business row counts and invariants.
2. Review and apply `migrations-postgres/0004_admin_auth.sql` with the guarded
   `server-go/cmd/postgres-migrate` command, then verify the migration record,
   five Admin tables, constraints, and unchanged business row counts.
3. Configure the Admin and customer authentication secrets and
   `CUSTOMER_PORTAL_BASE_URL` without exposing their values.
4. Deploy the Go API and D1-free web Worker separately; assert
   the response body and customer data scope at each boundary.
5. Submit a public application with email and password through
   `POST /api/auth/customer/register`, or create a pending customer through
   `POST /api/v1/admin/customers`. Public registration stores only the password
   hash and keeps login disabled; it requires a same-origin request and an
   `Idempotency-Key` header. The admin-created route does not issue credentials.
6. Review the customer with `PATCH /api/v1/admin/customers/:id/kyc`, recording a
   reason for rejection, then separately activate an approved customer with
   `PATCH /api/v1/admin/customers/:id/activate`.
7. Approval changes a public applicant with a stored password to `active`; the
   customer can then sign in directly with the registration email and password.
   For admin-created `pending_setup` customers without a password, deliver the
   activation response's one-time setup URL securely and complete the legacy
   password and TOTP setup. An already active customer is restored without
   resetting credentials or issuing a new setup URL.
8. Only after status is `active`, KYC is `approved`, and operations is `active`,
   create a new wallet through `POST /api/v1/crypto/wallets`. This is the first
   step that calls Cregis and requires explicit approval.
9. Verify customer login and an empty, customer-scoped history, then test a
   small deposit callback and reconcile it in the customer and admin
   histories.
10. Submit a small withdrawal, approve it explicitly, send it to Cregis, and
    reconcile the final signed payout callback. Submission or approval alone is
    not completion.

## Production enablement gate

Before changing `CREGIS_ENABLED` to `true`:

1. Rotate the Cregis secret that was previously shared outside the secret
   manager and install the replacement directly in Render.
2. Add the verified fixed relay IPv4 address to the Cregis IP allowlist. Confirm
   that the address is an AWS Elastic IP before enabling Cregis; an auto-assigned
   instance address can change after a stop/start. Render must reach Cregis only
   through the dedicated authenticated relay.
3. Confirm the two HTTPS callback endpoints are reachable and the Cregis
   notification categories for deposit and payout are enabled.
4. Confirm only the configured Admin identity can complete password + TOTP
   setup and that unauthenticated Admin API requests are rejected.
5. Confirm the intended administrator can submit and then approve or reject the
   same request, while each action remains separately audited.
6. Create a test wallet, verify it belongs to the configured Cregis project via
   `POST /api/v1/address/inner`, and confirm the Portal does not expose the
   address before that verification succeeds.
7. Obtain explicit approval before any test that can create a real payout.

## Acceptance evidence

Keep separate evidence for source validation, Cloudflare deployment, Render
deployment, PostgreSQL backup/migration/restore, callback verification, and business-state
assertions. A successful HTTP response alone is not wallet acceptance.

The historical whole-core move from D1 to Render PostgreSQL is recorded in
[`NEOBANK_POSTGRES_CUTOVER.md`](./NEOBANK_POSTGRES_CUTOVER.md). GitHub push,
PostgreSQL migration, Render deploy, Cloudflare deploy, and Access policy changes
remain separately verified operations.
