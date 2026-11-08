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

## r5 修复（Shizuku 授权：补齐 API_V23 权限与 V3_SUPPORT 元数据）

真机「提权诊断」截图：`rootGranted=false`、`rootAvailable=false`、`shizukuInstalled=true`、`shizukuProviderRegistered=true`，但 `shizukuRunning=false`、`shizukuGranted=false`、`shizukuVersion=-1`、`elevatedId=null`、`npErr=IllegalStateException（Shizuku 服务未启动或 binder 未送达）`、`rootListCount=-1`。设备无 Root，Shizuku 经无线调试启动，用户反馈 MT 管理器可正常授权而本应用不行。

**根因**（对照 MT 2.26.11 的清单 + Shizuku 官方源码确认）：Shizuku 服务端 `server/src/main/java/rikka/shizuku/server/BinderSender.java` 的 `sendBinder()` 用 `PackageManager.GET_PERMISSIONS` 读取客户端 `PackageInfo.requestedPermissions`，仅当包含 `moe.shizuku.manager.permission.API_V23` 时才调用 `ShizukuService.sendBinderToUserApp()`，否则直接 `continue`——**清单里没声明这个权限，服务端根本不会把 binder 推给本应用**，`pingBinder()` 恒为 false、`getVersion()` 恒为 -1，与「服务是否在运行」「provider 是否注册」都无关。本项目由 `aapt2` 直接打包、没有 Gradle manifest merger，官方 `dev.rikka.shizuku:provider` AAR 本该自动注入的 `<uses-permission>` 与 `V3_SUPPORT` 元数据从未进入 Manifest（与 0.1.54 的 `${applicationId}` 占位符属于同一类「手搓打包丢配置」问题）。MT 2.26.11 的清单明确同时声明了 `API_V23`、`V3_SUPPORT` 与带 `INTERACT_ACROSS_USERS_FULL` 权限的 `.shizuku` provider。

- `AndroidManifest.xml`：补 `<uses-permission android:name="moe.shizuku.manager.permission.API_V23" />`；在 `<application>` 内补 `<meta-data android:name="moe.shizuku.client.V3_SUPPORT" android:value="true" />`（Shizuku Manager 据此把应用列入「应用管理」授权列表）。provider 的 authorities / exported / multiprocess / permission 属性本已正确，保持不变。
- `ElevatedAccess.java`：新增 `apiV23Declared()` / `v3SupportDeclared()` 运行时自检、`binderSeen` 标志与 `Shizuku.addBinderReceivedListenerSticky` / `addBinderDeadListener` 生命周期监听；`diag()` 与 `status()` 输出 `apiV23Declared`、`v3SupportDeclared`、`binderSeen`、`shizukuUid`；`npErr` 在未声明权限时直接指出根因，不再笼统归因为「服务未启动或时序问题」。
- `app.js`：授权页在 `apiV23Declared=false` 时提示「应用需升级」并说明真实原因；「Shizuku 未运行」提示改为正确引导（启动服务 → 应用管理里允许 → 重启服务 → 划掉应用重开）；诊断弹窗新增上述四个字段。
- `tests/shizuku-integration-check.py`：把 `API_V23` 元素、`V3_SUPPORT` 元数据、运行时自检字段与 binder 监听纳入硬断言防回归。

验证：`aapt2` 打包由 CI 完成；本地集成自检通过、Manifest XML 解析出 `API_V23` 与 `V3_SUPPORT=true`、`app.js`/`boot.js` 语法通过、`javac` 全量 134 个 class 零错误（新增 2 个 listener 内部类）、前端冒烟 8 / 12 / 11 全 PASS，`video-ui-smoke` 与 `java-edit-ui-smoke` 两项失败与改动前基线逐项一致。versionCode 仍为 55、签名密钥未变，可直接覆盖安装。

覆盖安装后需在 Shizuku 应用内**停止并重新启动服务**（服务端的 `PID_LIST`/`UID_LIST` 会记住已推送过的 UID），再从最近任务划掉本应用重新打开；诊断里 `apiV23Declared=true`、`shizukuRunning=true` 即表示通道已打通。
