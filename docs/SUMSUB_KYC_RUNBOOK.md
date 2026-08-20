# Sumsub 个人开户 KYC 运行手册

## 1. 业务边界

本接入只适用于 Neobank 个人开户注册。验证范围固定为：

1. `IDENTITY`：只接受 `PASSPORT` 且结果为 `GREEN`；
2. `SELFIE`：本人活体/人脸结果为 `GREEN`；
3. `PROOF_OF_RESIDENCE`：住址证明结果为 `GREEN`。

三项齐全且申请级结果为 `GREEN` 时，系统仅把验证状态改为
`ready_for_admin_review`。后台合规人员仍须完成制裁/PEP/负面信息及资料一致性
人工复核，并明确点击批准或拒绝。Sumsub 不得直接批准 KYC、激活账户、创建法币
账户或创建 Cregis 钱包。企业 KYB 不走此流程。

仓库中 VA/Partner 历史界面的 `kyc_url` 人工录入字段属于另一条旧业务路径，不能
作为个人开户 Sumsub 接入、申请人关联或审批依据。

## 2. 状态与反馈

| 内部状态                 | 含义                             | 可否后台批准             |
| ------------------------ | -------------------------------- | ------------------------ |
| `initializing`           | 尚未创建或关联 Applicant         | 否                       |
| `awaiting_applicant`     | 已创建 Applicant，等待提交       | 否                       |
| `provider_reviewing`     | Sumsub 处理中或步骤未齐          | 否                       |
| `resubmission_required`  | Sumsub `RED + RETRY`，客户可补件 | 否                       |
| `provider_rejected`      | Sumsub `RED + FINAL`             | 否；管理员可记录人工拒绝 |
| `ready_for_admin_review` | 申请级及三步骤满足本手册要求     | 是，但仍需人工清单       |
| `provider_error`         | Provider 暂时不可用              | 否                       |

`moderationComment` 可展示给客户；`clientComment` 仅后台可见。Webhook 与主动同步
都只保存截断后的必要结构化状态，不保存证件图像、原始 Webhook 正文或 SDK token。

## 3. 请求链路

```text
个人提交开户注册
  -> PostgreSQL 原子保存客户、申请、验证记录和短期 onboarding session
  -> 浏览器向 Go API 请求 10 分钟 WebSDK token
  -> Go API 以 customer_id 派生 externalUserId 并幂等创建/查找 Applicant
  -> 客户在 Sumsub WebSDK 提交护照、人脸和住址证明
  -> Sumsub Webhook 到 Cloudflare Worker，Worker 保留原始正文和签名头并增加 Edge 签名
  -> Go API 校验 Edge 签名及 Sumsub HMAC，持久化事件摘要并入同步队列
  -> 后台 worker 主动读取 applicant status 与 required steps
  -> 三项 GREEN 后进入 ready_for_admin_review
  -> 后台人工批准后才自动开户
```

关键接口：

- `POST /api/auth/customer/register`
- `POST /api/auth/customer/onboarding/login`
- `GET /api/auth/customer/onboarding/status`
- `POST /api/auth/customer/onboarding/kyc/token`
- `POST /api/webhooks/sumsub`
- `GET /api/v1/admin/customers/:id/kyc-verification`
- `POST /api/v1/admin/customers/:id/kyc/sync`

## 4. Sumsub Dashboard 配置

创建独立 Level `neobank_individual_v1`，不要复用缺少住址证明的其他项目 Level。
Level 必须要求护照、被动活体/人脸和住址证明；在 Sandbox 用测试资料核对
`requiredIdDocsStatus` 确实返回 `IDENTITY`、`SELFIE`、`PROOF_OF_RESIDENCE`。

Webhook URL：

```text
https://portal.sscdigitalbank.com/api/webhooks/sumsub
```

Webhook secret 必须与 Render 的 `SUMSUB_WEBHOOK_SECRET` 一致，并启用 Sumsub HMAC
签名。先在 Sandbox 验证 `applicantCreated`、待审、`RED + RETRY`、`RED + FINAL` 和
`GREEN`。生产 Level、token/secret 和 webhook secret 必须与 Sandbox 隔离。

## 5. Render 配置

源码默认 `SUMSUB_ENABLED=false`。所需变量：

| 变量                    | 规则                                                         |
| ----------------------- | ------------------------------------------------------------ |
| `SUMSUB_ENABLED`        | Sandbox 验收前保持 `false`                                   |
| `SUMSUB_ACTIVATION_APPROVED` | 第二道人工激活门禁，Sandbox 验收前保持 `false`           |
| `SUMSUB_BASE_URL`       | `https://api.sumsub.com`                                     |
| `SUMSUB_MODE`           | `sandbox` 或 `production`，必须与 Webhook `sandboxMode` 一致 |
| `SUMSUB_LEVEL_NAME`     | `neobank_individual_v1`                                      |
| `SUMSUB_APP_TOKEN`      | Render secret，不得写入仓库                                  |
| `SUMSUB_SECRET_KEY`     | Render secret，不得写入仓库                                  |
| `SUMSUB_WEBHOOK_SECRET` | 至少 16 字符的独立 Webhook secret                            |

任何 secret 都不得粘贴到日志、Issue、聊天记录、浏览器存储或前端环境变量。

## 6. PostgreSQL 迁移与发布门禁

生产迁移为 `migrations-postgres/0008_sumsub_individual_kyc.sql`。执行前必须：完整备份、
记录备份校验和、在隔离 PostgreSQL 恢复并核对、人工审查迁移文件并记录 SHA-256、
取得明确批准。迁移工具还要求 `POSTGRES_MIGRATION_APPROVED_SHA256` 与审查文件完全
一致。迁移、Render 部署、Cloudflare Worker 部署和启用 Sumsub 是四个独立动作。

推荐顺序：

1. 保持 `SUMSUB_ENABLED=false` 与 `SUMSUB_ACTIVATION_APPROVED=false` 部署兼容代码；
2. 依照上述门禁应用 `0008` 并做表、索引和既有客户行数核对；
3. 配置 Sandbox Level、Webhook 与 Render secrets；
4. 设置 `SUMSUB_ENABLED=true` 与 `SUMSUB_ACTIVATION_APPROVED=true` 并只用 Sandbox 测试申请；
5. 完成下面的验收证据后，再单独审批生产切换。

## 7. Sandbox 验收

- 重复注册请求只产生一份客户/申请/验证记录，不创建重复 Applicant；
- SDK token 不出现在 URL、日志、localStorage 或数据库；
- 错误 Webhook HMAC、错误 Level、错误环境和错误 externalUserId 均被拒绝或忽略；
- 重复 Webhook 不产生重复事件；漏掉 Webhook 后手动同步可恢复状态；
- 仅护照、人脸、住址证明三项和申请级结果全部 GREEN 才进入可审批；
- `RETRY` 可补件，`FINAL` 不可补件；客户看不到 `clientComment`；
- Sumsub GREEN 后客户仍不能登录，且没有账户或钱包；
- 后台人工批准后才触发现有自动开户流程；
- 旧个人申请及企业申请保持原有人工流程；
- 数据库、Render、Cloudflare 和 Sumsub 审计记录可以用 application reference、
  customer id、external user id 和 applicant id 交叉追踪，但不得记录证件内容。

本次源代码实施本身不代表迁移已执行、服务已部署、Webhook 已配置或生产已启用。
