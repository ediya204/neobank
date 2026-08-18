# Datastore policy: PostgreSQL only

Updated: 19 August 2026 (Asia/Hong_Kong)

This is a non-negotiable project instruction.

- Render PostgreSQL is the only authoritative and supported business datastore.
- Do not consider, propose, compare, select, design for, implement, test, deploy,
  migrate to, or retain Cloudflare D1 for any new or changed functionality.
- Do not include D1 as an alternative, fallback, rollback path, compatibility
  target, local-development target, or future option in plans or code reviews.
- Do not create or modify D1 schemas, migrations, bindings, gateways, adapters,
  queries, test fixtures, deployment steps, or acceptance checks.
- Existing D1 code, migrations, bindings, runbooks, and historical references are
  legacy evidence only. They are not current architecture and must not influence
  implementation or planning. Do not maintain them unless the user explicitly
  requests their removal or archival.
- New database work, local development, tests, backups, migrations, recovery,
  deployment, and acceptance must use PostgreSQL-compatible paths only.

Only a new, explicit user instruction that specifically reverses this policy may
restore D1 to scope. Ambiguity, historical documentation, existing D1 files, old
deployment state, or apparent implementation convenience must never be treated as
permission to consider D1.
