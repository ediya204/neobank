# Local development

The former workflow in this file has been retired and must not be used.

Current development is PostgreSQL-only. Follow these documents:

1. `docs/DATASTORE_POLICY.md`
2. `docs/LOCAL_FULL_STACK.md`

The supported first-time local startup is:

```bash
npm ci
npm run local:core:bootstrap
npm run dev
```

Use `npm run dev:background` when the full local stack must remain available
after the current terminal or Codex task ends, and stop it with
`npm run dev:stop` before reinstalling dependencies.
