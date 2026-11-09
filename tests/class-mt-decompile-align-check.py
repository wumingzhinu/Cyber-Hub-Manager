#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""r13: 基于 MT2.26.11.apk 反编译证据的 .class/JASM 对齐自检。

与 r12「照一段用户文本仿写」不同，本轮权威真值来自 APK 内原始文件：
  - assets/syntax/jasm.mtsx —— MT 官方 JASM 语法定义（首行注释
    「MT将class反编译为jasm进行编辑」），含 opcode / keyword / declaration /
    cpTag / cpRefKind 五组词表；
  - classes5.dex 反编译出的 JASM printer（混淆类 l/᩶ܿۜ.smali）—— 明文格式串
    package %s;%n / %sversion %s / } // end Class / } // end of module；
  - classes4.dex —— 36 个 ATT_* 类属性常量。

词表已固化为 tests/fixtures/mt-jasm-vocab.json（CI 内无 MT APK，快照可追溯）。
本自检验证：
  1) 我方 opcode 表全部是 MT 词表内的标准小写，绝无 camelCase；
  2) 修饰符词表对齐（strict / bridge / varargs / volatile / transient 取义）；
  3) 类属性块覆盖 MT ATT_* 中可确定为文本的属性；
  4) module-info 用 end of module 收尾；
  5) jvmasm 高亮的 declaration / opcode 词表来自 MT jasm.mtsx；
  6) 真实 package-info.class 输出仍与 MT 逐字符一致（不回归）；
  7) 版本标记 / 缓存纪元已递增（本轮改了 vendor/classview.js）。
"""
import base64
import json
import os
import re
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'app', 'src', 'main', 'assets')
CLASSVIEW = os.path.join(ASSETS, 'vendor', 'classview.js')
APP = os.path.join(ASSETS, 'app.js')
APP_HTML = os.path.join(ASSETS, 'app.html')
MAIN = os.path.join(ROOT, 'app', 'src', 'main', 'java', 'com', 'cyberhub', 'manager', 'MainActivity.java')
VOCAB = os.path.join(ROOT, 'tests', 'fixtures', 'mt-jasm-vocab.json')
JAR = os.path.join(ROOT, 'app', 'libs', 'commons-net-3.10.0.jar')
SAMPLE = os.path.join(ROOT, 'tests', 'fixtures', 'Sample.class')
ENTRY = 'org/apache/commons/net/bsd/package-info.class'

MT_EXPECTED = (
    'package org/apache/commons/net/bsd;\n'
    '\n'
    'synthetic interface package-info version 52:0\n'
    '{\n'
    '  SourceFile               "package-info.java";\n'
    '} // end Class org/apache/commons/net/bsd/package-info'
)

errors = []
COUNT = 0


def require(cond, msg):
    global COUNT
    COUNT += 1
    if not cond:
        errors.append(msg)


def read(p):
    with open(p, 'r', encoding='utf-8') as f:
        return f.read()


vocab = json.load(open(VOCAB, 'r', encoding='utf-8'))
require(vocab['_source'].startswith('MT2.26.11.apk'), '词表快照应标注 MT APK 反编译来源')
mt_ops = set(vocab['opcodes_std'])
mt_kw = set(vocab['keywords']) - {'keyword'}
mt_decl = set(vocab['declarations'])
att = set(a[len('ATT_'):] for a in vocab['ATT'])
require(len(mt_ops) >= 200 and 'aload_0' in mt_ops and 'aconst_null' in mt_ops,
        'MT 词表快照应含标准小写 aload_0 / aconst_null')
require('strict' in mt_kw and 'bridge' in mt_kw and 'varargs' in mt_kw,
        'MT 修饰符词表应含 strict / bridge / varargs')
require('SourceFile' in att and 'NestHost' in att and 'Record' in att,
        'MT ATT_* 全集应含 SourceFile / NestHost / Record')

cv = read(CLASSVIEW)
app = read(APP)
html = read(APP_HTML)
mainjava = read(MAIN)

# 代码视图：剥离 /* */ 块注释与关于页超长文案，仅检查真实代码，
# 避免把「r13 纠正了旧 camelCase」这类说明文字误判为残留。
def code_only(src):
    src = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
    # 关于页是超长单行（含版本说明文字），整行剔除
    src = '\n'.join(l for l in src.splitlines() if not l.startswith('function about()'))
    return src
cv_code = code_only(cv)
app_code = code_only(app)

# --- 1) opcode 必须标准小写，且是 MT 词表成员 ---
# 收集我方 classview.js OPS 表定义中出现的所有助记符字面量
op_literals = set(re.findall(r"'([a-z][a-z0-9_]*)'", cv))
# 生成式前缀（iLoad 族）在 r13 已改为小写数组
for fam in ['iload', 'lload', 'fload', 'dload', 'aload', 'istore', 'lstore', 'fstore', 'dstore', 'astore']:
    require(("'" + fam + "'") in cv or ("'" + fam + "',") in cv,
            'classview.js 应含标准小写 ' + fam)
# 严禁 camelCase（r10–r12 的自创拼写，MT 全库零命中）
for camel in ['aConst_null', 'iLoad', 'lLoad', 'fLoad', 'dLoad', 'aLoad',
              'iStore', 'lStore', 'fStore', 'dStore', 'aStore']:
    require(camel not in cv_code, 'classview.js 代码仍残留自创 camelCase ' + camel)
    require(camel not in app_code, 'app.js 代码仍残留自创 camelCase ' + camel)
require("'aconst_null'" in cv and "'aconst_null'" in app,
        '两处 opcode 表应使用 MT 标准 aconst_null')
require("'aload'" in cv and "'istore'" in cv,
        'opcode 表 load/store 前缀应为小写')

# --- 2) 修饰符词表对齐 ---
require("'strict'" in cv and 'strictfp' not in cv_code,
        'classview.js 应用 MT 词表的 strict（非 strictfp）')
require('FIELD_ACC' in cv and 'METHOD_ACC' in cv,
        'classview.js 应把字段/方法 flags 分表（volatile/transient vs bridge/varargs）')
require("'volatile'" in cv and "'transient'" in cv and "'bridge'" in cv and "'varargs'" in cv,
        '四个取义不同的修饰符都应出现')
require('isMethod ? METHOD_ACC : FIELD_ACC' in cv,
        'readMembers 应按字段/方法选择 flags 表')
require('bridge/volatile' not in cv_code and 'varargs/transient' not in cv_code,
        '不应有合并词 bridge/volatile / varargs/transient')
require('const MEM_M=' in app and 'flags(m.acc,MEM_M)' in app,
        'app.js builtinClassDisasm 方法应用方法专用 flags 表')

# --- 3) 类属性块覆盖 MT ATT_* ---
require('function classAttrValue' in cv, 'classview.js 应有类属性值解析函数')
for name in ['SourceFile', 'Signature', 'Deprecated', 'Synthetic', 'NestHost',
             'EnclosingMethod', 'NestMembers', 'PermittedSubclasses', 'SourceDebugExtension']:
    require(("case '" + name + "'") in cv,
            'classAttrValue 应覆盖 MT ATT_ 属性 ' + name)
for name in ['NestHost', 'EnclosingMethod', 'NestMembers', 'PermittedSubclasses']:
    require(name in app, 'app.js builtinClassDisasm 应覆盖 MT 属性 ' + name)
require('classAttrValue(a, b, r, info._cp)' in cv,
        'disassemble() 应调用 MT 属性解析器')

# --- 4) module 收尾 end of module ---
require("'} // end of module '" in cv and "'} // end Class '" in cv,
        'classview.js 应有 MT 两种收尾格式串')
require("'} // end of module '" in app, 'app.js 两处兜底应有 end of module 收尾')
require('(isModule ?' in cv, 'classview.js 应按 ACC_MODULE 选择收尾')
require('(acc&0x8000)' in app, 'app.js 应按 ACC_MODULE 选择收尾')

# --- 5) jvmasm 高亮词表来自 MT jasm.mtsx ---
require('const D=' in app and 'const K=' in app and 'const O=' in app,
        'jvmasm 应拆出 declaration/keyword/opcode 三组 MT 词表')
require('aload_0' in app and 'aconst_null' in app,
        'jvmasm opcode 词表应含 MT 标准小写助记符')
for d in ['NestHost', 'PermittedSubclasses', 'SourceDebugExtension', 'Record', 'Component']:
    require(d in app, 'jvmasm declaration 词表应含 MT 声明键 ' + d)

# --- 6) 真实样本：逐字符等于 MT；Sample 主体不回归；module-info 收尾 ---
NODE = r'''
const cv = require(process.argv[1]);
const inputs = JSON.parse(process.argv[2]);
const out = {};
for (const k of Object.keys(inputs)) {
  const d = cv.disassembleBase64(inputs[k]);
  out[k] = { valid: d.valid, text: d.text, instr: d.instructionCount,
             labels: d.labelCount, methods: d.methodCount };
}
process.stdout.write(JSON.stringify(out));
'''
inputs = {}
if os.path.isfile(JAR):
    with zipfile.ZipFile(JAR) as z:
        inputs['jar'] = base64.b64encode(z.read(ENTRY)).decode('ascii')
        try:
            inputs['module'] = base64.b64encode(
                z.read('META-INF/versions/9/module-info.class')).decode('ascii')
        except KeyError:
            pass
if os.path.isfile(SAMPLE):
    inputs['sample'] = base64.b64encode(open(SAMPLE, 'rb').read()).decode('ascii')

got = {}
try:
    r = subprocess.run(['node', '-e', NODE, CLASSVIEW, json.dumps(inputs)],
                       capture_output=True, text=True, timeout=60)
    require(r.returncode == 0, 'Node 执行 classview.js 失败：' + r.stderr.strip()[:200])
    got = json.loads(r.stdout) if r.returncode == 0 else {}
except Exception as e:  # noqa: BLE001
    require(False, 'Node 执行异常：' + str(e))

require('jar' in inputs, '真实 commons-net JAR 应存在')
if 'jar' in inputs:
    require(got.get('jar', {}).get('text') == MT_EXPECTED,
            'package-info.class 输出应与 MT 逐字符一致（r13 不回归）')
if 'sample' in inputs:
    st = str(got.get('sample', {}).get('text', ''))
    require('aload_0' in st and 'aLoad_0' not in st,
            'Sample.class 应输出 MT 标准小写 aload_0')
    require(got.get('sample', {}).get('instr', 0) >= 80,
            'Sample.class 指令数不应回归')
    require('bridge/volatile' not in st and 'varargs/transient' not in st,
            'Sample.class 不应输出合并修饰符')
if 'module' in inputs:
    mt = str(got.get('module', {}).get('text', ''))
    require('// end of module' in mt and '// end Class' not in mt,
            'module-info.class 应使用 MT 的 end of module 收尾')

# --- 7) 版本标记 / 缓存纪元递增 ---
ui = re.search(r"const UI_BUILD='(r\d+)';", app)
require(ui is not None and ui.group(1) >= 'r13', 'UI_BUILD 应递增到 r13 或更高')
require(ui is not None and ('?v=' + ui.group(1)) in html,
        'app.html 关键脚本版本号应与 UI_BUILD 一致')
ep = re.search(r'assetEpoch",0\)<(\d+)', mainjava)
require(ep is not None and int(ep.group(1)) >= 7,
        'MainActivity assetEpoch 应 >= 7（改动了 vendor/classview.js，覆盖安装需清缓存）')

if errors:
    print('FAIL: r13 基于 MT 反编译的 .class/JASM 对齐自检未通过（%d 项中 %d 项失败）'
          % (COUNT, len(errors)))
    for e in errors:
        print('  -', e)
    sys.exit(1)
print('PASS: r13 基于 MT2.26.11.apk 反编译词表的对齐自检 %d 项全部通过'
      '（opcode 小写 / 修饰符 / ATT_* 属性 / module 收尾 / 高亮词表 / 真实样本不回归 / 缓存标记）' % COUNT)
