# VA 银行渠道与开户运行手册

## 业务目标

后台维护可开户银行的固定基础资料，客户选择银行并查看其支持币种后提交 VA 申请。
银行实际分配账号后，运营在后台录入账户名称、银行账号和可选 IBAN，系统才把 VA
标记为已开通。

## 数据边界

银行渠道固定资料：

- 通道代码与显示名称
- 银行名称
- 银行国家/地区（ISO 两位代码）
- 银行地址与可选分行名称
- SWIFT/BIC
- 支持币种（当前只允许 USD、HKD）
- 启用状态

单一客户 VA 的可变资料：

- 客户
- 所选银行渠道
- 开户币种
- 账户用途
- 账户名称
- 银行账号
- 可选 IBAN

银行固定资料不能由客户端提交，也不能在 VA 审批表单中覆盖。开通时将渠道固定资料
复制到账户作为历史快照；渠道后续修改只影响新开账户。

## 状态与人工关口

```text
客户选择已启用银行 + 支持币种
  -> SUBMITTED
  -> APPROVED（运营录入真实账号）
  -> REJECTED（运营填写原因）
```

- 新银行渠道默认停用。
- VA 渠道只有在银行名称、国家、地址和 SWIFT/BIC 完整时才能启用。
- 同一客户、银行和币种同时只能有一笔 `SUBMITTED` 申请。
- 系统不得生成模拟银行账号；账号为空时不能批准。
- VA 开通不代表外部入账、清算或余额变化，不产生账本分录。
- VA 出款不是另一条银行配置。账户开通时保存所选 `VIRTUAL_ACCOUNT` 渠道 ID；
  后续从该 VA 转出时由系统自动带出同一银行渠道，前台和后台都不能改选其他银行。
- 旧版 `VA_PAYOUT` 通道只用于历史记录读取，不允许新建、重新启用或承接新出款。

## UI 与 API

后台：

- `/dashboard/funding-channels`：创建和维护统一的 `VIRTUAL_ACCOUNT` 银行渠道；
  下拉不再提供独立“VA 出款”类型。
- `/dashboard/operations/virtual-accounts`：独立 VA 申请队列，查看待处理、已开通和已拒绝记录。
- `/dashboard/operations/virtual-accounts/:id`：只读核对客户所选银行、币种与用途，
  录入银行实际分配的账户名称、账号和可选 IBAN，或填写客户可见拒绝原因。
- `/dashboard/onboarding` 只处理 KYC 开户申请，不再混入 VA 审批。

客户：

- `/portal/virtual-accounts`：选择银行、查看支持币种、提交申请并查看结果。

Core API：

- `GET /api/v1/funding-channels?organizationId=...&type=VIRTUAL_ACCOUNT&active=true`
- `POST /api/v1/customers/:id/virtual-account-requests`
- `GET /api/v1/customers/:id/virtual-account-requests`
- `PATCH /api/v1/virtual-account-requests/:id/approve`
- `PATCH /api/v1/virtual-account-requests/:id/reject`

客户会话经 Web Worker 只允许读取已启用 VA 银行，并且只允许读写路径中与会话客户 ID
完全一致的 VA 申请。其他 `/api/core/*` 路径继续只允许管理员会话。

## 发布与验收

远程发布必须分开执行并报告：

1. 备份 Render PostgreSQL，记录 checksum，并完成独立恢复测试。
2. 暂停 VA 开户写操作，经人工确认后应用 Prisma migration
   `20260818010000_va_bank_channels`。
3. 发布 `neobank-core`，验证渠道校验与账号录入。
4. 发布 `neobank-web`，验证客户选择银行、支持币种展示和自有申请隔离。
5. 分别验证 Admin、客户 A、客户 B；客户 A 访问客户 B 的申请必须失败。

Admin 验收还必须确认：

- Portal 提交后独立 VA 队列待处理计数增加，来源显示为“客户 Portal”；
- 详情中的银行、币种、用途和固定银行资料不可编辑；
- 账号不足 4 位、空白拒绝原因、重复批准或重复拒绝均被拒绝；
- 批准后创建 `VIRTUAL_ACCOUNT`，余额保持为零且不产生账本分录；
- 拒绝后 Portal 显示客户可见原因，内部管理员身份不泄露；
- 已完成记录只读，刷新后状态、处理人、处理时间和账号资料保持一致。

本地代码完成或 Cloudflare dry-run 不代表上述生产迁移、Render 发布、Cloudflare 发布
或真实银行开户已经完成。
