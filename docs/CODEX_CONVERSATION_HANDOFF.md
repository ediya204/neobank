# Curated collaboration history

Updated: 25 August 2026 (Asia/Hong_Kong)

This file records only current Neobank decisions. Historical task details are not
proof of live state; inspect the repository and deployments again.

## Current direction

- Render PostgreSQL is the only business datastore.
- The repository is Neobank-only. The former Partner Portal, Partner machine API,
  Partner credentials/Webhooks, default D1 Worker, and D1 VA migration chain were
  removed on a separate cleanup branch after the consolidated release.
- Admin and Customer authentication are separate application sessions. Customer
  Portal routes always require the `customer` role.
- KYC approval is the final account-opening gate, but never approves or settles a
  withdrawal.
- Customer OTC requires a fresh server quote and explicit confirmation within five
  seconds. Expiry moves no money.
- Cregis custody state is not the accounting authority. Core journal posting is
  authoritative, idempotent, and auditable.
- GitHub publication, Cloudflare deployment, Render deployment, PostgreSQL
  migration, and real-funds activity must always be reported separately.

## Working rule

Preserve unrelated dirty work, run PostgreSQL-only checks, stage only intended
files, and never commit credentials, local state, database exports, build output,
or `.learnings`. Production database work requires full backup, checksum,
isolated restore proof, explicit approval, and a post-check.
