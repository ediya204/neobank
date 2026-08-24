# Neobank collaboration instructions

Read these files before changing the project:

1. `docs/DATASTORE_POLICY.md`
2. `docs/CODEX_HANDOFF.md`
3. `docs/DECISIONS.md`
4. `docs/USER_WORKING_PREFERENCES.md`
5. `docs/CODEX_CONVERSATION_HANDOFF.md`
6. The domain-specific runbook for the area being changed.

The datastore rule is non-negotiable: use Render PostgreSQL only. Never consider
D1 in new code, planning, alternatives, fallbacks, local development, tests,
deployments, migrations, reviews, or acceptance. Existing D1 material is legacy
evidence only and must not influence current work. Only a new explicit user
instruction specifically reversing `docs/DATASTORE_POLICY.md` can change this.

Always inspect the actual Git branch, working tree, remote divergence, and current
deployment state before making claims. Historical notes are context, not proof of
the current live state.

For financial flows, preserve explicit pending, cleared, exception, submitted,
completed, and cancelled transitions. Admin entry is not final settlement.
Production database changes require a complete backup, checksum, restore test,
manual approval, and an auditable post-check. Never automate a real bank or wallet
transfer from an inferred request.

Keep customer and Admin data tenant-scoped. Do not expose operator notes, internal
identities, tenant keys, secret material, or another customer's data. Treat
transport success, Cloudflare Access redirects, and HTTP 200 as insufficient for
business acceptance without response and data assertions.

Before publishing normal Worker, Portal, or API changes, run the checks appropriate
to the diff, normally `npm run typecheck`, `npm run i18n:check`, `npm run api:test`,
`npm run api:build`, a production build, the PostgreSQL-only profile's deployment
dry-run, and Git whitespace and secret checks. Do not commit
`.dev.vars`, `.wrangler`, `.local-auth`, database exports, production data,
credentials, build output, or `.learnings` unless the user explicitly requests it.

GitHub publication and Cloudflare deployment are separate actions. Do not deploy
or apply remote migrations merely because a branch is pushed.
