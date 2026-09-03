# VA 开户手续费设计

**状态：** 已确认  
**日期：** 2026-09-03  
**范围：** 客户 Portal VA 申请、管理后台银行渠道配置、Core API、Render PostgreSQL 账务与对账

## 1. 目标与边界

客户申请 VA 时，按所选银行渠道收取独立的固定 USD 开户手续费：

- 管理员在现有银行渠道管理页配置每家银行的开户费；
- 客户提交申请时，从自己的 `SYSTEM_WALLET / USD` 可用余额中冻结费用；
- 管理员批准开户时正式扣除冻结费用，并记入平台 `FEE_REVENUE / USD`；
- 管理员拒绝或客户取消时释放冻结费用；
- 客户、管理员、平台账本均能查询同一笔费用的完整状态和关联关系。

本期只支持每家银行一档固定 USD 金额，不做客户级覆盖、百分比、阶梯价、优惠券或多币种扣费。银行配置为 `0 USD` 时允许免费申请，但不创建 0 金额资金流水或日记账。

## 2. 现有能力与复用原则

当前 VA 申请已有 `FundingChannel -> VirtualAccountRequest -> Account` 流程，但申请、批准和拒绝均不处理余额或账本。现有转出流程已具备冻结、解冻、消耗冻结余额、手续费收入账户和复式记账能力。

本设计复用现有模型，不新增重复的“开户费流水表”或通用计费引擎：

- `FundingChannel`：银行级费率配置；
- `VirtualAccountRequest`：开户业务状态和不可变费率快照；
- `Operation(type=VA_OPENING_FEE)`：客户可见的手续费资金记录；
- `JournalEntry / JournalLine`：正式入账凭证；
- `Account`：客户 USD 钱包余额及平台 USD 手续费收入余额。

## 3. 数据设计

### 3.1 银行渠道配置

在 `FundingChannel` 增加：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `openingFeeUsdMinor` | `BigInt?` | 固定 USD 开户费，最小单位为美分；`null` 表示未配置，`0` 表示免费 |
| `openingFeeVersion` | `BigInt` | 版本号，默认 0，首次配置为 1，每次改价加 1 |
| `openingFeeUpdatedBy` | `String?` | 最近修改管理员 ID |
| `openingFeeUpdatedAt` | `DateTime?` | 最近修改时间 |

只有 `VIRTUAL_ACCOUNT` 类型渠道可以配置开户费。渠道只有在银行资料完整且开户费已明确配置后才允许启用，避免将“未配置”误当成免费。

管理后台沿用现有 `/dashboard/funding-channels` 和资金设置权限，不新增菜单、页面或费率表。更新时提交当前 `openingFeeVersion`；版本不一致返回 `409 virtual_account_opening_fee_changed`，禁止覆盖其他管理员刚保存的价格。

### 3.2 VA 申请快照

在 `VirtualAccountRequest` 增加：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `idempotencyKey` | `String?` | 客户提交幂等键，与 `customerId` 组成唯一约束 |
| `openingFeeUsdMinor` | `BigInt` | 提交时锁定的费用快照，后续改价不追溯 |
| `openingFeeVersion` | `BigInt` | 提交时锁定的渠道费率版本 |
| `feeOperationId` | `String?` | 非零费用对应的唯一 `Operation` 外键 |

申请仍保存 `channelId`，费用快照只保存财务计算所需字段；银行显示名称从渠道读取，批准后银行固定资料继续复制到 VA 账户。免费申请的 `feeOperationId` 为 `null`。

### 3.3 手续费资金记录

`OperationType` 增加 `VA_OPENING_FEE`。非零费用创建一笔 Operation：

- `currency = USD`
- `amount = opening fee`
- `feeAmount = 0`
- `sourceAccountId = customer SYSTEM_WALLET / USD`
- `targetAccountId = platform FEE_REVENUE / USD`
- `channelId = selected VIRTUAL_ACCOUNT channel`
- `status = SUBMITTED`（冻结中）
- `narrative = VA opening fee`
- `metadata.vaOpeningFee` 保存申请 ID、银行渠道代码和名称、费率版本、冻结时间

申请与费用 Operation 一对零或一关联。Operation 是客户交易明细和管理员资金记录的唯一资金事实，不复制到另一张费用流水表。

### 3.4 正式账本

批准非零费用时，在同一个串行化事务内：

1. 客户 USD 钱包 `frozenBalance` 减少；
2. 创建唯一 `JournalEntry`；
3. 写入两条 USD `JournalLine`：
   - 借：客户 `SYSTEM_WALLET / USD`
   - 贷：平台 `FEE_REVENUE / USD`
4. Operation 标记为 `COMPLETED` 并记录 `executedAt`；
5. VA 申请标记为 `APPROVED` 并关联新建 VA 账户。

开户费不经过 `PLATFORM_CLEARING`，因为这不是外部银行款项清算。免费申请不创建 Operation 或 JournalEntry，申请快照中的 0 金额就是审计依据。

## 4. 状态与原子性

`AccountRequestStatus` 增加 `CANCELLED`。状态映射如下：

| 动作 | VA 申请 | 手续费 Operation | 客户 USD 钱包 | 平台手续费账户 | 日记账 |
| --- | --- | --- | --- | --- | --- |
| 提交非零费申请 | `SUBMITTED` | `SUBMITTED` | 可用减少、冻结增加 | 无分录 | 无 |
| 批准 | `APPROVED` | `COMPLETED` | 冻结减少 | 记入贷方 | 一笔平衡凭证 |
| 管理员拒绝 | `REJECTED` | `REJECTED` | 冻结释放回可用 | 无分录 | 无 |
| 客户取消 | `CANCELLED` | `CANCELLED` | 冻结释放回可用 | 无分录 | 无 |
| 提交免费申请 | `SUBMITTED` | 无 | 不变 | 无分录 | 无 |

所有余额、申请、Operation、JournalEntry 和 VA 账户变更必须在 Core API 的同一个 Render PostgreSQL 串行化事务中完成。任何一步失败都整体回滚。

只有 `SUBMITTED` 可以转为 `APPROVED`、`REJECTED` 或 `CANCELLED`。客户只能取消自己的申请；管理员不能用客户取消接口。重复审批、拒绝、取消或并发请求返回冲突，不得二次扣费或二次释放。

## 5. 提交与费用确认

客户读取可用 VA 银行时，Core API 返回格式化后的 `openingFeeUsd` 和 `openingFeeVersion`。Portal 在申请弹窗中显示：

- 所选银行；
- 申请币种；
- 开户手续费（固定 USD）；
- 扣款钱包：SSC 钱包 · USD；
- 当前可用余额；
- 提交后的可用余额；
- “提交后冻结，批准后扣除；拒绝或取消后释放”的说明。

提交时客户端发送 `expectedOpeningFeeUsd`、`expectedOpeningFeeVersion` 和 `Idempotency-Key`。服务端在事务内重新读取渠道和客户 USD 钱包：

- 渠道未配置费用：`virtual_account_opening_fee_not_configured`；
- 金额或版本变化：`virtual_account_opening_fee_changed`，要求客户重新确认；
- 无活动 USD 钱包：`usd_wallet_not_found`；
- 可用余额不足：`insufficient_available_balance`；
- 相同幂等键重试：返回原申请和原费用快照，不重复冻结；
- 同一客户、银行、币种已有待审申请：沿用现有冲突规则。

客户端只确认服务端报价，不能自行指定最终费用。手续费始终从 USD 钱包扣除，与所申请 VA 的币种无关。

## 6. 查询与界面记录

### 客户 Portal

- VA 申请列表显示银行、申请币种、开户费、费用状态、申请时间和审核/取消结果；
- `SUBMITTED` 申请提供“取消申请”，确认后释放冻结；
- 交易明细将 `VA_OPENING_FEE` 显示为“VA 开户手续费”，金额方向为支出；
- Operation 详情显示申请参考号、银行、渠道、费率版本、扣款钱包、冻结/扣除/释放时间和原因；
- 状态文案：`SUBMITTED=已冻结`、`COMPLETED=已扣除`、`REJECTED/CANCELLED=已释放`。

### 管理后台

- 银行渠道编辑器显示开户费、版本、最近修改人和时间；
- VA 审核详情显示费用快照、USD 钱包可用/冻结余额、费用 Operation 参考号和当前费用状态；
- 现有交易记录按 `VA_OPENING_FEE` 查询客户手续费；
- 现有账本显示批准后生成的客户借方和平台手续费收入贷方；
- 修正现有“VA 开通不产生账本分录”的说明，改为“VA 账户初始余额为 0；如配置开户费，批准时产生手续费账本分录”。

客户响应继续经 Web Worker 脱敏，不返回管理员身份、内部备注、租户键或其他客户数据。

## 7. 对账规则

在现有对账视图补充以下断言：

- 每笔非零、已完成的 `VA_OPENING_FEE` 必须恰有一笔平衡 USD 日记账；
- 每笔非零、待审核的 VA 申请必须有一笔 `SUBMITTED` 费用 Operation，且客户 USD 冻结额至少覆盖该费用；
- `REJECTED` 或 `CANCELLED` 的费用 Operation 不得存在日记账；
- USD `FEE_REVENUE` 的开户费贷方合计等于同期已完成 VA 开户费 Operation 合计；
- 同一申请不能关联多个费用 Operation，同一费用 Operation 不能关联多个申请。

不把冻结动作记入正式复式日记账；冻结通过 `Account.availableBalance / frozenBalance` 与 `SUBMITTED` Operation 审计。

## 8. 安全、发布与验收

- 所有读写按 organization/customer 归属校验；客户取消路径需加入 Web Worker 自有资源白名单测试；
- 金额以美分整数配置，在服务端转换为 Prisma Decimal，禁止 JavaScript 浮点数直接写库；
- 日记账引用使用费用 Operation reference，数据库唯一约束和条件更新共同防止重复入账；
- 邮件仅发送客户可见结果，不泄露管理员身份或内部信息；
- 不自动触发任何真实银行或钱包转账。

生产数据库变更必须先完成 Render PostgreSQL 全量备份、checksum、隔离恢复测试、人工批准和迁移后审计。GitHub 发布、Core 发布和 Web 发布分开执行，本设计确认不授权迁移或部署。

验收至少覆盖：不同银行不同费用、0 USD 免费、改价并发、报价变化、余额不足、幂等重试、批准扣费、拒绝释放、客户取消释放、重复状态变更、客户越权、日记账平衡、平台手续费余额及客户/管理员记录可追溯。
