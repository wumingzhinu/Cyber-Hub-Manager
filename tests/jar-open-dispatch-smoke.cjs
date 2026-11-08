// JAR 打开分发冒烟：真实 app.js 在 happy-dom 中点击文件，核对走的 rpc 动作。
// r8 之前 .jar 被判为 'file' → openText() → rpc('read')（8MB 上限报错）；
// 现在必须走 navigate(archive) → rpc('list')，且普通文本 / APK 分类不受影响。
const fs=require('fs'),path=require('path'),assert=require('assert');
(async()=>{
const modulePath=process.env.HAPPY_DOM_PATH||path.resolve(__dirname,'../../toolchain/test-node/node_modules/happy-dom/lib/index.js');
const {Window}=await import(modulePath);
const w=new Window({url:'https://cyber-hub.local/',width:398,height:768,settings:{disableJavaScriptFileLoading:true,disableCSSFileLoading:true}});
const errors=[];w.addEventListener('error',e=>errors.push(e.message));w.console.error=(...a)=>errors.push(a.join(' '));w.console.warn=()=>{};
const assets=path.resolve(__dirname,'../app/src/main/assets');
w.document.write(fs.readFileSync(path.join(assets,'app.html'),'utf8').replace(/<script[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link[^>]*>/g,''));
w.eval(`(()=>{
 const root='/storage/emulated/0',now=1792250000000;
 const files=[{name:'demo.jar',path:root+'/demo.jar',dir:false,size:25000000,time:now},{name:'notes.txt',path:root+'/notes.txt',dir:false,size:200,time:now},{name:'sample.apk',path:root+'/sample.apk',dir:false,size:340000,time:now},{name:'huge.bin',path:root+'/huge.bin',dir:false,size:9000000,time:now}];
 window.__calls=[];
 window.CyberNative={request(id,action,raw){const a=JSON.parse(raw);window.__calls.push({action,args:a});setTimeout(()=>{let data;try{
  switch(action){
   case'init':data={permission:true,home:root,workspace:root+'/CyberHub',version:'0.1.59',ownApk:root+'/self.apk'};break;
   case'disk':data={total:237888888888,free:170000000000};break;
   case'list':data=files.map(x=>({...x,total:237888888888,free:170000000000}));break;
   case'resolve':data=a.path;break;
   case'read':
    if(/huge\\.bin$/i.test(a.path||''))throw Error('文件过大，无法执行此操作（上限 8 MB）');
    data={id:'doc1',text:'hello',name:String(a.path||'').split('/').pop(),path:a.path,binaryXml:false};break;
   case'apkInfo':data={package:'com.demo',versionCode:1,versionName:'1',size:340000,signature:'x',protectionLevel:0,targetSdk:34,minSdk:21};break;
   case'openWithApps':data={mime:'application/octet-stream',suggest:[],text:[],image:[],video:[],audio:[]};break;
   case'hexView':{const off=0,len=64;let hex='';for(let i=0;i<len;i++)hex+=((off+i)&255).toString(16).padStart(2,'0');data={path:a.path,name:'huge.bin',size:128,offset:0,length:len,hex,ascii:''};break;}
   case'properties':data={path:a.path,size:200,modified:now,readable:true,writable:true,sha256:'x'};break;
   default:data=true;
  }
  window.receive({id,ok:true,data});
 }catch(e){window.receive({id,ok:false,error:e.message});}},5);}};
})();`);
for(const file of ['boot.js','vendor/codemirror.js','vendor/clike.js','vendor/xml.js','vendor/searchcursor.js','app.js'])
  w.eval(file==='app.js'?fs.readFileSync(path.join(assets,file),'utf8').replace('\ninit();','\nwindow.__test={state,pref,fileType,openFile,openText,openWithDialog};\ninit();'):fs.readFileSync(path.join(assets,file),'utf8'));
const sleep=()=>new Promise(r=>setTimeout(r,30));
async function wait(fn){for(let i=0;i<120;i++){if(fn())return;await sleep();}throw Error('Timed out waiting for DOM');}
const evaluate=s=>w.eval(s.replace(/\bstate\b/g,'window.__test.state').replace(/\bpref\b/g,'window.__test.pref').replace(/\bopenWithDialog\b/g,'window.__test.openWithDialog').replace(/\bopenFile\b/g,'window.__test.openFile').replace(/\bopenText\b/g,'window.__test.openText'));
const calls=()=>JSON.parse(w.eval('JSON.stringify(window.__calls)'));
const clear=()=>w.eval('window.__calls.length=0');
const file=n=>evaluate("openFile({name:'"+n+"',path:'/storage/emulated/0/"+n+"',dir:false,size:25000000,time:0})");
const settle=async()=>{await sleep();await sleep();await sleep();};
let count=0;const pass=n=>{count++;console.log('PASS',n)};

await wait(()=>w.eval('window.__test && window.__test.state.info'));

// 1) JAR 必须作为归档浏览：调用 list 且带 archive 参数，绝不调用 read
clear();await file('demo.jar');await settle();
const jarCalls=calls();
assert(!jarCalls.some(c=>c.action==='read'),'JAR 不应再走 rpc(read)（会触发 8MB 上限）');
assert(jarCalls.some(c=>c.action==='list'&&c.args.archive==='/storage/emulated/0/demo.jar'),'JAR 应作为 archive 进入 rpc(list) 双窗格浏览');
pass('JAR 点击直接进入归档浏览，不再触发文本读取');

// 2) 普通文本仍走 read（改动没有把所有文件都变成归档）
clear();await file('notes.txt');await settle();
assert(calls().some(c=>c.action==='read'&&c.args.path==='/storage/emulated/0/notes.txt'),'普通 .txt 仍应走 rpc(read)');
pass('普通文本仍走文本编辑器，分类未回归');

// 3) APK 仍是专属分类（apkInfo），不被当成普通压缩包
clear();await file('sample.apk');await settle();
const apkCalls=calls();
assert(apkCalls.some(c=>c.action==='apkInfo'),'APK 仍应走专属 rpc(apkInfo)');
assert(!apkCalls.some(c=>c.action==='list'&&c.args.archive),'APK 不应退化为普通归档浏览');
pass('APK 专属分类保持不变');

// 4) 显式用「编辑文本」打开超大文件时，兜底引导到打开方式而不是抛死错误
clear();
evaluate("openText({path:'/storage/emulated/0/huge.bin'},{name:'huge.bin',path:'/storage/emulated/0/huge.bin',dir:false,size:9000000,time:0})");
await settle();
const body=w.document.body.textContent;
assert(body.includes('文件超过文本编辑器上限'),'超大文件应给出可操作提示');
assert(w.document.querySelector('.owDialog'),'超大文件应回退到打开方式对话框');
pass('「文件过大」引导到十六进制 / 浏览压缩包，不再卡在纯错误页');

assert.deepEqual(errors,[],'运行时不应有未捕获错误：'+errors.join(' | '));
console.log('ALL '+count+' JAR-OPEN CHECKS PASSED');
})().catch(e=>{console.error('FAIL',e&&e.stack||e);process.exit(1)});
