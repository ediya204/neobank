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

前端开发环境启用本地演示身份。访问 `/dashboard/overview` 使用管理员界面；访问
`/portal/home` 使用合作方界面。资金页面右上角可以切换提交人、复核人、操作员和管理员，
用于验证双人复核规则。

## 资金闭环

1. 发起个人或企业开户。
2. 切换到另一名复核人员审核；通过后自动创建 USD、SGD、HKD、EUR、GBP 钱包。
3. 为客户申请独立 VA，并由另一名人员开通。
4. 录入法币银行到账，选择目标系统钱包或 VA。
5. 复核入账，系统生成平衡的复式凭证。
6. 发起内部转账、法币换汇、OTC 或三种出款。
7. 另一名人员复核；出款由操作员回填外部银行流水号后完成。
8. 在复式总账和交易详情中核对余额、冻结金额、提交人、复核人和执行人。

数字钱包只提供完整页面和状态展示，链上充值、提币、转账保持禁用，等待 Cregis 第二阶段。
