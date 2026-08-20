# 本地全栈运行

当前阶段不连接 Cloudflare 或 Render。所有服务只监听本机。

## 服务

- Web：`http://localhost:3002`
- NestJS API：`http://localhost:4000/api/v1`
- PostgreSQL 17：`localhost:5432`
- Redis：`localhost:6379`

## 首次启动

```bash
npm run local:core:bootstrap
npm run dev
```

如果需要在终端或 Codex 任务结束后继续保持本地预览，使用：

```bash
npm run dev:background
```

该命令会在启动前检查 Web 与 API，使用独立后台进程运行整套本地服务，并将日志写入
`/tmp/neobook-local-full-stack.log`。重复执行时，已就绪的服务不会再次启动。

需要重装依赖或结束预览时，先完整停止后台进程组：

```bash
npm run dev:stop
```

前端开发环境启用本地演示身份。访问 `/dashboard/overview` 使用管理员界面；访问
`/portal/home` 使用合作方界面。资金页面右上角可以切换普通用户和管理员，
用于验证单人审批与角色隔离规则。

## 资金闭环

1. 发起个人或企业开户。
2. 由管理员审批；通过后自动创建 USD、HKD 与 USDT-TRON 钱包。
3. 为客户申请 USD / HKD 独立 VA，并由管理员开通。
4. 法币转入可选择平台账户收款、VA 收款，或通过 OTC 将 USDT 卖出后入系统现金账户 / VA。
5. 管理员审批入账，系统生成平衡的复式凭证。
6. 发起 USD / HKD 换汇，或为 OTC 获取五秒成交报价；OTC 必须在倒计时内由客户
   点击确认，确认后由 PostgreSQL Core 原子完成且无需管理员审批。
7. 代付、POBO、VA 三种法币转出仍由管理员审批，并需人工回填外部银行流水号后完成。
8. 在复式总账和交易详情中核对余额、冻结金额、提交人、审批人和执行人。

数字钱包仅支持 USDT-TRON（TRC20）。本地模式可以验证收币信息、提币提交、管理员审批、
操作员回填 Tx Hash、拒绝释放冻结金额，以及钱包余额与会计镜像同步。真实链上广播仍保持
手工执行；本地页面和测试不会自动发起外部钱包转账。

## 账户资产总览 V1

Portal 的 `/portal/money/accounts` 从
`GET /api/v1/accounts/summary?customerId=<id>` 读取资产汇总：

- 只统计客户名下状态为 `ACTIVE` 的法币钱包、独立 VA 和数字钱包；
- 产品可用资产固定为法币 `USD`、`HKD`，数字资产 `USDT` 且仅支持 `TRON (TRC20)`；其他币种和网络的历史数据继续保留用于账务审计，但不进入 Portal 资产汇总，也不能用于新申请或新提币；
- 返回可用、冻结和账面余额，并按币种展示分布；
- 法币估值使用数据库中当前有效 FX 买卖价的中间值，USDT 在 V1 中按 1 USD 估算；
- 若某币种缺少有效汇率，接口返回 `valuationStatus=partial` 并明确列出该币种，不把它静默计入总资产；
- `Account` / `CryptoWallet` 余额是页面查询的物化读模型，`JournalEntry` / `JournalLine` 继续作为复式记账和审计依据，不创建第二套汇总余额表；
- 接口根据 `x-user-id` 对调用者和客户所属组织进行校验，跨租户请求返回 `403`。

运行 `npm run local:core:check` 会验证汇总字段、USDT 分布及租户隔离，而不只检查 HTTP 状态。
