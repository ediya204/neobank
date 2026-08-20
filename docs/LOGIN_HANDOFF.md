# 登录与账户交接 / Login Access Handoff

> 最后核对：2026-07-29（HKT）
>
> 本文只记录入口、账户标识和操作流程。密码、TOTP 密钥、恢复码、一次性激活
> Token、Cloudflare Service Token 与 Worker Secret 不得写入 GitHub。

## 1. 登录方式

网页端使用应用自有认证，不使用 Cloudflare 账户登录。Admin / Partner 使用密码与
TOTP；通过公开开户注册的客户使用申请时设置的邮箱与密码：

Admin / Partner：

1. 输入指定账户邮箱和本人设置的密码。
2. 输入验证器生成的 6 位 TOTP 动态验证码。
3. 认证成功后，系统签发安全的 HttpOnly 会话 Cookie。

公开开户注册客户：

1. KYC / KYB 人工审核通过并自动激活后，输入申请时设置的邮箱和密码。
2. 认证成功后，系统直接签发安全的 HttpOnly 会话 Cookie。

系统没有可直接创建已认证 Admin / Partner 身份的公开注册，也没有可通用的默认
密码。客户可在 `/customer/register` 输入邮箱、密码并提交个人或企业开户申请；
公开 API 只保存待审核档案和安全哈希后的密码，不创建钱包，也不会在审核前允许
登录或启用资金功能。客户邮箱验证用于自助找回密码；KYC / KYB 结论仍由后台人工处理。

预期流程为：提交开户申请 → 人工 KYC / KYB 审核 → KYC / KYB 通过 → 自动激活账户
并创建经 Cregis 归属验证的 USDT-TRC20 钱包。公开申请客户随后可直接使用申请邮箱
和密码登录。钱包开通不代表任何转出已审批或执行。仅后台创建且尚未设置密码的旧式
客户继续使用一次性激活链接与 TOTP 流程。

## 2. 初始账户与指定入口

| 角色                   | 初始账户邮箱                 | 唯一登录入口                                                | 登录后的工作区 | 初始密码                             |
| ---------------------- | ---------------------------- | ----------------------------------------------------------- | -------------- | ------------------------------------ |
| Admin / 运营后台       | `admin@example.com`          | [Admin 登录](https://your-va-portal.example/admin/login)    | `/dashboard`   | **无默认密码**；首次激活时由本人设置 |
| Admin / 运营后台       | `security-admin@example.com` | [Admin 登录](https://your-va-portal.example/admin/login)    | `/dashboard`   | **无默认密码**；首次激活时由本人设置 |
| Partner / Ethan Portal | `partner@example.com`        | [Partner 登录](https://your-va-portal.example/portal/login) | `/portal`      | **无默认密码**；首次激活时由本人设置 |

“无默认密码”是安全设计，不是配置缺失。任何初始密码都不应由开发人员生成后写入
仓库、聊天记录或工单。

## 3. URL 隔离规则

- 未登录访问 `/dashboard`，只会跳转到 `/admin/login`。
- 未登录访问 `/portal`，只会跳转到 `/portal/login`。
- Admin 账户不能在 Partner 入口登录。
- Partner 账户不能在 Admin 入口登录。
- 旧共享入口 `/auth/login`、`/auth/setup`、`/auth/jwt/login` 已停用，只显示
  “入口无效”，不提供登录表单。
- 角色由 URL 路径在服务端确定，请求参数不能切换或覆盖角色。

## 4. 首次激活

1. 运营人员完成账户标识核对后，通过受保护的
   `POST /api/auth/setup-token` bootstrap 流程签发一次性激活链接。首次激活请求
   省略 `purpose` 或显式使用 `purpose: "initial_setup"`。
2. 链接只通过安全渠道发送给对应账户本人，有效期为 30 分钟，且只能使用一次：
   - Admin：`https://your-va-portal.example/admin/setup#setup_token=...`
   - Partner：`https://your-va-portal.example/portal/setup#setup_token=...`
3. 本人设置 14–128 位密码，必须同时包含大写字母、小写字母、数字和符号。
4. 本人使用验证器扫描 TOTP 信息，并输入当前 6 位验证码完成绑定。
5. 本人把系统生成的 10 个一次性恢复码保存到密码管理器。
6. 激活完成后，只使用第 2 节列出的角色专属登录入口。

一次性激活链接不会保存在本文档或 Git 历史中。链接过期时，由管理员重新签发，
不要尝试复用旧链接。

## 5. 日常登录

### Admin

1. 打开 `https://your-va-portal.example/admin/login`。
2. 输入 `admin@example.com` 和本人密码。
3. 输入 TOTP 验证码。
4. 进入 `/dashboard`。

### Partner

1. 打开 `https://your-va-portal.example/portal/login`。
2. 输入 `partner@example.com` 和本人密码。
3. 输入 TOTP 验证码。
4. 进入 `/portal`。

## 6. 无法登录或丢失验证器

1. 优先使用尚未使用的一次性恢复码。
2. 如果密码、TOTP 和恢复码均不可用，联系管理员执行受审计的恢复流程。
3. 管理员先通过线下方式核验账户本人身份，再调用
   `POST /api/auth/setup-token`，并显式使用 `purpose: "credential_reset"`。
4. 重置成功会立即撤销旧会话与登录 challenge，废止旧 setup token、密码、TOTP、
   恢复码和未完成的 TOTP enrollment；旧凭证将全部停止工作。
5. 新 setup token 仍绑定原角色，只能从对应的 `/admin/setup` 或 `/portal/setup`
   重新设置密码、绑定 TOTP 并生成一组新的恢复码。
6. 新激活链接仍只通过安全渠道发送，不写入 GitHub。

用户可在设置页使用当前密码和验证器动态码修改密码；成功后当前设备保持登录，其他
设备会话退出。V1 暂无自助 TOTP 重置页面，验证器丢失时仍按管理员辅助凭据重置流程
处理。

### 6.1 客户自助找回密码

1. 客户在 `/customer/login` 选择“忘记密码？”，进入
   `/customer/forgot-password` 并输入账户邮箱。
2. 页面始终显示相同的已受理结果，不透露邮箱是否存在、账户状态或邮箱验证状态。
3. 尚未验证邮箱的有效客户会先收到 30 分钟一次性邮箱验证链接；验证完成后重新申请
   找回密码。
4. 已验证邮箱的有效客户会收到 30 分钟一次性密码重置链接。启用 TOTP 的客户还需输入
   当前动态码或一个未使用的恢复代码。
5. 重置成功会撤销所有旧客户会话、废止登录 challenge 并递增凭据版本，但保留现有
   TOTP 绑定和未使用的恢复代码。系统不会自动登录。
6. 如同时失去邮箱和验证器访问权，必须联系支持团队完成线下身份/KYC 核验；不得通过
   安全问题或客服代设日常密码绕过。

完整安全和上线步骤见 [Customer password recovery runbook](./CUSTOMER_PASSWORD_RECOVERY_RUNBOOK.md)。

## 7. 网页账户与机器 API

Partner 网页账户与 Partner 机器 API 是两套独立凭证：

- 网页 Admin/Portal：邮箱 + 密码 + TOTP；浏览器业务 API 的规范前缀分别是
  `/api/browser/v1/admin/*` 与 `/api/browser/v1/portal/*`。
- 机器 API：`/api/v1/*`，使用 Cloudflare Access Service Token、IP 白名单及
  API 幂等控制。
- 旧 `/api/v1/admin/*` 与 `/api/v1/portal/*` 只保留为 legacy Access 外层边界，
  新网页集成不得继续使用。

不得用 Portal 会话代替机器 API 凭证，也不得把机器 API Secret 放进本文档。

### 7.1 浏览器会话与 CSRF

- TOTP 验证成功后由系统设置 `__Host-va_session` HttpOnly Cookie。
- `GET /api/auth/me` 使用该 Cookie 返回当前用户、会话到期时间和
  `csrf_token`。
- 浏览器业务 API 的 `GET`、`HEAD`、`OPTIONS` 只要求角色匹配的有效会话；
  其他方法还必须发送与请求源完全一致的 `Origin`，以及
  `X-CSRF-Token: <csrf_token>`。
- 缺少或错误的会话、角色、来源或 CSRF token 分别按稳定的错误
  `code` 返回；完整请求、响应和错误契约见
  [Authentication API](./AUTH_API.md)。

## 8. 安全保管清单

以下信息只能放在批准的密码管理器或 Secret 管理系统中：

- 用户密码；
- TOTP 密钥或二维码；
- 一次性恢复码；
- setup token 和完整激活链接；
- Cloudflare Service Token Secret；
- Worker Secret、Webhook 签名密钥及密码 pepper。

## 9. 相关文档

- [Authentication API contract](./AUTH_API.md)
- [Human authentication V1 runbook](./AUTH_V1_RUNBOOK.md)
- [VA BaaS V1 验收清单](./V1_ACCEPTANCE.md)
- [Partner API Guide](./PARTNER_API_GUIDE.md)

## English quick handoff

- Admin account: `admin@example.com`
- Admin sign-in: `https://your-va-portal.example/admin/login`
- Partner account: `partner@example.com`
- Partner sign-in: `https://your-va-portal.example/portal/login`
- Authentication: account password followed by a six-digit TOTP code.
- There is **no default password**. Each user creates their own password through
  a 30-minute, one-time activation link delivered through a secure channel.
- First activation uses `purpose: "initial_setup"`; an administrator-assisted,
  identity-verified recovery must explicitly use `purpose: "credential_reset"`
  and requires full password and TOTP re-enrollment.
- Passwords, TOTP secrets, recovery codes, setup tokens, and machine API
  secrets must never be committed to GitHub.
