# 机器 API 接入安全

## 当前防护层

1. **Cloudflare Access Service Token**
   - 请求必须包含 `CF-Access-Client-Id` 与 `CF-Access-Client-Secret`。
   - Secret 只交付给 Ethan 的服务端，禁止放入浏览器、Portal、仓库、截图或日志。
2. **来源 IP/CIDR 白名单**
   - Ethan 从 Portal 或机器 API 提交新增/移除申请，由 Edi 在
     `系统配置 → API 管理 → 接入申请` 批准后才生效。
   - Edi 在 `资金运营 → API 安全` 保留紧急直接维护能力。
   - Portal 浏览器使用 `/api/browser/v1/portal/*`；Admin 浏览器使用
     `/api/browser/v1/admin/*`。两者使用自定义会话，不属于机器 API 白名单。
   - 支持 IPv4、IPv6、单 IP 与 CIDR。
   - 只保护 `/api/v1/*` 下的 Partner 机器路由；明确排除
     `/api/v1/admin/*` 与 `/api/v1/portal/*` legacy 外层边界。
3. **Worker 限流**
   - Ethan 机器 API 全局每分钟 120 次。
   - 超限返回 HTTP `429`、`rate_limit_exceeded` 与 `Retry-After: 60`。
4. **请求约束**
   - JSON 正文最大 16 KB。
   - 转出和 OTC 等资金写操作必须使用唯一 `Idempotency-Key`。
   - API 请求日志记录请求 ID、方法、路径和状态；非敏感运营日志还可记录事件类型、
     资源/投递 ID、尝试次数、响应状态、费率变更和配置项名称。
   - 日志不记录 Access Secret、密码、TOTP、Cookie、CSRF token、Webhook 签名
     Secret 或完整请求正文。
5. **Webhook 回调**
   - 仅允许经审批的公网 HTTPS 地址和预定义事件。
   - 使用 Worker Secret 中的密钥对时间戳和原始 JSON 正文做 HMAC-SHA256 签名。
   - 一般状态事件只含事件、Partner 客户标识、资源 ID、状态和时间；状态为
     `kyc_link_ready` 时额外携带该申请的 Sumsub 链接，`va_account.activated` 额外
     携带该 Partner 客户的 VA 账户快照。不得携带其他 Partner 数据、运营人员信息、
     内部备注、钱包私钥或凭证；投递记录和接收端日志必须按敏感开户数据保护，
     并对账号脱敏。
   - `fund_transaction.status_changed` 仅携带客户可见的类型、方向、资产、十进制金额、
     费用、净额、网络、参考号和清算状态，不携带操作员备注或内部身份；`submitted`
     / `pending` 不能解释为已清算或已记账。
   - `fiat_deposit.cleared_and_converted` 携带已完成清算的原法币金额、净汇率版本、
     USDT/TRON 净额、OTC 记录、参考号和清算时间；只有明确订阅该事件的已审批端点
     才会收到。
   - 非 `2xx` 结果指数退避重试，最多五次后进入 dead letter；Admin 可人工重试。

## 白名单启用流程

白名单初始关闭，避免在 Ethan 尚未提供固定出口地址时中断 API。

1. Ethan 在 Portal `API 接入` 或
   `POST /api/v1/api-integration/ip-allowlist-requests`
   提交生产和灾备出口的固定公网 IP/CIDR、标签和变更原因。
   申请中的 `environment` 仅用于标记出口用途，**不是独立的访问边界**；当前所有
   已批准且启用的规则都会作用于 `moventra.xyz` 这一套生产 API。
   服务端只接受全球公网单播地址，IPv4 不得宽于 `/8`、IPv6 不得宽于 `/32`，
   并拒绝私网、保留、文档示例和其他 IANA 特殊用途网段。
2. Edi 在 `API 管理 → 接入申请` 核对后批准；批准前规则不进入运行时白名单。
3. 先保持总开关关闭，从各出口完成一次带 Service Token 的连通性测试。
4. 确认至少一条规则为“启用”后，打开 IP 白名单总开关。
5. 从允许地址测试应返回正常业务响应；从其他地址测试应返回 HTTP `403`，稳定的
   程序判断依据是 `error.code=api_ip_not_allowed`：

```json
{
  "error": {
    "code": "api_ip_not_allowed",
    "message": "当前请求 IP 不在 Partner API 白名单中"
  }
}
```

`message` 是可本地化的人类提示，可能随语言或文案调整；客户端不得依赖其精确文本。

启用状态下若没有任何有效规则，系统按 fail-closed 拒绝机器 API。后台会阻止
“零有效规则”状态下直接打开总开关。

## Access 域名覆盖

生产 Worker 同时绑定 `moventra.xyz` 与 `www.moventra.xyz`。两个主机都必须分别
配置以下两类 Cloudflare Access self-hosted 应用，并使用同一个 Partner Service
Token 的 `Service Auth`（API decision 为 `non_identity`）策略：

- 精确根路径：`<host>/api/v1`
- 通配子路径：`<host>/api/v1/*`

不能只保护 apex；Access 应用按主机名匹配，`moventra.xyz/api/v1/*` 不会自动覆盖
`www.moventra.xyz/api/v1/*`。新增 Worker 自定义域或 API 主机时，必须先建立等价
Access 应用再开放流量。

每次 Access 或域名变更后，至少执行以下匿名验收，且不得读取或保存业务响应体：

- 两个主机的 `/api/v1`、`/api/v1/health` 与只读业务列表均返回 Access `403`；
- `www.moventra.xyz/` 仍返回正常静态站点；
- 使用当前有效 Service Token 从已批准出口执行认证业务验收，验证响应结构、
  Partner 范围和状态语义，不能只看 HTTP 状态。

## 凭证轮换

- Service Token 至少每年轮换一次，或在人员变动、泄漏怀疑、供应商环境变更后立即轮换。
- 轮换时先创建新令牌并并行验证，再撤销旧令牌，避免停机。
- Token Secret 只能在创建时查看；不要把 Secret 保存到 D1 或应用配置。
- Ethan 应把 Client ID/Secret 放在其服务端 Secret Manager 或受控环境变量中。

## 故障与应急

- **Ethan 全部请求 403，错误为 `api_ip_not_allowed`**：核对其当前出口 IP 与后台
  CIDR；必要时由 Edi 暂时关闭应用层白名单，再修正规则。
- **Cloudflare 返回 Access 登录页或 Access 403**：检查 Service Token 是否过期、
  已撤销或请求头是否缺失。
- **返回 429**：客户端遵循 `Retry-After`，使用指数退避，不要立即高频重试。
- **怀疑凭证泄漏**：先撤销 Cloudflare Service Token，再创建新 Token；检查 Worker
  日志中的请求 ID、路径和状态，并复核白名单变更审计。

## 下一层加固

当 Ethan 的固定出口 CIDR 稳定后，可把同一批 CIDR 同步到 Cloudflare Access
Partner API 策略的 `Require IP ranges`，让错误来源在到达 Worker 前即被拦截。
应用层白名单仍可保留，作为可审计的第二层控制。

## Webhook 接入与事件响应

1. Ethan 在 Portal 或通过机器 API
   `POST /api/v1/api-integration/webhook-requests`
   提交公网 HTTPS 地址和所需事件；地址中的用户名/密码、fragment、非 443 端口、
   本机/内网/保留地址会被拒绝。
2. Edi 审批后端点才生效；停用请求同样需要审批。
   审批时必须核对域名归属与当前 DNS 解析，不批准临时、动态或无法确认归属的域名。
   Admin 分别使用
   `POST /api/browser/v1/admin/api-integration/requests/:id/approve` 与
   `POST /api/browser/v1/admin/api-integration/requests/:id/reject`
   审批；已认证管理员邮箱保存在 `reviewed_by` 和审计 `metadata`。
3. Webhook 签名密钥由后台生成并加密保存。Admin 只能审批和查看 Key ID/状态；
   Partner 通过 TOTP 一次性领取，配置接收端后显式启用。现有 Worker Secret 在首个
   托管密钥启用前作为兼容回退，不在页面、D1 或日志中暴露。
4. Ethan 必须对原始请求体进行验签、检查五分钟时间窗，并按
   `X-VA-Webhook-Id` 去重。
5. Webhook 只表示“状态可能发生变化”；资金或客户可见动作前必须读取 API 确认。
6. 非 `2xx` 投递按指数退避自动重试，最多五次后进入 `dead_letter`。Admin 可对
   `retry_scheduled` 或 `dead_letter` 记录调用
   `POST /api/browser/v1/admin/api-integration/deliveries/:id/retry`，人工重试同样
   写入审计。
7. Admin 可调用 `POST /api/browser/v1/admin/api-integration/webhook-replays` 通用补发
   业务事件：从历史投递复制，或按事件类型和 Partner 范围资源 ID 重建当前客户可见
   快照。补发原因必填；服务端使用当前生效端点、当前签名密钥和新的事件 ID，并拒绝
   未订阅事件、跨 Partner 资源、内部处理字段及与当前资源状态不一致的事件。

当前 V1.1 已拒绝 IP literal、内网/保留名称、凭证 URL、非 443 端口及 HTTP
redirect，但 Worker 仅凭主机名无法永久约束第三方 DNS 后续解析变化。当前单一合作方
以人工域名审批和投递前配置复核作为控制；若未来开放多租户，应把 Webhook 迁移到
受控 egress proxy 或租户级回调域名 allowlist，在每次连接前执行 DNS/IP 策略。

网页登录、会话 Cookie、`Origin` 和 `X-CSRF-Token` 的边界见
[Authentication API](./AUTH_API.md)。`/api/v1/admin/*` 与
`/api/v1/portal/*` 仅为迁移期间保留的 legacy Cloudflare Access 外层边界；
当前 Admin/Portal 浏览器请求统一使用 `/api/browser/v1/*`。
