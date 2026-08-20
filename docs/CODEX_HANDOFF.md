# Codex travel handoff

Updated: 19 August 2026 (Asia/Hong_Kong)

## Mandatory datastore direction

Read `docs/DATASTORE_POLICY.md` first. Render PostgreSQL is the only datastore in
scope. D1 must not be considered in new code, planning, alternatives, fallbacks,
local development, tests, deployments, migrations, reviews, or acceptance. Any D1
reference remaining in this handoff or elsewhere in the repository is historical
evidence only and is overridden by that policy.

## Start here

This private repository contains the VA API Dashboard, Partner Portal,
Cloudflare web Worker, Render services, PostgreSQL migrations, documentation, and
local-test source. Continue from `main`; feature-branch names and deployment IDs
in older notes are historical.

On a new computer:

```bash
git clone https://github.com/ediya204/neobank.git
cd neobank
nvm install
nvm use
npm ci
npm run local:core:bootstrap
npm run dev
```

Follow `docs/LOCAL_FULL_STACK.md`. Never copy production secrets, databases, or
local state to the new computer.

Suggested first prompt to Codex:

> Read AGENTS.md and the handoff documents it references. Inspect current Git
> status, origin/main, migrations, and relevant code before changing anything.
> Treat all deployment notes as historical until verified live.

## Reproducible development contract

- Node is pinned by `.nvmrc`; npm and engine expectations are declared in
  `package.json`.
- `npm ci` uses the committed `package-lock.json`.
- Use the PostgreSQL-only local full-stack procedure in
  `docs/LOCAL_FULL_STACK.md`. Do not use D1-backed bootstrap, migration, seed, or
  test paths for current development.
- `.dev.vars`, `.local-auth`, `.wrangler`, build output, database exports, and
  `.learnings` remain excluded from Git. Keep temporary screenshots outside the
  repository unless they are intentionally reviewed product assets.
- Local development does not require Cloudflare production credentials.

## Current release scope

The source includes:

- Partner API V1.3 read-only USDT sweep reconciliation with pagination, detail,
  tenant isolation, completed transaction-history entries, and hardened state
  guards.
- Precise Webhook signature documentation and reconciliation guidance.
- Optional VA-account IBAN alongside the existing account number.
- Partner-managed team membership, invitations, built-in/custom roles, 12
  configurable non-financial permissions, final-Owner protection, server-side
  tenant resolution, and password + TOTP invitation activation.
- Real password change with TOTP, credential-version race protection, other-session
  revocation, and audit logging.
- FastForex-backed FX/OTC fee policies: active quotes are recomputed from live
  midpoint data. Customer OTC uses a server-fetched five-second `DRAFT` snapshot;
  explicit confirmation atomically posts it without approval, while expiration
  makes no balance change. Direct operation creation cannot bypass this gate.
- Automatic account-opening completion: an active, KYC-approved customer receives
  idempotent zero-balance USD/HKD standard fiat accounts during Core synchronization;
  the Admin UI has no manual standard-fiat-account creation action.
- Dedicated Admin KYC workflow: pending/rejected applications live at
  `/dashboard/onboarding`, decisions are made at
  `/dashboard/onboarding/:id/review`, and `/dashboard/customers` contains only
  KYC-approved customers with real account, wallet, balance, and sync fields.
- Sumsub individual KYC integration is present in source but disabled by default:
  `/portal/register` can launch WebSDK passport, liveness/face, and proof-of-address
  checks; signed Webhooks plus an idempotent reconciliation worker feed the Admin KYC
  workspace. Provider GREEN only unlocks manual review. Production still requires
  reviewed PostgreSQL migration `0008`, Sumsub Level/Webhook setup, secrets, explicit
  `SUMSUB_ENABLED=true`, deployment, and Sandbox acceptance evidence.
- Dedicated Admin VA fulfilment: Portal customers submit bank/currency/purpose
  requests after activation; Admin processes them at
  `/dashboard/operations/virtual-accounts` and its detail route, where customer
  selections are read-only and only real assigned account details or a
  customer-visible rejection reason can be recorded.
- Customer-specific withdrawal-fee management now lists every configured fiat
  payout channel/currency alongside Cregis USDT/TRON. Missing or disabled institution
  defaults are visible blocking states, and admins can either manage the institution
  rule or enable an isolated customer override without inventing a zero fee.
- Customer detail asset presentation: `/dashboard/customers/:id` groups the
  account view into system wallets, VA wallets, and digital-currency wallets;
  every product row shows its own account metadata and book, available, and
  frozen assets without combining currencies.
- Admin navigation normalization: canonical business names are shared by the
  sidebar, overview shortcuts, and page headings. Duplicate balance and USDT
  entries are redirects only, and reconciliation resolves to its actual workspace.
  The standalone business-approval entry is removed for the single-admin model;
  overview queue links open status-filtered transaction records, where explicit
  approve, reject, and execute actions remain available in the record detail.
  The old D1-backed audit page is intentionally absent from the Render-only sidebar
  and its legacy route resolves to 404 pending a PostgreSQL implementation.
- Responsive Portal layouts and en-US/zh-CN copy across desktop, tablet, mobile,
  and short landscape viewports.
- Local transaction-history and Webhook demo fixtures used by the travel setup.

Partner roles cannot perform settlement, ledger posting, withdrawal, manual OTC,
or USDT sweep operations. Those financial boundaries remain administrator-controlled
and manually confirmed.

## Database migrations

For current database changes, use PostgreSQL migrations only. Before any
production PostgreSQL migration, make a complete backup, record its checksum,
restore-test it separately, verify integrity and business row counts, obtain
manual approval, then perform an auditable post-check.

## Validation expectations

Before publishing or deploying, run at least:

```bash
npm run typecheck
npm run i18n:check
npm run docs:check
npm run webhook-security:check
npm run accounting:check
npm run api:test
npm run api:build
npm run local:core:check
npm run neobank:profile:check
npm run neobank:typecheck
npm run neobank:deploy:dry-run
```

Then verify a fresh clone with `npm ci`, `npm run local:core:bootstrap`, and the
PostgreSQL-only checks relevant to the change. Cloudflare Access redirects or HTTP
200/403 responses prove only the transport/protection layer; business acceptance
still requires authenticated response fields, tenant isolation, and
state-transition assertions.

## Live-state rule

This document intentionally does not pin a Worker version or claim that production
is current. After cloning, verify `origin/main`, Render service and PostgreSQL
migration state, `wrangler whoami`, the deployed web Worker version, and live
endpoints. A dated release report is evidence only for the exact publication and
deployment it verifies.
