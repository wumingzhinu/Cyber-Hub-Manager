#!/usr/bin/env node
/**
 * r14 运行时冒烟：从真实 app.js 抽取进度对话框组件，在最小 DOM 沙箱中执行，
 * 验证打开 / 真实百分比 / 错误 job 忽略 / 关闭四个行为。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'app/src/main/assets/app.js'), 'utf8');

const start = SRC.indexOf('const TASK_TITLES=');
const end = SRC.indexOf('window.receive=r=>');
if (start < 0 || end < 0 || end <= start) {
  console.error('FAIL: 无法从 app.js 定位进度组件片段');
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
    classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c) },
    _cls: cls,
  };
}
const els = {
  '#taskProgress': mk('taskProgress'),
  '#tpTitle': mk('tpTitle'),
  '#tpMsg': mk('tpMsg'),
  '#tpFill': mk('tpFill'),
};
const $ = sel => els[sel] || null;

const ctx = { window: {}, document: {}, $, console, Math, Object, Set, String };
vm.createContext(ctx);
vm.runInContext(code + '\n;this.__out={TASK_TITLES,taskProgressOpen,taskProgressClose};', ctx);
const out = ctx.__out;

let pass = 0;
const fails = [];
function ck(cond, msg) {
  if (cond) pass++;
  else fails.push(msg);
}

ck(out && typeof out.taskProgressOpen === 'function', 'taskProgressOpen 应可调用');
ck(out && typeof out.taskProgressClose === 'function', 'taskProgressClose 应可调用');
ck(out && out.TASK_TITLES && out.TASK_TITLES.dexToJar === 'Dex转Jar', 'TASK_TITLES.dexToJar 应为 Dex转Jar');
ck(out && out.TASK_TITLES && out.TASK_TITLES.dexToSmali === 'Dex转Smali', 'TASK_TITLES.dexToSmali 应为 Dex转Smali');

const dialog = els['#taskProgress'];
const job = out.taskProgressOpen('Dex转Jar');
ck(typeof job === 'string' && job.length > 1, 'taskProgressOpen 应返回 job id');
ck(dialog.hidden === false, '打开后对话框应显示');
ck(els['#tpTitle'].textContent === 'Dex转Jar', '标题应为 Dex转Jar');
ck(els['#tpMsg'].textContent === '处理中...', '默认说明应为 处理中...');
ck(dialog._cls.has('indeterminate'), '打开时应处于不确定进度');
ck(els['#tpFill'].style.width === '0%', '初始填充宽度应为 0%');

ctx.window.__taskProgress(job, 42, '正在反编译 classes.dex');
ck(els['#tpFill'].style.width === '42%', '收到 42 后填充宽度应为 42%');
ck(!dialog._cls.has('indeterminate'), '收到确定百分比后应移除不确定动画');
ck(els['#tpMsg'].textContent === '正在反编译 classes.dex', '说明文字应更新为真实阶段');

ctx.window.__taskProgress('t-not-current', 88, '不应生效');
ck(els['#tpFill'].style.width === '42%', '非当前 job 的进度应被忽略');

ctx.window.__taskProgress(job, 120, '超额');
ck(els['#tpFill'].style.width === '100%', '超过 100 应钳制到 100%');

out.taskProgressClose();
ck(dialog.hidden === true, '关闭后对话框应隐藏');
ck(!dialog._cls.has('indeterminate'), '关闭后应清除不确定动画');

console.log('检查项：' + (pass + fails.length) + '，失败：' + fails.length);
fails.forEach(f => console.log('FAIL:', f));
if (fails.length) process.exit(1);
console.log('PASS: r14 进度对话框运行时冒烟 ' + pass + ' 项全部通过（打开 / 百分比 / job 隔离 / 钳制 / 关闭）');
