# 客户转出白名单运行手册

## 业务范围

Customer Portal 在“安全与设置”内通过 `/portal/settings/allowlist` 提供统一的“转出白名单”入口；
它不作为顶部或侧边栏的独立导航项。旧路径 `/portal/money/beneficiaries` 仅保留重定向兼容：

- 法币：客户本人的 USD / HKD 银行收款账户；
- 数字货币：USDT / TRON（TRC20）外部收款地址。

白名单只定义后续转出可选择的目标，不代表付款批准、银行受理、链上广播或最终结算。
新增和停用均不产生余额变化或账本分录。

## 安全与数据边界

- 客户只能读取和变更当前登录客户自己的白名单。
- 新增和停用必须通过同一客户会话、同源 CSRF 与当前六位 TOTP 动态码的短时 step-up。
- step-up token 绑定当前会话、客户、凭证版本、用途和五分钟有效期，且只能使用一次。
- 法币只允许 USD / HKD；数字货币只允许 USDT / TRON（TRC20）。
- 银行账号、IBAN、SWIFT/BIC 和钱包地址保存后不可编辑。资料变化时必须停用旧记录并重新新增。
- 停用是可审计状态变化，不删除历史交易，也不改写已提交交易中的目标快照。
- 法币白名单写入 Core `Beneficiary`，数字货币地址继续使用
  `customer_withdrawal_addresses`；两者都由 Render PostgreSQL 持久化。

## 客户 API

- `GET /api/v1/customer/fiat-beneficiaries`
- `POST /api/v1/customer/fiat-beneficiaries`
- `POST /api/v1/customer/fiat-beneficiaries/:id/revoke`
- `GET /api/v1/customer/withdrawal-addresses`
- `POST /api/v1/customer/withdrawal-addresses`
- `POST /api/v1/customer/withdrawal-addresses/:id/revoke`
- `POST /api/auth/customer/step-up/totp`

新增法币白名单使用客户和幂等键派生的稳定记录 ID；同一请求重试返回原记录，不能用同一
幂等键改写目标。重复的启用中银行账户或链上地址会被拒绝。

## 状态与转出约束

```text
客户输入目标资料
  -> TOTP step-up
  -> active（可用于新的转出申请）
  -> TOTP step-up 停用
  -> revoked / inactive（仅保留历史查询）
```

法币付款和 USDT 转出页面只列出当前启用的匹配目标。后端提交时仍必须重新校验客户归属、
资产、币种、网络和启用状态，不能信任客户端选择结果。

## 发布与验收

1. 发布前运行 Go、Core、TypeScript、i18n、图标、文档、会计与生产构建检查。
2. 分别用客户 A、客户 B 验证列表、创建和停用；客户 A 不得读取或停用客户 B 的记录。
3. 验证错误动态码、已使用 step-up token、重复目标、篡改客户 ID 和嵌套路由均失败。
4. 验证停用后目标从新的付款选择器消失，历史交易仍保留原收款资料。
5. 验收只创建和停用白名单，不提交真实银行或链上转出。

本地测试、GitHub 发布、Render 发布和 Cloudflare Worker 发布是独立状态；未经逐项验证不得
声称该功能已经在生产可用。
