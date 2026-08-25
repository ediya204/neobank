# Neobank project handoff

Updated: 25 August 2026 (Asia/Hong_Kong)

## Architecture boundary

This repository contains only the SSC Digital Bank Neobank product:

- React/TypeScript Admin and Customer Portal;
- the D1-free Cloudflare `neobank-web` Worker;
- Render Go API, Nest Core API, email/accounting workers, and PostgreSQL;
- PostgreSQL migrations, local full-stack tooling, and product runbooks.

The former VA API / Partner Portal / Partner machine API surface was removed. Do
not reintroduce Partner roles, Partner API credentials, Partner Webhooks, the old
default Worker, or the old D1 migration chain without a new explicit product
decision from the user.

## Datastore

Read `docs/DATASTORE_POLICY.md` first. Render PostgreSQL is the only supported
business datastore. D1 references that remain in historical cutover evidence or
internal compatibility types do not authorize a D1 runtime, deployment, test
profile, fallback, or new migration.

## Start locally

```bash
nvm use
npm ci
npm run local:core:bootstrap
npm run dev
```

See `docs/LOCAL_FULL_STACK.md`. Local state, credentials, `.wrangler`, build
output, database exports, production data, and `.learnings` must not be committed.

## Current product scope

- Customer registration, password/TOTP/passkey security, email verification,
  Sumsub-assisted KYC, manual Admin approval, and account activation.
- USD/HKD system wallets, virtual accounts, and USDT-TRON wallets.
- Explicit pending, cleared, exception, submitted, completed, and cancelled
  financial states with balanced Core accounting.
- Customer-confirmed fifteen-second OTC quotes and Admin-controlled external payout
  execution.
- Cregis callback verification and exactly-once accounting intent processing.
- Admin KYC, customer/account management, funding channels, fees, operations,
  reconciliation, ledger, and RBAC.

No customer or Admin UI may infer settlement from data entry. No automated test
may move real bank or wallet funds.

## Validation

Run checks appropriate to the diff, normally:

```bash
npm run typecheck
npm run i18n:check
npm run icons:check
npm run country-codes:check
npm run api:test
npm run api:build
npm run local:core:check
npm run neobank:profile:check
npm run neobank:typecheck
npm run neobank:deploy:dry-run
git diff --check
```

Stateful local E2E tests run serially after `npm run local:core:bootstrap`.

## Release rule

Inspect the real branch, worktree, `origin/main`, deployed versions, and affected
services before making claims. Publish GitHub, Cloudflare, Render, and PostgreSQL
changes separately. Transport status or an Access redirect is not business
acceptance; assert the authenticated response, tenant scope, business fields, and
state transition.
