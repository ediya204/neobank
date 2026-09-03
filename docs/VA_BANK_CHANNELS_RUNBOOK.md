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
- 银行地址
- SWIFT/BIC
- 支持币种（当前只允许 USD、HKD）
- 开户手续费（固定 USD 金额）及配置版本
- 启用状态

单一客户 VA 的可变资料：

- 客户
- 所选银行渠道
- 开户币种
- 账户用途
- 账户名称
- 银行账号
- 可选 IBAN

通道配置不录入分行或收款/结算账号。每位客户的 VA 账户名称、账号和可选 IBAN
必须在该客户的开户审批中按银行实际分配结果单独录入。

银行固定资料不能由客户端提交，也不能在 VA 审批表单中覆盖。开通时将渠道固定资料
复制到账户作为历史快照；渠道后续修改只影响新开账户。

## 状态与人工关口

```text
客户选择已启用银行 + 支持币种
  -> SUBMITTED（冻结客户 USD 钱包开户费）
  -> APPROVED（运营录入真实账号；扣除冻结费用并记账）
  -> REJECTED（运营填写原因；释放冻结费用）
  -> CANCELLED（客户取消；释放冻结费用）
```

- 新银行渠道默认停用。
- VA 渠道只有在银行名称、国家、地址和 SWIFT/BIC 完整时才能启用。
- VA 渠道必须明确配置开户费才能启用；`NULL` 表示未配置并阻止新申请，`0.00`
  表示免费。修改费用会增加版本，只影响之后提交的申请。
- 同一客户、银行和币种同时只能有一笔 `SUBMITTED` 申请。
- 系统不得生成模拟银行账号；账号为空时不能批准。
- 非零开户费在提交时从客户 `SYSTEM_WALLET / USD` 可用余额转为冻结余额，并创建一笔
  `VA_OPENING_FEE / SUBMITTED` Operation。申请保存金额和规则版本快照。
- 批准时只消费冻结余额，Operation 变为 `COMPLETED`，并创建一张借记客户 USD 钱包、
  贷记平台 `FEE_REVENUE / USD` 的平衡凭证；不经过 `PLATFORM_CLEARING`。
- 拒绝或客户取消时，冻结金额恢复为可用余额，Operation 分别变为 `REJECTED` 或
  `CANCELLED`，不创建冲正凭证，因为批准前尚未正式记账。
- VA 账户本身初始余额仍为零；开户费不代表外部银行转账、入账或清算。
- VA 出款不是另一条银行配置。账户开通时保存所选 `VIRTUAL_ACCOUNT` 渠道 ID；
  后续从该 VA 转出时由系统自动带出同一银行渠道，前台和后台都不能改选其他银行。
- 旧版 `VA_PAYOUT` 通道只用于历史记录读取，不允许新建、重新启用或承接新出款。

## UI 与 API

后台：

- `/dashboard/funding-channels`：创建和维护统一的 `VIRTUAL_ACCOUNT` 银行渠道；
  下拉不再提供独立“VA 出款”类型。
- `/dashboard/operations/virtual-accounts`：独立 VA 申请队列，查看待处理、已开通和已拒绝记录。
- `/dashboard/operations/virtual-accounts/:id`：只读核对客户所选银行、币种与用途，
  查看手续费快照、冻结钱包和费用流水，录入银行实际分配的账户名称、账号和可选
  IBAN，或填写客户可见拒绝原因。
- `/dashboard/onboarding` 只处理 KYC 开户申请，不再混入 VA 审批。

客户：

- `/portal/virtual-accounts`：选择银行、确认固定 USD 开户费和提交后余额、提交申请、
  取消待处理的自有申请并查看费用状态。

Core API：

- `GET /api/v1/funding-channels?organizationId=...&type=VIRTUAL_ACCOUNT&active=true`
- `POST /api/v1/customers/:id/virtual-account-requests`
- `GET /api/v1/customers/:id/virtual-account-requests`
- `PATCH /api/v1/customers/:id/virtual-account-requests/:requestId/cancel`
- `PATCH /api/v1/virtual-account-requests/:id/approve`
- `PATCH /api/v1/virtual-account-requests/:id/reject`

客户会话经 Web Worker 只允许读取已启用 VA 银行，并且只允许读写路径中与会话客户 ID
完全一致的 VA 申请。费用元数据仅暴露银行、申请编号、规则版本和冻结时间；管理员身份、
配置人、幂等键及平台账户明细不会返回客户。其他 `/api/core/*` 路径继续只允许管理员会话。

## 发布与验收

远程发布必须分开执行并报告：

1. 备份 Render PostgreSQL，记录 checksum，并完成独立恢复测试。
2. 暂停 VA 开户写操作，经人工确认后应用 Prisma migration
   `20260903000000_va_opening_fee`。
3. 由运营逐一确认每个已启用 VA 银行的费用是批准值或明确的 `0.00`；不得猜测或自动补值。
4. 发布 `neobank-core`，验证渠道校验、冻结、扣除、释放和账号录入。
5. 发布 `neobank-web`，验证费用确认、客户取消和自有申请隔离。
6. 分别验证 Admin、客户 A、客户 B；客户 A 访问或取消客户 B 的申请必须失败。

Admin 验收还必须确认：

- Portal 提交后独立 VA 队列待处理计数增加，来源显示为“客户 Portal”；
- 详情中的银行、币种、用途和固定银行资料不可编辑；
- 账号不足 4 位、空白拒绝原因、重复批准或重复拒绝均被拒绝；
- 批准后创建零余额 `VIRTUAL_ACCOUNT`，仅开户费冻结余额被消费，并生成唯一平衡凭证；
- 拒绝或客户取消后开户费恢复为可用余额且不生成凭证；
- Portal 显示客户可见原因和费用状态，内部管理员身份与平台账户明细不泄露；
- 对账页确认每笔已完成费用只有一张凭证、费用收入贷方合计一致，且待处理费用的来源
  钱包冻结余额足以覆盖全部关联申请；
- 已完成记录只读，刷新后状态、处理人、处理时间和账号资料保持一致。

生产变更必须保存完整备份、checksum、隔离恢复测试、人工批准和迁移后核对证据。本地代码完成或 Cloudflare dry-run 不代表上述生产迁移、Render 发布、Cloudflare 发布
或真实银行开户已经完成。
