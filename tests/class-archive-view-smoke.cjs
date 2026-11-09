// r11 归档内 .class 打开分发冒烟：真实 app.js 在 happy-dom 中点开 JAR/ZIP/APK
// 归档内的 .class 条目，核对无论 classview.js 版本如何都进入 MT 同款深色
// 反汇编代码编辑器，绝不回退到 r9「类信息查看器」四标签表格。
//
// 覆盖三条路径：
//   1) 正常 r11 组件 → classDisasmOf 反汇编成功；
//   2) 覆盖安装后 WebView 缓存的 r9 组件（只有 parseBase64，缺 disassembleBase64）
//      → 组件自愈尝试 + app.js 内置 builtinClassDisasm 兜底；
//   3) 组件完全缺失 → 内置反汇编器仍产出逐条指令代码视图。
// 三条路径都断言：fileData 走 archive+entry、state.editor.kind==='class'、
// DOM 有 .classEditor 代码区、且没有 .cvTabs / 「类信息查看器」表格。
const fs = require('fs'), path = require('path'), assert = require('assert');
(async () => {
  const modulePath = process.env.HAPPY_DOM_PATH || path.resolve(__dirname, '../../toolchain/test-node/node_modules/happy-dom/lib/index.js');
  const { Window } = await import(modulePath);
  const assets = path.resolve(__dirname, '../app/src/main/assets');
  const appSrc = fs.readFileSync(path.join(assets, 'app.js'), 'utf8');
  const realB64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'Sample.class')).toString('base64');

  const w = new Window({ url: 'https://cyber-hub.local/', width: 398, height: 768, settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  const errors = [];
  w.addEventListener('error', e => errors.push(e.message));
  w.console.error = (...a) => errors.push(a.join(' '));
  w.console.warn = () => {};
  w.document.write(fs.readFileSync(path.join(assets, 'app.html'), 'utf8').replace(/<script[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link[^>]*>/g, ''));
  // 让 ensureClassView() 的动态重载立即结束（不真的加载脚本），验证内置兜底。
  const realAppend = w.document.head.appendChild.bind(w.document.head);
  w.document.head.appendChild = (node) => {
    if (node && node.tagName === 'SCRIPT') { setTimeout(() => { if (node.onerror) node.onerror(); }, 0); return node; }
    return realAppend(node);
  };

  w.eval(`(()=>{
   const root='/storage/emulated/0',now=1792250000000;
   window.__calls=[];
   window.CyberNative={request(id,action,raw){const a=JSON.parse(raw);window.__calls.push({action,args:a});setTimeout(()=>{let data;try{
    switch(action){
     case'init':data={permission:true,home:root,workspace:root+'/CyberHub',version:'0.1.59',ownApk:root+'/self.apk'};break;
     case'disk':data={total:237888888888,free:170000000000};break;
     case'list':data=[];break;
     case'resolve':data=a.path;break;
     case'fileData':data={name:String(a.entry||a.path||'').split('/').pop(),size:1436,mime:'application/octet-stream',data:REAL_B64};break;
     case'openWithApps':data={mime:'application/octet-stream',suggest:[],text:[],image:[],video:[],audio:[]};break;
     default:data=true;
    }
    window.receive({id,ok:true,data});
   }catch(e){window.receive({id,ok:false,error:e.message});}},5);}};
  })();`.replace('REAL_B64', JSON.stringify(realB64)));

  for (const file of ['boot.js', 'vendor/codemirror.js', 'vendor/clike.js', 'vendor/xml.js', 'vendor/searchcursor.js', 'vendor/classview.js', 'app.js'])
    w.eval(file === 'app.js'
      ? appSrc.replace('\ninit();', '\nwindow.__test={state,openFile,classScreen,builtinClassDisasm};\ninit();')
      : fs.readFileSync(path.join(assets, file), 'utf8'));

  const sleep = () => new Promise(r => setTimeout(r, 25));
  async function wait(fn) { for (let i = 0; i < 120; i++) { if (fn()) return; await sleep(); } throw Error('Timed out waiting for DOM'); }
  const calls = () => JSON.parse(w.eval('JSON.stringify(window.__calls)'));
  const clear = () => w.eval('window.__calls.length=0');
  const settle = async () => { for (let i = 0; i < 4; i++) await sleep(); };
  let count = 0; const pass = n => { count++; console.log('PASS', n); };

  await wait(() => w.eval('window.__test && window.__test.state.info'));

  // 归档内的 .class 条目：来自 ArchiveTools.listEntries，带 archive + entry，无独立 path。
  const archived = { name: 'Sample.class', archive: '/storage/emulated/0/lib/demo.jar', entry: 'demo/Sample.class', dir: false, size: 1436, time: 0 };
  const openArchived = () => w.eval('window.__test.openFile(' + JSON.stringify(archived) + ')');

  async function assertCodeView(label) {
    const ed = JSON.parse(w.eval("JSON.stringify({kind:window.__test.state.editor&&window.__test.state.editor.kind,text:window.__test.state.editor&&window.__test.state.editor.text,screen:window.__test.state.screen})"));
    assert(ed.kind === 'class', label + '：state.editor.kind 应为 class，实为 ' + ed.kind);
    assert(ed.screen === 'editor', label + '：应进入编辑器 screen');
    assert(String(ed.text).includes('Method ') && String(ed.text).includes('aLoad_0'),
      label + '：正文应是逐条反汇编指令，实为 ' + String(ed.text).slice(0, 80));
    assert(w.document.querySelector('#content').classList.contains('classEditor'),
      label + '：代码区应带 classEditor 深色配色类');
    assert(!w.document.querySelector('.cvTabs'), label + '：不应出现 r9 类信息查看器四标签表格');
    assert(!String(w.document.body.textContent).includes('类信息查看器'),
      label + '：不应显示「类信息查看器」表格页');
  }

  // 1) 正常 r11 组件：归档内 .class 走 fileData(archive+entry) 且进入代码视图
  clear(); await openArchived(); await settle();
  const c1 = calls();
  assert(c1.some(c => c.action === 'fileData' && c.args.archive === archived.archive && c.args.entry === archived.entry),
    '归档内 .class 应走 rpc(fileData) 且携带 archive + entry');
  assert(!c1.some(c => c.action === 'read'), '归档内 .class 不应走 rpc(read)（会抛二进制错误）');
  await assertCodeView('正常组件');
  pass('归档内 .class 走 fileData(archive+entry) 并进入反汇编代码视图');

  // 2) 覆盖安装后缓存 r9 组件：删掉 disassembleBase64，仅留 parseBase64。
  //    ensureClassView 重载失败 → builtinClassDisasm 兜底，仍不能回退表格。
  w.eval("delete window.CyberClassView.disassembleBase64; delete window.CyberClassView.disassemble; delete window.CyberClassView.disassembleBytes;");
  assert(w.eval('typeof window.CyberClassView.parseBase64') === 'function', '应保留 r9 的 parseBase64 模拟');
  clear(); await openArchived(); await settle();
  await assertCodeView('旧缓存组件');
  const t2 = JSON.parse(w.eval("JSON.stringify(window.__test.state.editor.text)"));
  assert(String(t2).includes('package demo;') && String(t2).includes('lookupswitch'),
    '旧组件下内置反汇编器应产出 package 行与 switch 指令');
  pass('旧缓存 classview.js（缺 disassembleBase64）仍靠内置反汇编器显示代码视图，不回退表格');

  // 3) 组件完全缺失（脚本 404 等极端情况）：内置反汇编器独立工作
  w.eval('window.CyberClassView = undefined;');
  clear(); await openArchived(); await settle();
  await assertCodeView('组件完全缺失');
  pass('CyberClassView 完全缺失时仍由 app.js 内置反汇编器产出代码视图');

  // 4) classInfoScreen 仍作为菜单二级入口保留（r9 功能不回归）
  assert(appSrc.includes('async function classInfoScreen(f){'), 'classInfoScreen 应保留');
  assert(appSrc.includes("icon:'info',label:'类信息查看器'"), '类信息查看器应仍是右上菜单二级入口');
  assert(!/classScreen\(f\)\{[\s\S]{0,1400}return classInfoScreen\(f\)/.test(appSrc),
    'classScreen 里不应再有 return classInfoScreen(f) 表格回退');
  pass('类信息查看器保留为菜单二级入口；classScreen 不再有表格回退');

  // 5) 内置反汇编器与主反汇编器输出一致（真实 javac 产物）
  const builtin = JSON.parse(w.eval('JSON.stringify(window.__test.builtinClassDisasm(' + JSON.stringify(realB64) + '))'));
  assert(builtin.valid === true && builtin.methodCount >= 4 && builtin.instructionCount >= 80,
    '内置反汇编器应产出完整指令：' + JSON.stringify({ v: builtin.valid, m: builtin.methodCount, i: builtin.instructionCount }));
  assert(String(builtin.text).includes('package demo;') && String(builtin.text).includes('Method ') && String(builtin.text).includes('L'),
    '内置反汇编器应含 package / 方法头 / 跳转标签');
  pass('内置反汇编器在真实 class 上产出 methodCount>=4 / 指令>=80 / 标签');

  assert.deepEqual(errors, [], '运行时不应有未捕获错误：' + errors.join(' | '));
  console.log('ALL ' + count + ' CLASS-ARCHIVE-VIEW CHECKS PASSED');
})().catch(e => { console.error('FAIL', e && e.stack || e); process.exit(1); });
