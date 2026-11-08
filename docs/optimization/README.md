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
