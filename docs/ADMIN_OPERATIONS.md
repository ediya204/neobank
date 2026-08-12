# Admin 运营管理闭环

> 当前 V1.2 资金范围：管理员只录入已核实的法币到账；记录保持“待清算”，
> 直到运营人员明确标记“已清算”，随后系统自动完成 USD → USDT/TRON。
> 客户法币转出、USDT 充值、全部客户转出和手动 OTC 创建均已关闭。
> 历史记录继续可查；Admin 的 OTC 页面仅用于只读核对自动兑换，USDT 归集
> 是当前受控的对外资金出口。下文涉及旧转出和手动 OTC 的段落仅作历史参考。

## 1. 文档目的

本文用于统一 Portal、Partner API 与 Admin 后台的业务边界，作为 V1 开发、运营录入、接口联调和验收依据。

核心原则：

- Ethan 可通过 Portal 或 Partner API 为其单一客户发起开户、转出和 OTC 申请。
- 客户是否到账、实际入账金额、转出执行结果和外部交易凭证均由管理员核实并在 Admin 录入。
- Portal 只能基于系统账本显示的可用余额发起转出或 OTC；外部真实资金变化不会自动改变余额。
- USDT 按网络独立记账，当前支持 TRON（TRC20）、Ethereum（ERC20）、
  Solana（SPL）和 BNB Smart Chain（BEP20）；接口标准值固定为
  `TRON`、`ETHEREUM`、`SOLANA`、`BSC`。
- 账本只允许追加，不允许管理员直接覆盖余额、修改或删除已完成账本记录。
- 所有关键状态变化都必须保留业务记录、外部凭证、操作人和审计日志；浏览器会话
  触发的业务审计把已认证邮箱写入 `metadata.actor`，机器 API 使用
  `partner_api` 标识。

## 2. 角色与权限边界

| 角色 | 可执行操作 | 不可执行操作 |
| --- | --- | --- |
| Ethan / Portal 用户 | 查看其客户、账户、余额和交易；发起开户、法币转出、USDT 转出和 OTC | 确认实际到账；手工增加余额；直接完成申请；修改账本；查看其他合作方数据 |
| Partner API | 完成与 Portal 等价的查询和发起操作；OTC 校验通过后即时完成 | 创建入账；直接完成转出；绕过余额校验；直接写账本 |
| 管理员 | 核实和录入入账；处理开户；审核并完成转出；只读核对 OTC；配置手续费和 API 安全；查看审计 | 直接编辑余额；审批或修改 OTC；修改或删除已完成账本记录；把终态记录重新打开 |
| 系统 | 校验权限和余额；占用或释放转出可用余额；原子完成 OTC；记录账本与审计 | 在未收到管理员确认时推断外部资金已到账或已转出 |

## 3. Admin 信息架构

| 导航分组 | 页面 | 路由 | 页面职责 |
| --- | --- | --- | --- |
| 工作台 | 运营总览 | `/dashboard/overview` | 汇总客户、待办、余额和近期交易；提供运营快捷入口 |
| 客户与开户 | 客户管理 | `/dashboard/customers` | 罗列全部客户及基本状态；进入单一客户全景 |
| 客户与开户 | 客户详情 | `/dashboard/customers/:id` | 查看开户资料、VA 账户、分链余额、申请和交易历史 |
| 客户与开户 | 开户申请 | `/dashboard/va-applications` | 仅处理尚未开户成功的申请 |
| 客户与开户 | 新建开户 | `/dashboard/va-applications/new` | 管理员代录开户申请 |
| 客户与开户 | 开户详情 | `/dashboard/va-applications/:id` | 回传 Sumsub 链接、确认 KYC、录入 VA 银行账户 |
| 资金运营 | 资金对账 | `/dashboard/operations/reconciliation` | 按上海时区汇总入账、自动兑换、已完成归集、当前资金与账本平衡，并下钻当日明细 |
| 资金运营 | 入账录入 | `/dashboard/operations/deposits` | 人工录入并完成法币或 USDT 实际到账 |
| 资金运营 | 转出审核 | `/dashboard/operations/withdrawals` | 审核 Portal/API 发起的银行或链上转出 |
| 资金运营 | OTC 兑换记录 | `/dashboard/operations/otc` | 对账和审计已自动完成的 USD 与 USDT 双向兑换 |
| 资金运营 | 客户余额 | `/dashboard/operations/balances` | 按客户查看 USD 与各网络 USDT 的账本、占用和可用余额 |
| 资金运营 | 交易历史 | `/dashboard/operations/transactions` | 按客户、类型、状态、资产、网络和日期检索业务交易 |
| 资金运营 | 账本 | `/dashboard/operations/ledger` | 查看不可变的借贷分录及其来源业务记录 |
| 系统配置 | 手续费 | `/dashboard/settings/fees` | 配置法币转出和 USDT 转出手续费 |
| 系统配置 | API 管理 | `/dashboard/settings/api-integration` | 分区管理接入申请、API 凭证与密钥、生效配置及 Webhook 投递 |
| 系统配置 | API 安全 | `/dashboard/settings/api-security` | 管理 API 开关、IP 白名单和安全策略 |
| 系统配置 | 审计日志 | `/dashboard/audit-logs` | 查询管理员、Portal 和 API 的关键操作轨迹 |

兼容路由 `/dashboard/operations` 应跳转到 `/dashboard/operations/deposits`；`/dashboard` 应跳转到 `/dashboard/overview`。

## 4. Portal → Admin 管理闭环

| Portal / API 行为 | Admin 待办 | 管理员动作 | 系统结果 |
| --- | --- | --- | --- |
| 发起开户 | 开户申请 | 校验客户资料，录入 Sumsub 链接；KYC 通过后录入 VA 账户 | Portal/API 可查询最新开户状态和账户资料 |
| 查看或报告外部法币到账 | 入账录入 | 核对银行流水，创建法币转入并确认完成 | 新增 USD 账本贷记，余额和交易历史同步更新 |
| 查看或报告外部 USDT 到账 | 入账录入 | 核对网络和 Tx Hash，创建 USDT 转入并确认完成 | 仅增加指定网络 USDT 余额 |
| 发起法币转出 | 转出审核 | 审核收款资料；处理中执行银行转账；录入银行参考号并完成 | 提交时占用 USD；完成后扣账并记录手续费；拒绝或取消则释放占用 |
| 发起 USDT 转出 | 转出审核 | 审核网络和地址；执行链上转账；录入 Tx Hash 并完成 | 提交时占用指定网络 USDT；完成后仅扣该网络；拒绝或取消则释放占用 |
| 发起 USD → USDT OTC | OTC 兑换记录 | 系统校验报价、余额和目标网络后即时完成；管理员只读核对 | 扣 USD，按所选网络增加扣除 0.5% 手续费后的 USDT |
| 发起 USDT → USD OTC | OTC 兑换记录 | 系统校验报价、余额和卖出网络后即时完成；管理员只读核对 | 仅扣所选网络 USDT，增加扣除 0.5% 手续费后的 USD |

## 5. 页面职责与交互要求

### 5.1 运营总览

总览用于回答“现在有什么需要处理”和“账面整体情况如何”，至少显示：

- 客户总数、已激活客户、开户中客户。
- 待处理开户、入账和转出数量；OTC 异常计数正常应为 0。
- USD 汇总余额。
- USDT 总额及 TRON、Ethereum、Solana、BNB Smart Chain 分链余额。
- 最近交易及状态。
- 跳转到开户、入账、转出、OTC 和客户管理的快捷入口。

浏览器数据接口：`GET /api/browser/v1/admin/overview`。

### 5.1.1 资金对账

资金对账页用于回答“当天实际完成了多少资金动作、当前资金在哪里、账本是否平衡”。
Admin 与 Portal 复用页面结构和计算口径，但权限边界不同：Admin 汇总全平台并可在
明细中查看运营备注；Portal 仅汇总当前 Partner 的客户，且必须同时具备
`customers.read`、`balances.read` 和 `transactions.read`，不得返回运营备注或其他
Partner 数据。

对账口径固定如下：

- 日期边界使用 `Asia/Shanghai` 自然日，并在响应中返回 UTC 起止时间和快照时间。
- 入账只统计 `completed`；法币还必须为 `settlement_status=cleared`。
- OTC 只统计 `completed_at` 落在当日的已完成自动兑换，并分别展示卖出和买入资产，
  不把 USD 与 USDT 相加为单一金额。
- 归集转出只统计状态为 `completed` 的批次；`locked` 与 `submitted` 单独列为待完成，
  不能计入已转出金额。
- 当前资金按资产和网络分别展示账本余额、待处理占用和可用余额。
- 平衡校验按资产和网络执行 `期初 + 入账 - 出账 = 期末`；差额非零必须作为异常处理，
  不允许直接修改账本消除差额。
- 当日明细默认每页 50 条，点击记录打开详情；Admin 可见内部运营字段，Portal 不可见。
- 顶部指标卡使用业务图标，并以记录笔数对比上一日同期；当前日期只比较相同已流逝时段，
  历史日期比较前一个完整自然日，避免半日数据与全天数据直接比较。
- “当前可用资金”卡只显示两行：USD 图标、资产和法币可用金额，以及 USDT 图标、
  资产和全网络 USDT 可用金额；各网络金额由构成图和资金表展开，避免卡片堆叠长文本。
- 近 7 日资金流动图从追加式账本按上海自然日汇总入账、出账与净变化；USD 与 USDT
  必须切换查看，USDT 可继续按网络筛选，不能跨资产合计。
- USDT 网络构成图只比较同一资产在各网络的当前可用余额。点击日期或网络后，页面应把
  相同日期、资产和网络条件带入当日资金明细，并允许一键清除筛选。
- 账本平衡区必须显示整体平衡状态；任何非零差额均使用异常颜色提示，但仍保留完整
  期初、入账、出账、期末和差额数字供人工复核。

浏览器数据接口：

- `GET /api/browser/v1/admin/reconciliation?date=YYYY-MM-DD`
- `GET /api/browser/v1/admin/reconciliation/movements`
- `GET /api/browser/v1/portal/reconciliation?date=YYYY-MM-DD`
- `GET /api/browser/v1/portal/reconciliation/movements`

### 5.2 客户管理与客户详情

客户列表应一页概览：

- 客户名称、邮箱、国家区号、电话号码。
- 开户状态、KYC 状态、VA 状态。
- USD 可用余额、USDT 汇总可用余额。
- 最近活动时间和待处理申请数量。

客户详情应以一个客户为上下文，组合展示：

- 基本资料与开户状态。
- VA 账户名称、账号、币种、SWIFT/BIC、银行名称和银行地址。
- USD 余额。
- USDT 汇总余额和各网络明细。
- 待处理占用、可用余额。
- 最近入账、转出、OTC 和账本记录。
- 跳转到对应 Admin 处理页的操作入口。

管理员可在客户上下文中修正开户基础资料、Sumsub 链接和已录入的 VA
账户资料。修正只能通过业务 API 完成，不得直接改 D1；每次修正必须写入审计日志，
并保留 `application_id`、操作类型和变更时间。资金余额不属于客户资料，不能在此处编辑。

数据接口：

- `GET /api/browser/v1/admin/customers`
- `GET /api/browser/v1/admin/customers/:id`

### 5.3 开户申请

列表默认只展示未达到 `active` 的客户；已开户成功客户由“客户管理”查看。

开户最小输入字段：

| 分组 | 字段 | 规则 |
| --- | --- | --- |
| 手机 | `phone_country_code` | 必填；从统一的“支持的国家/地区”区号列表选择并独立保存，如 `+65`；仍需完成客户及制裁名单筛查 |
| 手机 | `phone_number` | 必填；不重复包含国家区号 |
| 联系方式 | `email` | 必填；有效邮箱 |
| 客户 | `customer_name` | 必填 |

管理员处理字段：

| 阶段 | 字段 | 规则 |
| --- | --- | --- |
| KYC | `kyc_url` | 必填 HTTPS Sumsub 链接，回传给 Portal/API |
| VA 开通 | `account_name` | 必填 |
| VA 开通 | `account_number` | 必填 |
| VA 开通 | `iban` | 选填；与 `account_number` 同级的另一账户标识 |
| VA 开通 | `currency` | V1 固定 `USD` |
| VA 开通 | `swift_bic` | 必填 |
| VA 开通 | `bank_name` | 必填 |
| VA 开通 | `bank_address` | 必填 |

开户基础资料修正仍只允许 `phone_country_code`、`phone_number`、`email` 和
`customer_name` 四个字段。已激活客户如需更正 Sumsub 链接或 VA 账户，状态保持
`active`，不得借此回退开户状态。

申请尚未激活时，管理员可选择标准原因分类、填写 10–500 字的客户可见原因，
并标记需要修改的字段，要求 Partner 补正。此时外部状态显示为
`changes_requested`，但系统保留原开户阶段；管理员内部备注不得出现在 Portal、
Partner API 或 Webhook。Partner 修改四项基础资料后须携带最新
`application_version` 与 `Idempotency-Key` 重新提交，系统开启新的审核轮次并回到
`submitted`。申请 ID 和 Partner 客户 ID 均保持不变。
若要求补正 KYC 文件，管理员应先保存仍可用的新 Sumsub HTTPS 链接，再发出补正；
Portal 会在补正提示中展示该链接，供 Partner 完成文件操作后重提。

### 5.4 入账录入

入账不是 Ethan 发起的资金申请，而是管理员对外部实际到账的核实和录入。

通用字段：

- 客户 `application_id`
- 类型 `fiat_deposit` 或 `usdt_deposit`
- 资产 `USD` 或 `USDT`
- 到账金额 `amount`
- 外部参考 `external_reference`（银行流水号或 Tx Hash）
- 业务备注 `note`
- 状态处理备注 `operator_note`

法币入账在运营流程中必须录入银行流水号；USDT 入账必须选择网络并录入 Tx Hash。
参考号在创建时写入 `external_reference`，处理过程中补录时写入
`transaction_reference`。Admin 创建入账时服务端强制 `external_reference` 非空；
缺失时返回 `422 external_reference_required`。同一资产类型与网络的入账参考号在
全部客户账户间只能使用一次；法币及 TRON/Ethereum/BSC 的十六进制参考号忽略大小写
和首尾空格，Solana base58 签名保留大小写。重复录入返回
`409 duplicate_deposit_reference` 并给出已有资源 ID。
历史待处理 USDT 入账进入 `completed` 时，`external_reference` 与
`transaction_reference` 至少一个非空，否则返回
`422 transaction_reference_required`。法币入账不能走通用 `completed`，必须通过
`settlement_status=cleared` 完成清算兑换；否则返回 `409 fiat_settlement_required`。
系统完成前不增加余额，完成时才生成账本。

USDT 网络值：

| 标准值 | 显示名称 |
| --- | --- |
| `TRON` | TRON（TRC20） |
| `ETHEREUM` | Ethereum（ERC20） |
| `SOLANA` | Solana |
| `BSC` | BNB Smart Chain（BEP20） |

### 5.5 转出审核

转出来源为 Portal 或 Partner API，管理员不应代替 Ethan 随意制造客户负债。页面按类型展示对应字段。

法币转出：

- 客户、总扣账金额、资产 `USD`
- 手续费、实际到账金额
- 收款人名称
- 收款人地址
- 银行名称
- 银行账号 / IBAN
- SWIFT / BIC
- 银行地址（可选）
- 客户备注

USDT 转出：

- 客户、总扣账金额、资产 `USDT`
- 手续费、实际到账金额
- 网络
- 收款钱包地址
- 客户备注

管理员处理字段：

- `status`
- `operator_note`：管理员处理备注，最多 1000 字符
- `transaction_reference`：银行参考号或链上 Tx Hash，最多 200 字符

完成法币转出必须填写银行参考号，完成 USDT 转出必须填写 Tx Hash。Worker 在
`PATCH .../fund-transactions/:id` 进入 `completed` 时强制校验该字段；缺少凭证返回
HTTP `422 transaction_reference_required`，不能生成账本。

费用规则：

- 法币转出默认手续费：`30 USD`
- USDT 转出默认手续费：`5 USDT`
- `amount` 为客户总扣账金额。
- `net_amount = amount - fee_amount`。
- `expected_fee_amount` 是客户端对确认页费率的并发确认值，不作为历史费用保存；
  服务端创建申请时读取并固化实际 `fee_amount` 快照。之后修改后台费率不能改变
  历史申请；若确认值已过期则返回 `409 withdrawal_fee_changed`。

### 5.6 OTC 自动兑换记录

V1 仅允许：

- `USD → USDT`
- `USDT → USD`

不允许 USD → USD、USDT → USDT 或其他资产对。

申请及核对字段：

- 客户
- 卖出资产、卖出金额
- 买入资产、报价或成交汇率
- USDT 对应网络
- 固定手续费率 `0.5%`
- 预计手续费和预计到账
- 状态
- 完成状态和完成时间

只要卖出或买入一侧是 USDT，就必须指定网络。系统在创建时校验余额、报价和
0.5% 手续费，并在同一 D1 batch 中完成卖出扣账和买入净额入账；任一步失败都不
改变余额。Admin 页面只用于对账和审计，不提供审批、处理或修改入口。

### 5.7 余额、交易历史和账本

余额页显示三种金额：

- 账本余额：已完成账本分录汇总。
- 待处理占用：已提交或处理中的转出；OTC 即时完成，不产生待审批占用。
- 可用余额：`账本余额 - 待处理占用`。

USD 单独汇总；USDT 需要同时显示一个汇总金额和各网络明细。汇总只用于概览，任何转出和 OTC 校验仍按网络进行。

交易历史使用业务记录展示，支持 Data Grid、日期范围、客户、类型、状态、资产、
网络筛选和详情抽屉。详情抽屉按交易类型展示对应字段，不应对法币交易显示钱包地址，
也不应对链上交易显示银行资料。Admin 资金交易详情必须包含
`external_reference`、`transaction_reference`、`operator_note`；Admin OTC
详情必须包含 `settlement_reference`、`operator_note`。Portal/Partner 的相同查询
必须移除两个管理员处理字段，只保留客户可见的业务字段与外部执行参考。

账本页用于财务追溯，至少展示：

- 客户
- 资产
- 网络
- 借记或贷记金额
- 余额影响
- `source_type`
- `source_id`
- 创建时间

## 6. 状态流转

### 6.1 开户

```text
submitted
  → kyc_link_ready
  → kyc_approved
  → va_processing
  → active

任一未激活阶段 → changes_requested → submitted（补正后重新完整审核）
```

若管理员在 KYC 通过后直接具备完整 VA 账户资料，可在保存账户资料时进入 `active`。`active` 必须以账户字段完整为前提。

### 6.2 入账和转出

```text
submitted → processing → completed
     │           │
     ├───────────┼→ rejected
     └───────────┴→ cancelled
```

规则：

- `completed`、`rejected`、`cancelled` 为终态，不得重新打开。
- `completed` 才生成正式账本分录。
- `rejected` 或 `cancelled` 不生成账本，并释放此前占用的余额。
- 入账在 `submitted` 或 `processing` 时不计入余额。
- 转出在 `submitted` 或 `processing` 时占用余额，避免重复申请。
- 所有状态变化必须写入审计日志。

OTC 不使用上述人工状态机。创建请求校验通过后直接进入 `completed`，订单、
两条账本分录、Webhook 事件和审计记录原子写入。

## 7. 账本与余额不可直接修改原则

`ledger_entries` 是业务完成后的追加式财务记录，不是可编辑余额表。

必须遵守：

1. 不允许在 Admin 提供“编辑余额”或“删除账本”按钮。
2. 不允许通过 SQL 直接覆盖客户余额。
3. 每条账本分录必须关联 `source_type` 和 `source_id`。
4. 未完成的错误申请应拒绝或取消后重新创建。
5. 已完成交易如需纠正，应创建独立、受审核的冲正或补偿业务记录，填写原因、原交易引用和审批人，再由系统追加反向分录。
6. V1 若尚未提供受控冲正接口，管理员必须升级处理，不得手工修改 D1。
7. 终态不可变、幂等键和数据库事务必须共同防止重复完成和重复记账。

## 8. Admin API 映射

| 能力 | 接口 |
| --- | --- |
| 运营总览 | `GET /api/browser/v1/admin/overview` |
| 开户列表 / 创建 | `GET/POST /api/browser/v1/admin/va-applications` |
| 开户详情 / 更新 | `GET/PATCH /api/browser/v1/admin/va-applications/:id` |
| 驳回并要求补正 | `POST /api/browser/v1/admin/va-applications/:id/request-changes` |
| 客户列表 | `GET /api/browser/v1/admin/customers` |
| 客户详情 | `GET /api/browser/v1/admin/customers/:id` |
| 资金记录列表 / 管理员入账 | `GET/POST /api/browser/v1/admin/fund-transactions` |
| 资金记录状态处理 | `PATCH /api/browser/v1/admin/fund-transactions/:id` |
| OTC 自动兑换记录 | `GET /api/browser/v1/admin/otc-orders` |
| 客户余额 | `GET /api/browser/v1/admin/balances?application_id=:id` |
| 交易历史 | `GET /api/browser/v1/admin/transactions` |
| 账本 | `GET /api/browser/v1/admin/ledger` |
| 手续费配置 | `GET /api/browser/v1/admin/withdrawal-fees` |
| 修改单项手续费 | `PATCH /api/browser/v1/admin/withdrawal-fees/:type` |
| API 接入配置、申请与投递 | `GET /api/browser/v1/admin/api-integration` |
| 批准 / 拒绝接入申请 | `POST /api/browser/v1/admin/api-integration/requests/:id/approve`、`POST /api/browser/v1/admin/api-integration/requests/:id/reject` |
| 批准 / 拒绝 API 凭证轮换 | `POST /api/browser/v1/admin/api-integration/credential-rotation-requests/:id/approve`、`POST /api/browser/v1/admin/api-integration/credential-rotation-requests/:id/reject` |
| 人工重试 Webhook 投递 | `POST /api/browser/v1/admin/api-integration/deliveries/:id/retry` |
| 通用补发 Webhook | `POST /api/browser/v1/admin/api-integration/webhook-replays` |
| API 安全配置 | `GET/PATCH /api/browser/v1/admin/api-security` |
| 新增 IP 白名单 | `POST /api/browser/v1/admin/api-security/ip-allowlist` |

客户列表接口同时供客户总览和余额总览使用，支持 `q`（客户名称、编号或邮箱）、
`status`、`balance_state=all|with_balance|with_reserved`、`page` 与 `limit`（最大 100）。
响应 `meta` 包含 `total`、`page`、`limit` 和本次余额快照读取时间 `snapshot_at`。
| 修改 / 删除 IP 白名单 | `PATCH/DELETE /api/browser/v1/admin/api-security/ip-allowlist/:id` |
| 审计日志 | `GET /api/browser/v1/admin/audit-logs` |
| OpenAPI 文档 | `GET /api/browser/v1/admin/openapi.yaml` |

Portal 的 Webhook 配置页只展示近期投递，并提供“查看全部”入口跳转到
`/portal/webhook-deliveries`。完整列表使用
`GET /api/browser/v1/portal/api-integration/deliveries` 服务端分页，默认每页 50 条，
支持按 `event_type` 和 `status` 筛选；响应必须限定当前 Partner，且不得包含
`last_error`、签名密钥版本或其他内部投递字段。

Portal 和 Partner API 必须共享同一业务服务层、余额校验和状态规则，不能各自实现一套账本逻辑。Partner API 创建入账应返回 `403 operator_only`。
OTC 只能由 Ethan 通过 Portal 或 Partner API 发起；Admin 页面只读查询，
不得提供“新建 OTC”或审批入口。Admin 尝试创建时服务端返回 `403 partner_only`，
尝试 PATCH 时返回 `409 otc_auto_settlement_enabled`。
同理，Admin `POST .../fund-transactions` 只允许
`fiat_deposit` / `usdt_deposit`，尝试创建转出返回 `403 partner_only`。

Admin 列表过滤和状态录入契约：

| 场景 | 查询或请求体 |
| --- | --- |
| 修正客户基本资料 | `PATCH .../va-applications/:id`，body 为 `profile: { phone_country_code, phone_number, email, customer_name }` |
| 驳回并要求补正 | `POST .../va-applications/:id/request-changes`，body 为客户可见 `reason_code`、`reason_text`、`required_fields`、可选内部 `internal_note` 和 `expected_version` |
| 新增或修正 Sumsub 链接 | `PATCH .../va-applications/:id`，body 为 `kyc_url`；`submitted` 首次保存进入 `kyc_link_ready`，后续修正保持状态 |
| 推进开户状态 | `PATCH .../va-applications/:id`，body 为 `status`；不能单独把状态改为 `active` |
| 新增或修正 VA 账户 | `PATCH .../va-applications/:id`，body 为完整 `va_account`；允许从 `kyc_approved` / `va_processing` 激活或在 `active` 状态修正 |
| 入账队列 | `GET .../fund-transactions?direction=deposit&application_id=&status=&type=` |
| 转出队列 | `GET .../fund-transactions?direction=withdrawal&application_id=&status=&type=` |
| OTC 记录 | `GET .../otc-orders?application_id=&status=` |
| 资金处理 | `PATCH .../fund-transactions/:id`，body 为 `status`、可选 `operator_note`、可选 `transaction_reference`；完成转出时参考号必填 |
| 交易历史 | `GET .../transactions?application_id=&category=&status=&wallet=&date_from=&date_to=&page=&limit=` |
| 审计日志 | `GET .../audit-logs?application_id=&actor_type=&action=&page=&limit=`；`actor_type` 仅支持 `operator` 或 `partner`，`limit` 最大 200 |

开户 PATCH 每次必须且只能提交 `profile`、`kyc_url`、`status`、`va_account`
中的一种变更；空请求或混合多种变更由服务端返回 `422 validation_error`。

`public/openapi.yaml` 是 Ethan 的 Partner 机器 API 合同；Admin 浏览器虽可通过
`/api/browser/v1/admin/openapi.yaml` 读取同一文件，但 Admin 控制面请求体和权限
以本节为准，不能误把 Partner API 文档当作完整的 Admin OpenAPI。

`/api/v1/admin/*` 与 `/api/v1/portal/*` 只是迁移期间保留的 legacy
Cloudflare Access 外层边界，不是当前网页端入口，也不能用 Portal 会话代替
Partner 机器 API Service Token。新页面和人工联调统一使用
`/api/browser/v1/admin/*` 或 `/api/browser/v1/portal/*`。

## 9. 安全与运营控制

- Admin 网页必须使用 `/admin/login` 的应用密码 + TOTP，并由服务端校验
  `admin` 角色会话；Cloudflare Access 继续保护机器 API 和保留的旧 API 边界。
- Partner API 使用 Cloudflare Access Service Token，不使用 Portal 浏览器会话作为机器凭证。
- 浏览器登录或 TOTP 绑定成功后，服务端签发 `__Host-va_session` HttpOnly Cookie。
  `GET /api/auth/me` 返回当前用户、会话到期时间和 `csrf_token`；浏览器
  `GET` / `HEAD` / `OPTIONS` 请求只需角色匹配的 Cookie，所有
  `POST` / `PUT` / `PATCH` / `DELETE` 还必须发送精确同源 `Origin` 与
  `X-CSRF-Token`。缺失或不匹配分别返回 `403 invalid_origin` 或
  `403 invalid_csrf_token`。完整合同见 [Authentication API](./AUTH_API.md)。
- Partner API 已使用 Access Service Token、IP 白名单、每分钟 120 次限流和资金写入
  `Idempotency-Key`。V1 尚未实现独立 HMAC 请求签名；幂等键只能防重复业务写入，
  不能替代鉴权签名。
- IP 白名单只限制机器 API，不应影响管理员和 Ethan 的 Portal 登录。
- Partner 转出、OTC 与 Admin 入账均强制使用幂等键；现有 Admin 页面会为同一
  录入草稿生成并在重试时复用稳定键。开户 V1 不支持 `Idempotency-Key`。
  相同业务键不得跨资金/OTC 端点复用，也不得重复占用或记账。
- 敏感字段在日志中脱敏；不得记录完整 Service Token、银行账号或钱包私钥。
- 状态更新需使用事务和并发校验，防止两名管理员同时完成同一申请。
- 关键动作记录 `application_id`、`action`、`actor_type`、变更前后状态、参考号和
  时间；已认证浏览器操作者写入 `metadata.actor`，机器调用写入 `partner_api`。

### 9.1 IP 白名单管理

- `GET /api/browser/v1/admin/api-security` 返回 Access Service Token 要求、白名单总开关、
  有效规则数、规则列表及限流信息。
- 规则支持单个 IPv4/IPv6 地址或 CIDR；服务端会规范化为网络地址与前缀长度。
- 新增规则使用 `cidr`、可选 `label` 和可选 `enabled`；修改规则可更新这三个字段。
- 只有存在至少一条启用且有效的规则时才能打开总开关，否则返回
  `409 api_ip_allowlist_empty`。
- 总开关打开时，不得停用或删除最后一条有效规则，否则返回
  `409 api_ip_allowlist_would_lock_out`。
- 未命中规则的 Partner API 请求返回 `403 api_ip_not_allowed`；Admin 与 Portal
  API 不经过该白名单。
- 白名单创建、更新、删除和总开关变更都写入审计日志。生产启用前必须同时录入
  Ethan 的主出口和灾备 CIDR，并从两条链路各验证一次。

### 9.2 API 凭证、接入审批与 Webhook 重试 / 补发

- `GET /api/browser/v1/admin/api-integration` 返回待审批/已审批的凭证轮换、IP 与
  Webhook 申请、生效配置和最近投递。
- 凭证轮换生产启用前必须配置两个 Worker Secret：
  `CLOUDFLARE_ACCESS_MANAGEMENT_API_TOKEN`（仅授予 Access Service Tokens Write）
  与独立随机生成的 `API_CREDENTIAL_ENCRYPTION_KEY`。两者不得写入仓库、D1、日志
  或前端环境变量。
- 客户提交轮换申请后，Admin 通过
  `POST /api/browser/v1/admin/api-integration/credential-rotation-requests/:id/approve`
  批准，或使用同路径的 `/reject` 拒绝。批准会轮换当前绑定的同一个 Cloudflare
  Service Token；旧 Secret 按申请中的 `migration_window_hours` 保留 1–168 小时。
- 批准流程先调用 Cloudflare refresh 重新计算当前 `8760h`（一年）有效期，再轮换
  Secret。不要把生产金融 API 凭证改为 `forever`；到期日必须在 Portal 与 Admin
  可见并进入年度轮换检查。
- 新 Secret 使用独立密钥 AES-256-GCM 加密暂存。Admin 永远不能查看；Ethan 只能在
  Portal 使用当前账户的 TOTP 二次验证领取一次。成功响应后密文立即从 D1 清除。
  如客户未保存或泄露，必须重新提交轮换申请，不能恢复原 Secret。
- 批准使用
  `POST /api/browser/v1/admin/api-integration/requests/:id/approve`，拒绝使用
  `POST /api/browser/v1/admin/api-integration/requests/:id/reject`；拒绝必须填写
  审核原因，重复或过期状态变更返回冲突。
- Webhook 地址和事件只有批准后才生效。失败投递按指数退避自动重试，最多五次进入
  `dead_letter`；Admin 仅可对 `retry_scheduled` 或 `dead_letter` 记录调用
  `POST /api/browser/v1/admin/api-integration/deliveries/:id/retry`。
- 通用补发调用 `POST /api/browser/v1/admin/api-integration/webhook-replays`，必须填写
  `reason`，并且只能使用以下一种模式：传 `source_delivery_id` 复制任意历史业务投递，
  或同时传 `event_type` 与 `resource_id` 从当前 Partner 范围业务记录重建客户可见快照。
  补发使用当前生效端点和签名密钥，且事件必须仍在当前订阅中；每次补发生成新的
  `event_id`。历史状态与当前资源状态不一致时，应从历史投递复制，不能伪造当前状态。
- 重试复用原投递及原 `event_id`；补发创建新投递及新 `event_id`。两类操作均写入
  审计。补发原因、操作者、来源投递和资源编号只保存在内部审计中，不进入客户报文。
  审核人身份保存在申请的 `reviewed_by` 及审计
  `metadata` 中。Webhook 签名 Secret 不进入 D1、响应或日志。

### 9.3 审计日志管理

- 审计列表按 `created_at DESC, id DESC` 返回，支持客户、操作者类型、精确 action
  和分页过滤。
- 资金/OTC 创建与状态变更、手续费修改、白名单修改、开户资料修正均应产生审计。
- 列表响应包含 `action`、`actor_type`、`application_id`、客户名、结构化
  `metadata` 和时间；`metadata.actor` 标识自定义会话邮箱或 `partner_api`，
  页面详情不得显示 Access Secret 或请求正文。
- `operator_note`、`transaction_reference` 和 `settlement_reference` 属于业务记录
  字段。审计至少应能通过源记录 ID 关联它们；若需要在审计元数据中保存值，必须先
  明确脱敏规则。

### 9.4 法币清算、自动兑换与 USDT 归集

- 法币转入录入后默认处于“待清算”。Admin 可改为“调单”，只有选择“已清算”
  才会读取当前后台固定净汇率，并在同一 D1 batch 中完成 USD 入账、USD 扣减、
  零手续费 OTC 和 USDT/TRON 入账。
- 清算后统一交易历史必须保留原“法币转入”，并显示新 OTC 与“法币扣款”三条
  关联记录。“法币扣款”只是现有 USD 负账本的只读投影，不得再次写入负账本。
  三条记录通过来源法币交易 ID 和 OTC ID 双向追溯。
- 固定净汇率默认是 `1 USD = 0.995 USDT`。在
  `/dashboard/usdt-sweeps` 的“归集设置”中修改后只影响之后清算的记录；每笔 OTC
  保存清算时的汇率快照和来源法币交易 ID。
- 后台侧栏“USDT 归集”进入统一工作台。创建批次只锁定客户可用余额；人工把总额
  打到 Ethan 当前唯一 TRON 白名单地址并录入 64 位 Tx Hash 后，必须再次点击
  “确认完成”才会为每位客户写入正式负账本。
- 只有尚未提交 Tx Hash 的 `locked` 批次可取消并释放锁定。`submitted` 必须核对链上
  结果后确认完成；不得直接取消释放余额。需要纠错时进入人工对账，不能把可能已经
  转出的价值重新变成可用余额。`completed` 不能删除、取消或回退。同一 Tx Hash
  只能使用一次，历史批次保存白名单地址快照。
- Admin API 为
  `GET/POST /api/browser/v1/admin/sweep-batches`、
  `GET /api/browser/v1/admin/sweep-batches/:id`、
  `POST /api/browser/v1/admin/sweep-batches/:id/{submit|complete|cancel}`，
  设置接口为 `/conversion-settings/usd-usdt-tron` 与
  `/sweep-settings/ethan-tron-address`。
- Ethan Webhook 可订阅 `fiat_deposit.cleared_and_converted`、
  `usdt_sweep.locked`、`usdt_sweep.completed` 和 `usdt_sweep.cancelled`。
  投递失败不会回滚已经完成的清算或账务。

### 9.5 Partner Portal 通知 API

Portal 登录会话通过以下浏览器 API 读取和标记通知：

| 能力 | 接口 |
| --- | --- |
| 通知列表 | `GET /api/browser/v1/portal/notifications?limit=50` |
| 标记单条已读 | `POST /api/browser/v1/portal/notifications/:id/read` |
| 全部标记已读 | `POST /api/browser/v1/portal/notifications/read-all` |

- `limit` 必须为 1–100 的正整数；默认为 50，非法值返回 `422 validation_error`。
- 列表项包含 `id`、`application_id`、`customer_name`、`action`、
  `metadata`、`created_at` 和 `is_read`；`meta` 包含 `count`、`unread` 和 `limit`。
- 通知仅来自 Portal 可见的开户、资金、法币清算转换和 API 接入审批事件。
  标记不存在的通知返回 `404 not_found`。
- 这些端点仅供已登录 Partner Portal 使用，需要会话与 CSRF 保护，
  不属于 Cloudflare Access Service Token 认证的 `/api/v1` Partner API。

## 10. V1 验收场景

1. 访问 `/dashboard` 进入运营总览；旧 `/dashboard/operations` 进入入账录入；侧栏分组和各新路由可用。
2. Ethan 仅提交国家区号、号码、邮箱和客户名称；Admin 回传 Sumsub 链接，KYC 通过后录入完整 VA 账户，Portal 最终显示账户资料。
3. Admin 核实一笔 USD 实际到账，录入银行流水号并完成；完成前余额不变，完成后 USD 增加且交易、账本、审计均可追溯。
4. Admin 分别录入 TRON 与 BSC 的 USDT 入账；只有对应网络余额增加，USDT 汇总为各链合计。
5. Ethan 发起法币转出；系统按当前费率固化 30 USD 手续费并占用余额；Admin 完成时必须录入银行参考号，Portal 显示手续费和实际到账金额。
6. Ethan 从 Ethereum 发起 USDT 转出；系统只校验和占用 Ethereum 余额；Admin 完成时必须录入 Tx Hash，其他网络余额不变。
7. Admin 拒绝或取消一笔待处理转出；占用立即释放，不产生账本分录，终态不能重新打开。
8. Ethan 分别发起 USD → BSC USDT 和 TRON USDT → USD OTC；系统只允许这两个方向，按指定网络原子扣账和入账，并按买入金额计算 0.5% 手续费。
9. 管理员修改手续费后，新申请使用新费率，修改前已提交申请仍保留原费用快照。
10. 任一完成交易都能从交易详情跳转或关联到源记录、账本分录和审计日志；法币和链上详情展示各自相关字段。
11. Partner API 无权创建入账；未授权、非白名单 IP、超限请求均被拒绝；Portal 正常登录和操作不受机器 API 白名单影响。
12. 重复发送相同幂等请求不会重复创建记录；并发完成不会重复记账；终态记录无法被回退。
13. 在 Admin 分别进入入账、转出、OTC、余额、交易和账本独立路由；客户筛选和
    待办状态不会因为切换栏目而隐藏或串到其他业务队列。
14. 转出从 `processing` 进入 `completed` 时，空银行参考号或空 Tx Hash 返回
    `422 transaction_reference_required`；补齐后完成，处理备注和参考号可在详情中追溯。
15. OTC 请求返回 `completed` 后，在订单详情、统一交易历史和账本核对卖出、
    手续费与净买入字段；Admin 页面不得出现审批或处理按钮。
16. 审计日志可按客户、actor 和 action 查询；白名单总开关在无有效规则及试图
    删除最后一条有效规则时分别触发防锁死错误。
17. Admin 尝试创建转出或 OTC 均返回 `403 partner_only`；Partner/Portal 尝试
    创建入账返回 `403 operator_only`，角色边界不能仅依赖隐藏前端按钮。
18. Admin 录入 USD 1000，先标记调单再恢复待清算，余额不变；选择已清算后生成
    `995 USDT/TRON`、零手续费自动 OTC，并且第二次清算返回冲突。
19. 在“USDT 归集”选择多个客户创建批次，确认可用余额先减少但账本未扣款；取消
    会释放锁定。重新创建、填写 Tx Hash 并确认完成后，逐客户负账本之和等于批次
    总额，Ethan Webhook 包含客户明细。
20. 对未激活开户申请执行“驳回并要求补正”，确认 Portal/API/Webhook 只显示客户
    可见原因和待修改字段，不显示内部备注或操作员；同一申请不能重复发出未完成补正。
    Partner 使用稳定幂等键与最新版本重提后，申请 ID 不变、轮次和版本递增、状态回到
    `submitted`；重复重提不创建第二轮，旧版本请求返回冲突。
