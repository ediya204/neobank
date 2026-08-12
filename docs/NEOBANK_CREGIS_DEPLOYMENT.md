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
| `TENANT_ID` | No | `neobank` |
| `CREGIS_BASE_URL` | No | Test gateway while commissioning |
| `CREGIS_ENABLED` | No | `false` until the acceptance gate passes |
| `CREGIS_PROJECT_ID` | Sensitive | Cregis project configuration |
| `CREGIS_PROJECT_SECRET` | Yes | Newly rotated Cregis secret |

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
Submission is not settlement. Approval and execution require different operator
identities, and a Cregis callback is required for the final result.

## Production enablement gate

Before changing `CREGIS_ENABLED` to `true`:

1. Rotate the Cregis secret that was previously shared outside the secret
   manager and install the replacement directly in Render.
2. Add every Render outbound address shown for the service to the Cregis IP
   allowlist. If Cregis requires fixed individual IPs, use Render Dedicated IPs.
3. Confirm the two HTTPS callback endpoints are reachable and the Cregis
   notification categories for deposit and payout are enabled.
4. Confirm Cloudflare Access admits only the intended Neobank operators.
5. Provide two distinct operator identities for maker/checker testing.
6. Create a test wallet and reconcile the callback/history records.
7. Obtain explicit approval before any test that can create a real payout.

## Acceptance evidence

Keep separate evidence for source validation, Cloudflare deployment, Render
deployment, D1 migration/restore, callback verification, and business-state
assertions. A successful HTTP response alone is not wallet acceptance.
