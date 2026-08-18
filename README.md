# SSC数字银行 · SSC Digital Bank

React/TypeScript Portal and Admin UI with a Cloudflare Worker and D1 backend.

## Start on a new computer

The verified toolchain is Node `25.7.0`, npm `11.10.1`, and the committed
`package-lock.json`. Wrangler 4 requires Node 22 or newer.

```bash
git clone https://github.com/ediya204/neobank.git
cd neobank
nvm install
nvm use
npm ci
npm run local:bootstrap
npm run cf:dev:local
```

In a second terminal, run `npm run local:auth:link` for Admin and
`npm run local:auth:partner-link` for Partner Portal. Open each generated setup
link and enroll separate local-only credentials. See
[`docs/LOCAL_DEVELOPMENT.md`](docs/LOCAL_DEVELOPMENT.md) for the complete flow.

Local secrets, TOTP enrollment, sessions, D1 state, build output, and production
backups are intentionally excluded from Git. They are safely rebuilt on each
computer instead of copied through GitHub.

## Main commands

```bash
npm run typecheck
npm run i18n:check
npm run docs:check
npm run accounting:check
npm run cf:deploy:dry-run
```

## Documentation

- [Codex project handoff](docs/CODEX_HANDOFF.md)
- [Local development](docs/LOCAL_DEVELOPMENT.md)
- [Login and account handoff](docs/LOGIN_HANDOFF.md)
- [Human authentication V1 runbook](docs/AUTH_V1_RUNBOOK.md)
- [Partner API Guide](docs/PARTNER_API_GUIDE.md)
