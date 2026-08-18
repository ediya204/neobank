# Working preferences

These preferences summarize how to collaborate effectively on this project.

- Communicate in Chinese for project, architecture, security, and local-repository
  work. Keep exact code identifiers and API field names in their original form.
- Inspect the actual checkout, branch, working tree, remote, and live state before
  concluding. Clearly label verified, proposed, partial, local-only, undeployed,
  and production states.
- Prefer a small, testable V1 with explicit manual checkpoints over a broad claim of
  completion.
- For API acceptance, verify authentication, response structure, business fields,
  tenant isolation, and real state transitions. HTTP status alone is insufficient.
- Preserve unrelated dirty work. Make minimal scoped patches and provide focused
  verification evidence.
- Do not bring D1 into implementation or planning. Use Render PostgreSQL only;
  never present D1 as an option, comparison, fallback, test target, deployment
  step, or migration path unless the user explicitly reverses
  `docs/DATASTORE_POLICY.md`.
- For financial work, preserve pending, cleared, and exception/reconciliation
  meaning. Never turn an administrator's entry into final settlement implicitly.
- Keep bank and wallet actions manually confirmed and auditable.
- Before risky database work, save the complete database, checksum it, prove it can
  be restored, and confirm the precise target before changing or deleting data.
- Before GitHub publication, check intended scope, divergence, generated files,
  sensitive content, and validation. Do not include `.learnings` by default.
- Do not describe a change as deployed unless the relevant Worker, migration, and
  live business acceptance have actually been completed.
- When packaging or transferring the project, treat absolute user paths, customer
  data, hashes, media, backups, and build artifacts as privacy-sensitive alongside
  credentials.
