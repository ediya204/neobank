# 管理员用户与权限运行手册

更新：2026-08-20（Asia/Hong_Kong）

## 1. 范围与原则

管理员身份由 Render PostgreSQL 的 `admin_users` 管理。每名管理员必须绑定一个
独立的 Core `User`，后台业务请求使用该 Core 用户 ID 记账和审计，禁止再把不同
管理员压缩成共享的 `CORE_ADMIN_USER_ID`。

- 无公开管理员注册，也无默认密码。
- 新管理员使用 30 分钟有效、只能使用一次的 URL fragment 激活链接设置密码并绑定 TOTP。
- 固定角色提供可审计的最小权限组合；V1 不支持任意勾选权限。
- 角色或账号状态变化立即撤销目标账号的现有会话。
- 当前管理员不能修改自己的角色或停用自己。
- 系统必须始终保留至少一名已启用的超级管理员。
- 生产数据库只允许 Render PostgreSQL；数据库迁移遵守 `docs/DATASTORE_POLICY.md`。

## 2. 固定角色

| 角色               | 权限                                                               | 业务边界                                           |
| ------------------ | ------------------------------------------------------------------ | -------------------------------------------------- |
| `super_admin`      | 全部权限及 `admin_users.manage`                                    | 可管理管理员、客户、资金、系统配置和报表           |
| `operations_admin` | `customers.read`、`funds.read`、`funds.manage`、`reports.read`     | 可处理资金业务；不能管理管理员、KYC 决策或系统配置 |
| `compliance_admin` | `customers.read`、`customers.review`、`funds.read`、`reports.read` | 可处理客户、KYC 与 VA；资金仅供读取                |
| `read_only_admin`  | `customers.read`、`funds.read`、`reports.read`                     | 只读查看客户、资金与报表                           |

所有权限都在服务端执行。导航隐藏和路由守卫只改善体验，不能代替 Go API 与
Worker Core 代理的权限校验。未知 Core 路由对非超级管理员默认拒绝。

## 3. 管理入口与接口

- 页面：`/dashboard/admin-users`
- 列表：`GET /api/v1/admin/users`
- 创建：`POST /api/v1/admin/users`
- 更新：`PATCH /api/v1/admin/users/:id`
- 未完成首次激活时重新签发链接：`POST /api/v1/admin/users/:id/setup-token`

所有写请求要求管理员会话、同源 `Origin` 和有效 CSRF token。接口只返回一次性
setup token；前端只把它放在 `/admin/setup#setup_token=...` 的 fragment 中。
不得把 token 写入查询参数、日志、数据库明文、GitHub、工单或聊天记录。

## 4. 创建 `backoffice@sscdigitalbank.com`

功能发布并完成生产验收后，由已登录的超级管理员进入“系统管理 → 管理员与权限”：

1. 点击“增加管理员”。
2. 邮箱填写 `backoffice@sscdigitalbank.com`。
3. 核对显示名称并明确选择一个固定角色；不要默认扩大为超级管理员。
4. 创建后立即把一次性链接保存到批准的密码管理器，并通过安全渠道交付本人。
5. 本人设置符合策略的密码、绑定 TOTP、保存恢复材料并完成登录。
6. 验证 `/api/auth/me` 返回正确 `access_role` 和权限，并验证一项允许操作及一项禁止操作。
7. 在 `admin_auth_audit_events` 核对创建、登录及后续角色变化事件。

创建账号不是资金授权，不得由账号创建动作触发任何银行、钱包、清算或转账操作。

## 5. 生产发布顺序

生产发布和数据库迁移是独立动作，按以下兼容顺序执行：

1. 完整备份生产 PostgreSQL，记录 SHA-256，并在隔离 PostgreSQL 实例完成恢复测试、
   表结构检查、核心表行数检查和管理员登录数据检查。
2. 人工审查 `migrations-postgres/0007_admin_rbac.sql`，记录文件 SHA-256，取得明确批准。
3. 先发布兼容新旧签名身份格式的 Core API。
4. 使用受审 migration runner 应用 `0007_admin_rbac.sql`，执行迁移后查询确认：
   - 每个 `admin_users.core_user_id` 非空且唯一；
   - 每个绑定的 Core `User.role='ADMIN'`，并且属于 Neobank Core organization；
   - 至少一名 `status='active' AND access_role='super_admin'`；
   - `neobank_schema_migrations` 只出现一次 `0007_admin_rbac`。
5. 发布 Go API，确认 `/healthz` 的数据库状态正常，并使用现有管理员验证登录与
   `/api/auth/me` 的新字段。
6. 发布 Neobank web Worker，确认每位管理员的 Core 请求携带自己的已签名用户 ID。
7. 验证超级管理员、运营、合规、只读四类账号的允许/拒绝矩阵，再创建真实 backoffice 账号。

任何一步失败都停止后续动作。迁移后回滚优先恢复应用兼容版本；如需回滚数据库，
必须使用已验证的完整备份并再次取得人工批准，不能手工删除或覆盖认证行。

## 6. 本地验收

至少运行：

```bash
go test ./server-go/...
npm run api:test
npm run api:build
npm run typecheck
npm run i18n:check
npm run docs:check
npm run neobank:typecheck
npm run neobank:deploy:dry-run
git diff --check
```

账号管理的状态验收还应覆盖：重复邮箱、Core 身份冲突、并发版本冲突、自身锁定、
最后一名超级管理员保护、角色变化会话撤销、过期链接重签、已激活账号拒绝重新签发、
非超级管理员直接调用接口返回 `403`，以及不同管理员在 Core 审计中保留不同用户 ID。
