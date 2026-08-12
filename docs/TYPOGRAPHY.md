# 字体规范

本项目的 Admin、Partner Portal、Customer Portal 与认证页面共用 MUI 主题字体系统。
全站正文、标题、按钮和辅助信息必须通过 MUI `Typography` variant 或
`sx={{ typography: '...' }}` 使用主题 token，不为普通界面文字单独写近似字号。

## 基础设置

- 字体：`Public Sans, sans-serif`
- 浏览器基准：`htmlFontSize: 16`
- MUI 基准：`fontSize: 14`
- 单位：使用 `rem`，保留浏览器字体缩放能力
- 字重：400（正文）、500（中等）、600（副标题）、700（标题和按钮）、800（大标题）

## 字号层级

| Variant                          |   xs |   sm |   md |   lg | 常见用途                   |
| -------------------------------- | ---: | ---: | ---: | ---: | -------------------------- |
| `h1`                             | 40px | 52px | 58px | 64px | 营销主视觉标题             |
| `h2`                             | 32px | 40px | 44px | 48px | 页面主视觉、重点金额       |
| `h3`                             | 24px | 26px | 30px | 32px | 页面标题、关键指标         |
| `h4`                             | 20px | 22px | 24px | 24px | 页面区块标题               |
| `h5`                             | 18px | 19px | 20px | 20px | 卡片标题                   |
| `h6`                             | 17px | 18px | 18px | 18px | 小节标题                   |
| `subtitle1` / `body1`            | 16px | 16px | 16px | 16px | 重要说明、默认正文         |
| `subtitle2` / `body2` / `button` | 14px | 14px | 14px | 14px | 紧凑正文、表格、表单、按钮 |
| `caption` / `overline`           | 12px | 12px | 12px | 12px | 时间、标签、辅助信息       |

## 使用规则

- 页面视觉层级使用 variant，不通过 `fontSize` 临时模拟标题。
- MUI 表单、表格、菜单、弹窗和按钮从全局主题继承字号。
- 代码块使用 `body2` 加等宽字体；时间、键盘提示和紧凑元数据使用 `caption`。
- 图标尺寸、头像内文字、图表画布、PDF 排版和营销展示字可有独立尺寸；这些不是正文 token。
- 不把字号写成固定 `px` 来覆盖用户的浏览器字体缩放设置。
