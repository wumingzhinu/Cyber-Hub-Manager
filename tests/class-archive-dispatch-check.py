#!/usr/bin/env python3
"""r11 归档内 .class 分发链路静态自检。

用户反馈：JAR / ZIP / APK 归档内点 .class 仍显示 r9「类信息查看器」四标签
表格（图一），而目标是 MT 同款深色反汇编代码视图（图二）。本脚本锁定整条
链路的静态约束，防止后续版本回归：

  * app.js：fileArgs 对归档条目返回 {archive,entry,path}；openFile 的
    `type==='class'` 分支必须排在归档浏览之前，本地与归档一视同仁调用
    classScreen(f)；「编辑文本」同样改道 classScreen。
  * classScreen：不再 `return classInfoScreen(f)`；须有组件自愈、内置
    反汇编器、结构/字节兜底，且始终进入 renderEditor(kind='class')。
  * 缓存根治：app.html 脚本带 ?v=r11 版本号；MainActivity assetEpoch 提升到
    5 强制 clearCache；localAsset 对静态资源返回 no-store。
  * Java 层：fileData 走 resolve(a)；resolve 对 archive 用 ArchiveTools.readEntry
    解出条目到缓存文件；ArchiveTools.listEntries 给条目写入 archive + entry；
    ExtraTools.fileData 预览上限 16MB（不受 8MB 文本上限限制）。
"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'app', 'src', 'main', 'assets')
JAVA = os.path.join(ROOT, 'app', 'src', 'main', 'java', 'com', 'cyberhub', 'manager')

errors = []


def require(cond, msg):
    if not cond:
        errors.append(msg)


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


app_js = read(os.path.join(ASSETS, 'app.js'))
app_html = read(os.path.join(ASSETS, 'app.html'))
main_act = read(os.path.join(JAVA, 'MainActivity.java'))
data_engine = read(os.path.join(JAVA, 'DataEngine.java'))
archive_tools = read(os.path.join(JAVA, 'ArchiveTools.java'))
extra_tools = read(os.path.join(JAVA, 'ExtraTools.java'))

# --- 1. 归档条目参数与分类 ---
require("function fileArgs(f){return f.archive?{archive:f.archive,entry:f.entry,path:f.archive}:{path:f.path};}" in app_js,
        'fileArgs() 不再对归档条目返回 archive + entry')
require("if(ext==='class')return 'class';" in app_js,
        "fileType() 不再把 .class 判为 'class'")

# --- 2. openFile：class 分支必须在归档浏览之前，且不区分本地/归档 ---
m_open = re.search(r'^async function openFile\(f,index=state\.active\)\{(.*)$', app_js, re.M)
require(m_open is not None, '未找到 openFile() 定义')
if m_open:
    body = m_open.group(1)
    at_cls = body.find("if(type==='class')return classScreen(f)")
    at_archive = body.find("if(type==='archive'")
    require(at_cls >= 0, "openFile() 缺少 .class → classScreen(f) 分支")
    require(at_archive >= 0, "openFile() 缺少归档浏览分支")
    require(0 <= at_cls < at_archive,
            ".class 分支必须排在归档浏览之前，否则归档内 .class 会被当压缩包/文本")
require("fileType(f)==='class'?classScreen(f):openText(fileArgs(f))" in app_js,
        '「打开方式→编辑文本」未对 .class 改道 classScreen')

# --- 3. classScreen 契约：绝不回退表格 ---
m_cs = re.search(r'^async function classScreen\(f\)\{(.*?)^\}$', app_js, re.M | re.S)
require(m_cs is not None, '未找到 classScreen() 定义')
if m_cs:
    s = m_cs.group(1)
    require("rpc('fileData',fileArgs(f))" in s, 'classScreen 未用 fileData 读取字节')
    require('return classInfoScreen(f)' not in s,
            'classScreen 仍会回退到类信息表格（归档内 .class 会显示图一）')
    require('classDisasmOf(cv,b64)' in s and 'ensureClassView()' in s,
            'classScreen 缺少反汇编 + 组件自愈')
    require('builtinClassDisasm(b64)' in s, 'classScreen 缺少 app.js 内置反汇编器兜底')
    require('classStructText(info,nm)' in s and 'classBytesText(b64,nm)' in s,
            'classScreen 缺少结构 / 字节代码视图兜底')
    require("kind:'class'" in s and 'renderEditor()' in s,
            'classScreen 未进入 renderEditor(kind=class) 代码视图')
require('async function classInfoScreen(f){' in app_js,
        'r9 类信息查看器应保留为菜单二级入口')
require("icon:'info',label:'类信息查看器'" in app_js,
        '类信息查看器应仍在右上菜单')

# --- 4. 内置反汇编器自包含 ---
require('function builtinClassDisasm(b64){' in app_js, '缺少 app.js 内置反汇编器')
# 截取内置函数体，确认关键片段都在其中（而不是依赖 app.js 其它位置）
_i = app_js.find('function builtinClassDisasm(b64){')
_j = app_js.find('async function classScreen(f){', _i)
_builtin = app_js[_i:_j] if _i >= 0 and _j > _i else ''
for token in ['atob(', '0xCAFEBABE', 'tableswitch', 'lookupswitch', 'invokespecial',
              'Method ', 'Field ', 'package ', 'stack ', 'locals ']:
    require(token in _builtin, '内置反汇编器缺少关键片段：' + token)

# --- 5. 缓存根治 ---
require(re.search(r'<script src="app\.js\?v=r11">', app_html) is not None,
        'app.html 未给 app.js 加 ?v=r11 版本号')
require(re.search(r'<script src="vendor/classview\.js\?v=r11">', app_html) is not None,
        'app.html 未给 classview.js 加 ?v=r11 版本号')
require('getInt("assetEpoch",0)<5' in main_act and 'putInt("assetEpoch",5)' in main_act,
        'MainActivity 未把 assetEpoch 提升到 5（覆盖安装不会 clearCache）')
require('setCacheMode(WebSettings.LOAD_NO_CACHE)' in main_act,
        'MainActivity 未设置 LOAD_NO_CACHE')
require('"Cache-Control","no-store"' in main_act,
        'localAsset 未对静态资源返回 Cache-Control: no-store')
require("s.src='vendor/classview.js?v='+encodeURIComponent(UI_BUILD);" in app_js,
        'ensureClassView 未带版本号重载 classview.js')

# --- 6. Java 归档读取链路 ---
require('case "fileData":return ExtraTools.fileData(resolve(a));' in data_engine,
        'DataEngine 的 fileData 未走 resolve(a)（归档条目无法解出）')
require('ArchiveTools.readEntry(' in data_engine and 'a.getString("entry")' in data_engine,
        'resolve() 未用 ArchiveTools.readEntry 读取归档条目')
require('put("archive",archivePath).put("entry",' in archive_tools,
        'ArchiveTools.listEntries 未给条目写入 archive + entry')
require('public static byte[] readEntry(' in archive_tools,
        'ArchiveTools 缺少 readEntry()')
require('MAX_PREVIEW=16L*1024*1024' in extra_tools,
        'ExtraTools.fileData 预览上限不是 16MB（可能误触 8MB 文本上限）')

if errors:
    print('FAIL: r11 归档内 .class 分发自检未通过')
    for e in errors:
        print('  - ' + e)
    raise SystemExit(1)
print('PASS: r11 归档内 .class 分发自检 %d 项全部通过（前端分发 / 绝不回退表格 / '
      '内置反汇编 / 缓存根治 / Java 归档读取链路）' % 24)
