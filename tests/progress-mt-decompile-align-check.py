#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""r15：基于 MT2.26.11.apk 反编译还原的进度对话框对齐自检。

证据来源（tests/fixtures/mt-progress-spec.json + mtre/MT_PROGRESS_RULES.md）：
  - ARSCLib 导出 resources.arsc：3423 个 string 条目 / 36259 个值；
  - assets/strings*.mtl：11 语言 × 16 key（{dual_progress_dialog_total} → 总进度）；
  - baksmali 反编译 classes.dex：ProgressDialog / DualProgressDialog /
    BaseCancelableDialog / PluginProgressBar$Style / UIUpdater 的真实 smali；
  - 真机截图 142333.jpg：灰卡片 / 标题 / 处理中… / 蓝色水平条 / 无百分比 / 无按钮。

校验我方实现是否逐项对齐这些真实规格，而不是照截图仿写。
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = os.path.join(ROOT, 'app', 'src', 'main')
ASSETS = os.path.join(A, 'assets')
JAVA = os.path.join(A, 'java', 'com', 'cyberhub', 'manager')
CI = os.path.join(ROOT, '.github', 'workflows', 'build-apk.yml')


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


spec = json.loads(read(os.path.join(ROOT, 'tests', 'fixtures', 'mt-progress-spec.json')))
js = read(os.path.join(ASSETS, 'app.js'))
html = read(os.path.join(ASSETS, 'app.html'))
css = read(os.path.join(ASSETS, 'style.css'))
bus = read(os.path.join(JAVA, 'ProgressBus.java'))
main = read(os.path.join(JAVA, 'MainActivity.java'))
ci = read(CI)

# 剥离注释与关于页超长版本说明，只检查真实代码（避免历史说明里的旧文案误判）
def code_only(src):
    src = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
    return '\n'.join(l for l in src.splitlines() if "alertBox('版本 0.1.59'" not in l)


jsc = code_only(js)

fails = []
count = 0


def ck(cond, msg):
    global count
    count += 1
    if not cond:
        fails.append(msg)


# --- 1) 反编译证据快照本身 -----------------------------------------------
ck('MT2.26.11.apk' in spec['_source'], 'fixture 来源应指向 MT2.26.11.apk')
ev = spec['_evidence']
ck(ev['arsc_string_entries'] == 3423 and ev['arsc_string_values'] == 36259,
   'arsc 证据应为 3423 条目 / 36259 值')
ck(ev['mtl_locales'] == 11 and ev['mtl_keys_per_locale'] == 16, 'mtl 应为 11 语言 × 16 key')
ck(ev['dex_contains_chinese'] is False, 'dex 应无中文硬编码（文案在 arsc）')
ck(ev['resource_names_obfuscated_to'] == 'MT_Protector', '资源名应记录被 MT_Protector 混淆')
for c in ('ProgressDialog', 'DualProgressDialog', 'BaseCancelableDialog',
          'PluginProgressBar$Style', 'UIUpdater'):
    ck(c in ev['smali_classes'], 'smali 证据缺类 ' + c)

# --- 2) arsc 主文案：MT_MSG 逐项对齐 --------------------------------------
arsc = spec['arsc']
ck(len(arsc) == 13, 'arsc 主文案应为 13 条')
msg_map = {
    'processing': 'processing', 'loading': 'loading', 'preparing': 'preparing',
    'reloading': 'reloading', 'canceling': 'canceling', 'canceled': 'canceled',
    'pressAgain': 'press_again', 'total': 'total', 'oom': 'oom',
}
ck('const MT_MSG={' in jsc, 'app.js 缺 MT_MSG 状态文案机')
for js_key, arsc_key in msg_map.items():
    zh = arsc[arsc_key]['zh']
    ck((js_key + ":'" + zh + "'") in jsc,
       'MT_MSG.%s 应等于 arsc「%s」（%s）' % (js_key, zh, arsc[arsc_key]['id']))
# 功能专属「正在 XXX…」文案必须来自 arsc，不能是英文三点的自编模板
ck('MT_MSG.processing' in jsc and "(action&&TASK_STAGE[action])||MT_MSG.processing" in jsc,
   '打开时的默认文案应取 arsc 的 处理中…')
ck("处理中..." not in jsc, '代码里不应残留 r14 自编的英文三点「处理中...」')
ck('processing:' in jsc and "'处理中…'" in jsc, '应含 arsc 省略号文案 处理中…')

# --- 3) TASK_STAGE：功能专属文案全部命中 arsc 真实取值 ----------------------
ck('const TASK_STAGE={' in jsc, 'app.js 缺 TASK_STAGE 功能专属进行中文案')
zh_msgs = spec['task_messages_zh']
stage_vals = re.findall(r"'(正在[^']*…)'", jsc.split('const TASK_STAGE={', 1)[1].split('};', 1)[0])
ck(len(stage_vals) >= 15, 'TASK_STAGE 应至少覆盖 15 个功能专属进行中文案')
for v in stage_vals:
    ck(v in zh_msgs, 'TASK_STAGE 文案「%s」不在 arsc 简体功能专属文案集' % v)
for action in ('archiveExtract', 'compress', 'copy', 'sign', 'fileSplit', 'gpgEncrypt'):
    ck(action + ":'" in jsc, 'TASK_STAGE 缺 action ' + action)

# --- 4) 原生阶段文案按 MT「正在 XXX…」格式规范化 ---------------------------
ck('function mtStageText(msg)' in jsc, '缺 mtStageText 规范化')
ck(r"replace(/^(正在[^\s…]+)\s/,'$1… ')" in jsc, 'mtStageText 未把原生阶段文案规范化为「正在 XXX…」')

# --- 5) MT 对话结构：二级进度 / 总进度 / 样式 / 状态 -----------------------
dlg = spec['dialog']
ck(dlg['ProgressDialog']['message_text_size_sp'] == 16, 'ProgressDialog 消息应为 16sp')
ck(dlg['ProgressDialog']['progress_margin_top_dp'] == 12, 'ProgressDialog 进度条 marginTop 应为 12dp')
ck(dlg['ProgressDialog']['cancelable'] is False, 'ProgressDialog 应 setCancelable(false)')
ck('setSecondaryProgress' in dlg['ProgressDialog']['methods'], 'ProgressDialog 应支持二级进度')
ck(dlg['DualProgressDialog']['total_label_template'] == '{dual_progress_dialog_total}',
   'DualProgressDialog 总进度标签应来自 {dual_progress_dialog_total}')
ck(dlg['DualProgressDialog']['total_label_margin_top_dp'] == 6, '总进度标签 marginTop 应为 6dp')
styles = dlg['PluginProgressBar$Style']
ck(styles == ['HORIZONTAL', 'CIRCULAR', 'CIRCULAR_SMALL', 'CIRCULAR_LARGE'],
   'Style 枚举应为 4 种')
ck('const MT_STYLES=' in jsc and all(("'" + s + "'") in jsc for s in styles),
   'app.js MT_STYLES 应与 MT Style 枚举一致')

# 二级 / 总进度 / 样式 / 状态四条运行时分支
ck('window.__taskProgress=(job,percent,message,extras)' in jsc, '__taskProgress 应为 4 参（含 extras）')
for frag, label in (
    ('extras.secondary', '二级进度'),
    ('extras.total', '总进度'),
    ('extras.style&&MT_STYLES.indexOf', '样式切换'),
    ('extras.state', '状态文案'),
):
    ck(frag in jsc, '__taskProgress 缺 ' + label + ' 分支')
ck('function taskProgressState(state)' in jsc, '缺 taskProgressState')
ck('function taskProgressStyle(style)' in jsc, '缺 taskProgressStyle')
for cls in ("'circular'", "'circular-small'", "'circular-large'"):
    ck(cls in jsc, 'taskProgressStyle 缺样式类 ' + cls)

# --- 6) 取消交互：BaseCancelableDialog 三段文案 ----------------------------
ck('function taskCancelAttempt()' in jsc, '缺 taskCancelAttempt（再按一次取消）')
ck('MT_MSG.pressAgain' in jsc, '第一次点击应提示 再按一次取消操作')
ck("taskProgressState('canceling')" in jsc, '第二次点击应切到 正在取消操作…')
ck("'cancelTask'" in jsc and 'JSON.stringify({job:taskJob})' in jsc, '取消应下发 cancelTask action')
ck('window.__taskBack=()=>' in jsc, '缺返回键取消入口 __taskBack')
ck("msg===MT_MSG.canceled" in jsc, 'act() 应识别 已取消操作 并只 toast')

# --- 7) DOM / CSS 布局常量 -------------------------------------------------
for frag in ('id="tpSecondary"', 'id="tpTotal"', 'id="tpTotalLabel"',
             'id="tpTotalFill"', 'id="tpCircular"', 'class="tpRing"',
             'id="tpTitle"', 'id="tpMsg"', 'id="tpFill"'):
    ck(frag in html, 'app.html 缺 MT 结构 ' + frag)
ck('class="tpSecondary"' in html and 'class="tpTotal"' in html, 'DOM 缺二级进度 / 总进度容器')
for frag, label in (
    ('.tpSecondary{', '二级进度样式'),
    ('.tpTotal{', '总进度容器样式'),
    ('.tpTotalLabel{', '总进度标签样式'),
    ('.tpCircular{', '环形进度样式'),
    ('.tpRing{', '环形圈样式'),
    ('.taskProgress.circular-small .tpCircular{', 'CIRCULAR_SMALL 直径'),
    ('.taskProgress.circular-large .tpCircular{', 'CIRCULAR_LARGE 直径'),
    ('font-size:16px', '16sp 消息'),
    ('margin-top:12px', '12dp 进度条'),
    ('margin-top:6px', '6dp 总进度'),
):
    ck(frag in css, 'style.css 缺 ' + label)

# --- 8) 原生 ProgressBus / MainActivity 注入 ------------------------------
for frag, label in (
    ('public static final class Extras', 'Extras 扩展字段'),
    ('public int secondary', 'secondary'),
    ('public int total', 'total'),
    ('public int totalMax', 'totalMax'),
    ('public String style', 'style'),
    ('public String state', 'state'),
    ('class CancellationException', '取消异常'),
    ('已取消操作', '已取消操作 文案'),
    ('public static void bindJob(', 'bindJob'),
    ('public static boolean requestCancel(', 'requestCancel'),
    ('public static boolean isCanceled(', 'isCanceled'),
    ('private static void checkCanceled(', 'checkCanceled 打点检查'),
    ('public static void total(int percent, int max, String message)', 'total() 上报'),
    ('public static void secondary(int percent, String message)', 'secondary() 上报'),
    ('public static void style(String style, String message)', 'style() 上报'),
    ('default void report(int percent, String message, Extras extras)', 'Sink 3 参默认降级'),
):
    ck(frag in bus, 'ProgressBus 缺 ' + label)
ck('void taskProgress(String job,int percent,String message,ProgressBus.Extras extras)' in main,
   'MainActivity 缺 4 参 taskProgress 注入')
ck('extras.toJson()' in main, '注入未序列化 Extras')
ck('ProgressBus.bindJob(job)' in main, 'Bridge 未绑定 job')
ck('case "cancelTask":result=ProgressBus.requestCancel(' in main, 'Bridge 缺 cancelTask 分支')
ck('finally{if(!taskJob.isEmpty())ProgressBus.end();}' in main, 'Bridge 未在 finally 释放')

# --- 9) 版本 / 缓存 / CI ---------------------------------------------------
m = re.search(r"const UI_BUILD='(r\d+)';", js)
ck(m is not None and m.group(1) >= 'r15', 'UI_BUILD 应递增到 r15 或更高')
ck(m is not None and ('?v=' + m.group(1)) in html, 'app.html 脚本版本号应与 UI_BUILD 一致')
# r16 起改为通用校验：epoch 只增不减且两处取值一致，避免每轮改死值
m_ep = re.search(r'getInt\("assetEpoch",0\)<(\d+)', main)
ck(m_ep is not None and int(m_ep.group(1)) >= 9
   and ('putInt("assetEpoch",%s)' % m_ep.group(1)) in main,
   'assetEpoch 应提升到 >=9 且两处取值一致（覆盖安装清缓存）')
ck('r15 基于 MT2.26.11.apk 反编译还原进度对话框' in js, '关于页应记录 r15 反编译还原说明')
ck('tests/progress-mt-decompile-align-check.py' in ci, 'CI 未接入本对齐自检')
ck('tests/progress-mt-decompile-smoke.cjs' in ci, 'CI 未接入反编译运行时冒烟')

# --- 10) r13/r14 基线未回归 ------------------------------------------------
ck('TASK_TITLES[action]?taskProgressOpen(TASK_TITLES[action]' in jsc, 'rpc 仍应按 action 自动挂载')
ck('if(job)taskProgressClose();resolve(v)' in jsc, 'rpc 成功回调仍应关闭进度')
ck('ProgressBus.report(10+idx*80/total' in read(os.path.join(JAVA, 'DexEngine.java')),
   'DEX 转 JAR 真实打点未回归')

print('检查项：%d，失败：%d' % (count, len(fails)))
for f in fails:
    print('FAIL:', f)
if fails:
    sys.exit(1)
print('PASS: r15 基于 MT2.26.11.apk 反编译还原的进度对齐自检 %d 项全部通过'
      '（arsc 文案 / mtl 词表 / 双进度 / 二级进度 / 4 样式 / 取消交互 / 布局常量 / 原生注入 / 版本 CI）' % count)
