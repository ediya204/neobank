# Customer Security Center P0-P2

This runbook covers the customer-facing security center backed only by Render
PostgreSQL. It does not introduce a second datastore or a financial execution
path.

## Scope

- P0: security overview, authenticated password change, TOTP enrollment and
  replacement, one-time recovery-code regeneration, active-session review and
  revocation, and customer-visible security activity.
- P1: discoverable WebAuthn passkey registration/login/removal, verified login
  email change with a 24-hour cooling period, and immediate withdrawal lock with
  a separate 24-hour unlock cooling period.
- P2: customer data export and a cancellable account-closure request that enters
  manual review.

Password recovery remains email-link based and intentionally does not require
TOTP. Every signed-in sensitive security mutation requires the current password,
a fresh six-digit TOTP code, same-origin CSRF, a current credential version, and
an unrevoked customer session. A successful password, TOTP, or email change
invalidates outstanding login state and revokes other sessions.

Account closure never moves, settles, broadcasts, or withdraws funds. It creates
only a `pending` manual-review request. The customer may cancel it while pending.

## Privacy and secret boundaries

- Session tokens, CSRF tokens, password hashes, TOTP secrets, recovery codes,
  WebAuthn challenges, and raw IP/User-Agent values are never returned by the
  security summary or data export.
- Session context stores only purpose-bound SHA-256 hashes and a sanitized device
  label. The UI does not expose those hashes.
- Passkey credential material and WebAuthn challenge sessions are encrypted with
  AES-GCM using the existing customer auth key and distinct purpose strings.
- Passkey credential IDs remain lookup identifiers; they are not authentication
  secrets. User verification is required for passkey login.
- Security email copy is selected from a server allowlist. Arbitrary database
  content cannot become an email subject or body.
- Data export excludes credentials, authentication secrets, queue state,
  internal operator identities, and internal notes.

## PostgreSQL migration

Migration `migrations-postgres/0013_customer_security_center.sql` adds the
withdrawal-lock state, privacy-preserving session metadata, passkey/challenge,
email-change, and account-closure records plus the two email template enum values.

Production procedure:

1. Inspect the exact database and current migration state.
2. Create a complete custom-format `pg_dump` outside the repository.
3. Record SHA-256 and file size, restore into an isolated PostgreSQL database,
   and compare table counts and financial invariants.
4. Record the SHA-256 of migration `0013`; obtain explicit approval for that
   digest and database.
5. Apply only the reviewed migration with the PostgreSQL migrator.
6. Verify the migration record, columns, indexes, constraints, unchanged business
   row counts, and unchanged financial invariants.
7. Deploy application services separately. Never infer migration success from a
   Render deploy or HTTP health response.

## Deployment order

1. Complete the backup/restore/migration gate above.
2. Publish the reviewed commit to GitHub `main`.
3. Deploy the Go customer-auth service and the Core/email service from that exact
   commit. Keep `CUSTOMER_PASSWORD_RESET_SECRET` identical without displaying it.
4. Deploy the `neobank-web` Worker from the same commit.
5. Verify Render service health and revision, Cloudflare Worker version/traffic,
   GitHub main SHA, PostgreSQL migration state, and authenticated response fields
   as separate evidence.

## Acceptance checks

- Go unit tests prove purpose-bound encryption and hashed session context.
- Core tests prove email-change token derivation and allowlisted security alerts.
- TypeScript, i18n, docs, accounting, security, build, and deploy dry-run gates
  pass.
- Desktop and mobile visual QA compare the implementation against the supplied
  settings reference at the same viewport/state.
- Authenticated acceptance validates response fields and state transitions, not
  only HTTP status. No acceptance test initiates a real withdrawal or external
  transfer.
- A live customer credential is required to test WebAuthn, TOTP replacement, or
  step-up mutations in production. Do not synthesize or reset one merely for a
  deployment check.
