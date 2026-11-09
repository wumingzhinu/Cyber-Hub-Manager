// r12: 三级反汇编器（classview.js 主组件 / app.js 内置反汇编器 / 结构兜底）
// 输出与 MT 管理器类头语法逐行一致的真实执行冒烟。
//
// 不依赖 happy-dom：classview.js 直接 require；app.js 的
// classStructText / builtinClassDisasm 两个自包含函数抽取到隔离 vm 中真实执行
// （仅注入 atob），验证三处独立实现产出完全相同的 MT 风格文本。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const assets = path.join(ROOT, 'app', 'src', 'main', 'assets');
const appSrc = fs.readFileSync(path.join(assets, 'app.js'), 'utf8');
const cv = require(path.join(assets, 'vendor', 'classview.js'));

const MT_EXPECTED = [
  'package org/apache/commons/net/bsd;',
  '',
  'synthetic interface package-info version 52:0',
  '{',
  '  SourceFile               "package-info.java";',
  '} // end Class org/apache/commons/net/bsd/package-info'
].join('\n');

// --- 合成与 commons-net 真实样本等价的 package-info.class ---
function u1(v) { return [v & 255]; }
function u2(v) { return [(v >> 8) & 255, v & 255]; }
function u4(v) { return [(v >> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255]; }
function utf8(s) { const b = Buffer.from(s, 'utf8'); return [1].concat(u2(b.length), Array.from(b)); }
const cp = [].concat(
  utf8('org/apache/commons/net/bsd/package-info'), [7], u2(1),
  utf8('java/lang/Object'), [7], u2(3),
  utf8('package-info.java'), utf8('SourceFile'));
const bytes = Uint8Array.from([].concat(
  u4(0xCAFEBABE), u2(0), u2(52), u2(7), cp,
  u2(0x1600), u2(2), u2(4), u2(0), u2(0), u2(0),
  u2(1), u2(6), u4(2), u2(5)));
const b64 = Buffer.from(bytes).toString('base64');

let checks = 0;
function check(cond, msg) { checks++; assert(cond, msg); }

(async () => {
  // 1) 主组件逐字符对齐 MT
  const main = cv.disassembleBase64(b64);
  check(main.valid === true, '主组件应能解析 package-info.class');
  check(main.text === MT_EXPECTED,
    '主组件输出应逐字符等于 MT：\n' + main.text);

  // 2) 抽取 app.js 的两处自包含实现，在隔离上下文中真实执行
  const a = appSrc.indexOf('function classStructText(info,nm){');
  const z = appSrc.indexOf('async function classScreen(f){');
  check(a > 0 && z > a, 'app.js 未找到 classStructText..classScreen 区段');
  const chunk = appSrc.slice(a, z);
  const sandbox = {
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(
    chunk + '\n;this.__api={classStructText,builtinClassDisasm};',
    sandbox);
  const api = sandbox.__api;

  // 3) 内置反汇编器逐字符对齐 MT
  const builtin = api.builtinClassDisasm(b64);
  check(builtin.valid === true, '内置反汇编器解析失败');
  check(builtin.text === MT_EXPECTED,
    '内置反汇编器输出应逐字符等于 MT：\n' + builtin.text);

  // 4) 结构兜底也用同一套类头 / 属性 / 收尾语法
  const info = cv.parseBase64(b64);
  const struct = api.classStructText(info, 'package-info.class');
  check(struct.includes('package org/apache/commons/net/bsd;'),
    '结构兜底应使用斜杠内部包名');
  check(struct.includes('synthetic interface package-info version 52:0'),
    '结构兜底应使用 MT 类头（修饰符 + kind + 简单类名 + major:minor）');
  check(struct.includes('  SourceFile               "package-info.java";'),
    '结构兜底应渲染 SourceFile 属性块');
  check(struct.trim().endsWith('} // end Class org/apache/commons/net/bsd/package-info'),
    '结构兜底应有 MT 收尾注释');

  // 5) 真实 javac 产物：主体不回归，且主组件与内置实现输出完全一致
  const sampleB64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'Sample.class')).toString('base64');
  const sMain = cv.disassembleBase64(sampleB64);
  const sBuiltin = api.builtinClassDisasm(sampleB64);
  check(sMain.valid === true && sBuiltin.valid === true,
    'Sample.class 在两套实现中都应解析成功');
  check(sMain.instructionCount >= 80 && sBuiltin.instructionCount >= 80,
    '两套实现都应产出 >=80 条指令（主体不回归）');
  check(sMain.labelCount >= 8 && sBuiltin.labelCount >= 8,
    '两套实现都应产出 >=8 个跳转标签');
  check(sMain.text.includes('public super class Sample version 52:0'),
    '主组件 Sample 类头应为 MT 语法');
  check(sBuiltin.text.includes('public super class Sample version 52:0'),
    '内置实现 Sample 类头应为 MT 语法');
  check(sMain.text.includes('} // end Class demo/Sample') &&
        sBuiltin.text.includes('} // end Class demo/Sample'),
    '两套实现都应有 MT 收尾注释');
  // r11 起两套独立实现在「指令引用注释」上本就有既有差异（quoteMember 引号、
  // Class 分号 / String 前缀 / throws 行），不在本轮 MT 类头对齐范围内。
  // 这里只要求本轮改动的三段——类头、属性块、收尾注释——完全一致。
  const prelude = t => {
    const ls = t.split('\n');
    const i = ls.findIndex(l => l.includes('Field '));
    return ls.slice(0, i < 0 ? 6 : i).join('\n');
  };
  check(prelude(sMain.text) === prelude(sBuiltin.text),
    '两套实现的 MT 类头与类属性块应完全一致：\nMAIN:\n' +
    prelude(sMain.text) + '\nBUILTIN:\n' + prelude(sBuiltin.text));
  check(sMain.text.trim().endsWith('} // end Class demo/Sample') &&
        sBuiltin.text.trim().endsWith('} // end Class demo/Sample'),
    '两套实现的 MT 收尾注释应一致');

  console.log('ALL ' + checks + ' CLASS-MT-HEADER CHECKS PASSED');
})().catch(e => { console.error('FAIL', e && e.stack || e); process.exit(1); });
