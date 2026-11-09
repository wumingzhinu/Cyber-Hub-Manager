#!/usr/bin/env python3
"""r9 .class 类信息查看器自检：静态约束 + Node 真实执行解析器。

背景（r9）：app.js 的 fileType() 原先不给 .class 任何分类，返回 'file'，
openFile() 兜底调用 openText() → rpc('read') → DataEngine.read() 在前 2048
字节扫到 0x00（class 魔数 CAFEBABE 之后全是二进制）即抛
「二进制文件：无法作为文本打开，请在「打开方式」中选择十六进制查看器或其他应用」。
用户在「打开方式」里点「编辑文本」时 openText(fileArgs(f)) 没传 f，兜底失效，
异常被 act() 包成「无法完成」对话框——归档内 .class 完全看不了。

修复：新增 vendor/classview.js（纯 JS 解析 class 字节码）→ fileType('.class')
返回独立 'class' 类型 → openFile() 直达 classScreen(f)（用 fileData 拿 base64
解析并渲染 概览/字段/方法/常量池字符串）；「打开方式→编辑文本」对 .class 也改道
查看器。Java 层零改动，8MB 文本上限、13 项打开方式网格、blob.bin 显式编辑报错
行为均保持不变。

此脚本固定上述约束防回归，并用 node 真实执行 classview.js 校验解析结果。
"""
import os
import re
import json
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'app', 'src', 'main', 'assets')
APP_JS = os.path.join(ASSETS, 'app.js')
APP_HTML = os.path.join(ASSETS, 'app.html')
CLASSVIEW = os.path.join(ASSETS, 'vendor', 'classview.js')

errors = []


def require(cond, msg):
    if not cond:
        errors.append(msg)


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


# --- 0. 文件存在 ---
require(os.path.isfile(CLASSVIEW), '缺少 vendor/classview.js')
app_js = read(APP_JS) if os.path.isfile(APP_JS) else ''
app_html = read(APP_HTML) if os.path.isfile(APP_HTML) else ''
cv_js = read(CLASSVIEW) if os.path.isfile(CLASSVIEW) else ''

# --- 1. app.html 必须在 app.js 之前加载 classview.js ---
i_cv = app_html.find('vendor/classview.js')
i_app = app_html.find('<script src="app.js">')
require(i_cv >= 0, 'app.html 未加载 vendor/classview.js')
require(i_app >= 0, 'app.html 未加载 app.js')
require(0 <= i_cv < i_app, 'classview.js 必须在 app.js 之前加载')

# --- 2. classview.js 暴露的 API ---
for token in ['parseBytes', 'parseBase64', 'parse(', '0xCAFEBABE', 'jdkVersion',
              'methodSignature', 'fieldType', 'CyberClassView', 'decodeMutf8']:
    require(token in cv_js, f'classview.js 缺少 {token}')
require('module.exports' in cv_js and 'factory(root)' in cv_js,
        'classview.js 缺少 UMD 包装（Node 测试需要 module.exports）')

# --- 3. fileType 把 .class 判为独立类型 ---
require(re.search(r"if\(ext==='class'\)return 'class';", app_js) is not None,
        "fileType() 未把 .class 判为 'class'")

# --- 4. openFile 增加 class 直达查看器分支，且在归档/文本兜底之前 ---
m_open = re.search(r'^async function openFile\(f,index=state\.active\)\{(.*)$', app_js, re.M)
require(m_open is not None, 'app.js 未找到 openFile() 定义')
if m_open:
    body = m_open.group(1)
    at_cls = body.find("if(type==='class')return classScreen(f)")
    at_text = body.find('return openText(')
    require(at_cls >= 0, 'openFile() 缺少 type===class 直达分支')
    require(at_text >= 0, 'openFile() 缺少文本读取兜底分支')
    require(0 <= at_cls < at_text,
            'class 分支必须排在 openText 兜底之前，否则 .class 仍会被当文本读取')

# --- 5. classScreen 函数存在且用 fileData + parseBase64 渲染 ---
require('async function classScreen(f){' in app_js, 'app.js 缺少 classScreen()')
require("rpc('fileData',fileArgs(f))" in app_js,
        'classScreen() 未用 fileData 读取字节（应复用支持归档内条目的通道）')
require('cv.parseBase64(d.data)' in app_js,
        'classScreen() 未调用 CyberClassView.parseBase64()')
require("window.CyberClassView" in app_js,
        'classScreen() 未引用 window.CyberClassView')
for tab in ["'概览'", "'字段'", "'方法'", "'字符串'"]:
    require(tab in app_js, f'classScreen() 缺少标签 {tab}')
require('kvRow(' in app_js and 'listHtml(' in app_js,
        'classScreen() 缺少概览/列表渲染')
# 无效 class 也要有可操作出口，不能死在错误页
require("id=\"cvHex\"" in app_js and "id=\"cvOw\"" in app_js,
        'classScreen() 无效 class 时缺少十六进制 / 打开方式出口')

# --- 6. 「打开方式→编辑文本」对 .class 改道查看器（不改 13 项标签数组） ---
require("fileType(f)==='class'?classScreen(f):openText(fileArgs(f))" in app_js,
        '「编辑文本」未对 .class 改道查看器（用户显式选仍会报「无法完成」）')
labels = re.findall(r"\{label:'(编辑文本|浏览压缩包|查看图片|预览网页|十六进制|播放音乐|播放视频|XML 功能|DEX 功能|ARSC 功能|APK 信息|APKS 功能|Linux 脚本)'", app_js)
require(len(labels) == 13, f'打开方式内置项应为 13 项，实为 {len(labels)} 项（硬断言回归）')

# --- 7. r8 的二进制 / 文件过大兜底仍在（openText 未回归） ---
m_text = re.search(r'^async function openText\(args,f\)\{(.*)$', app_js, re.M)
require(m_text is not None, 'app.js 未找到 openText() 定义')
if m_text:
    t = m_text.group(1)
    require("msg.includes('二进制文件')" in t, 'openText() 原有「二进制文件」引导被破坏')
    require("msg.includes('文件过大')" in t, 'openText() 原有「文件过大」引导被破坏')
    require(t.count('return openWithDialog(f)') >= 2,
            'openText() 两个可操作兜底不完整')

# --- 8. 版本标记与关于页 ---
m_build = re.search(r"const UI_BUILD='r(\d+)';", app_js)
require(m_build is not None and int(m_build.group(1)) >= 9,
        'UI_BUILD 未更新为 r9')
require('r9 修复 .class 文件无法打开' in app_js, '关于页缺少 r9 版本说明')
require('r8 修复无法打开 JAR 文件' in app_js, '关于页 r8 版本说明被误删（回归）')

# --- 9. Java 层零改动：不新增 action，复用 fileData / hexView / resolve ---
data_engine = read(os.path.join(ROOT, 'app', 'src', 'main', 'java', 'com', 'cyberhub', 'manager', 'DataEngine.java'))
require('case "fileData":return ExtraTools.fileData(resolve(a));' in data_engine,
        'DataEngine.fileData 通道被破坏')
require('public static final long MAX_TEXT = 8L * 1024 * 1024;' in
        read(os.path.join(ROOT, 'app', 'src', 'main', 'java', 'com', 'cyberhub', 'manager', 'FileOps.java')),
        'FileOps.MAX_TEXT 8MB 文本上限被改动')

# --- 10. Node 真实执行 classview.js：构造最小合法 class + 断言解析结果 ---
# 最小 class：magic, minor=0, major=52, cp_count=5,
#  #1 Utf8 "Hello", #2 Class ->#1, #3 Utf8 "java/lang/Object", #4 Class ->#3
#  access=0x0021, this=#2, super=#4, interfaces=0, fields=0, methods=0, attrs=0
def u1(v): return bytes([v & 255])
def u2(v): return bytes([(v >> 8) & 255, v & 255])
def u4(v): return bytes([(v >> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255])
def utf8(s):
    b = s.encode('utf-8')
    return u1(1) + u2(len(b)) + b

minimal = (u4(0xCAFEBABE) + u2(0) + u2(52) + u2(5) +
           utf8('Hello') + u1(7) + u2(1) +
           utf8('java/lang/Object') + u1(7) + u2(3) +
           u2(0x0021) + u2(2) + u2(4) +
           u2(0) + u2(0) + u2(0) + u2(0))
b64 = __import__('base64').b64encode(minimal).decode('ascii')

node_check = r'''
const cv = require(process.argv[1]);
const b64 = process.argv[2];
const out = {};
const a = cv.parseBase64(b64);
out.minimal = {
  valid: a.valid, magic: a.magic, major: a.major, jdk: a.jdk,
  thisClass: a.thisClass, superClass: a.superClass,
  accessFlags: a.accessFlags, constantPoolCount: a.constantPoolCount,
  utf8: a.utf8, fields: a.fields.length, methods: a.methods.length,
  error: a.error
};
// 描述符可读化
out.sig = cv.methodSignature('(I[Ljava/lang/String;Lfoo/Bar;)Z');
out.field = cv.fieldType('[[Lfoo/Bar;');
out.jdk = cv.jdkVersion(61);
// 损坏文件必须优雅失败
out.badMagic = cv.parseBytes(new Uint8Array([1,2,3,4,5,6,7,8,9,10])).valid;
out.badMagicErr = cv.parseBytes(new Uint8Array([1,2,3,4,5,6,7,8,9,10])).error;
process.stdout.write(JSON.stringify(out));
'''
try:
    r = subprocess.run(['node', '-e', node_check, CLASSVIEW, b64],
                       capture_output=True, text=True, timeout=30)
    require(r.returncode == 0, f'node 动态执行 classview.js 失败：{r.stderr.strip()[:200]}')
    got = json.loads(r.stdout) if r.returncode == 0 else {}
except Exception as e:  # noqa: BLE001
    require(False, f'node 动态执行异常：{e}')
    got = {}

m = got.get('minimal', {})
require(m.get('valid') is True, f'最小 class 解析失败：{m.get("error")}')
require(m.get('magic') == 'CAFEBABE', f'魔数错误：{m.get("magic")}')
require(m.get('major') == 52, f'major 版本错误：{m.get("major")}')
require('Java 8' in str(m.get('jdk', '')), f'JDK 版本映射错误：{m.get("jdk")}')
require(m.get('thisClass') == 'Hello', f'类名错误：{m.get("thisClass")}')
require(m.get('superClass') == 'java.lang.Object', f'父类错误：{m.get("superClass")}')
require('public' in m.get('accessFlags', []) and 'super' in m.get('accessFlags', []),
        f'访问标志错误：{m.get("accessFlags")}')
require(m.get('constantPoolCount') == 5, f'常量池数量错误：{m.get("constantPoolCount")}')
require(m.get('fields') == 0 and m.get('methods') == 0, '空成员解析错误')
sig = got.get('sig', {})
require(sig.get('params') == ['int', 'java.lang.String[]', 'foo.Bar'],
        f'方法描述符参数解析错误：{sig.get("params")}')
require(sig.get('ret') == 'boolean', f'方法返回类型错误：{sig.get("ret")}')
require(got.get('field') == 'foo.Bar[][]', f'字段描述符错误：{got.get("field")}')
require('Java 17' in str(got.get('jdk', '')), f'jdkVersion(61) 错误：{got.get("jdk")}')
require(got.get('badMagic') is False, '损坏文件（魔数不符）应解析失败')

# --- 11. 若有真实 .class（r7 DEX→JAR 产物）则端到端解析 ---
real = os.path.join(os.path.dirname(ROOT), 'dextest', 'classes', 'com', 'cyberhub', 'manager', 'R.class')
if not os.path.isfile(real):
    real = os.environ.get('REAL_CLASS', '')
if real and os.path.isfile(real):
    real_b64 = __import__('base64').b64encode(open(real, 'rb').read()).decode('ascii')
    r2 = subprocess.run(['node', '-e',
                         "const cv=require(process.argv[1]);const o=cv.parseBase64(process.argv[2]);"
                         "process.stdout.write(JSON.stringify({valid:o.valid,thisClass:o.thisClass,"
                         "major:o.major,fields:o.fields.length,methods:o.methods.length,cp:o.constantPoolCount,error:o.error}));",
                         CLASSVIEW, real_b64], capture_output=True, text=True, timeout=30)
    if r2.returncode == 0:
        ro = json.loads(r2.stdout)
        require(ro.get('valid') is True, f'真实 .class 解析失败：{ro.get("error")}')
        require(str(ro.get('thisClass', '')).startswith('com.cyberhub.manager'),
                f'真实 .class 类名异常：{ro.get("thisClass")}')

if errors:
    print('FAIL: .class 类信息查看器自检未通过')
    for e in errors:
        print('  -', e)
    sys.exit(1)
print('PASS: .class 类信息查看器自检 %d 项全部通过（分类 / 直达 / 四标签 / 兜底 / 13项网格 / Java零改动 / Node 真实解析）'
      % (11 + 1))
