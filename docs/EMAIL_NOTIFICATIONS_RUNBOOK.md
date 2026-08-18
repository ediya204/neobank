# Email notifications runbook

## Scope and authority

Email notifications run in the Render `neobank-core` stack and persist in
`neobank-postgres`. D1 is deprecated and is not part of this design. The Go
`neobank` service remains responsible for its existing authentication/Cregis
boundaries; it does not send customer lifecycle email.

The email feature is disabled unless `EMAIL_NOTIFICATIONS_ENABLED=true`. A code
deployment, a PostgreSQL migration, a Render worker creation, an environment
update, and a real email send are separate actions and must be reported
separately.

## Architecture

Business mutations enqueue a minimal template payload in `EmailOutbox` inside
the same Prisma/PostgreSQL transaction. A dedicated Render background worker
runs `npm run start:email-worker`, claims rows with `FOR UPDATE SKIP LOCKED`, and
sends through the Zoho Mail REST API. Delivery is at least once: a process crash
after Zoho accepts a message but before PostgreSQL records `SENT` can cause a
duplicate, so every template must remain informational and idempotent.

Outbox states:

- `PENDING`: ready now or scheduled for retry.
- `PROCESSING`: claimed by a worker. Locks older than ten minutes are recovered.
- `SENT`: Zoho accepted the message.
- `DEAD`: a permanent failure or the maximum attempt count was reached.

No template may include balances, full bank account details, wallet addresses,
credentials, internal reviewer identity, internal notes, or rejection reasons.

## Zoho OAuth

Use one dedicated Zoho OAuth client for the service mailbox. Grant only:

- `ZohoMail.messages.CREATE`
- `ZohoMail.accounts.READ`

The second scope is used during setup to resolve the mailbox `accountId`; normal
delivery only creates messages. Never configure the mailbox login password as
an application secret.

Required Render secrets for the email worker only:

- `ZOHO_OAUTH_CLIENT_ID`
- `ZOHO_OAUTH_CLIENT_SECRET`
- `ZOHO_OAUTH_REFRESH_TOKEN`

Required non-secret settings:

- `ZOHO_MAIL_ACCOUNT_ID`
- `ZOHO_MAIL_FROM_ADDRESS`
- `ZOHO_ACCOUNTS_BASE_URL=https://accounts.zoho.com`
- `ZOHO_MAIL_API_BASE_URL=https://mail.zoho.com/api`
- `PORTAL_BASE_URL=https://portal.sscdigitalbank.com`
- `EMAIL_WORKER_POLL_INTERVAL_MS=5000`

Keep `EMAIL_NOTIFICATIONS_ENABLED=false` until the migration, worker health,
OAuth token exchange, and a controlled test recipient have all passed.
The web service needs only this feature flag to decide whether a business
transaction should enqueue a notification; it does not need Zoho credentials.

## Local verification

From `server/`:

```bash
npm ci
npm run prisma:generate
npm run build
node --test --test-concurrency=1 \
  test/customer-kyc-policy.test.mjs \
  test/edge-auth.test.mjs \
  test/operation-policy.test.mjs \
  test/email-notifications.test.mjs
```

For a local PostgreSQL test, apply migrations only to a disposable local
database. Leave `EMAIL_NOTIFICATIONS_ENABLED=false` when running lifecycle tests
that should not enqueue messages.

## Production gate

1. Take a complete PostgreSQL backup, record its checksum, restore-test it, and
   verify table counts and financial invariants.
2. Review the exact migration SQL and apply it to PostgreSQL separately from
   code deployment.
3. Deploy `neobank-core` with email disabled and verify health/business APIs.
4. Create a Render background worker from the same repository and commit. Use
   root directory `server`, build command
   `npm ci --include=dev && npm run prisma:generate && npm run build`, and start
   command `npm run start:email-worker`.
5. Put OAuth secrets in Render environment variables without logging or copying
   them into the repository. Give the worker the same internal `DATABASE_URL`.
6. With a controlled recipient, enable notifications and enqueue exactly one
   non-financial test message. Verify the Zoho API response, `SENT` row, sender,
   recipient, subject, HTML rendering, and inbox delivery.
7. Verify retry behavior with a non-production mock endpoint before accepting
   the real integration. Inspect `DEAD` rows without exposing recipients or
   payloads in logs.

Do not deploy, migrate, create a paid worker, or send a real email merely because
the local implementation and tests pass.
