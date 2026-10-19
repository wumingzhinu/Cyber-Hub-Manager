package com.cyberhub.manager;

import android.content.*;import android.content.pm.*;import android.os.*;
import org.json.*;import java.io.*;import java.nio.charset.StandardCharsets;import java.nio.file.*;import java.text.*;import java.util.*;import java.util.zip.*;
import com.android.apksig.*;

public final class DataEngine {
 final MainActivity activity;final File workspace,cache,trash;final DexEngine dex;final Map<String,Doc> documents=new HashMap<>();final Map<String,Map<String,byte[]>> archiveEdits=new HashMap<>();final Map<String,File> archiveOutputs=new HashMap<>();final LocalService services;private long docCounter=0;
 static class Doc {File file;String archive,entry;Axml axml;long modified;}
 DataEngine(MainActivity a){activity=a;workspace=new File(a.getFilesDir(),"工作区");workspace.mkdirs();cache=new File(a.getCacheDir(),"entries");cache.mkdirs();trash=new File(a.getFilesDir(),"recycle");trash.mkdirs();dex=new DexEngine(new File(a.getCacheDir(),"dex"));services=new LocalService(workspace);
  File welcome=new File(workspace,"欢迎.txt");if(!welcome.exists())try{FileOps.writeAtomic(welcome,("赛博中枢管家 0.1\n\n点「授予文件访问权限」即可浏览手机文件。\n轻点文件打开；长按进行复制、移动、重命名或移入回收站。\nAPK：查看内容、编辑清单、打开 DEX、查看 Java/Smali。\n编辑会创建备份或生成独立的已编辑归档。\nJava 和 Smali 均可编辑。保存会编译更改；「保存并签名 APK」会校验签名并保留备份。\n\n网络服务仅在本应用进程运行时可用。\n").getBytes(StandardCharsets.UTF_8),false);}catch(Exception ignored){}
 }
 boolean permission(){return Build.VERSION.SDK_INT>=30?Environment.isExternalStorageManager():activity.checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE)==PackageManager.PERMISSION_GRANTED;}
 synchronized Object call(String action,JSONObject a)throws Exception{
  switch(action){
   case "init":return new JSONObject().put("permission",permission()).put("home",Environment.getExternalStorageDirectory().getPath()).put("workspace",workspace.getPath()).put("version","0.1.6").put("ownApk",activity.getApplicationInfo().sourceDir);
   case "list":return list(a);
   case "disk":{File f=new File(a.getString("path"));return new JSONObject().put("total",f.getTotalSpace()).put("free",f.getUsableSpace());}
   case "exportText":{File f=FileOps.child(new File(a.getString("path")),a.getString("name"));if(f.exists())throw new IOException("输出已存在");FileOps.writeAtomic(f,a.getString("text").getBytes(StandardCharsets.UTF_8),false);record("已导出 "+f);return f.getPath();}
   case "read":return read(a);
   case "save":return save(a);
   case "pool":{byte[] b=FileOps.read(resolve(a),32L*1024*1024);List<String>ss=Axml.isBinary(b)?Axml.resourceStrings(b):Axml.resourceStrings(b);return new JSONArray(ss);}
   case "resolve":return resolve(a).getPath();
   case "create":{File f=FileOps.child(new File(a.getString("path")),a.getString("name"));if(f.exists())throw new IOException("名称已存在");if(a.optBoolean("folder")){if(!f.mkdir())throw new IOException("无法创建文件夹");}else FileOps.writeAtomic(f,new byte[0],false);record("已创建 "+f);return f.getPath();}
   case "batchRename":{Object r=BatchFiles.rename(a.getJSONArray("files"));record("已重命名所选文件");return r;}
   case "batchTransfer":{JSONArray fs=a.getJSONArray("files");List<File>sources=new ArrayList<>();List<String>names=new ArrayList<>();boolean move=a.optBoolean("move");for(int i=0;i<fs.length();i++){JSONObject f=fs.getJSONObject(i);if(move&&!f.optString("archive").isEmpty())throw new IOException("移动前请先解压归档条目");sources.add(resolve(f));names.add(f.getString("name"));}Object r=BatchFiles.transfer(sources,names,new File(a.getString("destination")),move);record((move?"已移动 ":"已复制 ")+sources.size()+" 个所选文件");return r;}
   case "rename":{File old=new File(a.getString("path"));File dest=FileOps.child(old.getParentFile(),a.getString("name"));if(dest.exists())throw new IOException("名称已存在");Files.move(old.toPath(),dest.toPath());record("已重命名 "+old.getName()+" → "+dest.getName());return dest.getPath();}
   case "copy":case "move":{File src=resolve(a),dst=FileOps.child(new File(a.getString("destination")),src.getName());FileOps.copyTree(src,dst);if(action.equals("move"))FileOps.deleteTree(src);record((action.equals("move")?"已移动":"已复制")+" "+src+" → "+dst);return dst.getPath();}
   case "trash":return recycle(new File(a.getString("path")));
   case "recycleList":return recycleList();
   case "restore":{File meta=FileOps.child(trash,a.getString("id")+".json");JSONObject m=new JSONObject(new String(FileOps.read(meta,65536),StandardCharsets.UTF_8));File src=FileOps.child(trash,a.getString("id")),dst=new File(m.getString("path"));if(dst.exists())throw new IOException("原始路径已被占用");FileOps.copyTree(src,dst);FileOps.deleteTree(src);meta.delete();record("已还原 "+dst);return true;}
   case "purge":{FileOps.deleteTree(FileOps.child(trash,a.getString("id")));FileOps.child(trash,a.getString("id")+".json").delete();return true;}
   case "extract":{File f=resolve(a),dst=FileOps.child(new File(a.getString("destination")),a.getString("name"));FileOps.extract(f,dst);record("已解压 "+f.getName());return dst.getPath();}
   case "compress":{JSONObject r=ArchiveTools.create(a);JSONArray removed=new JSONArray(),failures=new JSONArray();if(a.optBoolean("deleteSources")){JSONArray paths=a.getJSONArray("paths");for(int i=0;i<paths.length();i++){String path=paths.getString(i);try{recycle(new File(path));removed.put(path);}catch(Exception e){failures.put(path+": "+e.getMessage());}}}r.put("removed",removed).put("cleanupErrors",failures);record("已创建归档 "+r.getJSONArray("outputs"));return r;}
   case "archiveExtract":{File src=resolve(a),dest=FileOps.child(new File(a.getString("destination")),a.getString("name"));ArchiveTools.extract(src,dest,a.optString("password"));record("已解压 "+src);return dest.getPath();}
   case "compare":return CompareTools.compare(new File(a.getString("left")),new File(a.getString("right")),a.getString("mode"));
   case "zip":{File f=new File(a.getString("path")),dst=FileOps.child(f.getParentFile(),a.getString("name"));FileOps.zip(f,dst);record("已归档 "+f.getName());return dst.getPath();}
   case "properties":{File f=resolve(a);return new JSONObject().put("path",f.getPath()).put("size",f.length()).put("modified",f.lastModified()).put("readable",f.canRead()).put("writable",f.canWrite()).put("sha256",f.isFile()?FileOps.sha256(f):"—");}
   case "apkInfo":return apkInfo(resolve(a));
   case "bundleInspect":return ApksConverter.inspect(resolve(a));
   case "bundleConvert":{File src=resolve(a),dst=FileOps.child(new File(a.getString("destination")),a.getString("name"));try(InputStream key=activity.getAssets().open("development-signing.p12")){JSONObject result=ApksConverter.convert(src,dst,a.getString("choice"),a.getString("fingerprint"),new File(activity.getCacheDir(),"bundle-conversion"),key,message->activity.bundleProgress(a.optString("job"),message));record("已将 APKS 转换为 "+dst);return result;}}
   case "apkIcon":return iconForPath(a.getString("path"));
   case "sign":{File src=new File(a.getString("path")),dst=FileOps.child(new File(a.optString("destination",src.getParentFile().canWrite()?src.getParent():workspace.getPath())),strip(src.getName())+"-signed.apk");int suffix=2;while(dst.exists())dst=FileOps.child(dst.getParentFile(),strip(src.getName())+"-signed-"+(suffix++)+".apk");sign(src,dst);record("已签名 "+dst.getName());return dst.getPath();}
   case "dexFiles":return dexFiles(resolve(a));
   case "dexOpen":return dex.open(resolve(a),a.getJSONArray("entries"));
   case "dexTree":return dex.tree(a.optString("prefix"));
   case "dexCode":return dex.code(a.getString("class"),a.optString("mode","smali"),a.optString("decompiler","auto"));
   case "dexSave":{Object out=dex.save(a.getString("class"),a.getString("text"));record("已保存 Smali "+a.getString("class"));return out;}
   case "dexJavaSave":{File api=new File(activity.getCacheDir(),"compiler-api-34.jar");if(!api.isFile())try(InputStream in=activity.getAssets().open("compiler/android-api.jar")){FileOps.writeAtomic(api,FileOps.bytes(in,16L*1024*1024),false);}Object out=dex.saveJava(a.getString("class"),a.getString("text"),api);record("已编译 Java "+a.getString("class"));return out;}
   case "dexExport":{File output=new File(a.getString("destination"));Object out=dex.export(output);record("已导出 DEX 更改");return out;}
   case "dexQuery":return dex.query(a);
   case "dexSaveSign":{try(InputStream key=activity.getAssets().open("development-signing.p12")){JSONObject r=dex.commit(key);record("已保存、签名并校验 "+r.getString("path"));return r;}}
   case "dexCommit":{JSONObject r=dex.commit();record("已保存 DEX 工程到 "+r.getString("path"));return r;}
   case "restoreBackup":{File f=FileOps.restoreBackup(new File(a.getString("path")));record("已还原备份 "+f);return f.getPath();}
   case "dexStrings":return dex.strings(a.optString("query"));
   case "dexSearch":return dex.search(a.optString("query"));
   case "apps":return apps();
   case "log":return new JSONArray(activity.getPreferences(0).getString("log","[]"));
   case "terminal":return terminal(a.getString("command"),a.optString("path",workspace.getPath()));
   case "plugins":return plugins(a);
   case "service":return services.action(a);
   case "ftp":return FtpTools.call(a);
   default:throw new IOException("未知操作："+action);
  }
 }
 static String strip(String name){int p=name.lastIndexOf('.');return p>0?name.substring(0,p):name;}
 File resolve(JSONObject a)throws Exception{
  String archive=a.optString("archive");if(archive.isEmpty())return new File(a.getString("path"));String entry=a.getString("entry");String token=Integer.toHexString((archive+"|"+entry).hashCode());File dir=new File(cache,token);dir.mkdirs();File f=FileOps.child(dir,new File(entry).getName());byte[] bytes=FileOps.zipEntry(new File(archive),entry,256L*1024*1024);FileOps.writeAtomic(f,bytes,false);return f;
 }
 JSONArray list(JSONObject a)throws Exception{
  JSONArray out=new JSONArray();String archive=a.optString("archive");if(!archive.isEmpty()){
   String prefix=a.optString("entry");if(!prefix.isEmpty()&&!prefix.endsWith("/"))prefix+="/";Map<String,JSONObject>items=new TreeMap<>();
   try(ZipFile z=new ZipFile(archive)){Enumeration<? extends ZipEntry>en=z.entries();while(en.hasMoreElements()){ZipEntry e=en.nextElement();String name=e.getName();if(!name.startsWith(prefix)||name.equals(prefix))continue;String rest=name.substring(prefix.length());int slash=rest.indexOf('/');boolean dir=slash>=0;String shortName=dir?rest.substring(0,slash):rest;if(shortName.isEmpty())continue;items.put(shortName,new JSONObject().put("name",shortName).put("dir",dir).put("size",dir?0:e.getSize()).put("time",e.getTime()).put("archive",archive).put("entry",prefix+shortName+(dir?"/":"")));}}
   List<JSONObject>vals=new ArrayList<>(items.values());vals.sort((x,y)->Boolean.compare(y.optBoolean("dir"),x.optBoolean("dir")));for(JSONObject v:vals)out.put(v);
  }else{File dir=new File(a.getString("path"));File[] files=dir.listFiles();if(files==null)throw new IOException("无法读取此文件夹。请授予文件访问权限，或选择一个可访问的目录。");Arrays.sort(files,(x,y)->x.isDirectory()!=y.isDirectory()?(x.isDirectory()?-1:1):x.getName().compareToIgnoreCase(y.getName()));long free=dir.getUsableSpace(),total=dir.getTotalSpace();boolean elevated=ElevatedAccess.elevated(activity);for(File f:files){if(!a.optBoolean("hidden")&&f.getName().startsWith("."))continue;if(!elevated&&f.isDirectory()&&!f.canRead())continue;out.put(new JSONObject().put("name",f.getName()).put("path",f.getPath()).put("dir",f.isDirectory()).put("size",f.length()).put("time",f.lastModified()).put("free",free).put("total",total));}}
  return out;
 }
 JSONObject read(JSONObject a)throws Exception{
  File f=resolve(a);byte[] b=FileOps.read(f,FileOps.MAX_TEXT);Doc d=new Doc();d.file=f;d.archive=a.optString("archive");d.entry=a.optString("entry");d.modified=f.lastModified();String text;
  if(Axml.isBinary(b)){d.axml=new Axml();text=d.axml.decode(b);}else{for(int n=0;n<Math.min(b.length,2048);n++)if(b[n]==0)throw new IOException("二进制文件：请使用 APK、DEX 或资源工具");text=new String(b,StandardCharsets.UTF_8);}
  String id="doc"+(++docCounter);documents.put(id,d);return new JSONObject().put("id",id).put("text",text).put("name",f.getName()).put("path",f.getPath()).put("binaryXml",d.axml!=null);
 }
 JSONObject save(JSONObject a)throws Exception{
  Doc d=documents.get(a.getString("id"));if(d==null)throw new IOException("文档会话已过期");if(d.file.lastModified()!=d.modified)throw new IOException("文件已在外部被修改；保存前请重新加载");String text=a.getString("text");byte[] bytes=d.axml==null?text.getBytes(StandardCharsets.UTF_8):d.axml.encode(text);FileOps.writeAtomic(d.file,bytes,true);d.modified=d.file.lastModified();File output=d.file;
  if(!d.archive.isEmpty()){
   Map<String,byte[]>edits=archiveEdits.computeIfAbsent(d.archive,k->new HashMap<>());edits.put(d.entry,bytes);output=archiveOutputs.get(d.archive);
   if(output==null){File src=new File(d.archive);File parent=src.getParentFile().canWrite()?src.getParentFile():workspace;String ext=src.getName().endsWith(".apk")?".apk":".zip";output=new File(parent,strip(src.getName())+"-edited"+ext);int n=2;while(output.exists())output=new File(parent,strip(src.getName())+"-edited-"+(n++)+ext);archiveOutputs.put(d.archive,output);}
   FileOps.rewriteZip(new File(d.archive),output,edits);
  }record("已保存 "+output);return new JSONObject().put("path",output.getPath()).put("needsSigning",output.getName().endsWith(".apk"));
 }
 String recycle(File f)throws Exception{
  if(!f.exists())throw new IOException("文件已不存在");String id=UUID.randomUUID().toString();File target=new File(trash,id);FileOps.copyTree(f,target);JSONObject meta=new JSONObject().put("path",f.getCanonicalPath()).put("name",f.getName()).put("time",System.currentTimeMillis()).put("id",id);FileOps.writeAtomic(new File(trash,id+".json"),meta.toString().getBytes(StandardCharsets.UTF_8),false);FileOps.deleteTree(f);record("已移入回收站 "+f.getName());return id;
 }
 JSONArray recycleList()throws Exception{JSONArray arr=new JSONArray();File[] fs=trash.listFiles();if(fs!=null)for(File f:fs)if(f.getName().endsWith(".json"))arr.put(new JSONObject(new String(FileOps.read(f,65536),StandardCharsets.UTF_8)));return arr;}
 JSONObject apkInfo(File f)throws Exception{
  PackageManager pm=activity.getPackageManager();PackageInfo p=pm.getPackageArchiveInfo(f.getPath(),PackageManager.GET_PERMISSIONS);if(p==null)throw new IOException("Android 无法解析此 APK");p.applicationInfo.sourceDir=f.getPath();p.applicationInfo.publicSourceDir=f.getPath();String sig="未签名 / 未校验";
  try{ApkVerifier.Result v=new ApkVerifier.Builder(f).build().verify();List<String>s=new ArrayList<>();if(v.isVerifiedUsingV1Scheme())s.add("V1");if(v.isVerifiedUsingV2Scheme())s.add("V2");if(v.isVerifiedUsingV3Scheme())s.add("V3");sig=v.isVerified()?String.join(" + ",s):"签名无效或未签名";}catch(Exception e){sig="无法校验："+e.getMessage();}
  return new JSONObject().put("icon",appIcon(p.applicationInfo)).put("name",String.valueOf(p.applicationInfo.loadLabel(pm))).put("package",p.packageName).put("version",p.versionName).put("versionCode",Build.VERSION.SDK_INT>=28?p.getLongVersionCode():p.versionCode).put("size",f.length()).put("signature",sig).put("minSdk",p.applicationInfo.minSdkVersion).put("targetSdk",p.applicationInfo.targetSdkVersion).put("path",f.getPath());
 }
 String iconForPath(String path){PackageInfo info=activity.getPackageManager().getPackageArchiveInfo(path,0);if(info==null||info.applicationInfo==null)return "";info.applicationInfo.sourceDir=path;info.applicationInfo.publicSourceDir=path;return appIcon(info.applicationInfo);}
 String appIcon(ApplicationInfo info){try{android.graphics.drawable.Drawable drawable=info.loadIcon(activity.getPackageManager());android.graphics.Bitmap bitmap=android.graphics.Bitmap.createBitmap(96,96,android.graphics.Bitmap.Config.ARGB_8888);android.graphics.Canvas canvas=new android.graphics.Canvas(bitmap);drawable.setBounds(0,0,96,96);drawable.draw(canvas);ByteArrayOutputStream out=new ByteArrayOutputStream();bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);bitmap.recycle();return "data:image/png;base64,"+android.util.Base64.encodeToString(out.toByteArray(),android.util.Base64.NO_WRAP);}catch(Exception e){return "";}}
 void sign(File src,File dst)throws Exception{try(InputStream key=activity.getAssets().open("development-signing.p12")){ApkSigning.sign(src,dst,key);}}
 JSONArray dexFiles(File f)throws Exception{JSONArray a=new JSONArray();if(f.getName().endsWith(".dex"))return a.put(f.getName());try(ZipFile z=new ZipFile(f)){Enumeration<? extends ZipEntry>en=z.entries();while(en.hasMoreElements()){String n=en.nextElement().getName();if(n.matches("classes[0-9]*\\.dex"))a.put(n);}}return a;}
 JSONArray apps()throws Exception{JSONArray a=new JSONArray();List<ApplicationInfo>apps=activity.getPackageManager().getInstalledApplications(0);apps.sort((x,y)->String.valueOf(x.loadLabel(activity.getPackageManager())).compareToIgnoreCase(String.valueOf(y.loadLabel(activity.getPackageManager()))));for(ApplicationInfo p:apps)a.put(new JSONObject().put("name",String.valueOf(p.loadLabel(activity.getPackageManager()))).put("package",p.packageName).put("path",p.sourceDir));return a;}
 void record(String text){try{JSONArray old=new JSONArray(activity.getPreferences(0).getString("log","[]"));JSONArray next=new JSONArray();next.put(new JSONObject().put("text",text).put("time",System.currentTimeMillis()));for(int i=0;i<Math.min(199,old.length());i++)next.put(old.get(i));activity.getPreferences(0).edit().putString("log",next.toString()).apply();}catch(Exception ignored){}}
 String terminal(String command,String path)throws Exception{if(command.trim().isEmpty())return "";File dir=new File(path);if(!dir.isDirectory())throw new IOException("请先选择一个普通文件夹");java.lang.Process p=new ProcessBuilder("/system/bin/sh","-c",command).directory(dir).redirectErrorStream(true).start();java.util.concurrent.ExecutorService one=java.util.concurrent.Executors.newSingleThreadExecutor();java.util.concurrent.Future<byte[]>future=one.submit(()->FileOps.bytes(p.getInputStream(),1024*1024));try{if(!p.waitFor(20,java.util.concurrent.TimeUnit.SECONDS)){p.destroyForcibly();throw new IOException("命令在 20 秒后超时");}String result=new String(future.get(2,java.util.concurrent.TimeUnit.SECONDS),StandardCharsets.UTF_8);record("终端命令完成（退出码 "+p.exitValue()+")");return result+"\n[退出码 "+p.exitValue()+"]";}finally{p.destroy();one.shutdownNow();}}
 Object plugins(JSONObject a)throws Exception{File dir=new File(workspace,"Plugins");dir.mkdirs();String op=a.optString("op","list");if(op.equals("import")){File src=new File(a.getString("path"));if(!src.getName().endsWith(".sh"))throw new IOException("插件必须是 .sh 脚本");FileOps.copyTree(src,FileOps.child(dir,src.getName()));record("已导入脚本插件 "+src.getName());return true;}if(op.equals("run")){File f=FileOps.child(dir,a.getString("name"));return terminal("/system/bin/sh '"+f.getPath().replace("'","'\\''")+"'",workspace.getPath());}if(op.equals("remove")){FileOps.deleteTree(FileOps.child(dir,a.getString("name")));return true;}JSONArray arr=new JSONArray();File[]fs=dir.listFiles();if(fs!=null)for(File f:fs)if(f.getName().endsWith(".sh"))arr.put(f.getName());return arr;}
 void close(){services.stop();dex.close();}
}
