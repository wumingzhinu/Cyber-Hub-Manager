#!/usr/bin/env python3
"""r10/r11 .class「MT 同款字节码反汇编编辑器」自检：静态约束 + Node 真实反汇编。

背景（r9）：点 .class 进的是「类信息查看器」四标签表格。用户要求改成
MT 管理器那样的代码视图：深色代码区、行号、语法高亮、顶部工具栏、
底部符号栏，正文是逐条 JVM 指令而不是字段表格。

r11 追加修复：用户反馈「JAR / 归档内的 .class 仍是四标签表格」。根因是
classScreen() 在 disassembleBase64 缺失时 `return classInfoScreen(f)` 静默回退；
覆盖安装（versionCode 恒 55）后 WebView 缓存了 r9 版 classview.js（只有
parseBase64），归档内 .class 便命中该分支。r11 三层修复：删除表格回退、
组件自愈重载、app.js 内置反汇编器 + 结构/字节兜底，并给脚本加版本号 +
提升 assetEpoch 强制清缓存。任何情况下 .class 都进入代码编辑器。

修复（r10，Java 层零改动）：
  * vendor/classview.js 增加 disassemble()/disassembleBase64()：复用常量池解析，
    逐条反汇编 Code 属性（含 tableswitch / lookupswitch / wide / iinc），生成
    package / 类版本 / 字段 / 方法头(stack+locals) / 指令 / 十六进制跳转标签 /
    Method、Field、Class、String 引用注释；不反编译成 Java，也不写回字节。
  * app.js classScreen() 改为把反汇编文本塞进既有文本编辑器 renderEditor()，
    kind='class'，新增 CodeMirror 'jvmasm' 模式与 .classEditor 深配色；保存键
    改走 exportClassDisasm() 导出 .bytecode.txt；原查看器改名 classInfoScreen()
    保留在右上菜单；canLeave() 不再拦截派生视图。
此脚本固定上述约束防回归，并用 node 真实执行反汇编器校验输出。
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
STYLE_CSS = os.path.join(ASSETS, 'style.css')
CLASSVIEW = os.path.join(ASSETS, 'vendor', 'classview.js')
FIXTURE = os.path.join(ROOT, 'tests', 'fixtures', 'Sample.class')

errors = []


def require(cond, msg):
    if not cond:
        errors.append(msg)


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


app_js = read(APP_JS)
app_html = read(APP_HTML)
style_css = read(STYLE_CSS)
cv_js = read(CLASSVIEW)

# --- 1. 资源加载顺序 / 文件存在 ---
require(os.path.isfile(FIXTURE), '缺少 tests/fixtures/Sample.class 真实字节码样本')
i_cv = app_html.find('vendor/classview.js')
# r11: 脚本带 ?v=r11 版本号做 cache-busting，允许 query。
m_app = re.search(r'<script src="app\.js(?:\?[^"]*)?">', app_html)
i_app = m_app.start() if m_app else -1
require(0 <= i_cv < i_app, 'classview.js 必须在 app.js 之前加载')

# --- 2. classview.js 暴露新 API，且 r9 的解析 API 未回归 ---
for token in ['disassemble', 'disassembleBytes', 'disassembleBase64', 'decodeInstr',
              'opcodeCount', 'parseBytes', 'parseBase64', '0xCAFEBABE', 'methodSignature',
              'fieldType', 'CyberClassView', "tableswitch", "lookupswitch"]:
    require(token in cv_js, 'classview.js 缺少 ' + token)
require('module.exports' in cv_js and 'factory(root)' in cv_js,
        'classview.js 缺少 UMD 包装（Node 测试需要 module.exports）')
require('Code' in cv_js and 'maxStack' in cv_js and 'maxLocals' in cv_js,
        'parse() 未保留 Code 属性字节 / 栈深 / 局部变量数')

# --- 3. 分类与分发（r8/r9 回归） ---
require(re.search(r"if\(ext==='class'\)return 'class';", app_js) is not None,
        "fileType() 未把 .class 判为 'class'")
m_open = re.search(r'^async function openFile\(f,index=state\.active\)\{(.*)$', app_js, re.M)
require(m_open is not None, 'app.js 未找到 openFile() 定义')
if m_open:
    body = m_open.group(1)
    require(0 <= body.find("if(type==='class')return classScreen(f)") < body.find('return openText('),
            'class 直达分支必须排在 openText 兜底之前')
require("fileType(f)==='class'?classScreen(f):openText(fileArgs(f))" in app_js,
        '「打开方式→编辑文本」未对 .class 改道（r9 回归）')
labels = re.findall(r"\{label:'(编辑文本|浏览压缩包|查看图片|预览网页|十六进制|播放音乐|播放视频|XML 功能|DEX 功能|ARSC 功能|APK 信息|APKS 功能|Linux 脚本)'", app_js)
require(len(labels) == 13, '打开方式内置项应为 13 项，实为 %d 项' % len(labels))

# --- 4. classScreen 走反汇编 + 文本编辑器，classInfoScreen 保留四标签 ---
m_cs = re.search(r'^async function classScreen\(f\)\{(.*?)^\}$', app_js, re.M | re.S)
require(m_cs is not None, 'app.js 缺少 classScreen()')
if m_cs:
    s = m_cs.group(1)
    require("rpc('fileData',fileArgs(f))" in s, 'classScreen() 未用 fileData 读取字节')
    require('classDisasmOf(cv,b64)' in s and 'ensureClassView()' in s,
            'classScreen() 未走反汇编器 + 组件自愈（覆盖缓存旧 classview.js）')
    require('builtinClassDisasm(b64)' in s,
            'classScreen() 缺少 app.js 自包含反汇编器兜底（不依赖外部脚本）')
    require("kind:'class'" in s and 'renderEditor()' in s,
            'classScreen() 未进入文本编辑器（应复用 renderEditor / kind=class）')
    # r11 核心：绝不回退到四标签「类信息查看器」表格
    require('return classInfoScreen(f)' not in s,
            'classScreen() 仍会回退到类信息表格（归档内 .class 会显示旧视图）')
    require('classStructText(info,nm)' in s and 'classBytesText(b64,nm)' in s,
            'classScreen() 缺少结构 / 字节代码视图兜底')
require('async function classInfoScreen(f){' in app_js, 'r9 类信息查看器未保留为 classInfoScreen()')
# r12：缓存根治——脚本版本号需与 UI_BUILD 一致；assetEpoch 只增不减。
# 改为通用校验，避免每个版本递增都要同步改死断言。
m_ui = re.search(r"const UI_BUILD='r(\d+)';", app_js)
ui = int(m_ui.group(1)) if m_ui else 0
require(ui >= 12, 'UI_BUILD 应不低于 r12，实为 r%d' % ui)
require(('app.js?v=r%d' % ui) in app_html,
        'app.html 的 app.js 版本号应与 UI_BUILD 一致（cache-busting）')
require(('vendor/classview.js?v=r%d' % ui) in app_html,
        'app.html 的 classview.js 版本号应与 UI_BUILD 一致（cache-busting）')
main_act = read(os.path.join(ROOT, 'app', 'src', 'main', 'java', 'com', 'cyberhub', 'manager', 'MainActivity.java'))
m_ep = re.search(r'getInt\("assetEpoch",0\)<(\d+)', main_act)
require(m_ep is not None and int(m_ep.group(1)) >= 6 and
        ('putInt("assetEpoch",%s)' % m_ep.group(1)) in main_act,
        'MainActivity assetEpoch 应提升到 >=6 且两处取值一致（覆盖安装后 clearCache）')
for tab in ["'概览'", "'字段'", "'方法'", "'字符串'"]:
    require(tab in app_js, 'classInfoScreen() 缺少标签 ' + tab)
require('id="cvHex"' in app_js and 'id="cvOw"' in app_js,
        'classInfoScreen() 缺少十六进制 / 打开方式出口')

# --- 5. 语法高亮 / 配色 / 编辑器模式 ---
require("class:'jvmasm'" in app_js, 'editorModeByExt 未把 .class 映射到 jvmasm')
require("if(e&&e.kind==='class')return 'jvmasm';" in app_js,
        'editorModeFor() 未对 kind=class 强制 jvmasm')
require("CodeMirror.defineMode('jvmasm'" in app_js, '缺少 jvmasm CodeMirror 模式')
require("$(\'#content\').classList.toggle(\'classEditor\',e.kind===\'class\')" in app_js,
        'renderEditor() 未给 .class 代码区加 classEditor 类')
require("$('#content').classList.remove('classEditor')" in app_js,
        'goBack() 未清理 classEditor，退出后会污染其他页面配色')
for token in ['#content.classEditor .CodeMirror', '.cm-keyword', '.cm-builtin', '.cm-meta', '.cm-type']:
    require(token in style_css, 'style.css 缺少 MT 同款配色 ' + token)
for token in ["e.kind==='class'?'CLASS'", "e.kind==='class'?'smali'"]:
    require(token in app_js, '编辑器状态栏 / 字体未适配 class：' + token)

# --- 6. 保存键只导出、不覆写 .class；离开不拦截 ---
require('async function exportClassDisasm(){' in app_js, '缺少 exportClassDisasm()')
require("if(e.kind==='class')return exportClassDisasm();" in app_js,
        'saveEditor() 未把 .class 保存改道到导出（会覆写原始字节）')
require("exportText(cm.getValue(),name)" in app_js and ".bytecode.txt" in app_js,
        'exportClassDisasm() 未导出 .bytecode.txt 文本')
require("if(state.editor.kind==='class')return true;" in app_js,
        'canLeave() 仍会拦截反汇编派生视图')
require("if(e.kind==='class')return menu([" in app_js, 'editorMenu() 缺少 class 专用菜单')
for label in ['导出反汇编文本', '类信息查看器', '十六进制查看', '打开方式…']:
    require("label:'" + label + "'" in app_js, 'class 编辑器菜单缺少「' + label + '」')
require("else if(e.kind==='class'&&e.file)await classScreen(e.file);" in app_js,
        'reloadEditor() 未支持重新反汇编')

# --- 7. 版本标记 / 关于页 / DataEngine.fileData 通道未回归 ---
m_build = re.search(r"const UI_BUILD='r(\d+)';", app_js)
require(m_build is not None and int(m_build.group(1)) >= 10, 'UI_BUILD 未更新为 r10')
require('r10 .class 打开方式对标 MT 管理器' in app_js, '关于页缺少 r10 版本说明')
require('r9 修复 .class 文件无法打开' in app_js, '关于页 r9 版本说明被误删')
data_engine = read(os.path.join(ROOT, 'app', 'src', 'main', 'java', 'com', 'cyberhub', 'manager', 'DataEngine.java'))
require('case "fileData":return ExtraTools.fileData(resolve(a));' in data_engine,
        'DataEngine.fileData 通道被破坏')
require('public static final long MAX_TEXT = 8L * 1024 * 1024;' in
        read(os.path.join(ROOT, 'app', 'src', 'main', 'java', 'com', 'cyberhub', 'manager', 'FileOps.java')),
        'FileOps.MAX_TEXT 8MB 文本上限被改动')

# --- 8. Node 真实执行反汇编器（真实 javac 产物） ---
node_check = r'''
const fs = require('fs'), cv = require(process.argv[1]);
const bytes = new Uint8Array(fs.readFileSync(process.argv[2]));
const b64 = Buffer.from(bytes).toString('base64');
const out = {};
const d = cv.disassembleBase64(b64);
out.dis = { valid:d.valid, error:d.error, lines:d.lines, methods:d.methodCount,
            instr:d.instructionCount, labels:d.labelCount, className:d.className,
            major:d.major, jdk:d.jdk, text:d.text };
const p = cv.parseBase64(b64);
out.parse = { valid:p.valid, thisClass:p.thisClass, superClass:p.superClass,
              major:p.major, fields:p.fields.length, methods:p.methods.length,
              cp:p.constantPoolCount, jdk:p.jdk, error:p.error };
out.opcodeCount = cv.opcodeCount;
const bad = cv.disassembleBytes(new Uint8Array([1,2,3,4,5,6,7,8,9,10]));
out.bad = { valid:bad.valid, error:bad.error };
// r9 最小 class（无方法）也应能反汇编出类头，且指令数为 0
function u1(v){return [v&255];}function u2(v){return [(v>>8)&255,v&255];}
function u4(v){return [(v>>24)&255,(v>>16)&255,(v>>8)&255,v&255];}
function utf8(s){const b=Buffer.from(s,'utf8');return [1].concat(u2(b.length),Array.from(b));}
const minimal = Uint8Array.from([].concat(
  u4(0xCAFEBABE),u2(0),u2(52),u2(5),utf8('Hello'),[7],u2(1),
  utf8('java/lang/Object'),[7],u2(3),u2(0x0021),u2(2),u2(4),u2(0),u2(0),u2(0),u2(0)));
const md = cv.disassemble(minimal);
out.minimal = { valid:md.valid, instr:md.instructionCount, text:md.text, error:md.error };
process.stdout.write(JSON.stringify(out));
'''
try:
    r = subprocess.run(['node', '-e', node_check, CLASSVIEW, FIXTURE],
                       capture_output=True, text=True, timeout=45)
    require(r.returncode == 0, 'node 动态执行反汇编失败：' + r.stderr.strip()[:300])
    got = json.loads(r.stdout) if r.returncode == 0 else {}
except Exception as e:  # noqa: BLE001
    require(False, 'node 动态执行异常：' + str(e))
    got = {}

d = got.get('dis', {})
text = str(d.get('text', ''))
require(d.get('valid') is True, '真实 .class 反汇编失败：' + str(d.get('error')))
require(d.get('methods') >= 4, '方法数异常：%s' % d.get('methods'))
require(d.get('instr', 0) >= 80, '指令数异常：%s' % d.get('instr'))
require(d.get('labels', 0) >= 8, '跳转标签数异常：%s' % d.get('labels'))
require(d.get('className') == 'demo.Sample', '类名错误：%s' % d.get('className'))
require(d.get('major') == 52, 'major 版本错误：%s' % d.get('major'))
require(d.get('lines', 0) >= 100, '反汇编文本行数异常：%s' % d.get('lines'))
for token in ['package demo;', 'public super class Sample version 52:0',
              'private Field value:"I"', 'Method "<init>":"(I)V"',
              'stack 2 locals 2', 'aLoad_0', 'invokespecial',
              'Method java/lang/Object."<init>":"()V";',
              'Field demo/Sample.value:"I";', 'putfield', 'return',
              'lookupswitch', 'default L2d', 'L24:', 'L2a:',
              'if_icmpge', 'L5e', 'newarray', 'byte', 'areturn',
              'throws java.lang.Exception', 'Class java/lang/Exception',
              'Method decode_B:"([Ljava/lang/String;)[B"']:
    require(token in text, '反汇编文本缺少 MT 同款元素：' + token)
require('} // end Class demo/Sample' in text and '// SourceFile' not in text,
        'r12: 反汇编正文应有 MT 类体收尾，且不混入 // 元信息注释')
require('  SourceFile' in text and 'version 52:0' in text,
        'r12: 类属性块与 major:minor 版本格式应对齐 MT')
require('classInfoScreen' not in text and '概览' not in text,
        '反汇编正文不应再是 r9 的四标签表格内容')

p = got.get('parse', {})
require(p.get('valid') is True, 'r9 parseBase64 回归：' + str(p.get('error')))
require(p.get('thisClass') == 'demo.Sample', 'r9 parseBase64 类名错误')
require('Java 8' in str(p.get('jdk', '')), 'r9 parseBase64 JDK 映射错误')
require(got.get('opcodeCount', 0) >= 200, 'jvmasm 操作码表不完整：%s' % got.get('opcodeCount'))
require(got.get('bad', {}).get('valid') is False and 'CAFEBABE' in str(got.get('bad', {}).get('error', '')),
        '损坏文件应优雅失败并提示魔数')
md = got.get('minimal', {})
require(md.get('valid') is True, '无方法的最小 class 反汇编失败：' + str(md.get('error')))
require(md.get('instr') == 0 and 'public super class Hello version 52:0' in str(md.get('text', '')),
        '最小 class 应输出 MT 类头（含简单类名与 major:minor）、指令数为 0')

if errors:
    print('FAIL: r10 .class 反汇编编辑器自检未通过')
    for e in errors:
        print('  -', e)
    sys.exit(1)
print('PASS: r12 .class 反汇编编辑器自检全部通过（MT 类头对齐 / 分发 / 反汇编 / 语法高亮 / 配色 / 只导出不覆写 / r9 回归 / fileData 通道 / 缓存根治）')
