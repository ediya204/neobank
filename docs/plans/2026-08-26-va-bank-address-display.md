# VA Bank Address Display Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在用户指定的四个 VA 银行资料输出中展示账户快照里的银行地址。

**Architecture:** 保持现有页面组件和数据流不变，直接读取 `MoneyAccount.bankAddress`。仅修改账户资料弹窗、VA 转入资料及复制文本、后台客户详情卡片；地址缺失时显示现有占位符。

**Tech Stack:** React、TypeScript、Jest（react-scripts）。

---

1. 添加四项展示契约的失败回归测试并确认 RED。
2. 在三个现有页面文件中增加最小展示代码并确认 GREEN。
3. 运行专项测试、类型检查、i18n、构建及 Git 检查；发布和部署单独执行。
