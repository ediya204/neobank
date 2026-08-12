# Codex travel handoff

Updated: 2 August 2026 (Asia/Hong_Kong)

## Start here

This private repository is the complete VA API Dashboard, Partner Portal,
Cloudflare Worker, D1 migration, documentation, and local-test source. Continue
from `main`; feature-branch names and deployment IDs in older notes are historical.

On a new computer:

```bash
git clone https://github.com/ediya204/neobank.git
cd neobank
nvm install
nvm use
npm ci
npm run local:bootstrap
npm run cf:dev:local
```

In a second terminal, run `npm run local:auth:link` and
`npm run local:auth:partner-link`, then enroll separate local-only Admin and
Partner passwords and TOTP authenticators from the generated links. Follow
`docs/LOCAL_DEVELOPMENT.md`. Never copy production secrets or local D1 files to
the new computer.

Suggested first prompt to Codex:

> Read AGENTS.md and the handoff documents it references. Inspect current Git
> status, origin/main, migrations, and relevant code before changing anything.
> Treat all deployment notes as historical until verified live.

## Reproducible development contract

- Node is pinned by `.nvmrc`; npm and engine expectations are declared in
  `package.json`.
- `npm ci` uses the committed `package-lock.json`.
- `npm run local:bootstrap` creates missing local-only auth secrets, applies all
  migrations to local D1, and installs idempotent synthetic demo data.
- `.dev.vars`, `.local-auth`, `.wrangler`, build output, database exports, and
  `.learnings` remain excluded from Git. Keep temporary screenshots outside the
  repository unless they are intentionally reviewed product assets.
- Local development does not require Cloudflare production credentials.

## Current release scope

The source includes:

- Partner API V1.3 read-only USDT sweep reconciliation with pagination, detail,
  tenant isolation, completed transaction-history entries, and hardened D1 state
  guards.
- Precise Webhook signature documentation and reconciliation guidance.
- Optional VA-account IBAN alongside the existing account number.
- Partner-managed team membership, invitations, built-in/custom roles, 12
  configurable non-financial permissions, final-Owner protection, server-side
  tenant resolution, and password + TOTP invitation activation.
- Real password change with TOTP, credential-version race protection, other-session
  revocation, and audit logging.
- Responsive Portal layouts and en-US/zh-CN copy across desktop, tablet, mobile,
  and short landscape viewports.
- Local transaction-history and Webhook demo fixtures used by the travel setup.

Partner roles cannot perform settlement, ledger posting, withdrawal, manual OTC,
or USDT sweep operations. Those financial boundaries remain administrator-controlled
and manually confirmed.

## Migration order

Wrangler records the complete migration filename. Preserve the two already
established `0018` filenames and apply new migrations in this order:

1. `0019_va_account_optional_iban.sql`
2. `0020_portal_team_rbac.sql`
3. `0021_auth_challenge_credential_version.sql`
4. `0022_sweep_tenant_and_state_guards.sql`
5. `0023_portal_role_mutation_guard.sql`
6. `0024_partner_customer_id.sql`
7. `0025_managed_webhook_signing_keys.sql`
8. `0026_va_application_changes_requested.sql`

Before any remote migration, make a complete D1 export, record its checksum,
restore it separately, verify integrity and table counts, then run the financial
invariant preflight. Apply migrations before deploying Worker code that depends
on the new schema.

## Validation expectations

Before publishing or deploying, run at least:

```bash
npm run typecheck
npm run i18n:check
npm run docs:check
npm run webhook-security:check
npm run accounting:check
npm run auth:smoke
bash scripts/portal-team-rbac-check.sh
npm run db:preflight:remote
npm run cf:deploy:dry-run
```

Then verify a fresh clone with `npm ci` and `npm run local:bootstrap`. Cloudflare
Access redirects or HTTP 200/403 responses prove only the transport/protection
layer; business acceptance still requires authenticated response fields, tenant
isolation, and state-transition assertions.

## Live-state rule

This document intentionally does not pin a Worker version or claim that production
is current. After cloning, verify `origin/main`, `wrangler whoami`, remote pending
migrations, the deployed Worker version, and live endpoints. The release task's
final report is the dated evidence for the publication and deployment performed on
2 August 2026.
