#!/usr/bin/env node
/**
 * r15 运行时冒烟：从真实 app.js 抽取 MT 反编译还原后的进度组件，在最小 DOM 沙箱中执行，
 * 验证：arsc 初始文案 / 功能专属进行中文案 / 阶段文案规范化 / 二级进度 / 总进度 /
 * 4 种样式 / 状态文案 / 再按一次取消交互 / 关闭清理。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'app/src/main/assets/app.js'), 'utf8');

const start = SRC.indexOf('const MT_MSG=');
const end = SRC.indexOf('window.receive=r=>');
if (start < 0 || end < 0 || end <= start) {
  console.error('FAIL: 无法从 app.js 定位 r15 进度组件片段');
  process.exit(1);
}
const code = SRC.slice(start, end);

function mk(id) {
  const cls = new Set();
  return {
    id,
    hidden: true,
    textContent: '',
    style: {},
    classList: {
      add: (...cs) => cs.forEach(c => cls.add(c)),
      remove: (...cs) => cs.forEach(c => cls.delete(c)),
      contains: c => cls.has(c),
    },
    _cls: cls,
  };
}
const els = {};
['taskProgress', 'tpTitle', 'tpMsg', 'tpFill', 'tpSecondary', 'tpTotal',
 'tpTotalLabel', 'tpTotalFill', 'tpCircular'].forEach(id => { els['#' + id] = mk(id); });
const $ = sel => els[sel] || null;

const nativeCalls = [];
const ctx = {
  window: { CyberNative: { request: (...a) => nativeCalls.push(a) } },
  document: {}, $, console, Math, Object, Set, String, Date,
  setTimeout: () => 0,
};
vm.createContext(ctx);
vm.runInContext(code + '\n;this.__out={MT_MSG,MT_STYLES,TASK_STAGE,taskProgressOpen,taskProgressClose,taskCancelAttempt,__taskBack:window.__taskBack};', ctx);
const out = ctx.__out;

let pass = 0;
const fails = [];
function ck(cond, msg) {
  if (cond) pass++;
  else fails.push(msg);
}

// --- 1) MT_MSG 状态文案机与 Style 枚举 ---
ck(out && out.MT_MSG && out.MT_MSG.processing === '处理中…', 'MT_MSG.processing 应为 arsc「处理中…」');
ck(out.MT_MSG.loading === '正在加载…' && out.MT_MSG.preparing === '正在准备…', '加载/准备文案应对齐 arsc');
ck(out.MT_MSG.reloading === '正在重新加载…', '重新加载文案应对齐 arsc');
ck(out.MT_MSG.canceling === '正在取消操作…' && out.MT_MSG.canceled === '已取消操作', '取消三态文案应对齐 arsc');
ck(out.MT_MSG.pressAgain === '再按一次取消操作' && out.MT_MSG.total === '总进度', '二次确认/总进度文案应对齐 arsc');
ck(out.MT_MSG.oom === '运行内存不足', 'OOM 文案应对齐 arsc');
ck(Array.isArray(out.MT_STYLES) && out.MT_STYLES.join(',') === 'HORIZONTAL,CIRCULAR,CIRCULAR_SMALL,CIRCULAR_LARGE',
   'MT_STYLES 应为 MT 四种样式');
ck(out.TASK_STAGE.archiveExtract === '正在解压…' && out.TASK_STAGE.compress === '正在压缩…',
   'TASK_STAGE 应含 arsc 功能专属文案');

// --- 2) 打开：标题 + arsc 默认文案 / 功能专属文案 ---
const dialog = els['#taskProgress'];
let job = out.taskProgressOpen('Dex转Jar', 'dexToJar');
ck(job === 't1', 'job id 应为 t1');
ck(dialog.hidden === false, '打开后应显示');
ck(els['#tpTitle'].textContent === 'Dex转Jar', '标题应为 Dex转Jar');
ck(els['#tpMsg'].textContent === '处理中…', '无专属文案时默认应为 arsc 处理中…');
ck(dialog._cls.has('indeterminate'), '打开时应为不确定进度');
ck(els['#tpFill'].style.width === '0%' && els['#tpSecondary'].style.width === '0%', '主/二级初始宽度应为 0%');
ck(els['#tpTotal'].hidden === true, '总进度默认隐藏');

// --- 3) 阶段文案按 MT「正在 XXX…」规范化 ---
ctx.window.__taskProgress(job, 42, '正在反编译 classes.dex');
ck(els['#tpFill'].style.width === '42%', '42 应写入主进度');
ck(els['#tpMsg'].textContent === '正在反编译… classes.dex', '阶段文案应规范化为「正在反编译…」');
ck(!dialog._cls.has('indeterminate'), '确定百分比后应移除不确定动画');
ctx.window.__taskProgress('t-wrong', 88, '不应生效');
ck(els['#tpFill'].style.width === '42%', '非当前 job 应被忽略');
ctx.window.__taskProgress(job, 120, '超额');
ck(els['#tpFill'].style.width === '100%', '超过 100 应钳制到 100%');

// --- 4) 二级进度 / 总进度 / 样式 / 状态（extras） ---
ctx.window.__taskProgress(job, 55, '正在编译 core.dex',
  { secondary: 72, total: 30, style: 'CIRCULAR', state: 'loading' });
ck(els['#tpSecondary'].style.width === '72%', 'setSecondaryProgress 二级进度应为 72%');
ck(els['#tpTotal'].hidden === false, '有 total 时应显示总进度双条');
ck(els['#tpTotalLabel'].textContent === '总进度', '总进度标签应为「总进度」');
ck(els['#tpTotalFill'].style.width === '30%', 'totalProgressBar 应为 30%');
ck(dialog._cls.has('circular'), 'CIRCULAR 样式应切换为环形');
ck(els['#tpMsg'].textContent === '正在加载…', 'state=loading 应覆盖为 arsc「正在加载…」');

ctx.window.__taskProgress(job, 60, null, { style: 'CIRCULAR_SMALL' });
ck(dialog._cls.has('circular-small') && !dialog._cls.has('circular'), 'CIRCULAR_SMALL 应只保留对应类');
ctx.window.__taskProgress(job, 70, null, { style: 'CIRCULAR_LARGE' });
ck(dialog._cls.has('circular-large') && !dialog._cls.has('circular-small'), 'CIRCULAR_LARGE 应只保留对应类');
ctx.window.__taskProgress(job, 80, null, { style: 'HORIZONTAL' });
ck(!dialog._cls.has('circular') && !dialog._cls.has('circular-small') && !dialog._cls.has('circular-large'),
   'HORIZONTAL 应清除全部环形类');

ctx.window.__taskProgress(job, 90, null, { state: 'canceling' });
ck(els['#tpMsg'].textContent === '正在取消操作…', 'state=canceling 应显示 arsc 取消文案');

// --- 5) BaseCancelableDialog：再按一次取消 ---
out.taskProgressClose();
job = out.taskProgressOpen('解压', 'archiveExtract');
ck(els['#tpMsg'].textContent === '正在解压…', 'archiveExtract 初始应为「正在解压…」');
ck(typeof out.__taskBack === 'function' && out.__taskBack() === true, '返回键应触发取消并返回 true');
ck(els['#tpMsg'].textContent === '再按一次取消操作', '第一次点击应提示 再按一次取消操作');
const before = nativeCalls.length;
ctx.window.__taskProgress(job, 10, null, { state: 'canceling' }); // 复位文案，模拟运行中
els['#tpMsg'].textContent = '正在解压…';
out.taskCancelAttempt(); // 第一次
out.taskCancelAttempt(); // 第二次（3 秒内）→ 触发取消
ck(els['#tpMsg'].textContent === '正在取消操作…', '二次确认后应显示 正在取消操作…');
ck(nativeCalls.length > before, '取消应下发原生 cancelTask 请求');
ck(nativeCalls.some(c => c[1] === 'cancelTask' && c[2].indexOf('"job":') >= 0),
   'cancelTask 请求应携带 job');

// --- 6) 关闭清理 ---
out.taskProgressClose();
ck(dialog.hidden === true, '关闭后应隐藏');
ck(!dialog._cls.has('indeterminate') && !dialog._cls.has('circular') &&
   !dialog._cls.has('circular-small') && !dialog._cls.has('circular-large'),
   '关闭后应清除全部样式类');
ck(out.__taskBack() === false, '无任务时返回键应返回 false');

console.log('检查项：' + (pass + fails.length) + '，失败：' + fails.length);
fails.forEach(f => console.log('FAIL:', f));
if (fails.length) process.exit(1);
console.log('PASS: r15 MT 反编译还原进度对话框运行时冒烟 ' + pass +
  ' 项全部通过（arsc 文案机 / 功能专属文案 / 阶段规范化 / 二级进度 / 总进度 / 4 样式 / 状态 / 取消交互 / 清理）');
