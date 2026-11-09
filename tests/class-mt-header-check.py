#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""r13: .class 反汇编文本与 MT / JASM 语法逐行对齐自检。

对照样本：commons-net-3.10.0.jar 内
org/apache/commons/net/bsd/package-info.class（javap 确认为
ACC_INTERFACE|ACC_ABSTRACT|ACC_SYNTHETIC、major 52、0 字段 0 方法、
仅 SourceFile 属性）。以用户提供的 MT 管理器输出作为唯一权威期望值。

验证：
  1) 合成样本与真实 JAR 内样本两条输入，classview.js 输出逐字符等于 MT；
  2) 有字段/方法的 Sample.class 主体（指令 / 标签 / 引用注释）不回归；
  3) app.js 的 builtinClassDisasm / classStructText 与 classview.js 共用同一语法；
  4) 版本标记（UI_BUILD / ?v= / assetEpoch）已递增，覆盖安装不会命中旧缓存。
"""
import base64
import json
import os
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'app', 'src', 'main', 'assets')
CLASSVIEW = os.path.join(ASSETS, 'vendor', 'classview.js')
APP = os.path.join(ASSETS, 'app.js')
APP_HTML = os.path.join(ASSETS, 'app.html')
MAIN = os.path.join(ROOT, 'app', 'src', 'main', 'java', 'com',
                    'cyberhub', 'manager', 'MainActivity.java')
JAR = os.path.join(ROOT, 'app', 'libs', 'commons-net-3.10.0.jar')
SAMPLE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                      'fixtures', 'Sample.class')
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


# --- 合成一个与真实样本等价的最小 class（不依赖外部 JAR） ---
def u1(v):
    return bytes([v & 255])


def u2(v):
    return bytes([(v >> 8) & 255, v & 255])


def u4(v):
    return bytes([(v >> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255])


def utf8(s):
    b = s.encode('utf-8')
    return u1(1) + u2(len(b)) + b


def make_pkginfo():
    # 常量池: 1=Utf8(this) 2=Class#1 3=Utf8(super) 4=Class#3
    #         5=Utf8("package-info.java") 6=Utf8("SourceFile")
    cp = [utf8('org/apache/commons/net/bsd/package-info'), u1(7) + u2(1),
          utf8('java/lang/Object'), u1(7) + u2(3),
          utf8('package-info.java'), utf8('SourceFile')]
    return (u4(0xCAFEBABE) + u2(0) + u2(52) + u2(len(cp) + 1) + b''.join(cp) +
            u2(0x1600) + u2(2) + u2(4) +      # ACC_INTERFACE|ABSTRACT|SYNTHETIC
            u2(0) +                           # interfaces_count
            u2(0) + u2(0) +                   # fields / methods
            u2(1) + u2(6) + u4(2) + u2(5))   # SourceFile attr


NODE = r'''
const cv = require(process.argv[1]);
const inputs = JSON.parse(process.argv[2]);
const out = {};
for (const k of Object.keys(inputs)) {
  const d = cv.disassembleBase64(inputs[k]);
  out[k] = { valid: d.valid, text: d.text, instr: d.instructionCount,
             labels: d.labelCount, methods: d.methodCount, error: d.error };
}
const p = cv.parseBase64(inputs.synth);
out.parse = { sourceFile: p.sourceFile, attrs: p.attributes.map(a => a.name),
              valid: p.valid, major: p.major, access: p.access };
process.stdout.write(JSON.stringify(out));
'''

inputs = {'synth': base64.b64encode(make_pkginfo()).decode('ascii')}
if os.path.isfile(JAR):
    try:
        with zipfile.ZipFile(JAR) as z:
            inputs['jar'] = base64.b64encode(z.read(ENTRY)).decode('ascii')
    except Exception as e:  # noqa: BLE001
        require(False, '读取真实 package-info.class 失败：' + str(e))
if os.path.isfile(SAMPLE):
    with open(SAMPLE, 'rb') as f:
        inputs['sample'] = base64.b64encode(f.read()).decode('ascii')

try:
    r = subprocess.run(['node', '-e', NODE, CLASSVIEW, json.dumps(inputs)],
                       capture_output=True, text=True, timeout=45)
    require(r.returncode == 0, 'Node 执行 classview.js 失败：' + r.stderr.strip()[:300])
    got = json.loads(r.stdout) if r.returncode == 0 else {}
except Exception as e:  # noqa: BLE001
    require(False, 'Node 执行异常：' + str(e))
    got = {}

# --- 1) 两类输入都必须逐字符等于 MT 输出 ---
require('jar' in inputs, '真实 commons-net JAR 样本应存在')
for key in ('synth', 'jar'):
    if key not in inputs:
        continue
    d = got.get(key, {})
    require(d.get('valid') is True,
            '%s: 反汇编失败 %s' % (key, d.get('error')))
    require(d.get('text') == MT_EXPECTED,
            '%s: 输出与 MT 管理器不一致，实际为：\n%s' % (key, d.get('text')))

p = got.get('parse', {})
require(p.get('valid') is True, 'parse() 解析合成样本失败')
require(p.get('sourceFile') == 'package-info.java',
        'parse() 应解析出 SourceFile 供属性块渲染')
require(p.get('attrs') == ['SourceFile'],
        'parse() 应记录类属性名与数据偏移')
require(p.get('access') == 0x1600, 'access flags 应为 0x1600')
require(p.get('major') == 52, 'major 应为 52')

# --- 2) 主体不回归 ---
s = got.get('sample', {})
require(s.get('valid') is True, 'Sample.class 反汇编失败')
require(s.get('instr', 0) >= 80 and s.get('labels', 0) >= 8,
        'Sample.class 指令/标签主体回归：instr=%s labels=%s'
        % (s.get('instr'), s.get('labels')))
st = str(s.get('text', ''))
for t in ['package demo;', 'public super class Sample version 52:0', '{',
          '  SourceFile               "Sample.java";', 'private Field value:"I"',
          'stack 2 locals 2', 'aload_0', 'lookupswitch', 'L24:',
          '} // end Class demo/Sample']:
    require(t in st, 'Sample.class 缺少 MT 同款元素：' + t)
require('version 52.0' not in st and 'interface abstract class' not in st,
        'Sample.class 不应残留 r11 旧类头语法')

# --- 3) 静态约束：三处反汇编器共用同一套语法 ---
app_js = read(APP)
cv_js = read(CLASSVIEW)
import re as _re
_ui = _re.search(r"const UI_BUILD='(r\d+)';", app_js)
require(_ui is not None and _ui.group(1) >= 'r13', 'UI_BUILD 应递增到 r13 或更高')
require("' version '+u2(6)+':'+u2(4)" in app_js,
        'builtinClassDisasm 应使用 major:minor 版本格式')
require("' version '+info.major+':'+info.minor" in app_js,
        'classStructText 应使用 major:minor 版本格式')
require(app_js.count("?'} // end of module ':'} // end Class '") >= 2,
        'builtinClassDisasm / classStructText 都应有 MT 收尾（含 module 分支）')
require(app_js.count("out.push('{');") == 2, '两处兜底都应有 { } 类体')
require('const clsAttrs=[];' in app_js, 'builtinClassDisasm 应解析类级属性')
require("'} // end of module ' : '} // end Class '" in cv_js,
        'classview.js 应有 MT 收尾注释（含 module 分支）')
require("' version ' + info.major + ':' + info.minor" in cv_js,
        'classview.js 应使用 major:minor 版本格式')
require('offset: pos' in cv_js, 'classview.js parse() 应记录属性数据偏移')
require("if (isIface) skip['abstract'] = 1" in cv_js,
        'classview.js 不应重复输出 interface 隐含的 abstract')
require("if(isIface)skip.abstract=1" in app_js,
        'app.js 两处兜底不应重复输出 abstract')

# --- 4) 缓存标记必须递增（本轮改了 vendor/classview.js） ---
require(_ui is not None and ('?v='+_ui.group(1)) in read(APP_HTML),
        'app.html 关键脚本版本号应与 UI_BUILD 一致')
main_java = read(MAIN)
_ep = _re.search(r'assetEpoch",0\)<(\d+)', main_java)
require(_ep is not None and int(_ep.group(1)) >= 7,
        'MainActivity assetEpoch 应 >= 7（本轮改了 vendor/classview.js，覆盖安装需清缓存）')

if errors:
    print('FAIL: r13 MT/JASM 对齐自检未通过（%d 项中 %d 项失败）' % (COUNT, len(errors)))
    for e in errors:
        print('  -', e)
    sys.exit(1)
print('PASS: r13 .class 反汇编与 MT/JASM 语法逐行对齐自检 %d 项全部通过'
      '（真实 JAR 样本 / 合成样本 / 主体不回归 / 三级语法一致 / 缓存标记）' % COUNT)
