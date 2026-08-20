# VA BaaS V1 产品与 API 规划

> 本文件主要保留旧 V1.2 产品设计背景。当前 Neobank 客户 Portal 已单独开放
> PostgreSQL Core 的五秒 OTC 报价确认流程；未确认不占用余额，确认后原子完成且
> 无需审批。Partner 机器 API 的手动 OTC 写入、客户转出和 USDT 充值仍关闭。

## V1 目标

V1 用于验证 Cloudflare Access、Portal、机器 API、D1 数据交换和人工运营记账能否形成闭环。系统只有一个合作方 Ethan；运营管理员为 Edi。

核心原则：

1. Ethan 可以发起开户、转出和 OTC。
2. 法币/USDT 实际到账与转出完成由 Edi 人工确认；OTC 由系统校验后即时完成。
3. 账本只记录已完成业务；待处理转出占用可用余额，OTC 不进入审批队列。
4. 可用余额 = 账本余额 − 待处理转出占用。
5. 转入记录只能由 Edi 根据实际到账录入。

## 管理员后台

### 1. 开户申请

- 列表：搜索、状态筛选、新增测试申请、进入详情。
- 详情任务顺序：
  1. 查看 Ethan 提交的国家区号、电话、邮箱、客户名称。
  2. 如资料不完整或不一致，填写客户可见原因和待修改字段，要求 Ethan 补正；
     内部备注只对 Admin 可见。
  3. 录入 Sumsub HTTPS 链接，系统进入 `kyc_link_ready`。
  4. 人工确认 KYC 通过，系统进入 `kyc_approved`。
  5. 录入 VA 银行字段，系统进入 `active`。
- VA 字段：账户名称、账户号码、币种、SWIFT/BIC、银行名称、银行地址。

### 2. 资金运营

- `资金记录`：录入四类实际业务或待处理操作；转入由管理员独占录入。
- `OTC 记录`：只读查看 Ethan 从 Portal/机器 API 发起并由系统自动完成的兑换；
  Admin 不创建、不审批；固定费率 0.5%。
- `客户余额`：同时显示账本余额、待处理占用、可用余额。
- `账本`：只读查看所有已完成分录。
- `手续费设置`：配置未来新申请使用的法币固定转出费和 USDT 固定转出费。
- `API 管理`：分区管理 Ethan 提交的 IP/CIDR 与 Webhook 配置申请、凭证密钥、生效配置及投递
  状态，并对允许重试的失败投递执行人工重试。
- `确认完成并记账` 是高影响动作：只有实际处理完成后点击。

## Ethan Portal

### 1. 首页看板

- `/portal/home` 汇总全部客户、VA 开通进度、法币/USDT 可用余额、待处理事项和最近交易。
- 提供客户、法币钱包、数字钱包、交易历史、开户、OTC 和 API 接入的快捷入口。

### 2. 客户管理

- `客户总览` 在一个页面显示客户基本资料、开户状态、VA 账户和各资产可用余额。
- 点击“查看详情”进入单一客户页，集中查看：
  - 联系方式、KYC 链接和开户时间；
  - VA 银行账户完整字段；
  - 账本余额、待处理占用、可用余额；
  - 该客户的资金流水、转出和 OTC 记录。
- Portal 与管理员后台共用布局、侧边栏和右上角快捷功能。

### 3. 发起开户

- 唯一必填字段：国家区号、电话号码、电子邮箱、客户名称。
- 列表只显示尚未达到 `active` 的客户，并展示 KYC 链接与当前进度。

### 4. 可用余额

- 显示账本余额、待处理占用和可用余额。
- 转出与 OTC 的校验以可用余额为准。

### 5. 法币钱包与数字钱包

- 两个钱包采用两级信息架构：先列出全部客户和对应可用余额，再点击进入单一客户钱包。
- 单一客户钱包详情只负责余额与交易历史；点击“发起转出”进入独立转出页面。
- 法币钱包显示法币账本余额、占用、可用余额及法币交易历史。
- 法币转出字段：资产、金额、收款人名称、收款人地址、银行名称、
  银行账号/IBAN、SWIFT/BIC、可选银行地址和备注。
- 数字钱包显示 USDT 账本余额、占用、可用余额及链上交易历史。
- 数字货币转出字段：资产、金额、网络、收款钱包地址和可选备注。
- 两类钱包均以单一客户为操作对象；提交后占用可用余额。
- 转出表单按金额与收款资料分组校验，并在最终提交前显示确认弹窗。
- 转出金额是账户总扣账金额；实际到账金额 = 转出金额 − 固定手续费。
- V1 默认法币转出手续费为 `30 USD`、USDT 转出手续费为 `5 USDT`。
- 每笔转出的 `fee_amount` 由服务端按创建时配置写入并作为历史快照；管理员更新
  设置只影响未来新申请。
- Portal 加载费率失败时禁止提交；客户端提交 `expected_fee_amount` 只作为确认页
  的并发确认值，不作为历史费用保存。若期间后台改价，服务端返回
  `409 withdrawal_fee_changed`，要求刷新并重新确认。
- 法币转入和 USDT 转入由管理员录入，Portal 不提供申报入口。

### 6. 交易历史

- 独立页面统一展示法币/USDT 转入、转出和 OTC。
- 使用 MUI Data Grid，支持分页、按客户、交易类别、状态和日期范围筛选。
- 点击任意交易打开右侧详情抽屉，查看参考号、收款银行或链上地址等完整信息。
- 单一客户详情及 OTC 工作台可直接跳转到该客户的交易历史。
- 机器 API 使用 `GET /transactions`，返回统一的方向、资产、金额、状态和时间字段。
- 转出交易同时返回总扣账金额、服务端手续费快照和实际到账金额。

### 7. OTC

- Ethan 提交卖出资产/金额、买入资产/总额及成交汇率。
- OTC 工作台左侧按卖出、报价、买入上下排列，右侧显示该客户最近交易。
- 申请创建时占用卖出资产；管理员完成后：
  - 卖出资产从账本扣减；
  - 买入净额写入账本；
  - 买入净额 = 买入总额 − 买入总额的 0.5%。

### 8. API 接入

- 展示 Base URL、Cloudflare Access 请求头和幂等键要求。
- 提供客户总览 `GET /customers` 与单一客户详情 `GET /customers/{applicationId}`。
- 提供当前转出手续费 `GET /withdrawal-fees`，便于机器客户端在提交前计算实际到账。
- 不在 Portal 或源代码中显示真实 Client Secret。
- `/api/v1/*` 是 Partner 机器 API；Admin/Portal 浏览器业务 API 分别使用
  `/api/browser/v1/admin/*` 与 `/api/browser/v1/portal/*`。旧
  `/api/v1/admin/*`、`/api/v1/portal/*` 仅作为 legacy Access 外层边界，不用于
  新网页集成。
- 机器 API 使用分层防护：
  1. Cloudflare Access Service Token 验证调用方身份；
  2. Worker 对 Ethan 的机器 API 统一执行每分钟 120 次的限流；
  3. 可选 IP/CIDR 白名单限制来源地址，支持 IPv4 与 IPv6；
  4. 转出与 OTC 等资金写操作继续要求 `Idempotency-Key`，请求体限制为 16 KB。
- IP 白名单只作用于 `/api/v1/*` 机器 API，不影响 Admin 或 Portal。初始保持关闭；
  先录入至少一个 Ethan 固定出口 CIDR，再由 Edi 确认启用，避免误锁。
- Ethan 可在 Portal 或机器 API 提交白名单新增/移除申请；申请在 Admin 审批前不改变
  运行时规则。审批、拒绝、取消及实际生效结果全部写入审计日志。Admin 保留直接维护
  入口，作为误锁或紧急事件的恢复工具。
- Webhook 地址、事件订阅、停用也使用同一审批闭环。批准后的端点接收按事件最小化
  的 Partner 范围载荷；`kyc_link_ready` 状态事件携带可操作的 Sumsub 链接，
  `va_account.activated` 携带开户成功所需的 VA 账户快照，其他状态事件不携带银行
  资料；`fund_transaction.status_changed` 携带客户可见的资金类型、金额、币种、费用、
  网络、参考号与清算状态，但不把 `submitted` / `pending` 解释为清算完成。请求以
  HMAC-SHA256 签名，失败后指数退避重试，
  最多五次后进入 dead letter，Portal/Admin 可查看投递状态。Admin 仅对
  `retry_scheduled` / `dead_letter` 投递人工重试；也可从历史投递或按事件类型与
  Partner 范围资源 ID 通用补发。重试复用原事件，补发生成新事件 ID；原因与操作者
  均写入审计。
- 新 Webhook 签名密钥由后台生成并以 AES-GCM 密文保存在 D1；根加密密钥仍只存在
  Worker Secret。Partner 通过 TOTP 一次性领取并显式启用；明文不写入前端持久状态、
  日志或审批数据。原 `PARTNER_WEBHOOK_SIGNING_SECRET` 仅保留为迁移兼容回退。
- 白名单总开关变更继续写入审计日志。启用状态下没有有效规则时系统 fail closed；
  未命中规则返回 `403 api_ip_not_allowed`。
- 超过 Worker 限流阈值返回 `429 rate_limit_exceeded` 和 `Retry-After`。

### 9. 网页认证与审计

- Admin 只从 `/admin/login` 登录，Partner 只从 `/portal/login` 登录；两者均使用
  应用自有密码 + TOTP，角色由路径固定。
- 登录完成后浏览器使用 `__Host-va_session` HttpOnly Cookie；
  `GET /api/auth/me` 返回当前用户、到期时间和 `csrf_token`。
- `/api/browser/v1/admin/*` 与 `/api/browser/v1/portal/*` 的
  `GET` / `HEAD` / `OPTIONS` 要求角色匹配会话；其他方法还要求精确同源
  `Origin` 与 `X-CSRF-Token`。
- 首次激活 setup token 使用 `purpose=initial_setup`（可省略并取默认值）；已激活
  账户恢复必须在线下身份核验后显式使用 `purpose=credential_reset`。重置会撤销
  旧会话、密码、TOTP、恢复码和未完成挑战，并要求完整重新绑定。
- 浏览器业务审计的 `metadata.actor` 保存已认证邮箱，机器 API 动作使用
  `partner_api`，以便从统一审计日志追溯真实操作来源。

完整认证、Cookie、CSRF 与错误契约见
[Authentication API](./AUTH_API.md)。

## 状态机

### 开户

`submitted → kyc_link_ready → kyc_approved → va_processing → active`

未激活阶段均可进入 `changes_requested`；Ethan 修改资料并幂等重提后回到
`submitted` 开启新审核轮次，申请 ID 不变。

录入完整 VA 账户资料时，也允许从 `kyc_approved` 直接进入 `active`。

### 资金

`submitted → processing → completed`

也可由 `submitted` 或 `processing` 进入 `rejected` / `cancelled`。只有 `completed` 写账本；拒绝或取消会自动释放占用金额。

### OTC

创建请求通过余额、报价、0.5% 手续费和 USDT 网络校验后直接进入 `completed`。
卖出扣账与买入净额入账必须原子完成，不存在 Admin 审批状态。

## 权限与路径

| 使用者 | UI | API | 权限 |
|---|---|---|---|
| Edi | `/dashboard/*` | `/api/browser/v1/admin/*` | Admin 会话；全部运营写入、处理、账本读取 |
| Ethan | `/portal/*` | `/api/browser/v1/portal/*` | Partner 会话；客户管理、开户、余额读取、转出和 OTC 申请 |
| Ethan 系统 | 无 | `/api/v1/*` | Access Service Token；与 Portal 相同的合作方权限 |

Cloudflare Access 继续作为 `/api/v1/*` Partner 机器 API 的前置认证层；浏览器 API
由应用自有会话与角色校验保护。旧 `/api/v1/admin/*` 和 `/api/v1/portal/*`
只保留 legacy Access 边界，不是浏览器业务 API 的规范入口。

后台 `系统配置 → API 管理` 用于审核 Ethan 提交的 IP/CIDR 与 Webhook 配置，并查看
投递记录；`资金运营 → API 安全` 保留为机器 API 白名单的紧急直接控制。白名单与
Access Service Token 是两层独立校验；Service Token Secret 与 Webhook 签名密钥都只
允许经过 TOTP 的一次性领取，页面不会再次展示或长期保存明文。

## 数据库发布基线

当前候选版本的完整加固基线是 migrations `0001`–`0013`。`0013` 不新增 Worker
必需的表或列；为避免旧 Worker 的 OTC floor 费额与新数据库 half-up trigger
短暂冲突，应先完成在途 OTC/重复入账凭证只读预检，再发布 `1.1.1` Worker，并立即
应用 `0013_api_accounting_hardening.sql`。两步之间暂停人工资金操作；Worker 与
D1 均完成前不得宣称生产验收完成。逐笔处置 SQL 见
[V1 验收清单](./V1_ACCEPTANCE.md#0013-发布前只读检查)。

## V1 后续迭代

- V1.1：持续增强 API 管理、Webhook 可观测性，以及既有操作备注与拒绝/取消交互。
- V1.2：邮件通知、CSV 导出、Webhook 多签名密钥轮换和请求日志查询。
- V2：多合作方租户隔离、审批双人复核、自动对账、真实 Sumsub/银行/链上集成。
