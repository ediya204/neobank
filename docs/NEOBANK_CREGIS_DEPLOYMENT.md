# Neobank Cregis deployment runbook

This runbook covers the isolated Neobank wallet service only. It does not claim
that the existing application backend has been fully replaced by Go.

## Isolation boundary

- Cloudflare Worker: `neobank-d1-gateway`
- Cloudflare D1: `neobank-core-v1`
- Render service: `neobank`
- Tenant identifier: `neobank`
- Cregis calls remain disabled until the credential, outbound IP allowlist, and
  callback checks are complete.

Do not reuse or migrate an existing Worker, D1 database, Render service, or
Cloudflare Access application for this deployment.

## Production web profile

The production web build is an explicit allowlist, selected at compile time with
`REACT_APP_NEOBANK_DEPLOYMENT_MODE=isolated-wallet`. It exposes only:

| Audience      | Browser routes                                          | Authentication source                              |
| ------------- | ------------------------------------------------------- | -------------------------------------------------- |
| Customer      | `/customer/login`, `/customer/setup`                    | Go customer session, CSRF token, password and TOTP |
| Customer      | `/portal/crypto-wallet` plus `/deposit` and `/withdraw` | Same validated customer session                    |
| Administrator | `/admin/neobank-crypto`                                 | Cloudflare Access JWT plus `NEOBANK_ADMIN_EMAILS`  |

All Partner Portal, general Dashboard, admin password-login, registration, and
other Nest-only routes render the safe 404 page in this profile. The default
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

Every Wrangler command above names `wrangler.neobank.jsonc`; none defaults to
the `va-api-dashboard` configuration. `npm run cf:release` belongs to the VA API
deployment and is not a Neobank release command.

The web Worker derives an administrator session only from
`CF-Access-Jwt-Assertion`. It validates the RS256 signature against the team
JWKS, issuer, application audience, expiry, and then the normalized email
allowlist before `GET /api/auth/access-admin/session` returns an admin user.
Browser headers, query parameters, the local identity selector, and
`x-user-id` are never accepted as a production administrator identity.

## Required Render environment variables

Set values in the Render dashboard. Never commit or paste secret values into a
ticket, chat, log, or repository.

| Name                       | Secret    | Initial value or source                                  |
| -------------------------- | --------- | -------------------------------------------------------- |
| `D1_GATEWAY_URL`           | No        | URL of `neobank-d1-gateway`                              |
| `D1_GATEWAY_SECRET`        | Yes       | Same random value as the Worker secret                   |
| `EDGE_SHARED_SECRET`       | Yes       | Same random value as the web Worker secret               |
| `PUBLIC_BASE_URL`          | No        | Render service origin, without a trailing slash          |
| `CUSTOMER_PORTAL_BASE_URL` | No        | Public customer Portal origin, without a trailing slash  |
| `TENANT_ID`                | No        | `neobank`                                                |
| `CUSTOMER_PASSWORD_PEPPER` | Yes       | Separate random value of at least 32 bytes               |
| `CUSTOMER_TOTP_KEY`        | Yes       | Random 32-byte AES key encoded as hex or Base64          |
| `CUSTOMER_RECOVERY_PEPPER` | Yes       | Separate random value of at least 32 bytes               |
| `FASTFOREX_API_KEY`        | Yes       | Rotated FastForex key; configure directly in Render      |
| `CREGIS_BASE_URL`          | No        | Test gateway while commissioning                         |
| `CREGIS_ENABLED`           | No        | `false` until the acceptance gate passes                 |
| `CREGIS_PROJECT_ID`        | Sensitive | Cregis project configuration                             |
| `CREGIS_PROJECT_SECRET`    | Yes       | Newly rotated Cregis secret                              |
| `CREGIS_RELAY_URL`         | No        | Dedicated HTTPS origin for the Neobank-only egress relay |
| `CREGIS_RELAY_SECRET`      | Yes       | Separate random HMAC secret shared only with the relay   |

`CREGIS_RELAY_URL` affects only the Cregis client. Do not configure a global
`HTTP_PROXY` or `HTTPS_PROXY`, because D1 gateway traffic must remain direct.
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
events are stored in the isolated D1 database. Passwords are never stored:
the API stores only a random salt and a peppered PBKDF2-HMAC-SHA-256 result.
TOTP secrets are encrypted with the dedicated AES key. Session tokens, CSRF
tokens, setup tokens, and login challenges are stored only as hashes.

The customer routes use the application session instead of Cloudflare Access:

- Login: `/customer/login`
- One-time activation: `/customer/setup#setup_token=...`
- Customer auth API: `/api/auth/customer/*`, `/api/auth/me`, `/api/auth/logout`
- Customer-scoped wallet API: `/api/v1/customer/*`

The Worker keeps `/admin*`, `/dashboard*`, and every other `/api/*` route behind
Cloudflare Access, while the isolated React router still returns 404 for
Nest-only pages. Cregis callbacks remain public but signature-verified. A
customer ID supplied by a browser is never used as the authorization scope;
the API derives the customer ID from the validated session.

Only USDT on TRON TRC20 is accepted:

- Cregis chain ID: `195`
- Cregis token ID: `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`
- Cregis currency ID: `195@TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`

Do not change the existing legacy wallet row to these identifiers. Create a
new customer, then create a new wallet using that new customer ID. The operator
delivers the 30-minute setup URL through an approved secret channel; no default
password is generated or sent in chat. The customer chooses the password and
enrols TOTP.

The rollout order is mandatory:

1. Back up the production D1 database, record a checksum, and prove a restore
   into an isolated database.
2. Apply `migrations-core/0002_customer_auth.sql`,
   `migrations-core/0003_cregis_wallet_deposit_gate.sql`, and
   `migrations-core/0004_customer_kyc_atomic_funds.sql` to the isolated restore,
   then run `PRAGMA foreign_key_check`. Migration `0004` intentionally leaves
   existing customers at KYC pending and operations pending; do not backfill
   approval without a real review.
3. Configure the three new authentication secrets and
   `CUSTOMER_PORTAL_BASE_URL` without exposing their values.
4. Deploy the D1 gateway allowlist, Go API, and web Worker separately; assert
   the response body and customer data scope at each boundary.
5. Create a pending customer through `POST /api/v1/admin/customers`. Creation
   does not issue credentials or a setup URL.
6. Review the customer with `PATCH /api/v1/admin/customers/:id/kyc`, recording a
   reason for rejection, then separately activate an approved customer with
   `PATCH /api/v1/admin/customers/:id/activate`.
7. For `pending_setup` customers only, deliver the activation response's
   one-time setup URL securely and complete password and TOTP setup. An already
   active customer is restored to operations-active without resetting
   credentials or issuing a new setup URL.
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
4. Confirm Cloudflare Access admits only the intended Neobank operators.
5. Confirm the intended administrator can submit and then approve or reject the
   same request, while each action remains separately audited.
6. Create a test wallet, verify it belongs to the configured Cregis project via
   `POST /api/v1/address/inner`, and confirm the Portal does not expose the
   address before that verification succeeds.
7. Obtain explicit approval before any test that can create a real payout.

## Acceptance evidence

Keep separate evidence for source validation, Cloudflare deployment, Render
deployment, D1 migration/restore, callback verification, and business-state
assertions. A successful HTTP response alone is not wallet acceptance.
