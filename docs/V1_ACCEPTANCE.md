# VA BaaS V1 验收清单

## 入口

- 管理员登录：`https://moventra.xyz/admin/login`
- 管理员后台：`https://moventra.xyz/dashboard/va-applications`
  - 登录邮箱：`admin@example.com`
- Ethan 登录：`https://moventra.xyz/portal/login`
- Ethan Portal：`https://moventra.xyz/portal/customers`
  - 登录邮箱：`partner@example.com`
- 机器 API：`https://moventra.xyz/api/v1`
- OpenAPI（Portal 登录后）：`https://moventra.xyz/api/browser/v1/portal/openapi.yaml`

人类网页登录使用应用自有密码 + TOTP，并按 Admin/Partner URL 隔离；机器 API
继续使用 Cloudflare Access Service Token。没有默认密码，真实密码、TOTP、
恢复码、setup token 和 Service Token Secret 均不写入仓库或本文档。

## 生产发布基线（部署与只读验收：2026-07-29）

- Worker：`va-api-dashboard`
- 当前生产版本：`d55f21f1-8851-4cfd-93cf-339884975db0`
- Git 发布提交：`f83b22859f28d47fe2532c858db0fffa45391250`
- 自定义域名：`moventra.xyz`
- 当前生产 D1 已应用 migration `0001`–`0013`
- `0013` 的 13 个账务完整性触发器已在生产 D1 只读确认存在
- 隔离 D1 已验证：13 个 migration、6 个客户、11 笔资金记录、2 笔 OTC，
  append-only Seed 连续运行两次结果不重复
- Cloudflare Access：
  - 人类 UI 使用应用自有密码 + TOTP 和角色专属会话；
  - `/dashboard` 只跳转 Admin 登录，`/portal` 只跳转 Partner 登录；
  - 浏览器业务 API 使用 `/api/browser/v1/admin/*` 与
    `/api/browser/v1/portal/*`；
  - 旧 `/api/v1/admin/*` 与 `/api/v1/portal/*` 仅保留为 legacy Access 外层保护；
  - 机器 API 仅接受 `VA API - Ethan Integration` Service Token
  - 静态资源公开，业务数据 API 仍要求角色会话或机器凭证
- IP 白名单能力已上线但总开关保持关闭；收到 Ethan 的固定生产/灾备 CIDR 后再启用，避免误锁死机器 API。

2026-07-29 已完成 Worker V1.1.1 与 D1 `0013` 的生产发布。线上只读检查确认：
根路径、Partner API Guide、Admin 登录和 Portal 登录返回 `200`；未登录访问
Admin/Portal 浏览器业务 API 返回 `401`；不带 Service Token 访问机器 API 返回
Cloudflare Access `403`。当前发布终端未持有既有 Service Token Secret，因此未执行
带机器凭证的生产 `v1-smoke.sh`，也没有为测试新建凭据或放宽 Access；凭证持有人仍须
补做该项只读回归，才能把机器 API 标记为完整生产验收。

Admin 运营闭环及 API 管理所需的 `0010_admin_operations.sql` 与
`0011_partner_api_integrations.sql`、自定义网页登录所需的
`0012_custom_auth.sql`，以及账务/API 合同加固所需的
`0013_api_accounting_hardening.sql`，必须在本次发布完成前全部应用；
`operator_note`、`settlement_reference`、运营总览、API 管理、Webhook
投递记录和新版审计列表均可按本文验收。

### 0013 发布前只读检查

旧版本 OTC 手续费曾向下截断，新版本改为按买入资产最小单位 half-up。先在生产 D1
运行以下只读查询：

```sql
SELECT id, application_id, status, buy_asset, buy_amount_minor, fee_amount_minor
FROM otc_orders
WHERE status IN ('submitted', 'processing')
  AND fee_amount_minor <> (
    CAST(buy_amount_minor / 200 AS INTEGER)
    + CASE WHEN buy_amount_minor % 200 >= 100 THEN 1 ELSE 0 END
  );

SELECT
  type,
  COALESCE(network, '') AS network,
  CASE
    WHEN type = 'usdt_deposit' AND network = 'SOLANA'
      THEN trim(external_reference)
    ELSE lower(trim(external_reference))
  END AS normalized_reference,
  COUNT(*) AS duplicate_count,
  group_concat(id) AS resource_ids
FROM fund_transactions
WHERE type IN ('fiat_deposit', 'usdt_deposit')
  AND external_reference IS NOT NULL
  AND trim(external_reference) <> ''
GROUP BY type, COALESCE(network, ''), normalized_reference
HAVING COUNT(*) > 1;
```

2026-07-29 正式发布前已再次对生产 D1 执行上述两项只读预检，结果均为空；
Cloudflare 返回 `rows_written = 0`、`changed_db = false`。

任一查询返回记录时不得自动改账。Edi 应逐笔核对原始银行/链上凭证：旧 OTC 只能在
人工确认后取消并按新费率重建；历史重复入账需保留原记录和审计，由后续反向调整流程
纠正，不能删除 Ledger。

`0013` 不增加 Worker 必需的表或列，因此推荐顺序是：通过上述预检 → 发布
Partner API `1.1.1` Worker → 立即应用 `0013` → 执行只读 smoke 与角色回归。
两步之间不应进行人工资金操作；如无法控制写入窗口，则先暂停资金写入再执行 migration
与 Worker 切换。只有 Worker 和 D1 均完成后才可把候选状态改为生产已验收。

本次生产发布已按上述顺序完成；D1 migration list 返回无待应用项。

## Demo 数据

先应用全部 D1 migration，再执行 append-only Seed：

```bash
# 本地
scripts/demo-seed.sh --local

# 远端（只补充缺失的固定 demo_* 行，不删除账本，必须双重确认）
VA_DEMO_REMOTE_ACK=demo-va-v1 \
  scripts/demo-seed.sh --remote --confirm-remote-demo-seed
```

脚本不会删除或覆盖既有账本，不会运行 migration、部署 Worker 或改写管理员已配置的
手续费。需要完全干净的验收状态时应创建新的隔离 D1，而不是清理已有账本。远端执行前
应先确认 migration `0001`–`0013` 已应用。当前验收基准：

| 客户 | Application ID | 状态 |
|---|---|---|
| `[DEMO] Ethan Client - Active` | `demo_va_active_v1` | `active` |
| `[DEMO] Ethan Client - Submitted` | `demo_va_submitted_v1` | `submitted` |
| `[DEMO] Ethan Client - KYC Link Ready` | `demo_va_kyc_link_ready_v1` | `kyc_link_ready` |
| `[DEMO] Ethan Client - KYC Approved` | `demo_va_kyc_approved_v1` | `kyc_approved` |
| `[DEMO] Ethan Client - VA Processing` | `demo_va_va_processing_v1` | `va_processing` |
| `[DEMO] API UAT Isolated` | `demo_va_uat_api_v1` | `active` |

### 主 Demo 客户预期

- VA 账户：`79632100001001` / USD / `DEMOSG01XXX`
- USD：账本 `19197.5`，待处理占用 `1500`，可用 `17697.5`
- USDT/TRON：账本 `4500`，占用 `100`，可用 `4400`
- USDT/Ethereum：账本 `5000`，占用 `200`，可用 `4800`
- USDT/Solana：账本 `4700`，占用 `0`，可用 `4700`
- USDT/BSC：账本 `5990.025`，占用 `0`，可用 `5990.025`
- 资金记录：
  - 法币转入 1 笔，四链 USDT 转入各 1 笔，均已完成并入账；
  - 法币转出 `submitted / processing / completed` 各 1 笔，手续费快照均为
    `30 USD`；
  - USDT 转出 `submitted / processing / completed` 各 1 笔，手续费快照均为
    `5 USDT`。
- OTC：
  - `USD → USDT/BSC` completed：卖出 `1000 USD`，买入总额 `995 USDT`，
    手续费 `4.975 USDT`，净买入 `990.025 USDT`；
  - `USDT/TRON → USD` completed：卖出 `500 USDT`，买入总额 `500 USD`，
    手续费 `2.5 USD`，净买入 `497.5 USD`。

### 自动只读验收

```bash
# 本地
VA_API_BASE_URL=http://localhost:8787/api/v1 scripts/v1-smoke.sh

# 远端
CF_ACCESS_CLIENT_ID=... \
CF_ACCESS_CLIENT_SECRET=... \
VA_API_BASE_URL=https://moventra.xyz/api/v1 \
  scripts/v1-smoke.sh
```

Smoke 为只读：验证 Request ID、状态覆盖、余额等式、四链、手续费/净额快照、
分页与客户/类型/状态/日期/钱包过滤。若管理员已修改默认手续费，可设置
`VA_UAT_EXPECT_DEFAULT_FEES=0`，交易级手续费快照仍会严格校验。

后端或 API 变更后，可在新建或专用的本地隔离 D1 上显式运行 append-only
幂等写入 UAT。它只操作 `demo_va_uat_api_v1`，不会清理或修改既有账本：

```bash
VA_UAT_ALLOW_WRITES=1 scripts/v1-idempotency-uat.sh --local
```

该脚本明确拒绝远端模式，因为测试会创建一笔占用余额的 submitted 转出。生产环境
只运行 `v1-smoke.sh` 只读检查；真实写入验收必须使用单独批准的 Demo 流程。

## 管理员验收

1. 访问 `/dashboard`，确认跳转到 `/dashboard/overview`；总览显示客户总数、待办、
   USD 汇总、USDT 总额与 TRON/Ethereum/Solana/BSC 分链金额、最近交易和快捷入口。
2. 进入客户管理，确认全部客户一页可见；打开 `demo_va_active_v1`，核对基本资料、
   VA 账户、USD、四链 USDT、待处理占用和最近交易。
3. 进入开户申请，确认只显示 `submitted`、`kyc_link_ready`、`kyc_approved`、
   `va_processing`、`changes_requested`，不显示已 `active` 客户。
4. 打开 `Submitted` 客户，只使用国家区号、号码、邮箱和客户名称；录入 HTTPS
   Sumsub 链接，推进 KYC 后录入完整 VA 银行资料。再修正一次基础资料或 VA 资料，
   确认状态不回退且审计可追踪；混合两种更新字段的 PATCH 应返回
   `422 validation_error`。
5. 进入“入账录入”，选择 `demo_va_active_v1`；分别创建 USD 银行入账和一笔 USDT
   入账。空银行参考号或空 Tx Hash 必须被表单及 API 以
   `422 external_reference_required` 拒绝；完成前余额不变，完成后只增加 USD
   或所选网络 USDT。
6. 进入“转出审核”，在不选择客户时应看到全部待办；再按客户、状态和类型筛选。
   将一笔转出推进到 `processing`，填写 `operator_note`；空参考号完成应返回
   `422 transaction_reference_required`，补齐银行参考号或 Tx Hash 后才能完成记账。
7. 进入“OTC 兑换记录”，确认只能查看 USD → USDT 或 USDT → USD，且 USDT 一侧
   显示网络；Admin 不显示新建或审批按钮。由 Ethan Portal/API 发起后应直接返回
   `completed`，再核对指定链余额、0.5% 手续费、统一交易历史和两条账本分录。
8. 分别进入客户余额、交易历史和账本独立路由；确认 USD 与 USDT 总额、四链明细、
   业务记录、源记录 ID 和账本分录可互相核对，且页面没有直接编辑余额或删除账本入口。
9. 在手续费设置中确认法币固定费为 `30 USD`、数字货币固定费为 `5 USDT`；修改后
   保存并刷新，新申请使用新值，已有交易保留原费用快照。
10. 进入 `API 安全`，确认 Access Service Token 必须、每分钟 120 次限流和白名单
    状态可见。无有效规则时打开总开关应返回 `409 api_ip_allowlist_empty`。
11. 添加一条 IPv4 或 IPv6 测试 CIDR，检查规范化、重复校验、启停和审计；总开关
    开启后，停用或删除最后一条有效规则应返回
    `409 api_ip_allowlist_would_lock_out`。验收后关闭总开关并删除测试规则。
12. 进入 `系统配置 → API 管理 → 接入申请`，审核 Portal 提交的 IP 新增申请；确认批准前运行时
    白名单不变，批准后规则出现且关联源申请。拒绝另一申请时必须填写原因；重复审批
    必须返回冲突。再审核一个 Webhook 配置，核对事件订阅、投递结果和失败重试入口；
    只允许对 `retry_scheduled` / `dead_letter` 投递人工重试，并确认重试动作写入审计。
13. 进入审计日志，分别按客户、`operator` / `partner` 和精确 action 过滤；验证
    分页、客户名、结构化 metadata 和源记录关联。Admin 浏览器动作的
    `metadata.actor` 应为已认证邮箱，机器 API 动作为 `partner_api`；不得显示
    Access Secret 或请求正文。
14. 通过 Portal/Partner 查询上述资金与 OTC，确认管理员内部 `operator_note` 和
    OTC `settlement_reference` 不出现在响应；客户可见的银行参考号或 Tx Hash
    仍可正常查询。
15. 直接调用 Admin POST 创建转出或 OTC，确认返回 `403 partner_only`；通过
    Portal/Partner POST 创建入账，确认返回 `403 operator_only`。
16. 对一笔未激活申请填写客户可见原因、待修改字段和内部备注后要求补正；Portal、
    Partner API 和 Webhook 不得出现内部备注或操作员身份。Partner 修改资料并使用
    `Idempotency-Key` 与最新 `application_version` 重提，确认申请 ID 不变、审核轮次
    递增、状态回到 `submitted`；重复请求不得重复递增。

## Ethan Portal 验收

1. 进入首页看板，确认客户、开户进度、法币/USDT 可用余额、待处理交易和最近交易汇总。
2. 进入客户总览，在一个页面确认客户、联系方式、状态、VA 账户和可用资金。
3. 点击 `[DEMO] Ethan Client - Active` 的“查看详情”，核对 VA 账户、余额、资金和 OTC。
4. 在发起开户栏目提交新客户，只填写国家区号、电话、邮箱和客户名称；下方列表不应显示已 `active` 客户。
5. 进入法币钱包，先看到全部客户；点击客户后检查法币余额与历史，再点击“发起转出”进入独立银行转出页。确认页面与提交确认弹窗均显示总扣账金额、`30 USD` 手续费和实际到账金额。
6. 进入数字钱包，先看到全部客户；点击客户后检查 USDT 余额与链上历史，再点击“发起转出”进入独立链上转出页。确认页面与提交确认弹窗均显示总扣账金额、`5 USDT` 手续费和实际到账金额。
7. 发起一笔卖法币或卖 USDT 的 OTC。
8. 在交易历史 Data Grid 中按客户、交易类型、状态和日期范围筛选；清算一笔法币
   入金后确认同时看到原法币转入、自动 OTC 和法币扣款三行，点击后可通过来源法币
   交易 ID 与 OTC ID 互相追溯。
9. 确认 OTC 左侧按卖出、报价、买入上下排列，右侧显示当前客户最近交易。
10. 尝试超过可用余额的申请，应收到“账本可用余额不足”。
11. 资金栏目不能申报转入；转入仅展示管理员录入的结果。
12. 进入设置页，检查真实登录账户、语言、主题、导航和内容宽度设置；使用当前密码、
    新密码与未使用的 6 位动态码完成一次改密，确认当前设备保持登录且其他会话退出。
13. 进入 `API 接入`，提交生产/灾备 IP 新增申请；确认状态为待审批且不会立即改变
    生效规则。取消一个待审批申请，确认不能再被批准。
14. 提交公网 HTTPS Webhook 地址与事件订阅；审批后发送测试事件，检查签名头、
    原始正文验签和 Portal 投递状态。关闭或修改端点仍应生成新的待审批申请。

## 登录与会话验收

1. Admin 只从 `/admin/login` 登录，Partner 只从 `/portal/login` 登录；跨角色
   密码、setup token、TOTP enrollment token、challenge 和恢复码均失败且不被消耗。
2. `GET /api/auth/me` 使用 `__Host-va_session` HttpOnly Cookie 返回角色、到期时间与
   `csrf_token`。浏览器 `GET` / `HEAD` / `OPTIONS` 只要求角色匹配会话；
   `POST` / `PUT` / `PATCH` / `DELETE` 还必须发送精确同源 `Origin` 和
   `X-CSRF-Token`。
3. 缺少会话返回 `401 authentication_required`；错误角色返回 `403 forbidden`；
   错误来源或 CSRF token 分别返回 `403 invalid_origin` /
   `403 invalid_csrf_token`。
4. 管理员签发首次激活 token 时省略 `purpose` 或使用
   `purpose=initial_setup`。已激活账户只能通过显式
   `purpose=credential_reset` 重置；重置前必须完成线下身份核验。
5. credential reset 成功后，旧会话、登录 challenge、密码、TOTP 和恢复码立即失效；
   新 token 仍只能在对应角色的 `/admin/setup` 或 `/portal/setup` 完成密码与 TOTP
   绑定。核对 `auth.credential_reset` 审计事件。
6. 自助改密只能调用当前角色的 `/api/auth/{admin|portal}/password/change`；当前密码、
   TOTP、Origin 或 CSRF 任一无效时不得更新。成功后旧密码、其他会话和未完成登录
   challenge 失效，当前会话仍可读取 `/api/auth/me`，并存在
   `auth.password_change` 成功审计记录。
7. 并发登录请求即使已用旧密码完成计算，在改密提交后也不得新建
   challenge 或会话；上线前必须先应用
   `0021_auth_challenge_credential_version.sql`。

完整请求/响应与 Cookie/CSRF 合同见 [Authentication API](./AUTH_API.md)。

## 已验证的 API 规则

- 合作方尝试创建转入：HTTP `403 operator_only`。
- Admin 尝试代 Ethan 创建转出或 OTC：HTTP `403 partner_only`。
- 合作方超可用余额申请：HTTP `409 insufficient_available_balance`。
- 相同业务请求重复使用 `Idempotency-Key`：返回原记录，不重复占用余额。
- 同一 `Idempotency-Key` 搭配不同客户、金额、网络或收款资料：HTTP
  `409 idempotency_conflict`。
- 转出金额小于或等于固定手续费：HTTP `422 withdrawal_amount_too_low`。
- Admin 创建法币或 USDT 入账缺少银行参考号 / Tx Hash：HTTP
  `422 external_reference_required`。
- Admin 完成入账时，原记录和本次处理均没有参考号：HTTP
  `422 transaction_reference_required`。
- Admin 完成法币或 USDT 转出缺少银行参考号 / Tx Hash：HTTP
  `422 transaction_reference_required`。
- 已创建转出保留提交时的手续费快照；后台改费后历史交易金额不变。
- 未认证访问网页工作区：应用跳转到对应角色登录页；浏览器 API 返回
  `401 authentication_required`。
- 管理员与合作方网页 API 使用不同的会话角色和路径；机器 API 仍由
  Cloudflare Access Service Token 保护。
- Admin/Portal 浏览器 API 的规范前缀是 `/api/browser/v1/admin/*` 与
  `/api/browser/v1/portal/*`；`/api/v1/admin/*` 与 `/api/v1/portal/*`
  仅为 legacy Access 边界，不用于新网页集成。
- 机器 API 超过每分钟 120 次时返回 HTTP `429 rate_limit_exceeded`。
- 每个 Worker API 响应包含 `X-Request-Id`；结构化日志记录同一个
  `request_id`，但不记录凭证或请求正文。
- IP 白名单关闭时不改变现有连通性；启用后仅允许命中有效 IPv4/IPv6 CIDR 的机器 API 请求。
- 白名单启用后，未命中来源返回 HTTP `403 api_ip_not_allowed`；Admin 与 Portal API 不受影响。
- 白名单配置变更写入审计日志，且 Service Token Secret 不写入 D1、日志、Portal 或仓库。
- Portal/机器 API 的白名单与 Webhook 申请在 Admin 审批前不改变生效配置；拒绝必须
  有审核原因，待审批申请可由 Ethan 取消。
- Webhook 只发送资源 ID、状态和时间；签名密钥仅存在 Worker Secret；非 `2xx`
  结果最多重试五次后进入 dead letter，业务状态不因回调失败回滚。
- 白名单总开关没有有效规则时返回 `409 api_ip_allowlist_empty`；总开关已开启时，
  停用或删除最后一条有效规则返回 `409 api_ip_allowlist_would_lock_out`。
- Admin 审计列表支持 `application_id`、`actor_type`、`action`、`page` 和 `limit`
  查询；`actor_type` 仅允许 `operator` / `partner`，`limit` 最大 200。
- `operator_note` 与 OTC `settlement_reference` 是 Admin-only 字段；Partner/Portal
  列表、客户详情与统一交易历史均不得返回。
