package com.cyberhub.manager;

import android.content.Context;
import android.content.pm.PackageManager;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONObject;
import rikka.shizuku.Shizuku;

/** Root / Shizuku 提权授权的状态查询与申请。阻塞方法须在 worker 线程调用（Bridge 已保证）。 */
public final class ElevatedAccess {
    private ElevatedAccess(){}
    private static final String PREFS="elevated_access",KEY_ROOT="root_granted";
    private static final int SHIZUKU_REQ=300;
    private static volatile Boolean rootCache;
    private static CountDownLatch shizukuLatch;
    private static final AtomicInteger shizukuResult=new AtomicInteger(-1);
    private static volatile boolean listenerAdded=false;

    private static final Shizuku.OnRequestPermissionResultListener LISTENER=(requestCode,grantResult)->{
        if(requestCode!=SHIZUKU_REQ)return;
        shizukuResult.set(grantResult);
        CountDownLatch latch=shizukuLatch;if(latch!=null)latch.countDown();
    };

    public static boolean rootGranted(Context c){
        Boolean cache=rootCache;if(cache!=null)return cache;
        boolean granted=c.getSharedPreferences(PREFS,Context.MODE_PRIVATE).getBoolean(KEY_ROOT,false);
        rootCache=granted;return granted;
    }

    public static boolean shizukuRunning(){
        try{return Shizuku.pingBinder();}catch(Throwable t){return false;}
    }

    public static boolean shizukuGranted(){
        try{return shizukuRunning()&&!Shizuku.isPreV11()&&Shizuku.checkSelfPermission()==PackageManager.PERMISSION_GRANTED;}catch(Throwable t){return false;}
    }

    /** 是否已有任一提权能力：决定无权访问的文件夹是否显示。 */
    public static boolean elevated(Context c){return rootGranted(c)||shizukuGranted();}

    public static JSONObject call(Context c,JSONObject a)throws Exception{
        String op=a.optString("op","status");
        if(op.equals("requestRoot"))return new JSONObject().put("granted",requestRoot(c));
        if(op.equals("requestShizuku"))return new JSONObject().put("granted",requestShizuku());
        return status(c);
    }

    public static JSONObject status(Context c)throws Exception{
        return new JSONObject()
            .put("rootGranted",rootGranted(c))
            .put("rootAvailable",rootBinaryExists())
            .put("shizukuInstalled",shizukuInstalled(c))
            .put("shizukuRunning",shizukuRunning())
            .put("shizukuGranted",shizukuGranted());
    }

    private static boolean shizukuInstalled(Context c){
        try{c.getPackageManager().getPackageInfo("moe.shizuku.privileged.api",0);return true;}catch(Throwable t){return false;}
    }

    private static boolean rootBinaryExists(){
        Process p=null;
        try{
            p=new ProcessBuilder("/system/bin/sh","-c","command -v su").redirectErrorStream(true).start();
            if(!p.waitFor(10,TimeUnit.SECONDS))return false;
            return p.exitValue()==0&&!readAll(p).trim().isEmpty();
        }catch(Throwable t){return false;}
        finally{if(p!=null)p.destroy();}
    }

    /** 触发 su 授权弹窗并等待结果；成功后记忆授权状态。 */
    private static boolean requestRoot(Context c){
        Process p=null;
        try{
            p=new ProcessBuilder("su","-c","id").redirectErrorStream(true).start();
            if(!p.waitFor(90,TimeUnit.SECONDS))return false;
            boolean ok=p.exitValue()==0&&readAll(p).contains("uid=0");
            if(ok){rootCache=true;c.getSharedPreferences(PREFS,Context.MODE_PRIVATE).edit().putBoolean(KEY_ROOT,true).apply();}
            return ok;
        }catch(Throwable t){return false;}
        finally{if(p!=null)p.destroy();}
    }

    private static synchronized boolean requestShizuku(){
        try{
            if(!shizukuRunning()||Shizuku.isPreV11()||Shizuku.getVersion()<11)return false;
            if(Shizuku.checkSelfPermission()==PackageManager.PERMISSION_GRANTED)return true;
            if(!listenerAdded){Shizuku.addRequestPermissionResultListener(LISTENER);listenerAdded=true;}
            shizukuResult.set(-1);
            CountDownLatch latch=new CountDownLatch(1);shizukuLatch=latch;
            try{Shizuku.requestPermission(SHIZUKU_REQ);}catch(Throwable t){shizukuLatch=null;return false;}
            boolean done=latch.await(90,TimeUnit.SECONDS);
            shizukuLatch=null;
            return done&&shizukuResult.get()==PackageManager.PERMISSION_GRANTED;
        }catch(Throwable t){return false;}
    }

    private static String readAll(Process p)throws Exception{
        StringBuilder out=new StringBuilder();
        try(BufferedReader r=new BufferedReader(new InputStreamReader(p.getInputStream(),StandardCharsets.UTF_8))){
            String line;while((line=r.readLine())!=null)out.append(line).append('\n');
        }
        return out.toString();
    }
}
