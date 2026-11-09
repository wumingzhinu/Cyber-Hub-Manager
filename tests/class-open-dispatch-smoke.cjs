// .class 打开分发冒烟：真实 app.js + classview.js 在 happy-dom 中点击文件，核对走的 rpc 动作与渲染。
// r9 之前 .class 被判为 'file' → openText() → rpc('read') → 后端扫到 0x00 抛「二进制文件…」；
// r9 改成四标签「类信息查看器」；r10 依用户要求对标 MT 管理器，改为「字节码反汇编文本编辑器」：
// 深色代码区 + 行号 + 语法高亮 + 顶部工具栏 + 底部符号栏，正文是逐条 JVM 指令。
// 原查看器保留为 classInfoScreen()，从右上菜单进入。txt / blob.bin 行为不变。
const fs = require('fs'), path = require('path'), assert = require('assert');
(async () => {
  const modulePath = process.env.HAPPY_DOM_PATH || path.resolve(__dirname, '../../toolchain/test-node/node_modules/happy-dom/lib/index.js');
  const { Window } = await import(modulePath);
  const w = new Window({ url: 'https://cyber-hub.local/', width: 398, height: 768, settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  const errors = []; w.addEventListener('error', e => errors.push(e.message)); w.console.error = (...a) => errors.push(a.join(' ')); w.console.warn = () => {};
  const assets = path.resolve(__dirname, '../app/src/main/assets');
  const appSrc = fs.readFileSync(path.join(assets, 'app.js'), 'utf8');
  w.document.write(fs.readFileSync(path.join(assets, 'app.html'), 'utf8').replace(/<script[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link[^>]*>/g, ''));

  // 真实 javac 产物（含 lookupswitch / 跳转标签 / 异常 / Method·Field·Class 引用）
  const realBytes = fs.readFileSync(path.join(__dirname, 'fixtures', 'Sample.class'));
  const realB64 = realBytes.toString('base64');
  // 最小合法 Java class：CAFEBABE / major 52 / this=Hello / super=java.lang.Object / access 0x0021
  const minB64 = Buffer.from(
    'CAFEBABE' + '0000' + '0034' + '0005' +
    '01' + '0005' + Buffer.from('Hello').toString('hex') +
    '07' + '0001' +
    '01' + '0010' + Buffer.from('java/lang/Object').toString('hex') +
    '07' + '0003' +
    '0021' + '0002' + '0004' + '0000' + '0000' + '0000' + '0000', 'hex'
  ).toString('base64');

  w.eval(`(()=>{
   const root='/storage/emulated/0',now=1792250000000;
   const files=[{name:'Sample.class',path:root+'/Sample.class',dir:false,size:1436,time:now},
                {name:'notes.txt',path:root+'/notes.txt',dir:false,size:200,time:now},
                {name:'blob.bin',path:root+'/blob.bin',dir:false,size:4096,time:now}];
   window.__calls=[];
   window.CyberNative={request(id,action,raw){const a=JSON.parse(raw);window.__calls.push({action,args:a});setTimeout(()=>{let data;try{
    switch(action){
     case'init':data={permission:true,home:root,workspace:root+'/CyberHub',version:'0.1.59',ownApk:root+'/self.apk'};break;
     case'disk':data={total:237888888888,free:170000000000};break;
     case'list':data=files.map(x=>({...x,total:237888888888,free:170000000000}));break;
     case'resolve':data=a.path;break;
     case'read':
      if(/\\.bin$/i.test(a.path||''))throw Error('二进制文件：无法作为文本打开，请在「打开方式」中选择十六进制查看器或其他应用');
      data={id:'doc1',text:'hello',name:String(a.path||'').split('/').pop(),path:a.path,binaryXml:false};break;
     case'fileData':data={name:String(a.path||'').split('/').pop(),size:1436,mime:'application/octet-stream',data:process.env.REAL_B64};break;
     case'openWithApps':data={mime:'application/octet-stream',suggest:[],text:[],image:[],video:[],audio:[]};break;
     case'hexView':{const len=64;let hex='';for(let i=0;i<len;i++)hex+=(i&255).toString(16).padStart(2,'0');data={path:a.path,name:'Sample.class',size:1436,offset:0,length:len,hex,ascii:''};break;}
     default:data=true;
    }
    window.receive({id,ok:true,data});
   }catch(e){window.receive({id,ok:false,error:e.message});}},5);}};
  })();`.replace('process.env.REAL_B64', JSON.stringify(realB64)));

  for (const file of ['boot.js', 'vendor/codemirror.js', 'vendor/clike.js', 'vendor/xml.js', 'vendor/searchcursor.js', 'vendor/classview.js', 'app.js'])
    w.eval(file === 'app.js'
      ? appSrc.replace('\ninit();', '\nwindow.__test={state,pref,fileType,openFile,openText,openWithDialog,classScreen,classInfoScreen,editorMenu,saveEditor,exportClassDisasm};\ninit();')
      : fs.readFileSync(path.join(assets, file), 'utf8'));
  const sleep = () => new Promise(r => setTimeout(r, 30));
  async function wait(fn) { for (let i = 0; i < 120; i++) { if (fn()) return; await sleep(); } throw Error('Timed out waiting for DOM'); }
  const evaluate = s => w.eval(s.replace(/\bstate\b/g, 'window.__test.state').replace(/\bpref\b/g, 'window.__test.pref').replace(/\bopenWithDialog\b/g, 'window.__test.openWithDialog').replace(/\bopenFile\b/g, 'window.__test.openFile').replace(/\bopenText\b/g, 'window.__test.openText').replace(/\bclassScreen\b/g, 'window.__test.classScreen'));
  const calls = () => JSON.parse(w.eval('JSON.stringify(window.__calls)'));
  const clear = () => w.eval('window.__calls.length=0');
  const file = n => evaluate("openFile({name:'" + n + "',path:'/storage/emulated/0/" + n + "',dir:false,size:1436,time:0})");
  const settle = async () => { await sleep(); await sleep(); await sleep(); };
  let count = 0; const pass = n => { count++; console.log('PASS', n); };

  await wait(() => w.eval('window.__test && window.__test.state.info'));

  // 1) .class 走 fileData 且绝不走 read
  clear(); await file('Sample.class'); await settle();
  const clsCalls = calls();
  assert(!clsCalls.some(c => c.action === 'read'), '.class 不应再走 rpc(read)（后端会抛「二进制文件」）');
  assert(clsCalls.some(c => c.action === 'fileData'), '.class 应走 rpc(fileData) 拿 base64 字节');
  pass('.class 点击走 fileData 字节读取，不再触发文本读取');

  // 2) r10：进入的是字节码反汇编文本编辑器，不是 r9 的四标签表格
  const ed = JSON.parse(w.eval("JSON.stringify({kind:window.__test.state.editor&&window.__test.state.editor.kind,text:window.__test.state.editor&&window.__test.state.editor.text,screen:window.__test.state.screen})"));
  assert(ed.kind === 'class', 'state.editor.kind 应为 class，实为 ' + ed.kind);
  assert(ed.screen === 'editor', '应进入编辑器 screen');
  assert(String(ed.text).includes('package demo;'), '反汇编正文应含 package 行');
  assert(String(ed.text).includes('public super class version 52.0'), '反汇编正文应含类版本头');
  assert(String(ed.text).includes('stack 2 locals 2'), '反汇编正文应含方法栈深');
  assert(String(ed.text).includes('Method java/lang/Object."<init>":"()V";'), '反汇编正文应含常量池引用注释');
  assert(String(ed.text).includes('L24:') && String(ed.text).includes('if_icmpge'), '反汇编正文应含跳转标签与条件跳转');
  assert(!w.document.querySelector('.cvTabs'), 'r10 默认视图不应再是 r9 类信息查看器');
  pass('.class 默认打开为 MT 同款反汇编代码视图（指令 / 标签 / 引用注释）');

  // 3) MT 同款编辑器外观：代码区、配色类、工具栏、状态栏、底部符号栏、语法高亮 token
  assert(w.document.querySelector('#codehost'), '应创建 CodeMirror 代码宿主');
  assert(w.document.querySelector('#content').classList.contains('classEditor'), '代码区应带 classEditor 深色配色类');
  assert(w.document.querySelector('#codehost .CodeMirror'), '应实例化 CodeMirror 编辑器');
  const toolbarBtns = w.document.querySelectorAll('#toolbar button');
  assert(toolbarBtns.length === 7, '顶部工具栏应为 菜单 + 图钉/撤销/重做/保存/编辑 + 更多 共 7 键，实为 ' + toolbarBtns.length);
  assert((w.document.querySelector('#docName') || {}).textContent === 'Sample.class', '状态栏应显示 .class 文件名');
  assert((w.document.querySelector('#cursorInfo') || {}).textContent.includes('CLASS'), '状态栏应标记 CLASS 模式');
  assert(w.document.querySelectorAll('#bottom .bottom-key').length >= 5, '底部应保留符号快捷栏');
  // happy-dom 下 CodeMirror 只渲染视口附近的行，关键字/标签行可能被裁掉；
  // DOM 层确认指令与引用 token，再用真实 jvmasm mode 逐行验证四类着色。
  for (const cls of ['cm-builtin', 'cm-type'])
    assert(w.document.querySelector('#codehost .' + cls), '反汇编应有 ' + cls + ' 语法高亮 token');
  const modeTokens = JSON.parse(w.eval(`(()=>{
    const mode=CodeMirror.getMode({},'jvmasm');
    function toks(line){let pos=0;const out=[];const st={
      sol:()=>pos===0,
      eatSpace(){const m=/^\\s+/.exec(line.slice(pos));if(m){pos+=m[0].length;return true;}return false;},
      match(re){const m=re.exec(line.slice(pos));if(m){pos+=m[0].length;return m;}return null;},
      next(){return line[pos++];},string:line};
      while(pos<line.length){const p=pos;const t=mode.token(st,{});if(pos===p)st.next();if(t)out.push(t);}return out;}
    return JSON.stringify({head:toks('package demo;'),cls:toks('public super class version 52.0'),
      label:toks('L24:     iLoad 4'),instr:toks('aLoad_0'),
      ref:toks('Method java/lang/Object."<init>":"()V";')});
  })()`));
  assert(modeTokens.head.includes('keyword'), 'package / 类声明应着关键字色');
  assert(modeTokens.cls.includes('keyword') && modeTokens.cls.includes('number'), '类版本头应有着色');
  assert(modeTokens.label.includes('meta'), '跳转标签 L24: 应着 meta 蓝色');
  assert(modeTokens.instr.includes('builtin'), '指令助记符应着 builtin 色');
  assert(modeTokens.ref.includes('type') && modeTokens.ref.includes('string'), '常量池引用与方法签名应着 type/string 色');
  pass('编辑器外观：深色代码区 / 7 键工具栏 / 状态栏 / 符号栏 / 五类语法高亮');

  // 4) 右上菜单保留 r9 类信息查看器与十六进制 / 打开方式出口
  w.eval('window.__test.editorMenu()'); await settle();
  const menuText = w.document.body.textContent;
  for (const label of ['导出反汇编文本', '类信息查看器', '十六进制查看', '打开方式…', '跳转到行'])
    assert(menuText.includes(label), 'class 编辑器菜单缺少「' + label + '」');
  pass('右上菜单提供导出 / 类信息 / 十六进制 / 打开方式 / 跳转');

  // 5) r9 类信息查看器仍可用（从菜单入口进入），四标签与出口不回归
  w.eval("window.__test.classInfoScreen({name:'Sample.class',path:'/storage/emulated/0/Sample.class',dir:false})"); await settle();
  assert(w.document.body.textContent.includes('类信息查看器'), 'classInfoScreen 应仍显示类信息查看器');
  assert(w.document.querySelector('.cvTabs'), 'r9 四标签栏应保留');
  assert.deepEqual([...w.document.querySelectorAll('[data-cvtab]')].map(b => b.textContent),
    ['概览', '字段', '方法', '字符串'], 'r9 标签应为 概览/字段/方法/字符串');
  assert(w.document.querySelector('#cvHex') && w.document.querySelector('#cvOw'), 'r9 十六进制 / 打开方式出口应保留');
  pass('r9 类信息查看器完整保留为二级入口（四标签 + 十六进制 / 打开方式）');

  // 6) 保存键只导出、不覆写 .class（源码级硬断言，避免真实弹窗）
  assert(appSrc.includes("if(e.kind==='class')return exportClassDisasm();"), 'saveEditor 未把 .class 保存改道到导出');
  assert(appSrc.includes(".bytecode.txt") && appSrc.includes('exportText(cm.getValue(),name)'), '导出应生成 .bytecode.txt');
  assert(!/e\.kind==='class'[\s\S]{0,80}rpc\('save'/.test(appSrc), '.class 保存路径里不应出现 rpc(save) 写回');
  pass('保存键只导出反汇编文本，绝不覆写 .class 原始字节');

  // 7) 普通文本仍走 read（分类未回归）
  clear(); await file('notes.txt'); await settle();
  assert(calls().some(c => c.action === 'read' && c.args.path === '/storage/emulated/0/notes.txt'), '普通 .txt 仍应走 rpc(read)');
  pass('普通文本仍走文本编辑器，分类未回归');

  // 8) blob.bin 显式「编辑文本」（未传 f）仍以「二进制文件」错误 reject，
  //    且不被改道到反汇编视图（r8 / open-with-ui-smoke 的解释性报错行为不变）。
  clear();
  const binReject = await evaluate("openText({path:'/storage/emulated/0/blob.bin'}).then(()=>'resolved',e=>String(e&&e.message||e))");
  await settle();
  assert(String(binReject).includes('二进制文件'), '二进制显式文本编辑仍应抛出「二进制文件」错误');
  assert(calls().some(c => c.action === 'read'), 'blob.bin 仍应走 rpc(read)');
  assert(!calls().some(c => c.action === 'fileData'), 'blob.bin 不应被改道到反汇编视图');
  pass('blob.bin 显式编辑文本行为不变，未被误判为 .class');

  assert.deepEqual(errors, [], '运行时不应有未捕获错误：' + errors.join(' | '));
  console.log('ALL ' + count + ' CLASS-VIEW CHECKS PASSED');
})().catch(e => { console.error('FAIL', e && e.stack || e); process.exit(1); });
