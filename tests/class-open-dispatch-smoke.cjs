// .class 打开分发冒烟：真实 app.js + classview.js 在 happy-dom 中点击文件，核对走的 rpc 动作与渲染。
// r9 之前 .class 被判为 'file' → openText() → rpc('read') → 后端扫到 0x00 抛「二进制文件…」；
// 现在必须走 classScreen() → rpc('fileData') → 解析并渲染类信息查看器，且 txt / blob.bin 行为不变。
const fs = require('fs'), path = require('path'), assert = require('assert');
(async () => {
  const modulePath = process.env.HAPPY_DOM_PATH || path.resolve(__dirname, '../../toolchain/test-node/node_modules/happy-dom/lib/index.js');
  const { Window } = await import(modulePath);
  const w = new Window({ url: 'https://cyber-hub.local/', width: 398, height: 768, settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
  const errors = []; w.addEventListener('error', e => errors.push(e.message)); w.console.error = (...a) => errors.push(a.join(' ')); w.console.warn = () => {};
  const assets = path.resolve(__dirname, '../app/src/main/assets');
  w.document.write(fs.readFileSync(path.join(assets, 'app.html'), 'utf8').replace(/<script[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link[^>]*>/g, ''));

  // 最小合法 Java class：CAFEBABE / major 52 / this=Hello / super=java.lang.Object / access 0x0021
  const b64 = Buffer.from(
    'CAFEBABE' + '0000' + '0034' + '0005' +
    '01' + '0005' + Buffer.from('Hello').toString('hex') +
    '07' + '0001' +
    '01' + '0010' + Buffer.from('java/lang/Object').toString('hex') +
    '07' + '0003' +
    '0021' + '0002' + '0004' + '0000' + '0000' + '0000' + '0000', 'hex'
  ).toString('base64');

  w.eval(`(()=>{
   const root='/storage/emulated/0',now=1792250000000;
   const files=[{name:'Hello.class',path:root+'/Hello.class',dir:false,size:64,time:now},
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
     case'fileData':data={name:'Hello.class',size:64,mime:'application/octet-stream',data:process.env.CV_B64};break;
     case'openWithApps':data={mime:'application/octet-stream',suggest:[],text:[],image:[],video:[],audio:[]};break;
     case'hexView':{const len=64;let hex='';for(let i=0;i<len;i++)hex+=(i&255).toString(16).padStart(2,'0');data={path:a.path,name:'Hello.class',size:64,offset:0,length:len,hex,ascii:''};break;}
     default:data=true;
    }
    window.receive({id,ok:true,data});
   }catch(e){window.receive({id,ok:false,error:e.message});}},5);}};
  })();`.replace('process.env.CV_B64', JSON.stringify(b64)));

  for (const file of ['boot.js', 'vendor/codemirror.js', 'vendor/clike.js', 'vendor/xml.js', 'vendor/searchcursor.js', 'vendor/classview.js', 'app.js'])
    w.eval(file === 'app.js'
      ? fs.readFileSync(path.join(assets, file), 'utf8').replace('\ninit();', '\nwindow.__test={state,pref,fileType,openFile,openText,openWithDialog,classScreen};\ninit();')
      : fs.readFileSync(path.join(assets, file), 'utf8'));
  const sleep = () => new Promise(r => setTimeout(r, 30));
  async function wait(fn) { for (let i = 0; i < 120; i++) { if (fn()) return; await sleep(); } throw Error('Timed out waiting for DOM'); }
  const evaluate = s => w.eval(s.replace(/\bstate\b/g, 'window.__test.state').replace(/\bpref\b/g, 'window.__test.pref').replace(/\bopenWithDialog\b/g, 'window.__test.openWithDialog').replace(/\bopenFile\b/g, 'window.__test.openFile').replace(/\bopenText\b/g, 'window.__test.openText').replace(/\bclassScreen\b/g, 'window.__test.classScreen'));
  const calls = () => JSON.parse(w.eval('JSON.stringify(window.__calls)'));
  const clear = () => w.eval('window.__calls.length=0');
  const file = n => evaluate("openFile({name:'" + n + "',path:'/storage/emulated/0/" + n + "',dir:false,size:64,time:0})");
  const settle = async () => { await sleep(); await sleep(); await sleep(); };
  let count = 0; const pass = n => { count++; console.log('PASS', n); };

  await wait(() => w.eval('window.__test && window.__test.state.info'));

  // 1) .class 走 fileData 且绝不走 read
  clear(); await file('Hello.class'); await settle();
  const clsCalls = calls();
  assert(!clsCalls.some(c => c.action === 'read'), '.class 不应再走 rpc(read)（后端会抛「二进制文件」）');
  assert(clsCalls.some(c => c.action === 'fileData'), '.class 应走 rpc(fileData) 拿 base64 字节');
  pass('.class 点击走 fileData 字节读取，不再触发文本读取');

  // 2) 渲染出类信息查看器，含解析出的类名 / 魔数 / 父类 / JDK 版本 / 四标签
  const body = w.document.body.textContent;
  assert(body.includes('类信息查看器'), '应显示「类信息查看器」标题');
  assert(w.document.querySelector('.cvTabs'), '应渲染四标签栏');
  const tabLabels = [...w.document.querySelectorAll('[data-cvtab]')].map(b => b.textContent);
  assert.deepEqual(tabLabels, ['概览', '字段', '方法', '字符串'], '标签应为 概览/字段/方法/字符串');
  assert(body.includes('CAFEBABE'), '概览应显示魔数 CAFEBABE');
  assert(body.includes('Hello'), '概览应显示解析出的类名 Hello');
  assert(body.includes('java.lang.Object'), '概览应显示父类 java.lang.Object');
  assert(body.includes('Java 8'), '概览应显示编译目标 Java 8');
  pass('类信息查看器渲染概览（魔数/类名/父类/JDK 版本）与四标签');

  // 3) 切到「方法」「字符串」标签不报错
  w.document.querySelector('[data-cvtab="methods"]').click();
  await settle();
  assert(w.document.querySelector('#cvBody'), '方法标签应渲染列表区');
  w.document.querySelector('[data-cvtab="strings"]').click();
  await settle();
  const strBody = w.document.body.textContent;
  assert(strBody.includes('Hello') || strBody.includes('java/lang/Object'), '字符串标签应列出常量池字符串');
  pass('字段/方法/字符串标签可切换并渲染常量池');

  // 4) 十六进制 / 打开方式出口存在
  assert(w.document.querySelector('#cvHex'), '应提供「十六进制查看」出口');
  assert(w.document.querySelector('#cvOw'), '应提供「打开方式…」出口');
  pass('查看器保留十六进制 / 打开方式出口');

  // 5) 普通文本仍走 read（分类未回归）
  clear(); await file('notes.txt'); await settle();
  assert(calls().some(c => c.action === 'read' && c.args.path === '/storage/emulated/0/notes.txt'), '普通 .txt 仍应走 rpc(read)');
  pass('普通文本仍走文本编辑器，分类未回归');

  // 6) blob.bin 显式「编辑文本」（未传 f）仍以「二进制文件」错误 reject，
  //    且不被改道到类信息查看器（r8 / open-with-ui-smoke 的解释性报错行为不变）。
  //    用 then(_, e=>...) 主动吞掉 rejection，避免 happy-dom 视为未捕获异常。
  clear();
  const binReject = await evaluate("openText({path:'/storage/emulated/0/blob.bin'}).then(()=>'resolved',e=>String(e&&e.message||e))");
  await settle();
  assert(String(binReject).includes('二进制文件'), '二进制显式文本编辑仍应抛出「二进制文件」错误');
  assert(calls().some(c => c.action === 'read'), 'blob.bin 仍应走 rpc(read)');
  assert(!calls().some(c => c.action === 'fileData'), 'blob.bin 不应被改道到类信息查看器');
  pass('blob.bin 显式编辑文本行为不变，未被误判为 .class');

  assert.deepEqual(errors, [], '运行时不应有未捕获错误：' + errors.join(' | '));
  console.log('ALL ' + count + ' CLASS-VIEW CHECKS PASSED');
})().catch(e => { console.error('FAIL', e && e.stack || e); process.exit(1); });
