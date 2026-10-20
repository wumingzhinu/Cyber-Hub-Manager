package com.cyberhub.manager;

import org.jf.dexlib2.*;
import org.jf.dexlib2.dexbacked.DexBackedDexFile;
import org.jf.dexlib2.iface.*;
import org.jf.dexlib2.immutable.*;
import org.jf.dexlib2.immutable.value.ImmutableEncodedValue;
import org.jf.dexlib2.writer.pool.DexPool;
import org.jf.dexlib2.writer.io.MemoryDataStore;

import java.io.File;
import java.io.FileOutputStream;
import java.util.*;
import java.util.zip.*;
import java.util.regex.*;

/**
 * DEX 混淆对抗（对标 MT 管理器「DEX 混淆对抗」）：
 * 把干扰符号 / 单字母 / 超长名 / 非拉丁符号等混淆标识符，
 * 重命名为顺序可读的 abc 字母名。保留内部类关系，不改动方法体。
 *
 * 仅依赖 dexlib2（Apache-2.0）。
 */
public final class DexDeobfuscator {

 /** 写回结果 */
 public static class Report {
  public int dexCount=0, classesRenamed=0, methodsRenamed=0, fieldsRenamed=0;
  public final List<String> renamedClasses=new ArrayList<>();
  public final List<String> errors=new ArrayList<>();
 }

 /** 默认匹配：单字母 / 干扰符号 / 非拉丁 / 超长名 */
 private static final Pattern DEFAULT_OBF = Pattern.compile(
   "^[A-Za-z0-9_]{1,2}$" +                       // 单双字母
   "|^oO0lI1_.*$"                                 // 干扰字符
   "|.*[\\u0600-\\u06FF\\u0750-\\u077F].*"       // 阿拉伯/叙利亚符号
   "|.{40,}"                                        // 超长名
   );

 /**
  * 主入口。target 为 APK 或 .dex。
  * @param customPattern  自定义"哪些名字算混淆"的正则，null/空用默认
  * @param targetClasses  需要处理的类（每行一个，支持 com.foo.* / com.foo.** / ! 排除），null=全部
  * @return 写回后的输出文件（同目录 原名_deobf.apk / .dex）
  */
 public static Report run(File target, String customPattern, List<String> targetClasses, Report out) throws Exception {
  Pattern obf = (customPattern!=null && !customPattern.isEmpty())
    ? Pattern.compile(customPattern) : DEFAULT_OBF;
  out.dexCount = collectAndRewrite(target, obf, targetClasses, out) ? 1 : 0;
  return out;
 }

 /** 收集 dex 列表并逐个重命名写回 */
 static boolean collectAndRewrite(File target, Pattern obf, List<String> targetClasses, Report out) throws Exception {
  if (target.getName().endsWith(".dex")) {
   byte[] data = FileOps.read(target, 512L*1024*1024);
   byte[] outDex = rewriteDex(data, obf, targetClasses, out);
   File outF = new File(target.getParentFile(), target.getName().replaceFirst("\\.dex$","_deobf.dex"));
   try (FileOutputStream fo=new FileOutputStream(outF)) { fo.write(outDex); }
   return out.classesRenamed>0;
  }
  // APK：对每个 classes*.dex 重命名，zip 重写
  Map<String,byte[]> edits = new LinkedHashMap<>();
  try (ZipFile z=new ZipFile(target)) {
   Enumeration<? extends ZipEntry> en=z.entries();
   while (en.hasMoreElements()) {
    ZipEntry e2=en.nextElement();
    if (!e2.getName().matches("classes\\d*\\.dex")) continue;
    byte[] data = FileOps.zipEntry(target, e2.getName(), 512L*1024*1024);
    byte[] outDex = rewriteDex(data, obf, targetClasses, out);
    if (outDex != data) edits.put(e2.getName(), outDex);
   }
  }
  if (edits.isEmpty()) return false;
  File outApk = new File(target.getParentFile(), target.getName().replaceFirst("(\\.apk)$","_deobf$1"));
  FileOps.rewriteZip(target, outApk, edits);
  return true;
 }

 /** 单 dex 重命名：识别混淆类 → 生成 abc 映射 → DexPool 重写 */
 static byte[] rewriteDex(byte[] original, Pattern obf, List<String> targetClasses, Report out) throws Exception {
  DexBackedDexFile dex = new DexBackedDexFile(Opcodes.forDexVersion(35), original);

  // 1) 收集"混淆类"（类名匹配 或 在 targetClasses 里）
  Map<String, String> classMap = new LinkedHashMap<>(); // Lold/; -> Lnew/;
  for (ClassDef c : dex.getClasses()) {
   if (!shouldProcess(c.getType(), obf, targetClasses)) continue;
   String raw = c.getType(); // Lcom/foo/Bar;
   if (!containsObfName(raw, obf)) continue;
   classMap.put(raw, generateReadableName(raw));
  }
  if (classMap.isEmpty()) return original;

  // 2) 对每个被改名的类，重建 ImmutableClassDef（类名 + 方法名 + 字段名 重命名）
  DexPool pool = new DexPool(dex.getOpcodes());
  for (ClassDef c : dex.getClasses()) {
   String oldType = c.getType();
   String newType = classMap.getOrDefault(oldType, oldType);
   // 方法名/字段名：只改"混淆名"成员
   List<Field> newFields = new ArrayList<>();
   for (Field f : c.getStaticFields()) newFields.add(renameField(f, obf, newType));
   for (Field f : c.getInstanceFields()) newFields.add(renameField(f, obf, newType));
   List<Method> newMethods = new ArrayList<>();
   for (Method m : c.getDirectMethods()) newMethods.add(renameMethod(m, obf));
   for (Method m : c.getVirtualMethods()) newMethods.add(renameMethod(m, obf));
   pool.internClass(new ImmutableClassDef(
     newType, c.getAccessFlags(), c.getSuperclass(), c.getInterfaces(),
     c.getSourceFile(), c.getAnnotations(),
     newFields, newFields, newMethods, newMethods));
  }
  MemoryDataStore store = new MemoryDataStore();
  pool.writeTo(store);
  return Arrays.copyOf(store.getData(), store.getSize());
 }

 /** 是否处理该类：targetClasses 过滤（留空全处理；! 前缀排除） */
 static boolean shouldProcess(String type, Pattern obf, List<String> targetClasses) {
  if (targetClasses == null || targetClasses.isEmpty()) return true;
  // 简化：用类描述符匹配规则里的点分名
  String dotted = type.substring(1,type.length()-1).replace('/','.');
  boolean in=false, excluded=false;
  for (String rule : targetClasses) {
   String r=rule.trim(); if (r.isEmpty()) continue;
   if (r.startsWith("!")) {
    String ex=r.substring(1);
    if (matchRule(ex, dotted)) excluded=true;
   } else {
    if (matchRule(r, dotted)) in=true;
   }
  }
  return in && !excluded;
 }

 static boolean matchRule(String rule, String dotted) {
  if (rule.endsWith(".*")) return dotted.startsWith(rule.substring(0,rule.length()-2));
  if (rule.endsWith(".**")) return dotted.startsWith(rule.substring(0,rule.length()-3));
  return dotted.equals(rule);
 }

 /** 类描述符里是否有"混淆名"段 */
 static boolean containsObfName(String typeDesc, Pattern obf) {
  // Lcom/foo/Bar; -> 检查最后一段类名（Bar）
  String simple = typeDesc.substring(typeDesc.lastIndexOf('/')+1, typeDesc.length()-1);
  return obf.matcher(simple).find();
 }

 /** 生成可读名：取原类名首字符 + 顺序 abc（保留包路径） */
 private static final Map<String, Integer> seqCounter = new HashMap<>();
 static String generateReadableName(String typeDesc) {
  int lastSlash = typeDesc.lastIndexOf('/');
  String pkg = typeDesc.substring(0, lastSlash+1); // com/foo/
  String simple = typeDesc.substring(lastSlash+1, typeDesc.length()-1); // Bar
  // 内部类：保留 $ 前的外层部分一致
  int dollar = simple.indexOf('$');
  String outer = dollar>=0 ? simple.substring(0,dollar) : simple;
  String inner = dollar>=0 ? simple.substring(dollar) : "";
  int n = seqCounter.merge(pkg, 1, Integer::sum);
  String base = toAbc(n); // abc, def, ghi ...
  // 外层类：abc；内部类：abc$bar
  return pkg + base + inner + ";";
 }

 static String toAbc(int n) {
  // 1->abc 2->def ... 26->zab 27->aca ...（3 字母循环）
  StringBuilder sb = new StringBuilder();
  int x = n-1;
  for (int i=0;i<3;i++) { int c = (x % 26); x/=26; sb.append((char)('a'+c)); }
  return sb.reverse().toString();
 }

 /** 重命名方法（仅混淆名成员，保留 <init>/<clinit>） */
 static Method renameMethod(Method m, Pattern obf) {
  String name = m.getName();
  if (name.equals("<init>") || name.equals("<clinit>")) return m;
  String newName = obf.matcher(name).find() ? "m_" + hashName(name) : name;
  if (newName.equals(name)) return m;
  return new ImmutableMethod(
    newName,
    m.getDefiningClass(),
    m.getParameters(),
    m.getReturnType(),
    m.getAccessFlags(),
    m.getAnnotations(),
    m.getHiddenApiRestrictions()==null?Collections.emptySet():m.getHiddenApiRestrictions(),
    m.getImplementation());
 }

 static Field renameField(Field f, Pattern obf, String newDefiningClass) {
  String name = f.getName();
  String newName = obf.matcher(name).find() ? "f_" + hashName(name) : name;
  if (newName.equals(name)) return f;
  return new ImmutableField(
    newName,
    newDefiningClass,
    f.getType(),
    f.getAccessFlags(),
    null,
    f.getAnnotations(),
    f.getHiddenApiRestrictions()==null?Collections.emptySet():f.getHiddenApiRestrictions());
 }

 /** 简单稳定哈希（把混淆名映射成短数字） */
 static String hashName(String name) {
  int h = 0;
  for (int i=0;i<name.length();i++) h = h*31 + name.charAt(i);
  return Integer.toHexString(h & 0x7fffffff);
 }
}
