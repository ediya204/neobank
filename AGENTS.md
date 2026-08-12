# VA API collaboration instructions

Read these files before changing the project:

1. `docs/CODEX_HANDOFF.md`
2. `docs/DECISIONS.md`
3. `docs/USER_WORKING_PREFERENCES.md`
4. `docs/CODEX_CONVERSATION_HANDOFF.md`
5. The domain-specific runbook for the area being changed.

Always inspect the actual Git branch, working tree, remote divergence, and current
deployment state before making claims. Historical notes are context, not proof of
the current live state.

For financial flows, preserve explicit pending, cleared, exception, submitted,
completed, and cancelled transitions. Admin entry is not final settlement.
Production database changes require a complete backup, checksum, restore test,
manual approval, and an auditable post-check. Never automate a real bank or wallet
transfer from an inferred request.

Keep Partner data tenant-scoped. Do not expose operator notes, internal identities,
tenant keys, secret material, internal Webhook delivery state, or other Partners'
data. Treat transport success, Cloudflare Access redirects, and HTTP 200 as
insufficient for business acceptance without response and data assertions.

Before publishing normal Worker, Portal, or Partner API changes, run the checks
appropriate to the diff, normally `npm run typecheck`, `npm run i18n:check`,
`npm run docs:check`, `npm run accounting:check`, a production build,
`npm run cf:deploy:dry-run`, and Git whitespace and secret checks. Do not commit
`.dev.vars`, `.wrangler`, `.local-auth`, database exports, production data,
credentials, build output, or `.learnings` unless the user explicitly requests it.

GitHub publication and Cloudflare deployment are separate actions. Do not deploy
or apply remote migrations merely because a branch is pushed.
