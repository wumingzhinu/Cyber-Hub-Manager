# 优化档案

本目录归档基于 **MT 管理器 2.26.11**（`bin.mt.plus`）静态分析，对 Cyber-Hub-Manager 所做的三轮功能对齐与增强记录。源码中的改动已经全部落地，这里的补丁与报告仅用于审阅、比对和回滚追溯。

| 轮次 | 报告 | 补丁 | 主要内容 |
| --- | --- | --- | --- |
| 第一轮 | `optimization-report.html` | `optimization.patch` | 外部文件打开（VIEW/EDIT/SEND Intent、`content://` 私有缓存）、编辑器语法模式接入、README 版本号校正 |
| 第二轮 | `mt-gap-round2.html` | `optimization-round2.patch` | JetBrains Mono 等宽字体、新增 15 种 CodeMirror 语法、正则/大小写查找替换与 `$1`–`$9` 反向引用 |
| 第三轮 | `mt-gap-round3.html` | `optimization-round3.patch` | 中英文语言包与切换、离线 Markdown + KaTeX 预览、`.9.png` 编辑导出、文件夹/双窗格对比、媒体信息与签名校验、三套图标 activity-alias |

## 说明

- 三轮改动均保持默认中文文案逐字不变，未触及长按菜单 10 项、打开方式 13 项等硬断言；`build.gradle` 与 versionCode 未改动（仍为 0.1.59 / 55）。
- 新增第三方资源：`JetBrains Mono`（OFL）、`KaTeX 0.16.11`（MIT）、`CodeMirror 5.65.16` modes（MIT）；许可证见仓库 `licenses/` 目录。
- 分析用的 `MT2.26.11.apk`、`archive.json`、`res.json`、`pkg.json` 等中间产物未纳入仓库（第三方应用版权与体积原因）。
- 未实施项：`LocalService` Web 管理器由「只读」改为「读写」属于安全模型变更，需配对码、CSRF token、可写根目录白名单、二次确认与活动记录配套设计，暂未改动。

## r4 修复（WebView 静态资源白名单）

真机反馈：覆盖安装后打开 `.py` 文件仍无语法高亮。根因是 `MainActivity.localAsset()` 原本只放行固定 9 个 assets 文件，前三轮新增的 30 个 CodeMirror modes、`lang/packs.js`、`vendor/katex/*`、JetBrains Mono 字体、`ninepatch.js` / `markdown-preview.js` 等全部返回 404，`CodeMirror.modes.python` 不存在，`editorModeFor()` 返回 `null`，因此 token 不着色。

- `localAsset()` 改为 `isStaticAsset()` 安全目录放行：拒绝 `..`、绝对路径、`%`、`:`、反斜杠；显式排除 `development-signing.p12` 与 `jar/dex/apk/p12/jks/keystore`；仅允许静态资源扩展名。新增 `assetMime()` 按扩展名返回正确 MIME（含 `font/woff2`）。
- `WebSettings` 增加 `LOAD_NO_CACHE`，并在升级后清一次 WebView 缓存（`assetEpoch=4`），避免旧 `app.html` 被复用。
- `DataEngine.read()` 返回 `encoding` 字段；编辑器信息栏显示「编码 · 语法模式 · 构建标记 r4」，可直接确认资源是否已更新。
- 新增当前行高亮（`cm-activeLine`），并补齐浅色 / 深色主题下 def、builtin、variable-2/3、type、property、operator、meta、tag、attribute、bracket、punctuation、error 等 token 配色。

验证：真实 Chromium 渲染各 token 颜色与当前行高亮均生效；放行规则模拟中 `app.html` 的 38 个引用全部放行、67 个 assets 文件仅 `development-signing.p12` 与 `compiler/android-api.jar` 被拒；前端冒烟 8 / 12 / 11 全 PASS，另两项失败与改动前基线一致。
