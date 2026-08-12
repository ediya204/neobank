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

## Required Render environment variables

Set values in the Render dashboard. Never commit or paste secret values into a
ticket, chat, log, or repository.

| Name | Secret | Initial value or source |
| --- | --- | --- |
| `D1_GATEWAY_URL` | No | URL of `neobank-d1-gateway` |
| `D1_GATEWAY_SECRET` | Yes | Same random value as the Worker secret |
| `EDGE_SHARED_SECRET` | Yes | Same random value as the web Worker secret |
| `PUBLIC_BASE_URL` | No | Render service origin, without a trailing slash |
| `CUSTOMER_PORTAL_BASE_URL` | No | Public customer Portal origin, without a trailing slash |
| `TENANT_ID` | No | `neobank` |
| `CUSTOMER_PASSWORD_PEPPER` | Yes | Separate random value of at least 32 bytes |
| `CUSTOMER_TOTP_KEY` | Yes | Random 32-byte AES key encoded as hex or Base64 |
| `CUSTOMER_RECOVERY_PEPPER` | Yes | Separate random value of at least 32 bytes |
| `CREGIS_BASE_URL` | No | Test gateway while commissioning |
| `CREGIS_ENABLED` | No | `false` until the acceptance gate passes |
| `CREGIS_PROJECT_ID` | Sensitive | Cregis project configuration |
| `CREGIS_PROJECT_SECRET` | Yes | Newly rotated Cregis secret |
| `CREGIS_RELAY_URL` | No | Dedicated HTTPS origin for the Neobank-only egress relay |
| `CREGIS_RELAY_SECRET` | Yes | Separate random HMAC secret shared only with the relay |

`CREGIS_RELAY_URL` affects only the Cregis client. Do not configure a global
`HTTP_PROXY` or `HTTPS_PROXY`, because D1 gateway traffic must remain direct.
The relay accepts only the Cregis address-create, address-legality, and payout
paths, authenticates the complete request body, rejects replayed nonces, and
pins its upstream to the configured Cregis test gateway.

## Callback endpoints

The Go service supplies distinct callback URLs on Cregis requests:

- `POST /api/v1/callbacks/cregis/deposit`
- `POST /api/v1/callbacks/cregis/payout`

Cregis callbacks are verified using the Cregis signature protocol and must
return the literal response `success` only after the notification is accepted.
Keep retry notifications enabled in Cregis.

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
Cloudflare Access. Cregis callbacks remain public but signature-verified. A
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
2. Apply `migrations-core/0002_customer_auth.sql` to the isolated restore and
   run `PRAGMA foreign_key_check`.
3. Configure the three new authentication secrets and
   `CUSTOMER_PORTAL_BASE_URL` without exposing their values.
4. Deploy the D1 gateway allowlist, Go API, and web Worker separately; assert
   the response body and customer data scope at each boundary.
5. Create a new pending customer through `POST /api/v1/admin/customers`.
6. Create a new wallet through `POST /api/v1/crypto/wallets` using only the new
   customer ID. This is the first step that calls Cregis and requires explicit
   approval.
7. Deliver the returned setup URL securely, complete password and TOTP setup,
   then verify login and an empty, customer-scoped history.
8. Test a small deposit callback and reconcile it in the customer and admin
   histories.
9. Submit a small withdrawal, approve it explicitly, send it to Cregis, and
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
6. Create a test wallet and reconcile the callback/history records.
7. Obtain explicit approval before any test that can create a real payout.

## Acceptance evidence

Keep separate evidence for source validation, Cloudflare deployment, Render
deployment, D1 migration/restore, callback verification, and business-state
assertions. A successful HTTP response alone is not wallet acceptance.
