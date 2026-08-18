# Curated collaboration history

This is a privacy-reduced summary of important conversations, not a raw transcript.
It preserves decisions and task identifiers without copying credentials, customer
records, temporary links, local database contents, or internal tool output.

## Current datastore instruction

Render PostgreSQL is the only datastore in scope. D1 references below are
historical context only and must never be used to propose, plan, implement, test,
deploy, or review current work. `docs/DATASTORE_POLICY.md` overrides every older
D1-related note in this history.

## Core product direction

- Initial VA planning established a manually controlled lifecycle: create an
  application, hand off KYC, manually activate the VA account, record financial
  actions, and keep sensitive money movement under operator confirmation.
- The business was later narrowed to manual fiat receipt, explicit clearing,
  automatic fiat-to-USDT conversion, and administrator-controlled USDT/TRON sweep.
- Customer-facing manual OTC and unrelated deposit/withdrawal write paths were
  removed or disabled while historical visibility and audit records were retained.

## Accounting and security corrections

- A review identified that fiat deposit completion could bypass clearing and that a
  submitted sweep could be cancelled after a transaction hash existed.
- The resulting workflow guards require proper fiat settlement before automatic
  conversion and distinguish locked cancellation from submitted completion or
  exception handling.
- Ledger immutability, idempotency, network-specific balances, and manual approval
  are continuing invariants.

## Portal and Dashboard evolution

- Portal API integration management was split into clearer management areas.
- Dashboard and Portal transaction history were aligned while keeping operational
  actions restricted to authorized administrators.
- Wallet views gained summaries, transaction direction indicators, and visibility
  for automatic conversion and completed sweep effects.
- Authentication and local development were hardened so Admin local testing uses a
  separate local identity, password, TOTP, session, CSRF, and recovery setup.

## Partner notification and reconciliation

- The collaboration decided not to choose between Webhook and queries.
- Webhook is used for real-time events; consumers verify and deduplicate it.
- Query APIs are used for recovery, reconciliation, and audit.
- Completed sweep debits appear in transaction history with batch and chain
  references.
- Partner-scoped sweep-batch endpoints expose the current batch and per-customer
  detail without exposing another Partner's data or internal operational metadata.

## Historical sweep source task

Task `019fbebe-4b02-7662-b0b7-7591ff531ad5` produced:

- commit `5d6bdae`: completed USDT sweeps in Partner transaction history
- commit `3b98733`: Partner-scoped sweep batch reconciliation
- commit `c562c27`: secure bilingual reconciliation documentation

That task's final state was local and validated at the time. Its changes were later
integrated with the Portal team, authentication, IBAN, responsive UI, and security
hardening work on the `main` release line. Do not use the historical commit or
migration status above as proof of the current GitHub or Cloudflare state.

## How to use this history

Treat this file as orientation. Before continuing any item, inspect current code,
Git history, current Cloudflare configuration, and relevant data state. If there is
a conflict, the user's newest explicit instruction and verified current state take
priority over this historical summary.
