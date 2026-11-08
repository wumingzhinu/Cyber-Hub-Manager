#!/usr/bin/env python3
"""Shizuku 集成自检：manifest 的 ShizukuProvider 与客户端声明必须齐全。

背景（0.1.54 根因修复）：本项目用 aapt2 直接打包，无 Gradle manifest merger，
manifest 里的 ${applicationId} 占位符不会被替换。Shizuku 客户端运行时按
content://<packageName>.shizuku 查找 provider 拿 binder——若 authorities 是
字面量 ${applicationId}.shizuku，则 binder 永远无法送达，Shizuku 全部检测失败，
设备上表现为「服务明明在运行，应用却一直显示 Shizuku 未运行」。

背景（r5 根因修复，对照 MT 管理器 2.26.11）：Shizuku 服务端
server/src/main/java/rikka/shizuku/server/BinderSender.java 的 sendBinder() 只读取
PackageInfo.requestedPermissions（GET_PERMISSIONS），仅当应用声明了
moe.shizuku.manager.permission.API_V23 时才调用 sendBinderToUserApp，否则直接
continue。本项目没有 Gradle manifest merger，官方 provider AAR 本该自动注入的
<uses-permission> 与 V3_SUPPORT 元数据从未进入 manifest，导致服务端根本不推送
binder：shizukuInstalled=true、providerRegistered=true，但 pingBinder() 恒 false、
shizukuVersion=-1、newProcess 抛 IllegalStateException（真机提权诊断截图的症状）。
"""
import re, sys, xml.etree.ElementTree as ET
from pathlib import Path

P = Path(__file__).resolve().parents[1]
MANIFEST = P / 'app/src/main/AndroidManifest.xml'
PKG = 'com.cyberhub.manager'

text = MANIFEST.read_text(encoding='utf-8')
errors = []

# 1. 任何地方都不允许出现未替换的占位符
for m in re.finditer(r'\$\{[^}]*\}', text):
    errors.append(f'未替换的构建占位符: {m.group(0)}')

root = ET.fromstring(text)
ns = {'android': 'http://schemas.android.com/apk/res/android'}
providers = [p for p in root.iter('provider')
             if p.get('{%s}name' % ns['android']) == 'rikka.shizuku.ShizukuProvider']
if not providers:
    errors.append('未找到 rikka.shizuku.ShizukuProvider 声明')
else:
    p = providers[0]
    a = lambda k: p.get('{%s}%s' % (ns['android'], k))
    if a('authorities') != f'{PKG}.shizuku':
        errors.append(f"authorities 应为 {PKG}.shizuku，实际为 {a('authorities')!r}")
    if a('exported') != 'true':
        errors.append('exported 必须为 true（ShizukuProvider.attachInfo 强制要求）')
    if a('multiprocess') != 'false':
        errors.append('multiprocess 必须为 false（ShizukuProvider.attachInfo 强制要求）')
    if a('enabled') in (None, 'false'):
        errors.append('enabled 必须为 true')
    if a('process') is not None:
        errors.append(
            "禁止设置 android:process（当前 %r）——官方模板不使用独立进程：provider 必须运行在主进程，"
            "Shizuku 服务端把 binder 经 call('sendBinder') 推送到 provider 所在进程；若 provider 在 :shizuku "
            "独立进程，binder 只会送进该进程，主进程（Shizuku 类的静态 binder 字段所在处）永远收不到，"
            "pingBinder() 恒为 false（0.1.54 的实际故障）" % a('process'))
    if a('permission') != 'android.permission.INTERACT_ACROSS_USERS_FULL':
        errors.append('permission 应为 android.permission.INTERACT_ACROSS_USERS_FULL')

# 2. queries 声明（可见性）
if 'moe.shizuku.privileged.api' not in text:
    errors.append('缺少 <queries> 声明 moe.shizuku.privileged.api')

# 2.5 r5 根因：Shizuku 服务端筛选客户端所要求的 API_V23 权限（必须是真实元素，不能只在注释里）
uses = [p.get('{%s}name' % ns['android']) for p in root.iter('uses-permission')]
if 'moe.shizuku.manager.permission.API_V23' not in uses:
    errors.append(
        '缺少 <uses-permission android:name="moe.shizuku.manager.permission.API_V23" />：'
        'Shizuku 服务端 BinderSender.sendBinder() 只向声明了该权限的应用推送 binder，'
        '缺了它 pingBinder() 恒为 false（0.1.59 r5 的实际故障，对照 MT 2.26.11）')

# 2.6 v3 客户端标记：Shizuku Manager 据此把应用列入「应用管理」授权列表
app = root.find('application')
metas = {}
if app is not None:
    for m in app.iter('meta-data'):
        metas[m.get('{%s}name' % ns['android'])] = m.get('{%s}value' % ns['android'])
if metas.get('moe.shizuku.client.V3_SUPPORT') not in ('true', '1', '0x1'):
    errors.append(
        'application 内缺少 <meta-data android:name="moe.shizuku.client.V3_SUPPORT" '
        'android:value="true" />（MT 2.26.11 同样声明）')

# 3. 四个 Shizuku 构件必须都在 libs
libs = P / 'app/libs'
for jar in ('shizuku-api-13.1.5.jar', 'shizuku-provider-13.1.5.jar',
            'shizuku-aidl-13.1.5.jar', 'shizuku-shared-13.1.5.jar'):
    if not (libs / jar).exists():
        errors.append(f'缺少构件 {jar}（会导致 NoClassDefFoundError）')

# 4. ElevatedAccess 必须包含 provider 注册检测与 binder 等待重试
src = (P / 'app/src/main/java/com/cyberhub/manager/ElevatedAccess.java').read_text(encoding='utf-8')
for token in ('shizukuProviderRegistered', 'shizukuRunningWait', '"shizukuProviderRegistered"',
              'apiV23Declared', '"apiV23Declared"', 'v3SupportDeclared', '"v3SupportDeclared"',
              '"binderSeen"', 'addBinderReceivedListenerSticky',
              'moe.shizuku.manager.permission.API_V23'):
    if token not in src:
        errors.append(f'ElevatedAccess.java 缺少 {token}')

if errors:
    print('FAIL')
    for e in errors:
        print(' -', e)
    sys.exit(1)
print('PASS: Shizuku 集成自检通过（占位符 / authorities / provider 属性 / queries / '
      'API_V23 权限 / V3_SUPPORT 元数据 / 四个构件 / 运行时自检与 binder 监听）')
