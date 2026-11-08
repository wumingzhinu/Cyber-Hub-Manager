#!/usr/bin/env python3
"""启动直达自检：WebView 首屏必须就是文件管理器，不得再退回启动提示页。

背景（r6）：app.html 原先在 <section id="content"> 里写死一整页
「正在打开您的工作区… / 文件管理器正在加载。/ 重试」的 .bootStatus，
init() 要等原生 rpc('init') 返回后才 renderFiles() 替换成双窗格管理器，
因此每次启动都先看到那张提示页（慢或失败时还得点「重试」）。

现改为：静态 HTML 首屏直接给出 .filepanes 双窗格骨架，app.js 的 init()
在第一个 await 之前同步调用 renderBootFrame() 补齐工具栏/底栏，目录数据
随后异步回填；仅当脚本真正崩溃或启动超时，boot.js 的 report() 才显示
带「重试」的错误兜底页。此脚本把这些约束固定下来防回归。
"""
import re
import sys
from pathlib import Path

P = Path(__file__).resolve().parents[1]
ASSETS = P / 'app/src/main/assets'
html = (ASSETS / 'app.html').read_text(encoding='utf-8')
app_js = (ASSETS / 'app.js').read_text(encoding='utf-8')
boot_js = (ASSETS / 'boot.js').read_text(encoding='utf-8')

errors = []

# 1. 静态首屏必须是双窗格文件管理器骨架
if 'class="filepanes"' not in html:
    errors.append('app.html 首屏缺少 .filepanes 双窗格容器')
if html.count('aria-label="左侧文件窗格"') != 1 or html.count('aria-label="右侧文件窗格"') != 1:
    errors.append('app.html 首屏应各有且仅有一个左右文件窗格')

# 2. 不得再出现整页启动提示与静态「重试」按钮
for banned in ('正在打开您的工作区', '文件管理器正在加载', 'id="bootRetry"',
               'class="bootStatus"'):
    if banned in html:
        errors.append(f'app.html 首屏仍含已废弃的启动提示元素：{banned}')

# 3. init() 必须在任何 await 之前同步渲染管理器骨架
m = re.search(r'^async function init\(\)\{(.*)$', app_js, re.M)
if not m:
    errors.append('app.js 未找到 init() 定义')
else:
    body = m.group(1)
    first = body.find('renderBootFrame()')
    first_await = body.find('await ')
    if first < 0:
        errors.append('init() 未调用 renderBootFrame()，首屏不会立即补齐工具栏/底栏')
    elif first_await >= 0 and first > first_await:
        errors.append('renderBootFrame() 必须在第一个 await 之前调用，否则又会退回启动提示页')
if 'function renderBootFrame()' not in app_js:
    errors.append('app.js 缺少 renderBootFrame() 定义')
if "header('赛博中枢管家','文件管理器'" not in app_js:
    errors.append('renderBootFrame() 未渲染文件管理器标题')
if 'renderFileBottom()' not in app_js:
    errors.append('renderBootFrame() 未渲染底栏')

# 4. 错误兜底必须保留：report() 仍能整页重建并生成「重试」按钮
for token in ('function report(', "element('button', '重试')", 'window.location.reload()'):
    if token not in boot_js:
        errors.append(f'boot.js 的错误兜底被破坏，缺少 {token}')
if 'CyberBoot.ready' not in app_js:
    errors.append('app.js 未在数据就绪后调用 CyberBoot.ready()')

# 5. 首屏占位文案应是轻量的「正在读取文件…」，不是「正在启动」
if '正在启动…' in html:
    errors.append('app.html 工具栏不应再显示「正在启动…」')

if errors:
    print('FAIL: 启动直达自检未通过')
    for e in errors:
        print(' -', e)
    sys.exit(1)
print('PASS: 启动直达自检 12 项全部通过（首屏双窗格 / 无提示页 / 同步渲染 / 错误兜底 / 占位文案）')
