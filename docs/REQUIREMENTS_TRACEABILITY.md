# V1 需求追踪矩阵

> V1.2 当前范围：只允许 Admin 人工录入法币到账，并在明确标记“已清算”后
> 自动兑换为 USDT/TRON。客户转出、USDT 充值及手动 OTC 创建已关闭；历史数据
> 继续通过余额、交易、自动兑换记录和账本查询。旧需求行仅代表历史实现。

状态说明：`已实现` 表示当前代码、API 或确定性 Demo 可验收；`配置待办` 表示产品能力
已具备但需要真实运营配置；`后续版本` 表示明确不属于 V1 自动化范围。

| 需求 | 状态 | V1 证据 / 验收入口 |
| ---------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 单一合作方 Ethan，Edi 人工运营 | 已实现 | Admin `/dashboard/*`、Portal `/portal/*`，权限边界见产品规划 |
| 开户提交客户方小写 UUID v4 客户 ID、国家区号、电话号码、邮箱、客户名称 | 已实现                 | Portal 发起开户、`POST /va-applications`；ID 作为字符串全链路返回                                                                                                                                      |
| 国家区号与号码分开 | 已实现 | `phone_country_code`、`phone_number` |
| Edi 手工回填 Sumsub 链接、KYC 状态与 VA 资料 | 已实现 | Admin 开户详情；Demo 覆盖 `submitted → kyc_link_ready → kyc_approved → va_processing → active` |
| Admin 可修正基础资料、Sumsub 链接和已激活 VA 资料 | 已实现 | `PATCH /api/browser/v1/admin/va-applications/:id` 的 `profile`、`kyc_url`、`va_account`；状态保持与审计 |
| 开户更新一次只允许一种操作 | 已实现 | 混合或空 PATCH 返回 `422 validation_error` |
| VA 返回账户名、账号、币种、SWIFT/BIC、银行名、银行地址 | 已实现 | 客户详情与 `va_account` |
| Ethan 所有合作方操作可通过 API 完成 | 已实现 | OpenAPI：开户、客户、余额、交易、转出、OTC、手续费 |
| Ethan 获得 API 与管理 Portal | 已实现 | `/api/v1` 与 `/portal/home` |
| Admin 与 Portal 使用一致的 Minimal/MUI 设计系统 | 已实现 | 共用布局、主题、MUI 组件 |
| Admin 按工作台、客户与开户、资金运营、系统配置分组 | 已实现 | `/dashboard/overview`、`/dashboard/customers`、`/dashboard/operations/*`、`/dashboard/settings/*` |
| Admin 首页汇总客户、待办、USD、四链 USDT 与最近交易 | 已实现 | `GET /api/browser/v1/admin/overview`、`/dashboard/overview` |
| Admin 客户管理先总览，再进入单一客户全景 | 已实现 | `/dashboard/customers` 与 `/dashboard/customers/:id` |
| Portal 侧栏与右上角搜索、语言、通知、主题、账户入口 | 已实现 | Portal 布局人工验收 |
| Portal 首页展示全局数据看板 | 已实现 | `/portal/home` |
| 客户管理先总览，再进入单一客户账户和资金详情 | 已实现 | `/portal/customers` 与详情路由 |
| 客户余额默认展示全部客户并支持搜索、筛选、分页、导出和详情查询 | 已实现 | `/portal/balances` 与 `/portal/balances/:customerId` |
| 发起开户页只列出未 `active` 客户 | 已实现 | Demo 提供四个未开通状态 |
| 资金实际到账与完成结果由 Edi 录入，Ethan 不能申报转入 | 已实现 | Partner 转入返回 `403 operator_only`；Admin 可录入 |
| Admin 入账必须提供银行参考号或 Tx Hash | 已实现 | 创建缺失返回 `422 external_reference_required`；完成时 `external_reference` / `transaction_reference` 均为空返回 `422 transaction_reference_required` |
| 同一外部入账凭证不得跨客户重复记账 | 已实现 | 同类型/网络全局防重；法币与十六进制链参考号忽略大小写，Solana 签名保留大小写；冲突返回 `409 duplicate_deposit_reference` |
| 可用余额以账本为准，扣除待处理转出占用 | 已实现 | `/balances`；OTC 创建时原子完成，不产生待审批占用 |
| 法币钱包、数字钱包先列全部客户，再进入详情 | 已实现 | 两级钱包路由 |
| 法币/数字货币转出使用独立页面 | 已实现 | `.../{customerId}/withdraw` |
| 转出页左侧余额与流程、下方表单，右侧最近交易 | 已实现 | 两种转出页人工视觉验收 |
| 转出表单分组验证、快捷金额、确认弹窗 | 已实现 | Portal 转出工作台 |
| 法币收款字段区分于链上字段 | 已实现 | 银行资料与网络/钱包地址分组 |
| 法币收款资料包含收款人地址 | 已实现 | `beneficiary_address`，前后端与 OpenAPI 必填 |
| 法币固定手续费 30 USD、数字货币固定手续费 5 USDT | 已实现 | migration 默认值、Admin 可配置、`GET /withdrawal-fees` |
| 显示手续费和实际到账；amount 为总扣账 | 已实现 | 服务端保存 `fee_amount` 快照；`net_amount = amount - fee_amount` |
| 每笔转出保存创建时手续费快照，后台改价只影响新单 | 已实现 | `fee_amount` 由服务端按创建时配置写入；Demo 覆盖 submitted/processing/completed 快照 |
| 提交期间费率变化要求重新确认 | 已实现 | 客户端提交 `expected_fee_amount` 作为并发确认值；不匹配返回 `409 withdrawal_fee_changed` |
| 法币转入、USDT 转入、法币转出、USDT 转出均可追踪 | 已实现 | 统一交易历史；Seed 覆盖全部类型 |
| Admin 资金队列按入账/转出、客户、状态和类型过滤 | 已实现 | `GET /api/browser/v1/admin/fund-transactions?direction=&application_id=&status=&type=` |
| Admin 完成转出必须录入银行参考号或 Tx Hash | 已实现 | `PATCH /api/browser/v1/admin/fund-transactions/:id`；`422 transaction_reference_required` |
| Admin 资金处理可记录运营备注 | 已实现 | `operator_note`；资金记录与 Admin 统一交易详情 |
| 数字货币支持 TRON、Ethereum、Solana、BSC | 已实现 | 网络枚举、图标、地址校验、四链 Seed |
| USDT 余额、转入、转出按链区分 | 已实现 | ledger `network` 维度与四链余额 |
| OTC 仅允许 USD ↔ USDT | 已实现 | API/数据库完整性约束与 UI 方向选择 |
| OTC 的 USDT 买卖侧必须按链扣账/入账 | 已实现 | `sell_network` / `buy_network`；双向 Demo |
| OTC 固定费率 0.5%，校验后即时记账 | 已实现 | `fee_bps=50`、卖出扣账与买入净额同一 D1 batch |
| 法币转入支持待清算、已清算与调单 | 已实现 | `settlement_status`；Admin 入账队列选择已清算 |
| 已清算法币按后台固定净汇率自动兑换 USDT/TRON | 已实现 | 默认 0.995；汇率版本、来源 OTC 与原子账本 |
| 法币入账不得绕过清算直接完成 | 已实现 | Worker 返回 `fiat_settlement_required`；数据库触发器阻止 `completed` 与清算字段不一致 |
| 自动清算 OTC 不另收 0.5% 手续费 | 已实现 | `pricing_model=net_rate`、`fee_amount_minor=0` |
| Admin 有独立 USDT 归集导航、工作台、记录与设置 | 已实现 | `/dashboard/usdt-sweeps` |
| 归集先锁余额，确认链上 Tx Hash 后正式扣账 | 已实现 | `usdt_sweep_batches/items`；`locked → submitted → completed` |
| 已提交 Tx Hash 的归集不得取消释放余额 | 已实现 | 仅 `locked → cancelled`；Worker 与数据库双重阻止 `submitted → cancelled` |
| Ethan 唯一 TRON 白名单地址与批次地址快照 | 已实现 | `/sweep-settings/ethan-tron-address` |
| 清算与归集 Webhook 携带客户和 OTC 明细 | 已实现 | `fiat_deposit.cleared_and_converted` 携带法币金额、净汇率版本、USDT/TRON 净额、OTC ID、参考号与清算时间；`usdt_sweep.*` 携带归集明细 |
| OTC 只能由 Ethan Portal/API 发起，Admin 只读对账审计 | 已实现 | Admin 无新建/审批入口且 Admin POST 返回 `403 partner_only`；Portal/API `POST /otc-orders` |
| Admin 只能录入转入，不能代 Ethan 创建转出 | 已实现 | Admin POST 转出返回 `403 partner_only`；Partner/Portal POST 转入返回 `403 operator_only` |
| Admin OTC 页面只读展示自动兑换结果 | 已实现 | OTC 列表与统一交易详情；Admin PATCH 返回 `409 otc_auto_settlement_enabled` |
| Admin-only 处理备注不返回 Portal/Partner | 已实现 | 按 API scope 移除 `operator_note` 和 OTC `settlement_reference` |
| OTC 左侧上下排列卖出、报价、买入，右侧最近交易 | 已实现 | `/portal/otc` 人工视觉验收 |
| 交易历史使用 Data Grid、日期范围、详情抽屉 | 已实现 | `/portal/transactions` |
| 交易详情按法币、链上、OTC 显示对应字段 | 已实现 | 详情抽屉与确定性 Demo |
| 交易过滤支持客户、类别、状态、日期、钱包及分页 | 已实现 | `GET /transactions`；`v1-smoke.sh` |
| 重复请求不重复占用，同 Key 不同业务返回冲突 | 已实现 | 请求指纹；`409 idempotency_conflict` |
| 资金/OTC 完成、终态与审计原子一致 | 已实现 | migration `0009` 终态保护与 `0013` 账务/API 合同加固；条件记账、状态与审计同一 D1 batch |
| 历史非法待处理单不得绕过新账务规则 | 已实现 | 空链安全回填；其余返回 `409 legacy_integrity_review_required` |
| 生产账务与 API 数据库基线统一 | 候选已实现，生产待发布 | migrations `0001`–`0013`；发布完成前必须应用并验证 `0013_api_accounting_hardening.sql` |
| Admin/Partner 网页使用角色专属密码 + TOTP 登录 | 已实现 | `/admin/login`、`/portal/login`；跨角色凭证不被接受，详见 [Authentication API](./AUTH_API.md) |
| 浏览器业务 API 使用会话 Cookie 与 CSRF 防护 | 已实现 | `/api/browser/v1/admin/*`、`/api/browser/v1/portal/*`；`GET /api/auth/me` 返回 `csrf_token`，不安全方法要求精确 `Origin` + `X-CSRF-Token` |
| 已激活账户恢复必须显式区分 credential reset | 已实现 | `POST /api/auth/setup-token` 的 `purpose=credential_reset`；撤销旧凭证并重新绑定密码/TOTP；首次激活为 `initial_setup` |
| Cloudflare Access Service Token 保护机器 API | 已实现 | Access 策略与请求头；Secret 不入仓库 |
| Partner API 每分钟 120 次限流 | 已实现 | Rate Limiting binding；`429` + `Retry-After` |
| 可选 IPv4/IPv6 CIDR 白名单及防锁死保护 | 已实现 | Admin `API 安全`、Worker fail-closed |
| 生产启用 Ethan 固定出口白名单 | 配置待办 | 需 Ethan 提供生产/灾备 CIDR 后由 Edi 启用 |
| API 白名单创建、修改、删除、总开关均可后台管理 | 已实现 | `/api/browser/v1/admin/api-security` 与 `/api/browser/v1/admin/api-security/ip-allowlist*`；空规则与最后规则防锁死 |
| Ethan 可提交 IP 白名单新增/移除申请，Admin 审批后生效 | 已实现 | Portal/机器 `/api-integration`；Admin `API 管理 → 接入申请`；pending 不影响运行时 |
| Ethan 可提交 Webhook 地址、事件订阅或停用申请 | 已实现 | HTTPS 公网地址校验；Admin 审批后写入生效配置 |
| Webhook 按事件最小化载荷、KYC 链接、VA 激活账户快照、资金金额快照、HMAC 签名、失败重试与死信 | 已实现 | `kyc_link_ready` 携带 Sumsub 链接；`va_account.activated` 携带 Partner 范围 VA 资料；`fund_transaction.status_changed` 携带客户可见金额及清算状态；其他事件保持精简；后台生成的 AES-GCM 加密托管密钥（Worker Secret 兼容回退）；D1 outbox；最多五次；Portal/Admin 投递状态 |
| Admin 驳回开户并给出客户可见原因，Partner 补正后幂等重提 | 本地已实现，待发布 | `0026_va_application_changes_requested.sql`；审核覆盖层保留原开户阶段；Portal/API/Webhook 隔离内部备注；版本冲突与重复重提受控 |
| Admin 可审批/拒绝 API 接入申请、重试失败 Webhook，并通用补发业务事件 | 已实现 | 重试：`POST .../deliveries/:id/retry`，复用原事件；补发：`POST .../webhook-replays`，支持历史投递或事件类型 + 资源 ID，生成新事件 ID，原因与操作者写入审计 |
| Admin 审计日志可按客户、actor、action 和分页查询 | 已实现 | `GET /api/browser/v1/admin/audit-logs`，`limit <= 200`；浏览器操作者写入 `metadata.actor`，机器 API 写入 `partner_api` |
| 每个 API 响应和结构化日志可按 Request ID 关联 | 已实现 | `X-Request-Id` 与日志 `request_id`；不记录凭证/正文 |
| Cloudflare D1 append-only Demo 可重复本地/远端执行 | 已实现 | `scripts/demo-seed.sql`、`scripts/demo-seed.sh`；同 ID 使用 `INSERT OR IGNORE`，不删除账本 |
| Demo 写入不删除或覆盖既有账务数据 | 已实现 | migration `0013` 锁定 Ledger UPDATE/DELETE；完全干净验收使用新隔离 D1 |
| 自动邮件、自动 Sumsub/银行/链集成 | 后续版本 | V1.2/V2 路线图；Webhook 已在 V1.1 实现 |

## 自动验收对应

- `scripts/demo-seed.sh`：显式选择 local/remote；remote 需要双重确认。
- `scripts/v1-smoke.sh`：完全只读，覆盖状态、余额、多链、费率快照、净额、OTC、
  交易过滤、分页、OpenAPI 与 `X-Request-Id`。Admin 新队列、状态处理、审计和
  白名单防锁死仍按 `docs/V1_ACCEPTANCE.md` 人工验收。
- `scripts/v1-idempotency-uat.sh`：显式 opt-in，只操作隔离客户
  `demo_va_uat_api_v1`；仅允许本地隔离 D1，验证同请求重放、跨端点复用、
  详情查询、未知字段拒绝及不同请求 `409 idempotency_conflict`，不清理账本。
- 人工高影响操作仍按 `docs/V1_ACCEPTANCE.md` 验收，不由脚本自动完成或记账。
