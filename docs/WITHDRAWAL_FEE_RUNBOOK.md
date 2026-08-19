# 多渠道转出手续费运行手册

## 业务目标

法币和数字货币转出不再共用单一全局费率。每条生效规则由以下维度唯一确定：

- 机构、生产租户或客户；
- 资产类别：`FIAT` 或 `CRYPTO`；
- 币种；
- 转出方式：`VA`、`POBO`、`PLATFORM` 或 `ON_CHAIN`；
- 渠道代码；
- 数字货币网络（法币固定为空，当前数字货币只允许 `TRON`）。

当前计费模式是每笔固定手续费。金额使用资产最小单位保存：法币 2 位，USDT 6 位，
不经过 JavaScript 浮点数写库。后续如增加百分比、阶梯或最低/最高费用，应新增明确的
计费模式字段和版本，而不是复用固定金额字段表达不同含义。

## 配置与权限

- Core 管理 API：
  - `GET /api/v1/withdrawal-fees?organizationId=...&customerId=...`
  - `POST /api/v1/withdrawal-fees`
  - `PATCH /api/v1/withdrawal-fees/:id`
- 只有机构 `ADMIN` 可以创建或修改规则；查询仍经过机构隔离。
- 不传 `customerId` 时返回机构/生产租户规则；传入 `customerId` 时同时返回该客户规则，
  且服务端验证客户属于当前机构。客户规则优先于机构默认，停用后自动回退机构默认。
- 新建客户规则时 `POST` 同时提交 `organizationId` 与 `customerId`；客户 ID 不能跨机构，
  也不能借此读取或修改其他机构的费率。
- 新规则使用 `POST`，已存在规则必须用当前 `version` 调用 `PATCH`。并发修改返回
  `409 withdrawal_fee_changed`，不得静默覆盖另一名管理员的更新。
- 法币规则的渠道代码必须对应同机构的渠道，方式与渠道类型必须匹配：
  `VA -> VIRTUAL_ACCOUNT`、`POBO -> POBO_PAYOUT`、
  `PLATFORM -> PLATFORM_PAYOUT`。
- Cregis 数字货币规则固定为 `CRYPTO / USDT / ON_CHAIN / CREGIS / TRON`。

后台 `/dashboard/funding-channels` 在渠道列表下方提供机构逐规则固定费用编辑；
`/dashboard/customers/:id` 的“手续费与规则”页签提供客户覆盖编辑。停用或改价只影响
之后的新申请，不能改写历史交易。

## 转出与快照

法币 Core 转出：

1. 客户端读取当前规则并展示渠道、手续费与账户总扣款。
2. 提交时发送 `expectedFeeAmount` 和 `expectedFeeRuleVersion`。
3. 服务端在串行化事务内按“客户覆盖 > 机构默认”重新读取生效规则，忽略客户端提供的
   普通 `feeAmount`。
4. 手续费加入冻结总额，并将金额以及规则 ID、版本、渠道和方式写入交易快照。

Cregis USDT/TRON 转出：

1. 客户输入金额是钱包总扣账金额。
2. `net_amount = amount - fee_amount`；只有 `net_amount` 发送给 Cregis。
3. 钱包余额仍按总扣账金额冻结和最终扣减。
4. `cregis_withdrawals` 保存总额、手续费、净额、规则 ID 和规则版本。
5. 同一幂等键重试先返回原交易快照；管理员之后改费不会重算旧申请。

金额小于或等于手续费必须返回 `withdrawal_amount_too_low`。客户端确认的金额或版本已经
变化时返回 `withdrawal_fee_changed`，要求客户重新核对，不能自动接受新费用。

## 数据库与发布

- Core Prisma migration：`20260818020000_withdrawal_fee_rules`。
- Go/Render PostgreSQL migration：`0006_withdrawal_fee_rules.sql`。
- 两条迁移都只创建同一张小写表 `withdrawal_fee_rules`；Go migration 还为
  `cregis_withdrawals` 增加交易级费用快照列，并为生产租户准备 5 USDT 的 Cregis 默认
  规则。该默认值只有迁移实际应用后才生效。

生产执行顺序：

1. 完整备份 Render PostgreSQL，记录 checksum，在隔离 PostgreSQL 17 中恢复并核对行数。
2. 暂停新转出提交，人工审核 migration checksum 后应用迁移。
3. 发布 Core 和 Go API，验证直连未授权请求失败、管理员规则机构隔离有效。
4. 发布 Web，分别验证 VA、POBO、平台代付和 Cregis/TRON 的费用预览。
5. 使用隔离测试客户提交但不执行真实银行或链上付款；核对总额、手续费、净额、冻结额和
   规则版本快照。
6. 经人工批准后恢复转出；真实资金验收仍必须单独审批。

本地 migration、seed、构建或 dry-run 均不代表 Render migration、服务发布或真实资金
转出已经完成。
