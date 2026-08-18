# Cloudflare release runbook

## Scope

This runbook covers normal Worker and static Portal/Dashboard releases. A
PostgreSQL migration is a separate production operation and still requires the complete
backup, checksum, restore test, manual approval, migration, and post-checks in
`AGENTS.md` and `docs/CODEX_HANDOFF.md`.

## Before building

1. Inspect the current branch, working tree, upstream divergence, remote pending
   migrations, and active Cloudflare version.
2. Identify the exact source files intended for the release. Preserve unrelated
   working-tree changes.
3. In a fresh release worktree, install the lockfile with the project release
   cache instead of relying on a possibly damaged user-level npm cache:

   ```bash
   npm run release:install
   ```

   This command also takes a worktree-specific lock. Do not bypass it with a
   second raw `npm ci`; concurrent installs in one worktree can overwrite
   `node_modules` and leave required binaries missing.

4. Run the checks required by `AGENTS.md`. For fast iteration, lint only the
   current diff:

   ```bash
   npm run lint:changed -- --base origin/main
   ```

   Keep `npm run lint` as the repository-wide lint gate. It is intentionally not
   hidden inside every small edit because this repository's type-aware full scan
   is expensive.

## Build and deploy once

The default VA profile is not the currently bound Neobank production Worker.
Do not run its release command unless that separate target has been provisioned
and manually approved:

```bash
npm run cf:release
```

This performs one React production build, runs Wrangler dry-run against that
build, then deploys the same prepared build. `npm run cf:deploy` and
`npm run cf:deploy:dry-run` remain safe standalone commands and each performs
its own build. The `:prepared` commands intentionally skip the React build and
must only be used after a successful `npm run cf:build` in the same worktree.
Both default and Neobank prepared deployments retain the previous static assets
for 24 hours so already-open browser tabs can finish loading their versioned
chunks while the root recovery boundary moves stale clients to the new build.

GitHub push and Cloudflare deployment remain separate actions. Do not infer one
from the other.

### Neobank full administration + wallet

The commands above target the separate default VA API profile and must not be
reused for the Neobank deployment. The currently deployed and bound Neobank
Worker is `neobank-web`; it uses an explicit full-admin-wallet profile and
Wrangler config:

```bash
npm run neobank:profile:check
npm run neobank:typecheck
npm run neobank:deploy:dry-run
# After a separate manual approval:
npm run neobank:deploy
```

`neobank:deploy:dry-run` builds with
`REACT_APP_NEOBANK_DEPLOYMENT_MODE=full-admin-wallet`; every prepared Wrangler
command includes `--config wrangler.neobank.jsonc`. The normal local/default
build remains the full Nest application. See
`docs/NEOBANK_CREGIS_DEPLOYMENT.md` for the route matrix, Admin application-session chain,
Go and Nest Core Render dependencies, KYC and operations gates, and PostgreSQL migration procedure.
The completed historical D1 cutover is recorded in
`docs/NEOBANK_POSTGRES_CUTOVER.md`; D1 is not a runtime fallback.

Changing the Admin boundary from Cloudflare Access to application password +
TOTP is a gated security migration, not a normal web-only release. Keep Access
enabled while preparing it. Back up Render PostgreSQL, checksum and restore-test
the backup, review and apply `migrations-postgres/0004_admin_auth.sql`, configure
the three Render Admin auth secrets, deploy the Go API and D1-free Worker, create
the one-time Admin setup link, and verify the
password/TOTP/session/CSRF flow through a non-custom-domain Worker endpoint.
Only after those assertions pass may an operator remove or bypass the Access
application covering `/admin*` and the corresponding Admin API paths. Recheck
that unauthenticated requests are rejected by the application after the Access
change. Never disable Access first.

The customer withdrawal-address whitelist is a separate PostgreSQL change.
Before deploying code that requires it, repeat the same backup, checksum,
restore-test, review, approval-hash, and post-migration verification gates for
`migrations-postgres/0005_customer_withdrawal_address_whitelist.sql`. Applying
the migration, deploying the Go service, deploying the web Worker, and enabling
any real withdrawal remain four separate approvals.

## Temporary worktrees and processes

- Create temporary release worktrees with a unique `mktemp -d` path.
- Record the exact path and remove only that path when the task completes.
- Before removal, verify `git status`, preserve any unique patch, and confirm no
  active task still owns the worktree.
- Stop the exact Wrangler/workerd process group started by the release task.
- Never bulk-delete `/tmp`, all Git worktrees, npm caches, production backups, or
  another task's local preview.
- A clean worktree whose branch is already on its configured upstream can be
  removed without deleting the branch. A dirty worktree may be force-removed
  only after its files are proven identical to a preserved commit or working
  tree.

## Post-deploy verification

Record the deployed Worker version and confirm its traffic percentage. Recheck
GitHub SHA and PostgreSQL migration state separately. Validate authentication, response
shape, tenant scope, and business data where credentials and an approved manual
session are available; transport success alone is insufficient.
