# Partner Portal 多用户与权限 V1

## 范围

多用户归属于 Partner 组织，由该 Partner 的 Owner/Admin 自行管理。平台 Admin 不代管 Partner 成员，也不能从 Admin Portal 进入团队管理页面。

当前 V1 只为已有 `ethan` Partner 建立组织与默认角色种子；迁移和代码在本地完成，尚未执行远程 D1 migration，也未部署生产。

## 默认角色

| 角色 | 主要能力 | 约束 |
| --- | --- | --- |
| Owner | 全部 12 项 Portal 权限 | 不能通过普通邀请或成员编辑授予；后续应使用独立所有权转移流程 |
| Admin | 团队、客户、余额、交易、集成、通知管理 | 不含一次性 API credential reveal；只有 Owner 可授予/管理 Admin |
| Operations | 客户创建与查看、余额与交易查看、通知 | 不可管理团队或集成 |
| Developer | API 集成查看/变更请求、通知、团队目录 | 不可查看客户资金数据 |
| Viewer | 客户、余额、交易、集成、通知只读 | 不可发起变更 |

Owner 或具备 `team.manage_roles` 的成员可以创建自定义角色，但只能授予自己已有的权限；`credentials.reveal` 永远只能由 Owner 授予。

## 权限目录

- `team.read`
- `team.invite`
- `team.manage_members`
- `team.manage_roles`
- `customers.read`
- `customers.create`
- `balances.read`
- `transactions.read`
- `integrations.read`
- `integrations.request_change`
- `credentials.reveal`
- `notifications.read`

所有权限都在 Worker 端根据登录用户的 membership 和 role 解析。请求体不能提供 `organization_id` 或 `partner_key` 来改变租户范围。

部分 Portal 页面会组合多个只读数据域：余额页需要 `customers.read` + `balances.read`，钱包页需要再加 `transactions.read`，交易页需要 `customers.read` + `transactions.read`。导航与路由守卫使用相同组合规则，避免自定义角色进入后再收到确定性的 403。

## 前端入口

- 页面：`/portal/team`
- 导航：Account → Team & permissions
- 页面守卫：`team.read`
- 功能：成员筛选、邀请记录、邀请创建/撤回、成员角色/状态、角色与权限 CRUD
- 响应式：桌面表格、移动端成员/邀请/角色卡片

## Browser API

基础路径：`/api/browser/v1/portal/team`

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| GET | `/members` | `team.read` |
| PATCH | `/members/:userId` | `team.manage_members` |
| GET | `/invitations` | `team.read` |
| POST | `/invitations` | `team.invite` |
| POST | `/invitations/:id/revoke` | `team.invite` |
| GET | `/roles` | `team.read` |
| POST | `/roles` | `team.manage_roles` |
| PATCH | `/roles/:id` | `team.manage_roles` |
| DELETE | `/roles/:id` | `team.manage_roles` |

成员和角色写操作使用 `version` 做 optimistic locking。系统角色不可修改或删除；最后一位 active Owner 由 D1 trigger 保护。

## 邀请与激活

1. Owner/Admin 选择邮箱与可授予角色，Worker 生成高熵一次性邀请 token，只保存 hash。
2. V1 在创建成功弹窗中显示一次性 setup link，由 Partner 自行通过安全渠道发送；尚未接入邮件发送服务。
3. 受邀用户通过现有 Portal setup 页面设置密码并登记 TOTP。
4. TOTP 验证成功时，鉴权激活、membership `active`、invitation `accepted` 与团队审计在同一个 D1 batch 提交。
5. 邀请在激活前被撤回时，setup token、onboarding member 和未完成身份被清理，旧链接立即失效。

## 安全边界

- 一个 auth user 在 V1 只能属于一个 Partner 组织。
- 成员不能修改自己的角色或状态。
- 普通成员不能修改 Owner；非 Owner 不能管理或授予系统 Admin。
- 角色不能包含操作者自身没有的权限。
- 成员角色/状态变化会撤销该成员所有 active sessions。
- Partner financial write 行为没有因新增角色而开放；原有清算和人工确认边界保持不变。
- 团队写操作写入 `portal_team_audit_events`，不记录明文邀请 token。

## 上线前事项

- 备份远程 D1 并验证可恢复后，再执行 `0020_portal_team_rbac.sql`。
- 为生产邀请配置邮件发送或明确的安全交付流程。
- 增加独立 Owner transfer/recovery 流程后，才允许变更 Owner。
- 用真实 Partner Owner、Admin、Operations、Developer、Viewer 各完成一次业务验收。
- 部署后验证 `/api/auth/me` 返回的 organization、membership、permissions 和所有 Portal 路由权限。
