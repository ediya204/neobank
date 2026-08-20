# 图标规范

本项目的 Admin、Partner Portal、Customer Portal 与认证页面共用 Minimal/MUI 设计系统，
图标遵循以下规则。

## 图标来源

- 界面、导航、动作与状态图标统一使用 `solar:*`。
- 法币使用 `circle-flags:*` 国旗；USD、HKD 等币种必须显示对应国家或地区。
- 数字资产与区块链品牌使用 `cryptocurrency-color:*`，不得用普通钱包图标代替品牌。
- USDT 按网络展示时，使用 USDT 主图标加对应网络角标。
- 文件、语言、Lightbox 等第三方或专用组件可保留其专用图标集。

全局别名与标准尺寸位于 `src/theme/iconography.ts`；资产、网络映射位于
`src/utils/asset-icons.ts`；业务页面通过 `src/components/asset-icon` 展示币种图标。
功能卡片、指标和空状态的图标容器统一使用 `src/components/ui-icon-badge`，该组件基于
MUI `Avatar variant="rounded"` 与主题语义色，不在业务页面重复手写背景、圆角和尺寸。

## 语义与样式

- 动作图标表达动作：转入、转出、复制、刷新、搜索等不能被币种图标取代。
- 资产图标表达资产：余额、账户、报价和网络构成使用国旗或品牌图标。
- 默认使用主题文本色；仅状态图标使用对应 `success`、`warning`、`error`、`info` 颜色。
- 彩色国旗和品牌图标保留原色，不叠加主题色。
- 图标容器优先使用主题 `background.neutral` 或语义色的 `lighter` token；圆形用于资产，
  圆角矩形用于功能入口。
- Button、IconButton 与 InputAdornment 内的图标沿用 MUI 组件自身的间距、交互态与
  无障碍语义，不额外套自定义图标容器。

## 尺寸

| 场景              | 尺寸 |
| ----------------- | ---: |
| 行内辅助          | 16px |
| 小按钮            | 16px |
| 普通按钮          | 18px |
| 默认独立图标      | 20px |
| 导航              | 24px |
| 功能入口/资产列表 | 28px |
| 重点资产          | 32px |
| 空状态            | 40px |

使用 `ICON_SIZES`，不要为相同层级新增近似尺寸。MUI Button 内的图标由主题按按钮大小统一。

## 无障碍

- 图标旁已有文字或位于带 `aria-label` 的按钮内时，图标是装饰性的并应隐藏于读屏器。
- 独立承载含义的图标必须提供 `aria-label`。
- 图标不得代替文本状态；关键状态始终同时显示文字或可访问名称。

## 唯一操作映射

同一个操作在所有页面使用同一个图标，不因入口、角色或卡片样式改变：

| 操作                    | 标准图标                                   |
| ----------------------- | ------------------------------------------ |
| 银行/VA 账户            | `solar:buildings-2-bold-duotone`           |
| 资金通道                | `solar:card-transfer-bold-duotone`         |
| 资金转入（法币与 USDT） | `solar:download-minimalistic-bold-duotone` |
| 资金转出（法币与 USDT） | `solar:upload-minimalistic-bold-duotone`   |
| 内部划转                | `solar:transfer-horizontal-bold-duotone`   |
| 换汇                    | `solar:refresh-square-bold-duotone`        |
| OTC                     | `solar:hand-money-bold-duotone`            |
| 新增                    | `solar:add-circle-linear`                  |
| 编辑                    | `solar:pen-bold`                           |
| 复制                    | `solar:copy-linear`                        |
| 刷新                    | `solar:refresh-linear`                     |
| 历史记录                | `solar:history-bold-duotone`               |

`src/theme/iconography.ts` 是唯一语义目录。修改或新增图标后必须运行
`npm run icons:check`；该检查会拒绝历史变体和产品页面中的非标准图标集。
