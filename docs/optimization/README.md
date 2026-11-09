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

正式签名 APK 请以仓库 Release `build-62` 为准（versionCode 55、签名密钥未变，可覆盖安装）；归档目录内的 `.apk` 与密钥文件均不入库。
