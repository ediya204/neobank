# Local development environment

The local and production environments run the same application code but use
separate authentication realms, databases, credentials, TOTP enrollment, and
secrets. Production secrets must never be copied into `.dev.vars`.

## First-time setup after cloning

Prerequisites: Git, `nvm`, and the private-repository access required to clone.
`curl` and `jq` are only required for the smoke/UAT scripts.

```bash
git clone https://github.com/ediya204/neobank.git
cd neobank
nvm install
nvm use
npm ci
npm run local:bootstrap
npm run cf:dev:local
```

`local:bootstrap` generates missing local-only secrets, applies every migration
to local D1, and installs the synthetic Dashboard, Portal, transaction-history,
and Webhook demo data. It never targets remote D1.

In a second terminal, issue separate local-only setup links:

```bash
npm run local:auth:link
npm run local:auth:partner-link
```

Open `.local-auth/admin-setup-url.txt` and
`.local-auth/partner-setup-url.txt`. Choose separate local-only passwords and
enroll separate TOTP authenticators for `local.admin@localhost.test` and
`local.partner@localhost.test`. Each link is single-use, expires after 30
minutes, has mode `0600`, and is excluded from Git.

- Admin: `http://127.0.0.1:8787/dashboard`
- Partner Portal: `http://127.0.0.1:8787/portal/login`

Do not reuse production passwords, TOTP secrets, recovery codes, or service
tokens. Existing `.dev.vars` values are preserved and its permissions are
normalized to mode `0600` by `local:auth:prepare`.

## Local data behavior

- `npm run db:migrate:local` always targets Wrangler's local D1 state.
- `npm run db:seed:local` is a local-only, idempotent demo-data runner.
- The local Webhook seed restores the synthetic demo endpoint when rerun.
- `.wrangler/` is machine-local state. Rebuild it from migrations and seeds;
  never commit or copy the SQLite files through GitHub.

## Environment boundaries

- Production migrations require a complete backup, checksum, restore test, and
  explicit confirmation of the target and pending files.
- `.dev.vars`, `.local-auth/`, `.wrangler/`, database exports, and build output
  are not source artifacts and must not be committed.
- `AUTH_LOCAL_BYPASS` remains disabled for Admin. Local Admin exercises the same
  password, TOTP, session-cookie, CSRF, and role checks as production.
- `API_CREDENTIAL_LOCAL_DEMO=true` enables a loopback-only credential rotation
  simulator. It never calls the production Cloudflare Access API.
- Production uses Cloudflare Worker Secrets and the configured production Admin
  identity; those values do not belong in `.dev.vars`.

## Cloudflare access from a new computer

Local development does not require production credentials. Before an explicitly
approved deployment, authenticate separately and confirm the account:

```bash
npx wrangler login
npx wrangler whoami
```

A successful login or an HTTP 200/302/403 response is not business-API
acceptance. Verify the response schema, business fields, tenant isolation, and
expected state transitions separately.

## Before production publication

Review the intended Git diff and sensitive-file exclusions, run the focused
checks, perform a Wrangler dry-run, inspect remote pending migrations, back up
remote D1 and prove the backup can be restored. Apply reviewed migrations before
deploying Worker code that depends on their schema. Run
`npm run db:preflight:remote` first and require every reported count to be zero.
