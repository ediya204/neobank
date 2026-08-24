# SSC数字银行 · SSC Digital Bank

Neobank Admin、Customer Portal、Cloudflare Web Worker、Render Go/Core 服务与
PostgreSQL 迁移的单一代码库。

## 本地启动

项目固定使用 `.nvmrc`、提交的 `package-lock.json`、PostgreSQL 17 和 Redis。

```bash
git clone https://github.com/ediya204/neobank.git
cd neobank
nvm install
nvm use
npm ci
npm run local:core:bootstrap
npm run dev
```

Web 默认监听 `http://localhost:3002`，Nest Core API 默认监听
`http://localhost:4000/api/v1`。完整说明见
[`docs/LOCAL_FULL_STACK.md`](docs/LOCAL_FULL_STACK.md)。

## 主要检查

```bash
npm run typecheck
npm run i18n:check
npm run icons:check
npm run api:test
npm run api:build
npm run local:core:check
npm run neobank:profile:check
npm run neobank:deploy:dry-run
```

## 发布边界

- GitHub、Cloudflare、Render 和 PostgreSQL 迁移是四项独立操作。
- 生产数据库只使用 Render PostgreSQL。
- 生产迁移必须先完成全量备份、SHA-256、隔离恢复测试、人工批准和迁移后核验。
- 实际资金或钱包转账必须由人工明确确认，测试和发布不能自动发起。

发布步骤见 [`docs/RELEASE_RUNBOOK.md`](docs/RELEASE_RUNBOOK.md)，项目协作边界见
[`docs/CODEX_HANDOFF.md`](docs/CODEX_HANDOFF.md)。
