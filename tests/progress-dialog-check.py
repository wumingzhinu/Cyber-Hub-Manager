#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""r14: 统一处理进度对话框自检。

覆盖：
  1) 前端 DOM / MT 同款样式（标题 + 处理中 + 蓝色进度条 + 不确定动画）；
  2) app.js 的 TASK_TITLES / taskProgressOpen / __taskProgress / taskProgressClose；
  3) rpc() 自动挂载与成功 / 失败关闭；
  4) 原生 ProgressBus 线程内进度总线与节流；
  5) MainActivity 注入通道与 Bridge.request 生命周期；
  6) DEX / 归档 / 复制 / 批量 / APK 优化的真实进度打点；
  7) 版本与缓存标记（r14 / ?v=r14 / assetEpoch 8）。
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = os.path.join(ROOT, 'app', 'src', 'main')
ASSETS = os.path.join(A, 'assets')
JAVA = os.path.join(ROOT, 'app', 'src', 'main', 'java', 'com', 'cyberhub', 'manager')


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


html = read(os.path.join(ASSETS, 'app.html'))
css = read(os.path.join(ASSETS, 'style.css'))
js = read(os.path.join(ASSETS, 'app.js'))
bus = read(os.path.join(JAVA, 'ProgressBus.java'))
main = read(os.path.join(JAVA, 'MainActivity.java'))
dex = read(os.path.join(JAVA, 'DexEngine.java'))
arch = read(os.path.join(JAVA, 'ArchiveTools.java'))
ops = read(os.path.join(JAVA, 'FileOps.java'))
batch = read(os.path.join(JAVA, 'BatchFiles.java'))
opt = read(os.path.join(JAVA, 'ApkOptimizer.java'))
data = read(os.path.join(JAVA, 'DataEngine.java'))

fails = []
count = 0


def ck(cond, msg):
    global count
    count += 1
    if not cond:
        fails.append(msg)


# --- 1) DOM / 样式 -------------------------------------------------------
for frag in ('id="taskProgress"', 'id="tpTitle"', 'id="tpMsg"', 'id="tpFill"',
             'class="taskProgress"', 'class="tpTrack"', 'class="tpCard"'):
    ck(frag in html, 'app.html 缺进度对话框结构 ' + frag)
ck('id="taskProgress" class="taskProgress" hidden' in html, '进度对话框应默认隐藏')
ck('.taskProgress{position:fixed' in css, 'style.css 缺全屏遮罩定位')
ck('.taskProgress[hidden]{display:none}' in css, 'style.css 缺 hidden 规则')
ck('.tpCard{' in css and '.tpTitle{' in css and '.tpMsg{' in css, 'style.css 缺卡片/标题/说明样式')
ck('.tpTrack{' in css and '.tpFill{' in css, 'style.css 缺进度轨道/填充样式')
ck('background:var(--blue)' in css, '进度填充应使用主题蓝色（对标 MT）')
ck('.taskProgress.indeterminate .tpFill' in css, '缺不确定进度动画样式')
ck('@keyframes tpIndet' in css, '缺不确定进度关键帧')
ck('#000000a8' in css, '缺半透明遮罩')

# --- 2) 前端逻辑 ---------------------------------------------------------
ck('const TASK_TITLES={' in js, 'app.js 缺 TASK_TITLES 映射')
for title in ("dexToJar:'Dex转Jar'", "dexToSmali:'Dex转Smali'", "dexRepair:'修复Dex'",
              "dexDecrypt:'Dex字符串解密'", "archiveExtract:'解压'", "compress:'压缩'",
              "batchTransfer:'复制文件'", "sign:'签名APK'", "optimize:'APK优化'",
              "clone:'生成共存APK'", "gpgEncrypt:'GPG加密'"):
    ck(title in js, 'TASK_TITLES 缺映射 ' + title)
ck('function taskProgressOpen(title' in js, '缺 taskProgressOpen')
ck('function taskProgressClose()' in js, '缺 taskProgressClose')
ck('window.__taskProgress=' in js, '缺原生进度注入入口 window.__taskProgress')
ck("el.classList.add('indeterminate')" in js, '打开时应进入不确定进度状态')
ck("const f=$('#tpFill');if(f)f.style.width=Math.max(0,Math.min(100,percent))+'%'" in js,
   '__taskProgress 应按 0-100 设置填充宽度')
ck('const SLOW_TASKS=' in js, '缺耗时任务白名单 SLOW_TASKS')
ck('TASK_TITLES[action]?taskProgressOpen(TASK_TITLES[action]' in js,
   'rpc 未按 action 自动挂载进度对话框')
ck('Object.assign({},args,{__task:job})' in js, 'rpc 未把 __task 传给原生')
ck('if(job)taskProgressClose();resolve(v)' in js, 'rpc 成功回调未关闭进度')
ck('if(job)taskProgressClose();reject(e)' in js, 'rpc 失败回调未关闭进度')

# --- 3) 原生进度总线 -----------------------------------------------------
ck('public final class ProgressBus' in bus, '缺 ProgressBus 类')
ck('ThreadLocal<State>' in bus, 'ProgressBus 必须用 ThreadLocal（worker 是 2 线程池）')
ck('public static void report(int percent, String message)' in bus, 'ProgressBus 缺 report')
ck('public static void stage(String message)' in bus, 'ProgressBus 缺 stage')
ck('Math.min(100, Math.max(0, percent))' in bus, 'ProgressBus 应把百分比钳制到 0-100')
ck('now - s.lastAt < 60' in bus, 'ProgressBus 缺 60ms 节流（避免高频 evaluateJavascript）')

# --- 4) 原生注入与生命周期 ----------------------------------------------
ck('void taskProgress(String job,int percent,String message)' in main, 'MainActivity 缺 taskProgress')
ck('window.__taskProgress&&window.__taskProgress(' in main, 'MainActivity 未注入 __taskProgress')
ck('ProgressBus.begin(' in main and 'ProgressBus.Sink' in main, 'Bridge 未绑定 ProgressBus')
ck('ProgressBus.bindJob(job)' in main, 'Bridge 未绑定 job（r15 取消通道）')
ck('finally{if(!taskJob.isEmpty())ProgressBus.end();}' in main, 'Bridge 未在 finally 释放 ProgressBus')
ep = re.search(r'getPreferences\(0\)\.getInt\("assetEpoch",0\)<(\d+)', main)
put = re.search(r'putInt\("assetEpoch",(\d+)\)', main)
ck(ep is not None and int(ep.group(1)) >= 8, 'assetEpoch 应提升到 8 或更高')
ck(put is not None and int(put.group(1)) >= 8, 'assetEpoch 写入值应为 8 或更高')

# --- 5) 真实进度打点 -----------------------------------------------------
ck('ProgressBus.report(n*100/total,"正在修复 "' in dex, 'DexEngine.repair 缺进度')
ck('ProgressBus.report(idx*100/total,"正在反汇编 "' in dex, 'DexEngine.toSmali 缺进度')
ck('ProgressBus.report(10+idx*80/total,"正在反编译 "' in dex, 'DexEngine.toJar 缺反编译阶段进度')
ck('ProgressBus.report(100,"JAR 已生成")' in dex, 'DexEngine.toJar 缺完成标记')
ck('ProgressBus.report(i*100/total,"正在解压 "' in arch, 'ArchiveTools.extract(zip) 缺进度')
ck('ProgressBus.stage("正在解压 "' in arch, 'ArchiveTools.extract(7z/tar/gzip) 缺阶段文案')
ck(arch.count('ProgressBus.report(idx*100/total,"正在压缩 "') >= 3, 'ArchiveTools 压缩三格式应都有进度')
ck('public static void copyTree(File src, File dst, boolean report)' in ops, 'FileOps 缺可静默 copyTree 重载')
ck('countTree(src, total)' in ops, 'FileOps 缺复制总文件数统计')
ck('ProgressBus.report(Math.min(99, done[0] * 100 / total[0])' in ops, 'FileOps 缺按文件进度')
ck('FileOps.copyTree(sources.get(i),new File(stage,names.get(i)),false)' in batch,
   'BatchFiles 应使用静默 copyTree 并由外层统一报进度')
ck('ProgressBus.report(i*100/Math.max(1,sources.size())' in batch, 'BatchFiles 缺按文件进度')
ck('ProgressBus.report(Math.min(95,i*100/total)' in opt, 'ApkOptimizer 缺按条目进度')
ck('ProgressBus.report(100,"APK 优化完成")' in opt, 'ApkOptimizer 缺完成标记')
ck('ProgressBus.stage("正在签名 "' in data, '签名缺阶段文案')
ck('ProgressBus.stage("正在生成共存 APK")' in data, '共存 APK 缺阶段文案')
ck('ProgressBus.stage("正在处理 APK 保护")' in data, 'APK 保护缺阶段文案')

# --- 6) 版本 / 缓存 -------------------------------------------------------
m = re.search(r"const UI_BUILD='(r\d+)';", js)
ck(m is not None and m.group(1) >= 'r14', 'UI_BUILD 应递增到 r14 或更高')
ck(m is not None and ('?v=' + m.group(1)) in html, 'app.html 脚本版本号应与 UI_BUILD 一致')
ck('r14 统一处理进度对话框' in js, '关于页应记录 r14 说明')

print('检查项：%d，失败：%d' % (count, len(fails)))
for f in fails:
    print('FAIL:', f)
if fails:
    sys.exit(1)
print('PASS: r14 统一处理进度对话框自检 %d 项全部通过（DOM / 样式 / rpc 挂载 / ProgressBus / 真实打点 / 版本缓存）' % count)
