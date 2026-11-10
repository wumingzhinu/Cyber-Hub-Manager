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

真机复测时收到的一张「提权诊断」截图与 r4 阶段的截图 SHA256 完全相同，且缺少 r5 新增的 `apiV23Declared` / `v3SupportDeclared` / `binderSeen` / `shizukuUid` 四个字段、`npErr` 仍为 r4 旧文案——据此判定该截图来自未升级到 build-56 的旧包，并非 r5 修复失效。核对清单见 `reports/r5-verify-checklist.html`。

## r6 优化（启动直达：去掉整页启动提示，首屏即文件管理器）

真机启动截图反馈：每次冷启动都先出现一张整页提示「正在打开您的工作区… / 文件管理器正在加载。」并带「重试」按钮，需等待甚至手动点击才能进入管理器。用户要求「直接进入管理器」。

**根因**：`app.html` 在 `<section id="content">` 里写死一整页 `.bootStatus` 启动提示（含静态 `#bootRetry`），工具栏副标题是「正在启动…」；`app.js` 的 `init()` 要先 `await rpc('init')` 拿到原生数据、`await refresh()` 拉到目录后才会 `renderFiles()` 把提示页替换成双窗格管理器。于是 WebView 首帧必然是提示页，冷启动 / 授权弹窗等待越久，提示页停留越久；`boot.js` 还有 20 秒 watchdog 会把它变成错误兜底页。

- `app.html`：删除 `.bootStatus` 整页提示与 `#bootRetry`，首屏直接给出 `.filepanes` 双窗格骨架（左右各一个 `.pane` + `.bootPlaceholder`「正在读取文件…」），工具栏副标题改为「文件管理器」，保留 `<noscript>` 兜底。
- `app.js`：新增 `renderBootFrame()`，并让 `init()` 在**第一个 `await` 之前**同步调用它补齐工具栏按钮与底栏（`header()` + `renderFileBottom()`），使第一帧就是可见、可操作的管理器；`rpc('init')` 与目录列表随后异步回填，`refresh()` 后占位文案自然消失。`UI_BUILD` 更新为 `r6`，关于页追加版本说明。
- `boot.js`：移除静态 `#bootRetry` 绑定，但完整保留 20 秒 watchdog 与 `report()`——脚本真正崩溃 / 加载超时时仍会整页重建出带「重试」（`window.location.reload()`）的错误兜底页。
- `style.css`：追加 `.bootPlaceholder` 轻量占位样式（浅 / 深主题）。
- `tests/startup-direct-check.py`：新增防回归硬断言，固定「首屏双窗格 / 无提示页与静态重试按钮 / `renderBootFrame()` 在 await 前调用 / 错误兜底保留 / 占位文案」等 12 项约束，并加入 CI 前端测试步骤。

验证：`startup-direct-check.py` PASS 12 项；`node --check app.js` / `boot.js` 通过；CI 三套前端冒烟 8 / 12 / 11 全 PASS；真实 Chromium 场景 A（正常启动）在 `sync-after-appjs` 瞬间即 `panes:2`、`filepanes:1`、`bootStatus:0`、`bootRetry:0`、`toolbarBtns:2`、`bottomBtns:5`，`after-data` 为 `fileRows:6`、标题 `/sdcard/`、占位清零；场景 B（纯静态首屏）确认旧提示文案与 `.bootStatus` 均已消失。全套 `.cjs` 测试改动前后逐项一致（10 项 PASS / 10 项 FAIL 均为沙箱环境限制，与基线相同），无回归。versionCode 仍为 55、签名密钥未变、默认中文文案未改，可直接覆盖安装。

## r7 修复（DEX 转 JAR：去掉 JDK zipfs 依赖）

真机反馈：对 DEX 执行「DEX 转 JAR」时无法完成，错误为 `cant find zipfs support`。

**根因**（反编译 `app/libs/dex-translator-v2.4.jar` 确认）：`DexEngine.toJar()` 调用 `Dex2jar.from(input).skipDebug(false).to(part.toPath())`，其中 `part` 是一个**尚不存在的 `.jar` 文件路径**。dex2jar 2.4 的 `to(Path)` 在目标不是「已存在目录」时会走 `createZip()`，用 `FileSystemProvider.installedProviders()` 遍历 provider 找 `scheme=jar` 的 zipfs；遍历不到就抛 `IOException("cant find zipfs support")`（常量池 `#63`）。Android 只有 `file` / `jrt` provider，没有 JDK 的 `jdk.zipfs` 模块，因此这一步必然失败，与 DEX 内容无关。

关键发现（字节码）：`to(Path)` 开头判断 `Files.exists(path) && Files.isDirectory(path)`，命中则**直接 `doTranslate(path)`**，完全不调用 `createZip()`；`Dex2jar$1$1.visitEnd()` 只用 `Path.resolve` / `Files.createDirectories` / `Files.write` 把 `.class` 写进目录（Android API 26+ 均支持）。

- `DexEngine.toJar()`：先创建 `part` 目录（`mkdirs()`），把目录 Path 传给 `to()` 走目录分支；新增 `addJarTree()` 递归目录，按相对路径把 `.class` 写入 `ZipOutputStream`。保持原有的 `names` 去重、跳过 `META-INF/MANIFEST.MF`、统一写一个 MANIFEST、多 DEX 合并与 `classes` 计数。
- `tests/dex-to-jar-no-zipfs-check.py`：新增 11 项防回归硬断言（禁止再把 `.jar` 文件路径交给 `Dex2jar.to()`、目录必须 `mkdirs()`、必须经 `addJarTree` 打包、保留根因注释），并加入 CI 前端测试步骤。
- `app.js` 关于页追加 r7 版本说明。

验证：
- 全量 `javac`（`assets/compiler/android-api.jar` + 59 个 libs + 生成的 R stub）编译 **134 个 class 零错误**。
- 真实 DEX 端到端：用 build-57 的 `classes.dex`（7,651,032 字节）调用 `DexEngine.open()` + `toJar()`，生成 **5,388 个 `.class`** 的 JAR，`javap` 可正常读取生成的类、ZIP 完整。
- 多 DEX 合并：用 APK 内 `classes.dex` / `classes2.dex` / `classes3.dex` 三个 DEX，产出 **19,370 个 `.class`**、`inputs=3`，并正确生成 `_dex` 目录。
- **对照实验**：`java --limit-modules java.base`（providers 仅 `file jrt`，等同 Android）下，旧路径 `to(文件.jar)` 精确复现 `cant find zipfs support`，新路径 `to(已存在目录)` 返回 `OK`。
- 前端冒烟 8 / 12 / 11 与 `dex-tools-smoke` 11 全 PASS，r6 启动直达自检 12 项仍 PASS。

versionCode 仍为 55、签名密钥未变、默认中文文案未改，可直接覆盖安装。DEX 转 Smali、DEX 编辑、JADX 反编译等其它 DEX 功能不受影响。

## r8 修复（无法打开 JAR 文件：误走 8 MB 文本读取上限）

真机反馈：点击生成的 JAR 文件无法打开，界面报错「文件过大，无法执行此操作（上限 8 MB）」。

**根因**：`app.js` 的 `archiveExtensions` 不含 `jar`，`fileType('x.jar')` 返回 `'file'`，`openFile()` 兜底调用 `openText()` → `rpc('read')` → `DataEngine.read()` → `FileOps.read(f, FileOps.MAX_TEXT = 8MB)`。同一根因按文件大小有两种表现：JAR 小于 8 MB 时 `read()` 在前 2048 字节检测到二进制字节，报「二进制文件：无法作为文本打开」；大于 8 MB 时 `FileOps.read()` 直接抛出用户所见的上限报错。后端 `ArchiveTools.format()` 对未知扩展名默认返回 `"zip"`，`listEntries()` 用 zip4j 列条目、`readEntry()` 提取，链路本就可用，缺的只是前端分类。

- `app.js`：`archiveExtensions` 增加 `jar` / `war` / `ear` / `aar` / `jmod`（均为标准 ZIP 容器），点击即命中 `openFile()` 的 `type==='archive'` 分支，双窗格逐层浏览 `.class` 与 `META-INF`；`apk` / `apks` / `xapk` 的专属分类保持不变。
- `app.js`：`openText()` 增加「文件过大」兜底 —— 即便用户在「打开方式」中显式选择「编辑文本」，也会提示并回退到打开方式对话框（十六进制查看器 / 浏览压缩包），不再卡在纯错误页；原有「二进制文件」引导保持不变。
- `app.js`：`UI_BUILD` 更新为 `r8`，关于页追加 r8 版本说明。
- `tests/jar-open-archive-check.py`：新增 60 项防回归自检（JAR 系归类 / 既有归档扩展名未丢 / 归档分支排在文本兜底之前 / 大文件兜底 / 13 项打开方式网格结构 / 后端 ZIP 分支 / 8 MB 边界不动），并用 node 真实执行 `fileType()` 校验 14 个分类用例。
- `tests/jar-open-dispatch-smoke.cjs`：在 happy-dom 中加载真实 `app.js`，验证点击 JAR 走 `rpc('list', {archive})` 而不再走 `rpc('read')`、普通 `.txt` 仍走文本编辑器、APK 仍走 `rpc('apkInfo')`、超大文件显式编辑文本会回退到打开方式对话框。两项新测试均已接入 CI 前端测试步骤。

**未改动**：`FileOps.MAX_TEXT` 仍为 8 MB（文本编辑器保护本身不变，只是不再让归档走这条路）、`DataEngine` / `ArchiveTools` / `DexEngine` 全部未改；versionCode 55、签名密钥、默认中文文案均保持不变。

验证：
- 后端端到端：用 r7 实测产出的 **23,597,013 字节真实 JAR**（19,371 条目 / 19,370 个 `.class`）调用 `ArchiveTools.listEntries()` 正常列出 14 个根条目、可进入 `META-INF/` 子目录，`readEntry()` 提取 `android/aapt/pb/internal/ResourcesInternal$1.class` 得到 203 字节、魔数 `CA FE BA BE`。
- 前端分发：`jar-open-dispatch-smoke.cjs` 4 项全 PASS；`jar-open-archive-check.py` 60 项全 PASS；`startup-direct-check.py` 12 项 / `dex-to-jar-no-zipfs-check.py` 11 项仍 PASS；`node --check app.js` / `boot.js` 通过。
- CI 三套前端冒烟 `file-icons-smoke` 8 / `open-with-ui-smoke` 12 / `media-player-ui-smoke` 11 全 PASS；全套 `.cjs` 改动前后逐项一致（原有 20 项结果不变，仅新增 1 项 PASS；10 项 FAIL 均为沙箱环境限制，与基线相同），无回归。

## r9 修复（.class 文件无法打开：新增内置类信息查看器）

真机反馈：进入 JAR / 归档后点击 `.class` 文件无法打开，界面报错「二进制文件：无法作为文本打开，请在「打开方式」中选择十六进制查看器或其他应用」；在「打开方式」里选「编辑文本」时被包成「无法完成」对话框。这正是 r8 章节末尾标注「本轮未加入独立 `.class` 反编译」所留下的缺口。

**根因**：`app.js` 的 `fileType()` 不给 `.class` 任何分类，返回 `'file'`，`openFile()` 兜底调用 `openText()` → `rpc('read')` → `DataEngine.read()` → `FileOps.read(f, MAX_TEXT)` 在前 2048 字节扫到魔数 `CAFEBABE` 之后的 `0x00` → 抛「二进制文件…」。而 `openWithBuiltinItems()` 的「编辑文本」调用 `openText(fileArgs(f))` 未传 `f`，使 `openText()` 的二进制兜底失效，异常被 `act()` 包成「无法完成」——归档内的 `.class` 完全看不到内容。

- 新增 `app/src/main/assets/vendor/classview.js`（UMD，Node + WebView 双用）：纯 JS 按 JVMS 规范解析 class 字节码 —— 魔数 / minor+major 版本→编译目标 JDK / 常量池（含 Modified UTF-8 与代理对）/ 访问标志 / `this_class` / `super_class` / 接口 / 字段 / 方法（含 `Code` 属性字节长度）/ `SourceFile` 与类属性 / 全部 UTF-8 字符串；提供描述符可读化（`[[Lfoo/Bar;`→`foo.Bar[][]`、`(I[Ljava/lang/String;)Z`→`(int, java.lang.String[]) → boolean`）。只解析结构，不执行、不反编译。
- `app.js`：`fileType()` 新增 `ext==='class' → 'class'`；`openFile()` 新增 `type==='class' → classScreen(f)` 直达分支（排在文本兜底之前）；新增 `classScreen(f)` 用现成的 `rpc('fileData', fileArgs(f))`（base64、16 MB 上限、经 `resolve()` 天然支持归档内条目）读取字节，按 **概览 / 字段 / 方法 / 常量池字符串** 四标签渲染，支持搜索、一键切到十六进制查看或打开方式；无效 class 也给出可操作出口，不再死在错误页。
- `app.js`：「打开方式 → 编辑文本」对 `.class` 改道查看器（`fileType(f)==='class'?classScreen(f):openText(fileArgs(f))`），13 项内置网格的标签数组与 `blob.bin` 显式编辑报错行为均不变。
- `app.js`：`UI_BUILD` 更新为 `r9`，关于页追加 r9 版本说明；`app.html` 在 `app.js` 前加载 `classview.js`；`style.css` 追加查看器样式（复用 `tabs`/`listrow`/`kvRow`/`searchline`/`primary`）。
- `tests/class-view-check.py`：12 项防回归自检（分类 / 直达分支顺序 / 四标签 / 编辑文本改道 / 13 项网格 / Java 层零改动 / 8 MB 上限不动），并用 node 真实执行 `classview.js` 校验最小合法 class、描述符可读化、损坏文件优雅失败与真实 `.class` 端到端解析。
- `tests/class-open-dispatch-smoke.cjs`：happy-dom 加载真实 `app.js` + `classview.js`，验证 `.class` 走 `rpc('fileData')` 而非 `rpc('read')`、渲染出含 `CAFEBABE`/类名/父类/JDK 版本的查看器与四标签、标签切换、十六进制与打开方式出口，且 `notes.txt` 仍走文本编辑器、`blob.bin` 显式编辑仍报「二进制文件」。新测试均接入 CI。
- `tests/jar-open-archive-check.py`：`UI_BUILD='r8'` 死断言改为「不低于 r8」的正则、`Foo.class` 分类期望从 `'file'` 更新为 `'class'`，避免版本递增时每轮都要改断言。

**未改动**：Java 层零改动 —— 未新增 action，复用现有 `fileData` / `hexView` / `resolve()`；`FileOps.MAX_TEXT` 仍为 8 MB、`DataEngine` / `ArchiveTools` / `DexEngine` / `ExtraTools` 全部未改；versionCode 55、签名密钥、默认中文文案、r4–r8 全部修复保持不变。

验证：
- 解析器权威性：用 `javap -verbose` 对照 r7 产出的真实 `.class`，`major version: 52`、`ACC_PUBLIC/ACC_SUPER`、父类 `org.antlr.runtime.Parser`、`Smali$1 implements Callable`、`ACCESS_SPEC` 字段全部吻合；末尾 `InnerClasses` 类属性被正确读到，证明常量池 / 字段 / 方法 / 属性区偏移解析无误。194,145 字节的 `smaliParser.class`（4,927 个常量池条目 / 840 字段 / 131 方法）亦正常解析。
- `class-view-check.py` 12 项 / `class-open-dispatch-smoke.cjs` 6 项全 PASS；`startup-direct-check.py` 12 / `dex-to-jar-no-zipfs-check.py` 11 / `jar-open-archive-check.py` 60 项仍 PASS；`node --check` 三个脚本通过。
- 全套 `.cjs` 改动前后逐项对照，无回归。

## r10 修复（.class 打开方式对标 MT 管理器：字节码反汇编编辑器）

**现象**：用户对比两张截图——图一 MT 管理器打开 `Hex.class` 是深色代码区 / 行号 / 语法高亮 / 7 键工具栏（菜单 / 图钉 / 撤销 / 重做 / 保存 / 编辑 / 更多）/ 底部符号栏，正文为 `package`、类版本头、`Method ...`、`stack N locals N`、逐条指令与 `L2f:` 跳转标签；图二 r9 版本是「类信息查看器」四标签表格（概览 / 字段 / 方法 / 字符串）。要求把 `.class` 默认打开改成图一同款。

**根因**：r9 只做了 class 结构解析并按字段表格渲染，没有反汇编 `Code` 属性里的字节码指令，也没有复用现成的文本编辑器框架。

- `assets/vendor/classview.js`：`parse()` 额外保留常量池与 `Code` 属性字节（max_stack / max_locals / code[]），新增 `disassemble()` / `disassembleBase64()`——205 个 JVM opcode 表，含 `tableswitch` / `lookupswitch` / `wide` / `iinc` / `multianewarray`，生成 MT 风格文本（类头、字段、方法头、十六进制跳转标签、Method / Field / Class / String 引用注释）；r9 的 `parseBase64()` 等 API 全部保留。
- `assets/app.js`：`classScreen()` 改为把反汇编文本送进 `renderEditor()`（`kind:'class'`，`UI_BUILD='r10'`），复用行号 / 搜索 / 查找替换 / 跳转 / 缩放 / 符号栏；新增 `CodeMirror.defineMode('jvmasm')`；`saveEditor()` 对 class 改走 `exportClassDisasm()` 导出 `.bytecode.txt`，`canLeave()` 不拦截派生视图；`editorMenu()` 增加导出 / 类信息 / 十六进制 / 打开方式四项；原查看器改名 `classInfoScreen()` 保留为菜单二级入口；`reloadEditor()` / `goBack()` 同步适配并清理 `classEditor` 配色类。
- `assets/style.css`：新增 `.classEditor` MT 同款深色配色（红关键字 / 蓝跳转标签 / 绿常量池引用 / 白指令 / 棕黄数字）。
- 测试：`tests/class-disasm-check.py`（静态约束 + Node 真实反汇编）、`tests/class-open-dispatch-smoke.cjs`（happy-dom 8 项：7 键工具栏 / 状态栏 / 符号栏 / 五类语法高亮 / 菜单四入口 / r9 查看器回归）、`tests/fixtures/Sample.class`（真实 javac 产物，含 lookupswitch / 循环跳转 / 异常），均接入 CI。

**未改动**：Java 层零改动，`AndroidManifest.xml` 与 `classes*.dex` 字节级一致，`versionCode` 55 与签名密钥未变；保存键只导出文本，绝不覆写 `.class` 原始字节；无效 class 仍回退到类信息 / 十六进制 / 打开方式出口。

验证：本地全套 16 项自检全 PASS（5 个 Python + 5 个 happy-dom 冒烟 + 3 个 `node --check`）；Actions 构建 #61 的 12 步全 success；交付 APK 21,382,484 字节、SHA-256 `f6eb750c1cb46abf2657bb28cf54885c710111fb6346cb3bc17c54253ed50ef9`，461 → 461 条目，仅 3 个 assets + 3 个 META-INF 签名清单变化，v1 内嵌证书与 r9 完全一致、v2 / v3 签名块齐全，可直接覆盖安装。

## r11 修复（JAR 内 .class 视图对标 MT 管理器：缓存根治）

**现象**：r10 已把 `.class` 默认打开改为 MT 同款字节码反汇编编辑器，但用户反馈从 JAR / 归档内点开的 `.class` 仍显示 r9 的四标签「类信息查看器」表格（图一），要求改成图二深色代码视图。本地散装 `.class` 看着正常、归档内条目稳定复现。

**根因**：`versionCode` 恒为 55 且签名证书相同，用户是覆盖安装，WebView HTTP 缓存里仍是 r9 版 `vendor/classview.js`——该版本只有 `parseBase64()`、没有 `disassembleBase64()`。r10 `classScreen()` 留有 `if(!dis||!dis.valid) return classInfoScreen(f);` 回退，于是 `dis=null` 时自动退回表格；旧 `parseBase64()` 又能正常渲染四标签，现象稳定、无报错、看起来像「没改」。归档内条目走 `fileData` 且总是重建视图，因此最易复现。

- `assets/app.js`：`UI_BUILD='r11'`；`classScreen()` 删除表格回退，归档内 `.class` 恒进深色代码编辑器；新增 `ensureClassView()`（带 `?v=r11` 重载组件自愈）、`classDisasmOf()`、`builtinClassDisasm()`（app.js 自包含 JVM 字节码反汇编器，205 opcode、跳转标签、引用注释，不依赖外部组件）、`classStructText()` / `classBytesText()`（留在代码编辑器内的最终兜底）；`classInfoScreen()` 降级为菜单二级入口；关于页追加 r11 说明。
- `assets/app.html`：`classview.js` / `app.js` 加 `?v=r11`；`MainActivity.java`：`assetEpoch` 4 → 5，覆盖安装后强制 `web.clearCache(true)`，配合既有 `LOAD_NO_CACHE` + `no-store`（本轮唯一 Java 改动）。
- 测试：`tests/class-archive-dispatch-check.py`（24 项静态自检：`fileArgs` 归档分支、分发优先级、无表格回退、内置反汇编、脚本 query、`assetEpoch=5`、Java 归档读取链路）、`tests/class-archive-view-smoke.cjs`（5 项 happy-dom：模拟 JAR 内 `demo/Sample.class`，特意剔除 `disassembleBase64` 模拟 r9 旧缓存，三条路径均断言渲染 `.classEditor` 且无 `.cvTabs`）；`class-disasm-check.py` / `class-view-check.py` 更新到 r11 契约；两项新测试接入 CI。

**未改动**：`vendor/classview.js` 与 `style.css` 未改；`AndroidManifest.xml` 字节级一致，versionCode 55 / 签名密钥未变；`DataEngine.fileData` / `ArchiveTools.readEntry()` 归档读取链路复用未改；保存键仍只导出 `.bytecode.txt`，绝不覆写 `.class` 原始字节。

验证：本地 6 个 Python 自检 + 6 个 happy-dom 冒烟 + 3 个 `node --check` 全 PASS（`FAIL_FLAG=0`）；Actions 构建 #62 的 12 步全 success；交付 APK 21,382,484 字节、SHA-256 `147b614712c6c46ab6e36da23f1bebcd4f1a48002805836d4f5ccde4b9b32a6b`，461 → 461 条目、仅 6 项变化（app.js / app.html / classes.dex + 3 个 META-INF 签名清单），并从 APK 内直接读出 `UI_BUILD='r11'` / `builtinClassDisasm` / `?v=r11` / DEX 内 `assetEpoch` 全部 PASS；v1 内嵌证书与 r10 完全一致、v2 / v3 签名块齐全，可直接覆盖安装。

## r12 修复（.class 反汇编文本对齐 MT 管理器语法）

**现象**：用户对比同一个 `org/apache/commons/net/bsd/package-info.class`（commons-net 3.10.0）。MT 管理器输出：

```
package org/apache/commons/net/bsd;

synthetic interface package-info version 52:0
{
  SourceFile               "package-info.java";
} // end Class org/apache/commons/net/bsd/package-info
```

r11 输出：

```
package org.apache.commons.net.bsd;
interface abstract class synthetic version 52.0
```

**根因**：r10 仿写反汇编器时只对齐了「字段 / 方法 / 逐条指令 / 跳转标签 / 引用注释」主体，类头用自定简化模板 `<flags> class <flags> version major.minor`：`class` 写死、flags 按位拆成前后两组、JVM 内部名 `/` 转成 `.`、版本写 `52.0`；`disassemble()` 又完全不渲染类属性（其实 `parse()` 已解析出 `sourceFile`）。`package-info.class` 是 0 字段 0 方法、仅 SourceFile 的空类，把这层差异全部暴露。该问题纯属前端文本模板，Java 层零引用，不影响 DEX 转 JAR / JADX 反编译链路（实测 198 个真实 class 全部解析成功）。

- `assets/vendor/classview.js`：`disassemble()` 类头改为 MT 语法——斜杠内部包名、修饰符前置 + 类型关键字 + 简单类名、`version major:minor`、interface 隐含 abstract 不重复输出；新增 `{ }` 包裹类体、`SourceFile` / `Signature` 等属性渲染（`  SourceFile               "xxx";`）与 `} // end Class <内部名>` 收尾；`parse()` 给 `attributes` 加 `offset` 供属性取值。
- `assets/app.js`：`builtinClassDisasm()` 补类级属性解析（`clsAttrs`），类头 / 属性 / 收尾与主组件一致；`classStructText()` 同步对齐；`jvmasm` 高亮补 `SourceFile` / `Signature` / `annotation` / `enum` / `module` / `end` 等关键字。三处独立实现输出统一，**主体（字段 / 方法 / 逐条指令 / `Lxx:` 跳转标签 / 常量池引用注释）保持不变**。
- 缓存：`UI_BUILD='r12'`、`app.html` 加 `?v=r12`、`MainActivity assetEpoch` 5 → 6（本轮改动了 `vendor/classview.js`，覆盖安装必须清 WebView 缓存）。
- 测试：`tests/class-mt-header-check.py`（37 项：真实 JAR 样本 + 合成样本逐字符比对 MT、主体不回归、三级语法一致、缓存标记）、`tests/class-mt-header-smoke.cjs`（17 项：主组件 / 内置反汇编器 / 结构兜底真实执行一致性），均接入 CI；既有 `class-disasm-check.py` / `class-open-dispatch-smoke.cjs` / `class-archive-dispatch-check.py` 断言更新到新类头，版本断言改为通用校验（不再写死 r11 / epoch 5）。

**未改动**：Java 层仅 `MainActivity` 的 `assetEpoch` 一行；`AndroidManifest.xml` 字节级一致，versionCode 55 / 签名密钥未变；`DataEngine` / `ArchiveTools` / `DexEngine` 全部未改；保存键仍只导出 `.bytecode.txt`，绝不覆写 `.class` 原始字节。

验证：本地 14 项自检全 PASS（`FAIL_FLAG=0`）；198 个真实 class 批量解析 198/198 成功、34,360 条指令 / 1,812 个跳转标签与改前一致；真实 `package-info.class` 输出与 MT 管理器逐字符相同；Actions 构建 #63 全 success。

## r13 修复（基于 MT2.26.11.apk 反编译证据对齐 .class/JASM 语法）

**工作方式切换**：r12 只对照用户贴出的一段 MT 输出文本、`commons-net-3.10.0.jar` 样本与 `javap -v`，属于「照文本仿写」；用户明确要求「再次修改，要基于 MT 管理器反编译修改优化 r12」。r13 不再猜测，而是**直接反编译 `MT2.26.11.apk` 安装包本体**取证，再系统性改造代码。

**证据链**（均为 APK 内原始文件 / 字节码，非用户贴文）：
- `assets/syntax/jasm.mtsx`（11,812 B）—— MT 官方 JASM 语法高亮定义，首行注释 `name: ["Jasm", ".jasm", ".class"] // MT将class反编译为jasm进行编辑`，含 opcode / keyword / declaration / cpTag / cpRefKind 五组词表；证明 `.class` 被反编译为**可编辑回编译的 JASM 汇编**，不是自定义显示模板。
- `classes5.dex` 经项目自带 `baksmali-2.5.2.jar` 反编译（4,677 个 smali），定位 JASM printer 混淆类 `l/᩶ܿۜ.smali`（3,987 行），内含明文格式串 `package %s;%n` / `%sversion %s` / `class ` / `interface ` / ` extends ` / ` implements ` / `%-26s: "%s"` / `} // end Class ` / `} // end of module `。
- `classes4.dex` 字符串池：36 个 `ATT_*` 属性全集；dex 字符串池：完整 Jasmin opcode 表（`00 - nop;01 - aconst_null;…;2a 0 aload_0;…`），**全部标准小写**。
- 全库检索：camelCase `aLoad_0` / `aConst_null` / `iStore_1` 命中 **0**；小写 `aload_0` / `aconst_null` / `istore_1` 命中 7。据以纠正 r10–r12 的自创拼写。

**关键纠错**：r10–r12 的 opcode 助记符是自创 camelCase（`aLoad_0`），MT 从不用；此前几轮用户截图都是 `package-info.class` 空类、无方法体，该错误完全不可见。r13 把 `classview.js` 与 `app.js` 内置反汇编器两处 opcode 表全改为 MT 标准小写。

**改动**：
- `vendor/classview.js`：`CLASS_ACC` 注释对齐 `jasm.mtsx`；新增 `FIELD_ACC` / `METHOD_ACC`，`readMembers()` 按字段·方法取表（`bridge`/`varargs` 归方法、`volatile`/`transient` 归字段）；opcode 表改标准小写；新增 `classAttrValue()` 覆盖 `NestHost` / `EnclosingMethod` / `NestMembers` / `PermittedSubclasses` / `SourceDebugExtension` 等 `ATT_*` 属性；module 采用 `} // end of module` 收尾。
- `app.js`：`UI_BUILD='r13'`；拆 `MEM` / `MEM_M`；内置 opcode 表与高亮 `jvmasm` 重写为 MT 五组词表（declaration / keyword / cpTag / cpRefKind / opcode）；类属性块扩展、`module-info` 用 `end of module` 收尾；`classStructText()` 同步；关于页补 r13 版本说明。
- 缓存：`app.html ?v=r13`、`MainActivity assetEpoch 6 -> 7`（改动了 `vendor/classview.js`，覆盖安装强制清 WebView 缓存）。
- 测试：新增 `tests/fixtures/mt-jasm-vocab.json`（MT 反编译词表快照：opcode 233 / keyword 25 / declaration 57 / cpTag 36 / cpRefKind 10 / ATT 36）与 `tests/class-mt-decompile-align-check.py`（80 项对齐自检），接入 `.github/workflows/build-apk.yml`；既有 4 个测试断言更新到标准小写与通用版本校验。

**验证**：本地全套 `FAIL_FLAG=0`（8 个 Python + 7 个 cjs 冒烟 + 3 个 `node --check`）；新增 80 项 + 既有 37 项全 PASS；198 个真实 class 批量解析 198/198 成功、34,360 条指令 / 1,812 个跳转标签与改前完全一致；用户实测 `package-info.class` 输出逐字符不变；`Sample.class` 输出 `aload_0`、`module-info.class` 用 `end of module` 收尾；Actions 构建 #64 全 success。签名 APK 内置资源实测 43 项全通过；逐条目 461→461 无增删、`AndroidManifest.xml` 字节级一致、签名证书本体 SHA-256 `bfe0c27b…9504` 与 r12 完全一致（可覆盖安装）。

**未改动**：Java 层仅 `MainActivity` 的 `assetEpoch` 一行；`AndroidManifest.xml` 字节级一致，versionCode 55 / 签名密钥未变；`DataEngine` / `ArchiveTools` / `DexEngine` / `ExtraTools` 全部未改；保存键仍只导出 `.bytecode.txt`，绝不覆写 `.class` 原始字节。本轮是纯前端反汇编文本 / 语法高亮改动，不影响 DEX 转 JAR 或 JADX 反编译链路。

## r14 修复（统一处理进度对话框）

**需求**：所有耗时处理都要有进度提示，与 MT 管理器一致——居中卡片显示标题（如「Dex转Jar」）、「处理中...」和蓝色进度条，而不是只有顶部 2px 忙条。

**改动**：
- 前端新增 `taskProgress` 组件（`app.html` + `style.css` + `app.js`）：全屏半透明遮罩 + 圆角卡片，标题 21px、说明 14px、6px 轨道 + 主题蓝填充；`TASK_TITLES` 覆盖 39 个耗时 action（Dex转Jar / Dex转Smali / 修复Dex / Dex字符串解密 / 解压 / 压缩 / 复制文件 / 签名APK / APK优化 / 生成共存APK / GPG加密 …）。
- `rpc()` 按 action 自动挂载：命中 `TASK_TITLES` 即弹窗并把 `__task` 传给原生；成功 / 失败均自动关闭。未命中标题的短操作保持原顶部忙条，不打扰。
- 原生新增 `ProgressBus`：`ThreadLocal` 线程内进度总线（worker 为 2 线程池）+ 60ms 节流，工具类无需改方法签名即可 `report(pct,msg)` / `stage(msg)`；`MainActivity` 新增 `taskProgress` 注入 `window.__taskProgress`，`Bridge.request` 在请求生命周期内 begin/end。
- 真实百分比打点：DEX 修复（按 DEX 文件）、转 Smali（按 DEX）、转 JAR（解出 0-8%、反编译 / 打包 10-90%、MANIFEST 92%、完成 100%）；归档解压（zip 按条目，7z / tar / gzip 按条目文案）、压缩（zip / 7z / tar 按条目）；`FileOps.copyTree` 按文件数（新增 `report=false` 静默重载）；`BatchFiles.transfer` 按文件；`ApkOptimizer` 按 ZIP 条目；签名 / 共存 / APK 保护为阶段文案。
- 无精确进度的任务显示不确定动画（34% 宽度来回滑动），完成后进度条推进到 100% 再关闭，避免「卡在 90%」的观感。

**验证**：新增 `tests/progress-dialog-check.py`（70 项）与 `tests/progress-dialog-smoke.cjs`（17 项，伪 DOM 真实执行打开 / 42% / job 隔离 / 钳制 / 关闭），均接入 CI；本地全套 `FAIL_FLAG=0`（9 个 Python + 8 个冒烟 + 3 个语法检查），r13 的 80 项 JASM 对齐与 37 项类头自检全部不回归。Actions 构建 #65 全 success。

**未改动**：`AndroidManifest.xml` 字节级一致（versionCode 55）；文件格式转换 / JADX 反编译链路零影响；`assetEpoch 7 -> 8`（改了 app.js / style.css，覆盖安装强制清 WebView 缓存）。

## r15 修复（基于 MT2.26.11.apk 反编译还原进度对话框）

**需求**：不再照截图仿写，而是反编译 `MT2.26.11.apk` 本体取证，把 r14 的进度层对齐 MT 真实规格。

**反编译证据链**：
- ARSCLib 导出 `resources.arsc`：3423 个 string 条目 / 36259 个值，**dex 内零中文硬编码**，资源名被混淆成同一个 `MT_Protector`；提取 `assets/strings*.mtl` **11 语言 × 16 key**。
- baksmali 2.5.2 反编译 `classes.dex`：`ProgressDialog` / `DualProgressDialog` / `BaseCancelableDialog` / `PluginProgressBar$Style` / `UIUpdater` 真实 smali。
- 用户真机截图 `142333.jpg` 校验外观（灰卡片 / `Dex转Jar` / `处理中…` / 蓝色水平条 / 无百分比 / 无按钮）。
- 固化：`mtre/MT_PROGRESS_RULES.md` + `tests/fixtures/mt-progress-spec.json`（13 主文案 + 60 条简体功能专属 + 全量 115 条 + 11 语言 × 16 key + 4 样式 + 5 个 dialog 结构）。

**两套文案体系（r14 完全缺失）**：
- 主程序 arsc：状态机 `处理中…` / `正在加载…` / `正在准备…` / `正在重新加载…` / `正在取消操作…` / `已取消操作` / `再按一次取消操作` / `总进度` / `运行内存不足`，及 **60 条功能专属**「正在 XXX…」（解压 / 压缩 / 复制 / 移动 / 签名 / 分割 / 合并 / 加密 / 解密 / 混淆 / 重新打包 …）。
- 插件 `.mtl`：`正在处理…` / `正在取消…`（与主程序不同，不可混用），`{dual_progress_dialog_total}` → `总进度`。

**8 项改造**：消息改 arsc 状态文案机 + 功能专属 `TASK_STAGE`；原生阶段文案经 `mtStageText()` 规范化为 MT「正在 XXX…」格式；`ProgressDialog` 二级进度 `setSecondaryProgress`；`DualProgressDialog` 总进度双条（6dp 标签「总进度」）；`PluginProgressBar$Style` 四种样式（HORIZONTAL / CIRCULAR / CIRCULAR_SMALL / CIRCULAR_LARGE，环形 36/56/84 px）；`BaseCancelableDialog` 取消交互「再按一次取消操作 → 正在取消操作… → 已取消操作」（遮罩 / 返回键二次确认 + `cancelTask` action + `CancellationException`）；布局常量对齐 16sp 消息 / 12dp 进度条 / 6dp 总进度 / `setCancelable(false)`；证据固化为 CI 词表。

**原生扩展**：`ProgressBus` 新增 `Extras`（secondary / total / totalMax / style / state / detail）、`bindJob` / `requestCancel` / `isCanceled` / `checkCanceled`、`total()` / `secondary()` / `style()` 上报；`MainActivity` 4 参 `taskProgress` 注入；**保留 r14 的 `begin/end/report` 签名，工具类零改动**，ThreadLocal + 60ms 节流语义对齐 MT `UIUpdaterGroup`。r14 的 39 个 action 自动挂载与全部真实百分比打点原样保留。

**验证**：新增 `tests/progress-mt-decompile-align-check.py`（138 项）与 `tests/progress-mt-decompile-smoke.cjs`（39 项，伪 DOM 真实执行双进度 / 4 样式 / 状态 / 取消交互），均接入 CI；r14 两个基础自检适配新契约（71 项 / 17 项）。本地全套 `FAIL_FLAG=0`（10 个 Python + 9 个冒烟 + 3 个语法检查 + javac ProgressBus），r13 的 80 项 JASM 对齐与 37 项类头不回归。**签名 APK 内置实测 86/86**：从交付包拆出资源伪 DOM 真实执行进度组件（`处理中…` → 42% → 二级 72% / 总进度 30% / CIRCULAR / 正在加载… / CIRCULAR_LARGE / 正在取消操作… / 正在解压… / cancelTask 下发 → 关闭清理），并验证 `package-info.class` 输出与 MT 逐字符一致、`Sample.class` 输出 `aload_0`、`module-info` 用 `end of module`。Actions 构建 #66 全 success。

**兼容性**：`AndroidManifest.xml` 字节级一致（versionCode 55）；461→461 条目无增删（变化仅 app.html / app.js / style.css / classes.dex + 3 个重签 META-INF）；签名块 v2/v3 方案一致，**签名证书本体 SHA-256 `bfe0c27b…9504` 与 r14 完全一致，可直接覆盖安装**。`DataEngine` / `ArchiveTools` / `DexEngine` 业务逻辑零改动，DEX 转 JAR 与 JADX 反编译链路不受影响。`assetEpoch 8 -> 9`（改了 app.js / style.css / ProgressBus，覆盖安装强制清 WebView 缓存）。

## r16 修复（基于 MT2.26.11.apk 反编译修复 DEX 重新划分 / DEX 混淆对抗）

**需求**：不再按代码逻辑推断，而是反编译 MT 安装包本体取证，按 MT 真实规格重做这两项功能。

**问题**：倒序逐项实测 15 项 APK 功能时发现 2 个真实缺陷——
- 「DEX 重新划分」`maxClasses` 默认被写成 `Math.max(1,…)=1`，与「指定数量」模式冲突，`count=2` 把 19379 个类各拆一个 DEX，**静默产出 40MB 不可用 APK 且不报错**；
- 「DEX 混淆对抗」重命名去重集合存的是带描述符分号的 `"aaa;"`、却与 `"aaa"` 比较，去重恒失效，多个类重名触发 `already been interned` 崩溃。
另有 4 项与 MT 规格不符（第二模式按类数而非方法数、缺 65536 硬约束、数量不足静默多切、对话框文案与默认值不一致）。

**反编译证据链**（`MT2.26.11.apk`）：
- ARSCLib 导出 `resources.arsc`：`0x7f120291 均匀分配` / `0x7f120294 生成的Dex数量` / `0x7f120296 按限制分配` / `0x7f120298 方法数量限制` / `0x7f120297 最大 65536，建议输入 64000` / `0x7f120292 是否自动增加 dex 数量？` / `0x7f12029a Android 5.0 警告` / `0x7f12029b 正在重新分配…` / `0x7f120261 DEX混淆对抗` / `0x7f120263 按 $ 分割逐段匹配`；
- baksmali 反编译 `classes3.dex`：`l/ۜۜۨ.smali:437` 对 `0x7f12028a「无法生成dex，单个dex内的方法数超过65536。」` 明确 `throw`；`classes.dex` 的 `l/᩹ۤۙ.smali:870-880` 注册两项菜单；
- 固化：`mt-dex-rules.md` + `tests/fixtures/mt-dex-spec.json` + `tests/mt-dex-align-check.py`（CI 接入，38 项；附 MT 字符串表时 55 项）。

**按 MT 规格的改造**：`DexTools.repartition` 两模式互斥（`maxClasses` 默认 0）、`DEX_METHOD_LIMIT=65536` 硬约束、`MT_RECOMMENDED_LIMIT=64000`、`methodLimit` 参数、`NEED_MORE_DEX:n` 信号与 `autoIncrease` 确认开关 / `autoIncreased` 输出；前端对话框按 MT 原文重做并补 `confirmBox` 询问；`DexDeobfuscator` 去分号去重 + `reservedTypes` 保留集合 + `$` 分段匹配。其余 13 项 APK 功能零改动。

**验证**：本地 CI 前端测试集 23/23、MT DEX 规格对齐 55/55（CI 38/38）、静态链路 63/63、双样本倒序回归 15/15 + 15/15；
Actions 构建 #68 全 success（含核心 JVM 冒烟测试——`ApkToolsSmokeTest` 已适配 MT「数量不足先询问再自动增加」契约）；
**交付 APK 内置实测 119/119**（MT DEX 规格文案 / DEX 后端常量 / 旧文案清除 / r15 进度组件 86 项回归 / classview 反汇编 / V1+V2+V3 签名与证书）。

**兼容性**：`AndroidManifest.xml` 与 r15 **字节级一致**（versionCode 55 / 0.1.59 / `com.cyberhub.manager`）；461→461 条目无增删（变化仅 `assets/app.html`、`assets/app.js`、`classes.dex` + 3 个重签 META-INF）；签名方案 v1/v2/v3 齐全，**v1 内嵌 X.509 证书 SHA-256 `bfe0c27b…9504` 与 r15 完全一致，可直接覆盖安装**。`assetEpoch 9 -> 10`（app.js 变动，覆盖安装强制清 WebView 缓存，`?v=r16`）。

## 交付与修复报告（`reports/`）

本目录归档面向用户的 HTML 交付说明，均为只读记录，不参与构建：

| 文件 | 内容 |
| --- | --- |
| `github-submit-report.html` | `de9400d` 首次提交记录：73 个文件、+26,218 / −258，远程校验与 CI 状态 |
| `apk-build-report.html` | GitHub Actions 首次编译打包结果：两次运行 success、签名 APK 校验、Release `build-53` |
| `r4-hotfix-report.html` | WebView 静态资源白名单根因与修复（提交 `8369fea`、Release `build-55`） |
| `shizuku-fix-report.html` | Shizuku 授权根因（`API_V23` / `V3_SUPPORT`）与修复（提交 `4af1a97`、Release `build-56`） |
| `r5-verify-checklist.html` | r5 版本核对卡：旧版诊断与 r5 诊断的字段对照、安装步骤、结果判读与 SAF 兜底方案 |
| `r6-startup-direct-report.html` | 启动直达管理器（r6）：去掉整页启动提示、首屏即双窗格管理器的根因与修复（提交 `d2b581d`、Release `build-57`） |
| `r7-dex-to-jar-fix-report.html` | DEX 转 JAR 修复（r7）：`cant find zipfs support` 根因、目录分支绕过 JDK zipfs、对照实验与实测（提交 `4c6cb54`、Release `build-58`） |
| `r8-jar-open-fix-report.html` | 无法打开 JAR 文件修复（r8）：JAR 误走 8 MB 文本上限的根因、归档归类修复、真实 23.6 MB JAR 端到端验证（提交 `bd55744`、Release `build-59`） |
| `r9-class-view-fix-report.html` | .class 文件无法打开修复（r9）：新增内置类信息查看器（纯 JS 解析 class 字节码）的根因、javap 权威对照、真实 194KB 大 class 端到端与 APK 二进制校验（提交 `d6041c2`、Release `build-60`） |
| `r10-class-disasm-report.html` | .class 打开方式对标 MT 管理器（r10）：字节码反汇编文本编辑器、语法高亮、保存只导出不覆写、真实 class 端到端与 APK 逐条目 / 签名证书核对（提交 `f34bcba`、Release `build-61`） |
| `r11-class-archive-view-report.html` | JAR 内 .class 视图对标 MT 管理器（r11）：覆盖安装后 WebView 旧缓存触发表格回退的根因、删回退 + 组件自愈 + 内置反汇编 + 缓存根治、归档场景防回归自检与 APK 内置资源实测（提交 `7457c85`、Release `build-62`） |
| `r12-mt-class-header-report.html` | .class 反汇编文本对齐 MT 管理器（r12）：类头 / 属性块 / 收尾注释的根因与修复、真实 package-info.class 逐行对照、三级反汇编器一致性、APK 内置资源实测与逐条目 / 签名证书核对（提交 `068e2d8`、Release `build-63`） |
| `r13-mt-decompile-report.html` | 基于 MT2.26.11.apk 反编译证据对齐 .class/JASM 语法（r13）：jasm.mtsx 官方语法定义 + classes5.dex JASM printer 格式串 + 36 个 ATT_* + Jasmin opcode 表，纠正 r10–r12 自创 camelCase 助记符、修饰符分表、类属性块、module 收尾、五组高亮词表，APK 内置资源实测与逐条目 / 签名证书核对（提交 `d7c456a`、Release `build-64`） |
| `r14-progress-dialog-report.html` | 统一处理进度对话框（r14）：MT 同款居中「标题 + 处理中 + 进度条」、39 个 action 自动挂载、ProgressBus 线程内真实百分比、DEX / 归档 / 复制 / 优化打点、伪 DOM 与签名 APK 实测（提交 `9ffd987`、Release `build-65`） |
| `r15-mt-progress-decompile-report.html` | 基于 MT2.26.11.apk 反编译还原进度对话框（r15）：arsc 3423 条 / mtl 11 语言 / 5 个 smali 类的证据链、两套文案体系、60 条功能专属文案、总进度双条 / 二级进度 / 4 样式 / 再按一次取消、16sp-12dp-6dp 布局常量、签名 APK 内置 86 项实测与逐条目 / 证书核对（提交 `332f380`、Release `build-66`） |
| `r16-mt-dex-release-report.html` | 基于 MT2.26.11.apk 反编译修复 DEX 重新划分 / 混淆对抗（r16）：2 个真实缺陷 + 4 项规格偏差、arsc/string id 与 smali 证据链、均匀分配 / 按限制分配（64000 / 65536）/ 数量不足先询问再自动增加、签名 APK 内置 119 项实测与逐条目 / 证书核对（提交 `94745769` + `92e6e7bf`、Release `build-68`） |

正式签名 APK 请以仓库 Release `build-68` 为准（versionCode 55、签名密钥未变，可覆盖安装）；归档目录内的 `.apk` 与密钥文件均不入库。
