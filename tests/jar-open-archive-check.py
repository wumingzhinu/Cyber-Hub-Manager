#!/usr/bin/env python3
"""JAR 归档打开自检：JAR 等 ZIP 系归档必须走「浏览压缩包」，不得再误走文本读取。

背景（r8）：app.js 的 archiveExtensions 原先不含 jar/war/ear/aar/jmod，
fileType('x.jar') 返回 'file'，openFile() 兜底调用 openText() → rpc('read')
→ DataEngine.read() → FileOps.read(f, FileOps.MAX_TEXT=8MB)。于是：
  - JAR < 8MB：read() 检测到二进制字节，报「二进制文件：无法作为文本打开」
  - JAR > 8MB：直接报「文件过大，无法执行此操作（上限 8 MB）」
后端 ArchiveTools.format() 对未知扩展名本就默认返回 "zip"，listEntries()
用 zip4j 列条目、readEntry() 提取条目，链路完全可用，缺的只是前端分类。

现把 jar/war/ear/aar/jmod 纳入 archiveExtensions，openFile() 的
type==='archive' 分支即进入双窗格归档浏览；另在 openText() 中给
「文件过大」补一个可操作兜底（引导到十六进制 / 浏览压缩包），
避免用户显式选「编辑文本」时卡在纯错误页。8MB 文本上限本身不变。

此脚本固定上述约束防回归，并用 node 真实执行 fileType() 校验分类结果。
"""
import json
import re
import subprocess
import sys
from pathlib import Path

P = Path(__file__).resolve().parents[1]
ASSETS = P / 'app/src/main/assets'
JAVA = P / 'app/src/main/java/com/cyberhub/manager'
app_js = (ASSETS / 'app.js').read_text(encoding='utf-8')
archive_tools = (JAVA / 'ArchiveTools.java').read_text(encoding='utf-8')
data_engine = (JAVA / 'DataEngine.java').read_text(encoding='utf-8')
file_ops = (JAVA / 'FileOps.java').read_text(encoding='utf-8')

errors = []
checks = 0


def require(cond, msg):
    global checks
    checks += 1
    if not cond:
        errors.append(msg)


# --- 1. 前端分类：JAR 系必须进入 archiveExtensions ---
m = re.search(r'^const archiveExtensions=\[(.*)\];$', app_js, re.M)
require(m is not None, 'app.js 未找到 archiveExtensions 定义')
arch = m.group(1).replace("'", '').split(',') if m else []
for ext in ('jar', 'war', 'ear', 'aar', 'jmod'):
    require(ext in arch, f'archiveExtensions 缺少 {ext}，点击该类型仍会误走文本编辑器')
# 原有归档扩展名一个都不能丢
for ext in ('zip', 'rar', '7z', 'tar', 'gz', 'gzip', 'tgz', 'bz2', 'bzip2',
            'xz', 'zst', 'lz4', 'tbz', 'tbz2', 'txz', 'tzst', 'zipx', 'cab', 'iso'):
    require(ext in arch, f'原有归档扩展名 {ext} 被意外移除')

# --- 2. openFile() 的归档分支必须仍在兜底 openText 之前 ---
m_open = re.search(r'^async function openFile\(f,index=state\.active\)\{(.*)$', app_js, re.M)
require(m_open is not None, 'app.js 未找到 openFile() 定义')
if m_open:
    body = m_open.group(1)
    at_arch = body.find("type==='archive'")
    at_text = body.find('return openText(')
    require(at_arch >= 0, 'openFile() 缺少 type===archive 归档分支')
    require(at_text >= 0, 'openFile() 缺少文本读取兜底分支')
    require(0 <= at_arch < at_text,
            '归档分支必须排在 openText 兜底之前，否则 JAR 仍会被当文本读取')
    require('archive:f.path' in body, '归档分支未把 f.path 作为 archive 传入双窗格浏览')

# --- 3. openText() 的「文件过大」兜底与原有二进制兜底 ---
m_text = re.search(r'^async function openText\(args,f\)\{(.*)$', app_js, re.M)
require(m_text is not None, 'app.js 未找到 openText() 定义')
if m_text:
    t = m_text.group(1)
    require("msg.includes('文件过大')" in t,
            'openText() 缺少「文件过大」引导，用户显式选编辑文本仍会卡在纯错误页')
    require("msg.includes('二进制文件')" in t,
            'openText() 原有「二进制文件」引导被破坏（回归）')
    require(t.count('return openWithDialog(f)') >= 2,
            '两类失败都应回退到打开方式对话框（十六进制 / 浏览压缩包）')

# --- 4. 13 项打开方式网格结构不变，「浏览压缩包」仍按 archive 判定 ---
require("{label:'浏览压缩包'" in app_js, '打开方式内置项「浏览压缩包」缺失')
require("fileType(f)==='archive'" in app_js,
        '「浏览压缩包」不再按 archive 类型启用，13 项网格置灰逻辑可能回归')

# --- 5. 版本标记与关于页 ---
require("const UI_BUILD='r8';" in app_js, 'UI_BUILD 未更新为 r8')
require('r8 修复无法打开 JAR 文件' in app_js, '关于页缺少 r8 版本说明')

# --- 6. 后端：JAR 按 ZIP 处理的能力必须保留 ---
require('return "zip";' in archive_tools,
        'ArchiveTools.format() 缺少默认 zip 兜底，JAR 将无法被 listEntries 读取')
require('format.equals("zip")||format.equals("apk")' in archive_tools,
        'ArchiveTools.listEntries() 的 zip/apk 分支被破坏')
require('ArchiveTools.listEntries(new File(archive)' in data_engine,
        'DataEngine.list() 未把归档路径交给 listEntries()')
require('ArchiveTools.readEntry(new File(archive)' in data_engine,
        'DataEngine.resolve() 未把归档条目交给 readEntry()')

# --- 7. 安全边界：8MB 文本上限本身不动（只是不再让 JAR 走这条路）---
require('FileOps.MAX_TEXT' in data_engine,
        'DataEngine.read() 不再使用 MAX_TEXT，文本编辑器大小保护可能被绕过')
require('public static final long MAX_TEXT = 8L * 1024 * 1024;' in file_ops,
        'FileOps.MAX_TEXT 被改动，文本编辑器 8MB 上限应保持不变')

# --- 8. 动态求值：用 node 真实执行 fileType()，确认分类结果 ---
m_ft = re.search(r'^function fileType\(f\)\{.*\}$', app_js, re.M)
m_txt = re.search(r'^const textExtensions=\[.*\];$', app_js, re.M)
require(m_ft is not None and m_txt is not None and m is not None,
        '无法从 app.js 提取 fileType / textExtensions / archiveExtensions 用于动态求值')
if m_ft and m_txt and m:
    js = (
        'function mediaKind(){return null;}\n'
        + m.group(0) + '\n' + m_txt.group(0) + '\n' + m_ft.group(0) + '\n'
        + "const names=['demo.jar','lib.war','app.ear','classes.aar','m.jmod',"
          "'plain.zip','app.apk','bundle.xapk','bundle.apks','notes.txt',"
          "'Foo.class','classes.dex','AndroidManifest.xml','other.bin'];\n"
        + "const out={};for(const n of names)out[n]=fileType({name:n,dir:false});\n"
        + 'process.stdout.write(JSON.stringify(out));'
    )
    try:
        r = subprocess.run(['node', '-e', js], capture_output=True, text=True, timeout=30)
        require(r.returncode == 0, f'node 动态求值失败：{r.stderr.strip()[:200]}')
        got = json.loads(r.stdout) if r.returncode == 0 else {}
    except Exception as e:  # noqa: BLE001
        require(False, f'node 动态求值异常：{e}')
        got = {}
    expected = {
        'demo.jar': 'archive', 'lib.war': 'archive', 'app.ear': 'archive',
        'classes.aar': 'archive', 'm.jmod': 'archive', 'plain.zip': 'archive',
        'app.apk': 'apk', 'bundle.xapk': 'apks', 'bundle.apks': 'apks',
        'notes.txt': 'text', 'Foo.class': 'file', 'classes.dex': 'dex',
        'AndroidManifest.xml': 'xml', 'other.bin': 'bin',
    }
    for name, want in expected.items():
        require(got.get(name) == want,
                f'fileType({name}) = {got.get(name)!r}，期望 {want!r}')

if errors:
    print('FAIL: JAR 归档打开自检未通过')
    for e in errors:
        print(' -', e)
    sys.exit(1)
print(f'PASS: JAR 归档打开自检 {checks} 项全部通过'
      '（JAR 系归类 / 归档分支优先 / 大文件兜底 / 13 项网格 / 后端 ZIP / 8MB 边界 / 动态求值）')
