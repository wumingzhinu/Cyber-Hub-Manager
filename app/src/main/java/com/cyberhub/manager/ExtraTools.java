package com.cyberhub.manager;

/* Round-3 extras: folder comparison, generic binary data for previews,
 * media/MIDI/ffmpeg probing, signature fingerprints and launcher icon aliases.
 * Kept in one class so DataEngine only needs a handful of switch cases. */
import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.SigningInfo;
import android.media.MediaMetadataRetriever;
import android.os.Build;
import com.android.apksig.ApkVerifier;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.SortedMap;
import java.util.SortedSet;
import java.util.TreeMap;
import java.util.TreeSet;

public final class ExtraTools {
 private ExtraTools(){}
 private static final long MAX_PREVIEW=16L*1024*1024;
 private static final long HASH_BUDGET=256L*1024*1024;

 /* ---------------- P2: folder comparison ---------------- */
 public static JSONObject compareFolders(File left,File right,boolean hash)throws Exception{
  if(left==null||right==null||!left.isDirectory()||!right.isDirectory())throw new java.io.IOException("请选择两个本地文件夹");
  SortedMap<String,File>a=new TreeMap<>(),b=new TreeMap<>();
  walk(left,left,a,0);walk(right,right,b,0);
  SortedSet<String>keys=new TreeSet<>(a.keySet());keys.addAll(b.keySet());
  JSONArray rows=new JSONArray();int added=0,removed=0,changed=0,same=0;long used=0;
  for(String k:keys){
   File x=a.get(k),y=b.get(k);
   if(x==null){added++;if(rows.length()<2000)rows.put(row(k,"仅右侧",0,y.length(),"",""));continue;}
   if(y==null){removed++;if(rows.length()<2000)rows.put(row(k,"仅左侧",x.length(),0,"",""));continue;}
   boolean sizeDiff=x.length()!=y.length(),contentDiff=false;String hx="",hy="";
   if(hash&&!sizeDiff&&x.isFile()&&used+x.length()<=HASH_BUDGET){
    hx=FileOps.sha256(x);hy=FileOps.sha256(y);used+=x.length();contentDiff=!hx.equals(hy);
   }
   if(sizeDiff||contentDiff){changed++;if(rows.length()<2000)rows.put(row(k,"不同",x.length(),y.length(),shortHash(hx),shortHash(hy)));}
   else same++;
  }
  return new JSONObject().put("rows",rows).put("left",left.getPath()).put("right",right.getPath())
   .put("added",added).put("removed",removed).put("changed",changed).put("same",same)
   .put("total",keys.size()).put("hash",hash).put("truncated",added+removed+changed>rows.length());
 }
 private static String shortHash(String h){return h==null||h.length()<16?"":h.substring(0,16);}
 private static JSONObject row(String n,String st,long ls,long rs,String lh,String rh)throws Exception{
  return new JSONObject().put("name",n).put("status",st).put("leftSize",ls).put("rightSize",rs)
   .put("leftHash",lh).put("rightHash",rh);
 }
 private static void walk(File root,File dir,SortedMap<String,File>map,int depth)throws java.io.IOException{
  if(depth>24||map.size()>20000)return;
  File[] fs=dir.listFiles();
  if(fs==null)throw new java.io.IOException("无法读取文件夹 "+dir.getPath());
  String base=root.getAbsolutePath();
  for(File f:fs){
   if(map.size()>20000)return;
   String abs=f.getAbsolutePath(),rel=abs.length()>base.length()?abs.substring(base.length()+1).replace(File.separatorChar,'/'):f.getName();
   if(f.isDirectory()){map.put(rel+"/",f);walk(root,f,map,depth+1);}
   else map.put(rel,f);
  }
 }

 /* ---------------- P1: generic file data for previews ---------------- */
 public static JSONObject fileData(File f)throws Exception{
  if(f==null||!f.isFile())throw new java.io.IOException("文件不存在");
  if(f.length()>MAX_PREVIEW)throw new java.io.IOException("文件超过 16 MB，无法预览");
  byte[] data=FileOps.read(f,MAX_PREVIEW);
  String n=f.getName().toLowerCase(Locale.US),mime="application/octet-stream";
  if(n.endsWith(".ttf"))mime="font/ttf";
  else if(n.endsWith(".otf"))mime="font/otf";
  else if(n.endsWith(".woff2"))mime="font/woff2";
  else if(n.endsWith(".woff"))mime="font/woff";
  else if(n.endsWith(".png"))mime="image/png";
  else if(n.endsWith(".svg"))mime="image/svg+xml";
  return new JSONObject().put("name",f.getName()).put("size",data.length).put("mime",mime)
   .put("data",Base64.getEncoder().encodeToString(data));
 }
 /* Write edited nine-patch PNG bytes next to the source; never overwrites it. */
 public static JSONObject saveFileData(File src,String base64)throws Exception{
  if(src==null||!src.isFile())throw new java.io.IOException("源文件不存在");
  byte[] data=Base64.getDecoder().decode(base64);
  if(data.length>MAX_PREVIEW)throw new java.io.IOException("文件超过 16 MB");
  if(data.length<8||data[0]!=(byte)137||data[1]!='P'||data[2]!='N'||data[3]!='G')throw new java.io.IOException("导出内容不是有效的 PNG");
  File dir=src.getParentFile();
  if(dir==null||!dir.canWrite())throw new java.io.IOException("目标目录不可写");
  String base=src.getName().replaceFirst("\\.(?i:png)$","");
  File dst=new File(dir,base+"_edited.9.png");int n=2;
  while(dst.exists())dst=new File(dir,base+"_edited-"+(n++)+".9.png");
  FileOps.writeAtomic(dst,data,false);
  return new JSONObject().put("path",dst.getPath()).put("size",data.length);
 }

 /* ---------------- P2: media / MIDI / ffmpeg probing ---------------- */
 public static JSONObject mediaProbe(Context ctx,File f)throws Exception{
  if(f==null||!f.isFile())throw new java.io.IOException("媒体文件不存在");
  String lower=f.getName().toLowerCase(Locale.US);
  JSONObject out=new JSONObject().put("name",f.getName()).put("size",f.length());
  if(lower.endsWith(".mid")||lower.endsWith(".midi")||lower.endsWith(".rmi")){
   out.put("kind","midi").put("midi",midiInfo(f));
  }else{
   JSONObject media=new JSONObject();MediaMetadataRetriever r=new MediaMetadataRetriever();
   try{
    r.setDataSource(f.getAbsolutePath());
    putMeta(media,r,"duration",MediaMetadataRetriever.METADATA_KEY_DURATION);
    putMeta(media,r,"width",MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH);
    putMeta(media,r,"height",MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT);
    putMeta(media,r,"mime",MediaMetadataRetriever.METADATA_KEY_MIMETYPE);
    putMeta(media,r,"bitrate",MediaMetadataRetriever.METADATA_KEY_BITRATE);
    putMeta(media,r,"rotation",MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION);
    putMeta(media,r,"artist",MediaMetadataRetriever.METADATA_KEY_ARTIST);
    putMeta(media,r,"title",MediaMetadataRetriever.METADATA_KEY_TITLE);
    putMeta(media,r,"album",MediaMetadataRetriever.METADATA_KEY_ALBUM);
    putMeta(media,r,"date",MediaMetadataRetriever.METADATA_KEY_DATE);
   }catch(Throwable e){media.put("error",e.getMessage()==null?e.getClass().getSimpleName():e.getMessage());}
   finally{try{r.release();}catch(Throwable ignored){}}
   out.put("kind","media").put("media",media);
  }
  out.put("ffmpeg",ffmpegInfo(f));
  return out;
 }
 private static void putMeta(JSONObject o,MediaMetadataRetriever r,String key,int code)throws Exception{
  try{String v=r.extractMetadata(code);if(v!=null)o.put(key,v);}catch(Throwable ignored){}
 }
 private static JSONObject midiInfo(File f)throws Exception{
  byte[] b=FileOps.read(f,16L*1024*1024);
  if(b.length<14||b[0]!='M'||b[1]!='T'||b[2]!='h'||b[3]!='d')throw new java.io.IOException("不是有效的 MIDI 文件（缺少 MThd）");
  long headerLen=u32(b,4);
  int format=((b[8]&255)<<8)|(b[9]&255),tracks=((b[10]&255)<<8)|(b[11]&255),division=((b[12]&255)<<8)|(b[13]&255);
  int pos=(int)(8+headerLen);if(pos<14||pos>b.length)pos=14;
  int trackCount=0,events=0,maxTicks=0,tempo=500000;
  while(pos+8<=b.length&&trackCount<512){
   if(b[pos]!='M'||b[pos+1]!='T'||b[pos+2]!='r'||b[pos+3]!='k')break;
   int len=(int)u32(b,pos+4),start=pos+8,end=Math.min(b.length,start+len);
   int p=start,ticks=0,running=-1;
   while(p<end){
    long[] vl=varlen(b,p,end);if(vl==null)break;ticks+=(int)vl[0];p=(int)vl[1];
    if(p>=end)break;
    int st=b[p]&255;
    if(st==0xFF){
     if(p+2>=end)break;int type=b[p+1]&255;long[] l=varlen(b,p+2,end);if(l==null)break;
     int ds=(int)l[1],dl=(int)l[0];
     if(type==0x51&&dl>=3&&ds+3<=end)tempo=((b[ds]&255)<<16)|((b[ds+1]&255)<<8)|(b[ds+2]&255);
     p=ds+dl;
    }else if(st==0xF0||st==0xF7){
     long[] l=varlen(b,p+1,end);if(l==null)break;p=(int)l[1]+(int)l[0];
    }else{
     int status;
     if((st&0x80)!=0){status=st;p++;running=st;}
     else{status=running;if(status<0)break;}
     int hi=status&0xF0;p+=(hi==0xC0||hi==0xD0)?1:2;
    }
    events++;
   }
   maxTicks=Math.max(maxTicks,ticks);trackCount++;pos=end;
   if(len<=0)break;
  }
  boolean smpte=(division&0x8000)!=0;
  double seconds=smpte||division<=0?0:(double)maxTicks/division*tempo/1000000.0;
  String formatName=format==0?"单轨":format==1?"同步多轨":format==2?"独立多轨":"未知 ("+format+")";
  return new JSONObject().put("format",formatName).put("formatCode",format).put("tracks",tracks)
   .put("foundTracks",trackCount).put("division",division).put("smpte",smpte)
   .put("tempoBpm",tempo>0?Math.round(60000000.0/tempo):0).put("events",events)
   .put("maxTicks",maxTicks).put("durationMs",(long)(seconds*1000));
 }
 private static long[] varlen(byte[] b,int p,int end){
  long v=0;int n=0;
  while(p<end&&n<4){int x=b[p]&255;v=(v<<7)|(x&0x7f);p++;n++;if((x&0x80)==0)return new long[]{v,p};}
  return null;
 }
 private static long u32(byte[] b,int o){return ((b[o]&255L)<<24)|((b[o+1]&255L)<<16)|((b[o+2]&255L)<<8)|(b[o+3]&255L);}
 private static JSONObject ffmpegInfo(File f){
  JSONObject o=new JSONObject();String exe=findFfmpeg();
  try{o.put("available",exe!=null);}catch(Exception ignored){}
  if(exe==null)return o;
  try{
   o.put("path",exe);
   Process p=new ProcessBuilder(exe,"-version").redirectErrorStream(true).start();
   String v=runCapture(p),line=v.isEmpty()?"":v.split("\\n")[0];
   o.put("version",line.length()>160?line.substring(0,160):line);
   Process probe=new ProcessBuilder(exe,"-hide_banner","-i",f.getAbsolutePath()).redirectErrorStream(true).start();
   String text=runCapture(probe);
   o.put("probe",text.length()>4000?text.substring(0,4000):text);
  }catch(Throwable e){try{o.put("error",e.getMessage()==null?e.getClass().getSimpleName():e.getMessage());}catch(Exception ignored){}}
  return o;
 }
 private static String findFfmpeg(){
  String[] paths={"/system/bin/ffmpeg","/system/xbin/ffmpeg","/vendor/bin/ffmpeg",
   "/data/data/com.termux/files/usr/bin/ffmpeg","/data/user/0/com.termux/files/usr/bin/ffmpeg"};
  for(String p:paths)if(new File(p).canExecute())return p;
  String env=System.getenv("PATH");
  if(env!=null)for(String d:env.split(":")){File f=new File(d,"ffmpeg");if(f.canExecute())return f.getAbsolutePath();}
  return null;
 }
 private static String runCapture(final Process p){
  final StringBuilder sb=new StringBuilder();
  Thread t=new Thread(()->{
   try(InputStream in=p.getInputStream()){
    byte[] buf=new byte[4096];int n;
    while(sb.length()<8000&&(n=in.read(buf))!=-1)sb.append(new String(buf,0,n,StandardCharsets.UTF_8));
   }catch(Throwable ignored){}
  });
  t.setDaemon(true);t.start();
  try{t.join(2500);}catch(InterruptedException ignored){}
  try{p.destroy();}catch(Throwable ignored){}
  return sb.toString();
 }

 /* ---------------- P2: signature fingerprints ---------------- */
 public static JSONObject signatures(Context ctx,String apkPath)throws Exception{
  JSONObject out=new JSONObject().put("self",selfSignatures(ctx));
  if(apkPath!=null&&!apkPath.isEmpty()){
   File f=new File(apkPath);
   if(!f.isFile())out.put("fileError","APK 未找到");
   else{
    ApkVerifier.Result r=new ApkVerifier.Builder(f).build().verify();
    JSONObject info=new JSONObject().put("verified",r.isVerified())
     .put("v1",r.isVerifiedUsingV1Scheme()).put("v2",r.isVerifiedUsingV2Scheme()).put("v3",r.isVerifiedUsingV3Scheme())
     .put("name",f.getName()).put("size",f.length());
    JSONArray certs=new JSONArray();
    for(X509Certificate c:r.getSignerCertificates())certs.put(certInfo(c));
    info.put("certificates",certs);
    JSONArray issues=new JSONArray();
    try{for(Object x:(List<?>)r.getErrors())issues.put(String.valueOf(x));}catch(Throwable ignored){}
    info.put("errors",issues);
    out.put("file",info);
   }
  }
  return out;
 }
 private static JSONObject selfSignatures(Context ctx){
  JSONObject o=new JSONObject();JSONArray arr=new JSONArray();
  try{o.put("package",ctx.getPackageName());}catch(Exception ignored){}
  try{
   PackageManager pm=ctx.getPackageManager();android.content.pm.Signature[] sigs;
   if(Build.VERSION.SDK_INT>=28){
    PackageInfo pi=pm.getPackageInfo(ctx.getPackageName(),PackageManager.GET_SIGNING_CERTIFICATES);
    SigningInfo si=pi.signingInfo;sigs=si==null?null:si.getApkContentsSigners();
   }else{
    PackageInfo pi=pm.getPackageInfo(ctx.getPackageName(),PackageManager.GET_SIGNATURES);
    sigs=pi.signatures;
   }
   if(sigs!=null)for(android.content.pm.Signature s:sigs){
    byte[] raw=s.toByteArray();
    try{
     CertificateFactory cf=CertificateFactory.getInstance("X.509");
     X509Certificate c=(X509Certificate)cf.generateCertificate(new ByteArrayInputStream(raw));
     arr.put(certInfo(c));
    }catch(Throwable e){arr.put(fingerprints(raw));}
   }
  }catch(Throwable e){try{o.put("error",String.valueOf(e.getMessage()));}catch(Exception ignored){}}
  try{o.put("certificates",arr);}catch(Exception ignored){}
  return o;
 }
 private static JSONObject certInfo(X509Certificate c)throws Exception{
  JSONObject o=fingerprints(c.getEncoded());
  o.put("subject",String.valueOf(c.getSubjectX500Principal().getName()));
  o.put("serial",c.getSerialNumber().toString(16));
  o.put("notBefore",String.valueOf(c.getNotBefore()));
  o.put("notAfter",String.valueOf(c.getNotAfter()));
  return o;
 }
 private static JSONObject fingerprints(byte[] data)throws Exception{
  JSONObject o=new JSONObject();
  for(String alg:new String[]{"SHA-256","SHA-1","MD5"}){
   byte[] d=MessageDigest.getInstance(alg).digest(data);StringBuilder s=new StringBuilder();
   for(int i=0;i<d.length;i++){if(i>0)s.append(':');s.append(String.format(Locale.ROOT,"%02X",d[i]&255));}
   o.put(alg.replace("-","").toLowerCase(Locale.ROOT),s.toString());
  }
  return o;
 }

 /* ---------------- P2: launcher icon aliases ---------------- */
 private static final String ALIAS_DEFAULT="com.cyberhub.manager.MainActivityDefault";
 private static final String ALIAS_BLUE="com.cyberhub.manager.MainActivityBlue";
 private static final String ALIAS_GREEN="com.cyberhub.manager.MainActivityGreen";
 public static boolean setIconVariant(Context ctx,String variant){
  String target="极光蓝".equals(variant)?ALIAS_BLUE:"矩阵绿".equals(variant)?ALIAS_GREEN:ALIAS_DEFAULT;
  String[] all={ALIAS_DEFAULT,ALIAS_BLUE,ALIAS_GREEN};
  PackageManager pm=ctx.getPackageManager();
  for(String name:all){
   int state=name.equals(target)?PackageManager.COMPONENT_ENABLED_STATE_ENABLED:PackageManager.COMPONENT_ENABLED_STATE_DISABLED;
   pm.setComponentEnabledSetting(new ComponentName(ctx,name),state,PackageManager.DONT_KILL_APP);
  }
  return true;
 }
 public static String iconVariant(Context ctx){
  String[] all={ALIAS_DEFAULT,ALIAS_BLUE,ALIAS_GREEN};String[] labels={"默认","极光蓝","矩阵绿"};
  for(int i=0;i<all.length;i++){
   int s=ctx.getPackageManager().getComponentEnabledSetting(new ComponentName(ctx,all[i]));
   if(s==PackageManager.COMPONENT_ENABLED_STATE_ENABLED)return labels[i];
  }
  return "默认";
 }
}
