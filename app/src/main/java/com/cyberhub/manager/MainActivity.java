package com.cyberhub.manager;

import android.app.*;
import android.os.*;
import android.Manifest;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.Settings;
import android.webkit.*;
import android.view.*;
import android.view.inputmethod.InputMethodManager;
import android.widget.*;
import android.graphics.Color;
import android.graphics.Typeface;
import com.termux.terminal.*;
import com.termux.view.*;
import com.cyberhub.manager.color.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

public class MainActivity extends Activity {
    private WebView web;
    private DataEngine engine;
    private static final String APP_URL="https://appassets.androidplatform.net/assets/app.html";
    private final ExecutorService worker=Executors.newFixedThreadPool(2);
    private final ExecutorService thumbnails=Executors.newSingleThreadExecutor();
    private FrameLayout root;
    private FrameLayout terminalOverlay;
    private TerminalView terminalView;
    private TerminalSession terminalSession;
    private int terminalTextSize=14;
    private boolean terminalCtrl,terminalAlt;
    private TextView terminalCtrlKey,terminalAltKey;
    @Override public void onCreate(Bundle state){super.onCreate(state);
        System.setProperty("java.io.tmpdir",getCacheDir().getPath());
        try{engine=new DataEngine(this);web=new WebView(this);web.setBackgroundColor(0xff303030);
        WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setAllowFileAccessFromFileURLs(false);s.setAllowUniversalAccessFromFileURLs(false);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);s.setTextZoom(100);s.setSupportZoom(false);s.setBuiltInZoomControls(false);s.setDisplayZoomControls(false);
        web.setWebChromeClient(new WebChromeClient(){@Override public boolean onConsoleMessage(ConsoleMessage m){
            if(m.messageLevel()==ConsoleMessage.MessageLevel.ERROR)android.util.Log.e("CyberHubUI",m.message()+" @ "+m.sourceId()+":"+m.lineNumber());return true;
        }});
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return !APP_URL.equals(r.getUrl().toString());}
            @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){return localAsset(r.getUrl(),r.getMethod());}
            @Override public void onReceivedError(WebView v,WebResourceRequest r,WebResourceError e){if(r.isForMainFrame())showStartupError("无法加载界面："+e.getDescription());}
            @Override public void onPageFinished(WebView v,String url){
                if(APP_URL.equals(url))v.evaluateJavascript("typeof window.CyberBoot === 'object'",result->{if(!"true".equals(result))showStartupError("界面启动脚本未能加载。");});
            }
            @Override public boolean onRenderProcessGone(WebView v,RenderProcessGoneDetail detail){
                if(web==v){web=null;v.destroy();}showStartupError("Android WebView 已停止。轻点重试以重新打开应用。");return true;
            }
        });
        web.addJavascriptInterface(new Bridge(),"CyberNative");root=new FrameLayout(this);root.addView(web,new FrameLayout.LayoutParams(-1,-1));setContentView(root);web.loadUrl(APP_URL);
        }catch(Throwable error){showStartupError(error.getClass().getSimpleName()+": "+error.getMessage());}
    }
    private WebResourceResponse localAsset(Uri uri,String method){
        String path=uri.getPath();
        if("GET".equals(method)&&"https".equals(uri.getScheme())&&"appassets.androidplatform.net".equals(uri.getHost())&&(uri.getPort()==-1||uri.getPort()==443)&&path!=null&&path.startsWith("/assets/")){
            String name=path.substring(8);
            if(Arrays.asList("app.html","app.js","boot.js","style.css","vendor/codemirror.js","vendor/codemirror.css","vendor/clike.js","vendor/xml.js","vendor/searchcursor.js").contains(name)){
                try{
                    String mime=name.endsWith(".html")?"text/html":name.endsWith(".css")?"text/css":"application/javascript";
                    return new WebResourceResponse(mime,"UTF-8",200,"OK",Collections.singletonMap("Cache-Control","no-store"),getAssets().open(name));
                }catch(IOException ignored){}
            }
        }
        // No network fallback, arbitrary local files, or signing-key exposure through WebView.
        return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",Collections.emptyMap(),new ByteArrayInputStream("未找到".getBytes(StandardCharsets.UTF_8)));
    }
    private void showStartupError(String message){
        android.widget.LinearLayout box=new android.widget.LinearLayout(this);box.setOrientation(android.widget.LinearLayout.VERTICAL);box.setPadding(32,40,32,24);box.setBackgroundColor(0xff303030);
        android.content.pm.PackageInfo provider=WebView.getCurrentWebViewPackage();
        String details="赛博中枢管家 0.1.9\n\n"+message+"\n\nAndroid "+Build.VERSION.RELEASE+"\nWebView: "+(provider==null?"不可用":provider.packageName+" "+provider.versionName);
        android.widget.TextView text=new android.widget.TextView(this);text.setText(details);text.setTextColor(0xffdddddd);text.setTextSize(16);text.setTextIsSelectable(true);box.addView(text);
        android.widget.Button retry=new android.widget.Button(this);retry.setText("重试");retry.setOnClickListener(v->recreate());box.addView(retry);
        android.widget.Button copy=new android.widget.Button(this);copy.setText("复制错误详情");copy.setOnClickListener(v->{((android.content.ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("启动错误",details));toast("错误详情已复制");});box.addView(copy);
        android.widget.ScrollView scroll=new android.widget.ScrollView(this);scroll.addView(box);setContentView(scroll);
    }
    void bundleProgress(String job,String message){
        runOnUiThread(()->{if(web!=null)web.evaluateJavascript("window.bundleProgress&&window.bundleProgress("+JSONObject.quote(job)+","+JSONObject.quote(message)+")",null);});
    }
    public final class Bridge {
        @JavascriptInterface public void request(String id,String action,String args){
            (action.equals("apkIcon")?thumbnails:worker).execute(()->{JSONObject response=new JSONObject();try{
                JSONObject a=new JSONObject(args);Object result;
                switch(action){
                    case "apkIcon":result=engine.iconForPath(a.getString("path"));break;
                    case "exit":runOnUiThread(()->finish());result=true;break;
                    case "permission":runOnUiThread(()->storagePermission());result=true;break;
                    case "install":{File f=new File(a.getString("path"));if(!f.isFile())throw new IOException("APK 未找到");File shared=shareCopy(f);runOnUiThread(()->install(shared));result=true;break;}
                    case "shareMultiple":{ArrayList<Uri>uris=new ArrayList<>();JSONArray paths=a.getJSONArray("paths");for(int i=0;i<paths.length();i++)uris.add(shareUri(shareCopy(new File(paths.getString(i)))));if(uris.isEmpty())throw new IOException("未选择文件");runOnUiThread(()->{try{Intent intent=new Intent(Intent.ACTION_SEND_MULTIPLE).setType("application/octet-stream").putParcelableArrayListExtra(Intent.EXTRA_STREAM,uris).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);ClipData clip=ClipData.newRawUri("文件",uris.get(0));for(int i=1;i<uris.size();i++)clip.addItem(new ClipData.Item(uris.get(i)));intent.setClipData(clip);startActivity(Intent.createChooser(intent,"分享文件"));}catch(Exception error){toast(error.getMessage());}});result=true;break;}
                    case "share":{File shared=shareCopy(new File(a.getString("path")));runOnUiThread(()->share(shared));result=true;break;}
                    case "clipboard":runOnUiThread(()->((android.content.ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("赛博中枢管家",a.optString("text"))));result=true;break;
                    case "colorPicker":result=colorPicker(a);break;
                    case "elevated":result=ElevatedAccess.call(MainActivity.this,a);break;
                    case "terminalOpen":{String p=a.optString("path",getFilesDir().getPath());runOnUiThread(()->openTerminal(p));result=true;break;}
                    case "terminalClose":runOnUiThread(()->closeTerminal());result=true;break;
                    default:result=engine.call(action,a);
                }
                response.put("id",id);response.put("ok",true);response.put("data",result==null?JSONObject.NULL:result);
            }catch(Throwable e){try{response.put("id",id);response.put("ok",false);response.put("error",e.getMessage()==null?e.getClass().getSimpleName():e.getMessage());}catch(JSONException ignored){}}
            final String json=response.toString();runOnUiThread(()->{if(web!=null)web.evaluateJavascript("window.receive&&window.receive("+json+")",null);});
            });
        }
    }
    private int dp(int value){return Math.round(value*getResources().getDisplayMetrics().density);}
    private String[] terminalEnv(String home,String cwd){
        File envFile=new File(getCacheDir(),"termux.env");
        try(FileOutputStream out=new FileOutputStream(envFile)){out.write("PS1=':\\w \\$ '\n".getBytes(StandardCharsets.UTF_8));}catch(IOException ignored){}
        return new String[]{
        "HOME="+home,
        "PWD="+cwd,
        "TMPDIR="+getCacheDir().getAbsolutePath(),
        "PATH=/sbin:/system/sbin:/system/bin:/system/xbin:/vendor/bin",
        "TERM=xterm-256color",
        "COLORTERM=truecolor",
        "LANG=en_US.UTF-8",
        "ENV="+envFile.getAbsolutePath(),
        "PS1=:\\w \\$ "
    };}
    private void openTerminal(String path){
        if(terminalOverlay!=null||root==null)return;
        File cwd=new File(path);
        if(!cwd.isDirectory())cwd=getFilesDir();
        final String cwdPath=cwd.getAbsolutePath();
        final String home=getFilesDir().getAbsolutePath();
        terminalTextSize=14;
        terminalView=new TerminalView(this,null);
        terminalView.setTerminalViewClient(new TermViewClient());
        terminalView.setTextSize(terminalTextSize);
        terminalView.setBackgroundColor(0xff000000);
        terminalView.setTypeface(Typeface.MONOSPACE);
        terminalSession=new TerminalSession("/system/bin/sh",cwdPath,new String[]{"-i"},terminalEnv(home,cwdPath),2000,new TermSessionClient());
        terminalView.attachSession(terminalSession);

        terminalOverlay=new FrameLayout(this);
        terminalOverlay.setBackgroundColor(0xff000000);
        LinearLayout column=new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.addView(terminalView,new LinearLayout.LayoutParams(-1,0,1));

        LinearLayout keys=new LinearLayout(this);
        keys.setOrientation(LinearLayout.VERTICAL);
        keys.setBackgroundColor(0xff000000);
        addTerminalKeyRow(keys,new String[][]{{"Esc","esc"},{"Tab","tab"},{"PgUp","pgup"},{"Home","home"},{"▲","up"},{"End","end"},{"⋮","menu"}});
        addTerminalKeyRow(keys,new String[][]{{"Ctrl","ctrl"},{"Alt","alt"},{"PgDn","pgdn"},{"◀","left"},{"▼","down"},{"▶","right"},{"⇄","keyboard"}});
        column.addView(keys,new LinearLayout.LayoutParams(-1,-2));
        terminalOverlay.addView(column,new FrameLayout.LayoutParams(-1,-1));

        root.addView(terminalOverlay,new FrameLayout.LayoutParams(-1,-1));
        terminalView.post(()->{if(terminalView!=null)terminalView.requestFocus();});
    }
    private void addTerminalKeyRow(LinearLayout parent,String[][] keys){
        LinearLayout row=new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        for(final String[] key:keys){
            TextView b=new TextView(this);
            b.setText(key[0]);b.setTextSize(15);b.setTextColor(0xfff0f0f0);b.setTypeface(Typeface.MONOSPACE);
            b.setGravity(Gravity.CENTER);b.setBackgroundColor(0xff000000);b.setClickable(true);b.setFocusable(false);b.setPadding(0,0,0,0);
            b.setOnClickListener(v->handleTerminalKey(key[1],b));
            if(key[1].equals("ctrl"))terminalCtrlKey=b;
            if(key[1].equals("alt"))terminalAltKey=b;
            row.addView(b,new LinearLayout.LayoutParams(0,dp(42),1));
        }
        parent.addView(row,new LinearLayout.LayoutParams(-1,dp(42)));
    }
    private void handleTerminalKey(String action,TextView view){
        switch(action){
            case "ctrl":terminalCtrl=!terminalCtrl;updateTerminalModifiers();focusTerminal();return;
            case "alt":terminalAlt=!terminalAlt;updateTerminalModifiers();focusTerminal();return;
            case "menu":showTerminalMenu(view);return;
            case "keyboard":toggleTerminalKeyboard();return;
            case "esc":writeTerminal("\u001b");return;
            case "tab":writeTerminal("\t");return;
            case "pgup":writeTerminal("\u001b[5~");return;
            case "pgdn":writeTerminal("\u001b[6~");return;
            case "home":writeTerminal("\u001b[H");return;
            case "end":writeTerminal("\u001b[F");return;
            case "up":writeTerminal("\u001b[A");return;
            case "down":writeTerminal("\u001b[B");return;
            case "left":writeTerminal("\u001b[D");return;
            case "right":writeTerminal("\u001b[C");return;
        }
    }
    private void writeTerminal(String text){
        resetTerminalModifiers();
        TerminalSession session=terminalSession;
        if(session!=null){byte[] bytes=text.getBytes(StandardCharsets.UTF_8);session.write(bytes,0,bytes.length);}
        focusTerminal();
    }
    private void resetTerminalModifiers(){terminalCtrl=false;terminalAlt=false;updateTerminalModifiers();}
    private void updateTerminalModifiers(){
        if(terminalCtrlKey!=null){terminalCtrlKey.setTextColor(terminalCtrl?0xff7fb3ff:0xfff0f0f0);terminalCtrlKey.setBackgroundColor(terminalCtrl?0xff1d3b5a:0xff000000);}
        if(terminalAltKey!=null){terminalAltKey.setTextColor(terminalAlt?0xff7fb3ff:0xfff0f0f0);terminalAltKey.setBackgroundColor(terminalAlt?0xff1d3b5a:0xff000000);}
    }
    private void focusTerminal(){TerminalView view=terminalView;if(view!=null)view.requestFocus();}
    private void toggleTerminalKeyboard(){
        TerminalView view=terminalView;
        if(view==null)return;
        InputMethodManager imm=(InputMethodManager)getSystemService(INPUT_METHOD_SERVICE);
        if(imm==null)return;
        if(imm.isActive(view))imm.hideSoftInputFromWindow(view.getWindowToken(),0);
        else{view.requestFocus();imm.showSoftInput(view,InputMethodManager.SHOW_IMPLICIT);}
    }
    private void pasteTerminal(){
        TerminalSession session=terminalSession;
        if(session==null)return;
        ClipboardManager cm=(ClipboardManager)getSystemService(CLIPBOARD_SERVICE);
        if(cm==null||!cm.hasPrimaryClip()||cm.getPrimaryClip()==null||cm.getPrimaryClip().getItemCount()==0)return;
        CharSequence text=cm.getPrimaryClip().getItemAt(0).coerceToText(this);
        if(text!=null){byte[] bytes=text.toString().getBytes(StandardCharsets.UTF_8);if(bytes.length>0)session.write(bytes,0,bytes.length);}
        focusTerminal();
    }
    private void showTerminalMenu(View anchor){
        PopupMenu menu=new PopupMenu(this,anchor);
        menu.getMenu().add(0,1,0,"粘贴");
        menu.getMenu().add(0,2,1,"清空屏幕");
        menu.getMenu().add(0,3,2,"关闭终端");
        menu.setOnMenuItemClickListener(item->{
            switch(item.getItemId()){
                case 1:pasteTerminal();return true;
                case 2:writeTerminal("\u000c");return true;
                case 3:closeTerminal();return true;
            }
            return false;
        });
        menu.show();
    }
    private void closeTerminal(){
        if(terminalOverlay==null)return;
        FrameLayout overlay=terminalOverlay;
        terminalOverlay=null;terminalView=null;terminalCtrlKey=null;terminalAltKey=null;terminalCtrl=false;terminalAlt=false;
        TerminalSession session=terminalSession;terminalSession=null;
        if(root!=null)root.removeView(overlay);
        if(session!=null){try{session.finishIfRunning();}catch(Throwable ignored){}}
        if(web!=null){web.requestFocus();web.evaluateJavascript("window.terminalClosed&&window.terminalClosed()",null);}
    }
    private final class TermSessionClient implements TerminalSessionClient {
        @Override public void onTextChanged(TerminalSession session){runOnUiThread(()->{if(terminalView!=null)terminalView.onScreenUpdated();});}
        @Override public void onTitleChanged(TerminalSession session){}
        @Override public void onSessionFinished(TerminalSession session){runOnUiThread(()->{if(terminalOverlay!=null){toast("终端会话已结束");closeTerminal();}});}
        @Override public void onCopyTextToClipboard(TerminalSession session,String text){runOnUiThread(()->{ClipboardManager cm=(ClipboardManager)getSystemService(CLIPBOARD_SERVICE);if(cm!=null)cm.setPrimaryClip(ClipData.newPlainText("Termux",text));});}
        @Override public void onPasteTextFromClipboard(TerminalSession session){
            try{ClipboardManager cm=(ClipboardManager)getSystemService(CLIPBOARD_SERVICE);if(cm==null||!cm.hasPrimaryClip()||cm.getPrimaryClip()==null||cm.getPrimaryClip().getItemCount()==0)return;CharSequence text=cm.getPrimaryClip().getItemAt(0).coerceToText(MainActivity.this);if(text!=null){byte[] bytes=text.toString().getBytes(StandardCharsets.UTF_8);if(bytes.length>0)session.write(bytes,0,bytes.length);}}catch(Throwable ignored){}
        }
        @Override public void onBell(TerminalSession session){}
        @Override public void onColorsChanged(TerminalSession session){runOnUiThread(()->{if(terminalView!=null)terminalView.onScreenUpdated();});}
        @Override public void onTerminalCursorStateChange(boolean state){}
        @Override public Integer getTerminalCursorStyle(){return TerminalEmulator.DEFAULT_TERMINAL_CURSOR_STYLE;}
        @Override public void logError(String tag,String message){android.util.Log.e(tag,message);}
        @Override public void logWarn(String tag,String message){android.util.Log.w(tag,message);}
        @Override public void logInfo(String tag,String message){android.util.Log.i(tag,message);}
        @Override public void logDebug(String tag,String message){android.util.Log.d(tag,message);}
        @Override public void logVerbose(String tag,String message){android.util.Log.v(tag,message);}
        @Override public void logStackTraceWithMessage(String tag,String message,Exception e){android.util.Log.e(tag,message,e);}
        @Override public void logStackTrace(String tag,Exception e){android.util.Log.e(tag,"",e);}
    }
    private final class TermViewClient implements TerminalViewClient {
        @Override public float onScale(float scale){return 1f;}
        @Override public void onSingleTapUp(MotionEvent e){InputMethodManager imm=(InputMethodManager)getSystemService(INPUT_METHOD_SERVICE);if(imm!=null&&terminalView!=null){terminalView.requestFocus();imm.showSoftInput(terminalView,InputMethodManager.SHOW_IMPLICIT);}}
        @Override public boolean shouldBackButtonBeMappedToEscape(){return false;}
        @Override public boolean shouldEnforceCharBasedInput(){return true;}
        @Override public boolean shouldUseCtrlSpaceWorkaround(){return true;}
        @Override public boolean isTerminalViewSelected(){return terminalView!=null;}
        @Override public void copyModeChanged(boolean copyMode){}
        @Override public boolean onKeyDown(int keyCode,KeyEvent e,TerminalSession session){return false;}
        @Override public boolean onKeyUp(int keyCode,KeyEvent e){return false;}
        @Override public boolean onLongPress(MotionEvent event){return false;}
        @Override public boolean readControlKey(){return terminalCtrl;}
        @Override public boolean readAltKey(){return terminalAlt;}
        @Override public boolean readShiftKey(){return false;}
        @Override public boolean readFnKey(){return false;}
        @Override public boolean onCodePoint(int codePoint,boolean ctrlDown,TerminalSession session){if(terminalCtrl||terminalAlt)resetTerminalModifiers();return false;}
        @Override public void onEmulatorSet(){}
        @Override public void logError(String tag,String message){android.util.Log.e(tag,message);}
        @Override public void logWarn(String tag,String message){android.util.Log.w(tag,message);}
        @Override public void logInfo(String tag,String message){android.util.Log.i(tag,message);}
        @Override public void logDebug(String tag,String message){android.util.Log.d(tag,message);}
        @Override public void logVerbose(String tag,String message){android.util.Log.v(tag,message);}
        @Override public void logStackTraceWithMessage(String tag,String message,Exception e){android.util.Log.e(tag,message,e);}
        @Override public void logStackTrace(String tag,Exception e){android.util.Log.e(tag,"",e);}
    }
    private File shareCopy(File src)throws IOException{File root=new File(getCacheDir(),"shared");root.mkdirs();File dst=FileOps.child(root,src.getName());java.nio.file.Files.copy(src.toPath(),dst.toPath(),java.nio.file.StandardCopyOption.REPLACE_EXISTING);return dst;}
    private Uri shareUri(File f){return new Uri.Builder().scheme("content").authority(getPackageName()+".files").appendPath(f.getName()).build();}
    private void install(File f){try{
        if(Build.VERSION.SDK_INT>=26&&!getPackageManager().canRequestPackageInstalls()){startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+getPackageName())));toast("允许安装后，再轻点安装");return;}
        Intent i=new Intent(Intent.ACTION_VIEW).setDataAndType(shareUri(f),"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);startActivity(i);
    }catch(Exception e){toast(e.getMessage());}}
    private void share(File f){try{Intent i=new Intent(Intent.ACTION_SEND).setType("application/octet-stream").putExtra(Intent.EXTRA_STREAM,shareUri(f)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);startActivity(Intent.createChooser(i,"分享文件"));}catch(Exception e){toast(e.getMessage());}}
    private void storagePermission(){try{if(Build.VERSION.SDK_INT>=30)startActivity(new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,Uri.parse("package:"+getPackageName())));else requestPermissions(new String[]{Manifest.permission.READ_EXTERNAL_STORAGE,Manifest.permission.WRITE_EXTERNAL_STORAGE},10);}catch(Exception e){startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));}}
    private void toast(String s){android.widget.Toast.makeText(this,s,android.widget.Toast.LENGTH_LONG).show();}
    private static final int COLOR_PICK_REQ=200;
    private static final int COLOR_PICK_NOTIF_REQ=201;
    private boolean colorPickerNotifPending=false;
    /** 屏幕取色入口：悬浮窗权限 → 通知权限（33+）→ 屏幕录制授权 → 启动前台服务。 */
    void startColorPicker(){
        if(ColorPicker.isRunning()){toast("屏幕取色已在运行");return;}
        if(!Settings.canDrawOverlays(this)){
            toast("请先允许本应用「显示在其他应用上层」，然后再次点击开始取色");
            try{startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,Uri.parse("package:"+getPackageName())));}catch(Exception ignored){}
            return;
        }
        if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){
            colorPickerNotifPending=true;
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},COLOR_PICK_NOTIF_REQ);
            toast("请允许通知（取色以前台服务运行），然后按提示继续");
            return;
        }
        launchColorProjection();
    }
    private void launchColorProjection(){
        try{
            android.media.projection.MediaProjectionManager m=(android.media.projection.MediaProjectionManager)getSystemService("media_projection");
            if(m==null){toast("此设备不支持屏幕取色");return;}
            startActivityForResult(m.createScreenCaptureIntent(),COLOR_PICK_REQ);
        }catch(Exception e){toast("无法启动屏幕取色："+(e.getMessage()==null?e.getClass().getSimpleName():e.getMessage()));}
    }
    Object colorPicker(JSONObject a)throws Exception{
        String op=a.optString("op","start");
        if(op.equals("stop")){runOnUiThread(()->ColorPicker.stopService(this));return new JSONObject().put("running",ColorPicker.isRunning());}
        if(op.equals("status"))return new JSONObject().put("running",ColorPicker.isRunning());
        if(op.equals("get")){
            SharedPreferences p=getSharedPreferences(ColorPicker.PREFS,MODE_PRIVATE);
            return new JSONObject()
                    .put("magnifierSize",p.getString(ColorPicker.PREF_MAGNIFIER_SIZE,"small"))
                    .put("captureSpeed",p.getString(ColorPicker.PREF_CAPTURE_SPEED,"normal"))
                    .put("showGridLines",p.getBoolean(ColorPicker.PREF_SHOW_GRID_LINES,true))
                    .put("captureRange",p.getString(ColorPicker.PREF_CAPTURE_RANGE,"small"));
        }
        if(op.equals("set")){
            SharedPreferences.Editor e=getSharedPreferences(ColorPicker.PREFS,MODE_PRIVATE).edit();
            String key=a.optString("key","");
            if(key.equals("magnifierSize"))e.putString(ColorPicker.PREF_MAGNIFIER_SIZE,a.getString("value"));
            else if(key.equals("captureSpeed"))e.putString(ColorPicker.PREF_CAPTURE_SPEED,a.getString("value"));
            else if(key.equals("captureRange"))e.putString(ColorPicker.PREF_CAPTURE_RANGE,a.getString("value"));
            else if(key.equals("showGridLines"))e.putBoolean(ColorPicker.PREF_SHOW_GRID_LINES,a.getBoolean("value"));
            e.apply();
            return new JSONObject().put("ok",true);
        }
        runOnUiThread(()->startColorPicker());
        return new JSONObject().put("started",true).put("running",ColorPicker.isRunning());
    }
    @Override protected void onActivityResult(int req,int res,Intent data){
        super.onActivityResult(req,res,data);
        if(req==COLOR_PICK_REQ){
            if(res==RESULT_OK&&data!=null){
                try{
                    Intent i=new Intent(this,ColorPickerService.class)
                            .putExtra(ColorPickerService.EXTRA_RESULT_CODE,res)
                            .putExtra(ColorPickerService.EXTRA_RESULT_DATA,data);
                    startForegroundService(i);
                    toast("屏幕取色已启动：拖动准星取样，轻点放大镜上的色值或坐标即复制");
                }catch(Exception e){toast("取色启动失败："+(e.getMessage()==null?e.getClass().getSimpleName():e.getMessage()));}
            }else toast("未授权屏幕录制，取色已取消");
        }
    }
    @Override public void onRequestPermissionsResult(int req,String[] perms,int[] results){
        super.onRequestPermissionsResult(req,perms,results);
        if(req==COLOR_PICK_NOTIF_REQ){
            colorPickerNotifPending=false;
            if(results.length>0&&results[0]==PackageManager.PERMISSION_GRANTED)launchColorProjection();
            else toast("未授予通知权限，取色已取消");
        }
    }
    @Override protected void onResume(){super.onResume();if(web!=null)web.evaluateJavascript("window.onNativeResume&&window.onNativeResume()",null);}
    @Override public void onBackPressed(){if(terminalOverlay!=null){closeTerminal();return;}if(web!=null)web.evaluateJavascript("window.goBack&&window.goBack()",null);}
    @Override protected void onDestroy(){closeTerminal();if(engine!=null)engine.close();worker.shutdownNow();thumbnails.shutdownNow();if(web!=null){web.removeJavascriptInterface("CyberNative");web.destroy();web=null;}super.onDestroy();}
}
