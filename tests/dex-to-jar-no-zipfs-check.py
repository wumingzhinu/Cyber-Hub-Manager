#!/usr/bin/env python3
"""DEX 转 JAR 防回归：禁止再依赖 JDK 的 zipfs（Android 没有该文件系统提供者）。

背景（r7）：DexEngine.toJar() 原先调用 Dex2jar.to(part.toPath())，part 是一个
「尚不存在的 .jar 文件路径」。dex2jar 2.4 的 to(Path) 在目标不是已存在目录时会
走 createZip()，遍历 FileSystemProvider.installedProviders() 找 scheme=jar 的
provider；Android 不含 JDK 的 jdk.zipfs 模块，遍历不到就抛
"cant find zipfs support"，DEX 转 JAR 无法完成。

现改为传入「已存在的目录」：to(Path) 的 Files.isDirectory 分支只调用
Path.resolve / Files.createDirectories / Files.write 把 .class 写进目录
（Android API 26+ 均支持），再由 addJarTree() 按相对路径打包成 JAR。

对照实验（--limit-modules java.base，providers 仅 file/jrt，等同 Android）：
  旧路径 to(文件.jar) -> FAIL cant find zipfs support
  新路径 to(已存在目录) -> OK
"""
import re
import sys
from pathlib import Path

P = Path(__file__).resolve().parents[1]
src = (P / 'app/src/main/java/com/cyberhub/manager/DexEngine.java').read_text(encoding='utf-8')
errors = []

# 1. toJar 仍存在，且仍由我们自己用 ZipOutputStream 产出 JAR（不交给 dex2jar 建压缩包）
if 'public JSONObject toJar(File folder)' not in src:
    errors.append('DexEngine.toJar() 缺失')
if 'new ZipOutputStream(new BufferedOutputStream(new FileOutputStream(jar)))' not in src:
    errors.append('toJar 未再用 ZipOutputStream 打包 JAR')

# 2. 旧写法不得回归：不得再把「.jar 文件路径」交给 Dex2jar.to()
if re.search(r'input\.getName\(\)\s*\+\s*"\.jar"', src):
    errors.append('仍存在 input.getName()+".jar" 临时文件路径，会再次触发 zipfs')

# 3. Dex2jar.to() 必须收到「已存在的目录」part
if 'input.getName()+"-classes"' not in src:
    errors.append('未创建 -classes 临时目录')
if '!part.isDirectory()&&!part.mkdirs()' not in src:
    errors.append('临时目录 part 未确保存在；to() 必须走 Files.isDirectory 分支')
calls = re.findall(r'Dex2jar\.from\([^)]*\)\.skipDebug\([^)]*\)\.to\(([^;]*?)\);', src)
if not calls:
    errors.append('未找到 Dex2jar.to(...) 调用')
for arg in calls:
    if 'part.toPath()' not in arg:
        errors.append('Dex2jar.to() 参数不是目录 part：' + arg.strip()[:70])

# 4. 目录内容必须由 addJarTree 按相对路径写进 JAR
if 'addJarTree(part,"",zout,names)' not in src:
    errors.append('未通过 addJarTree 把目录内容写入 JAR')
if 'private static int addJarTree(' not in src:
    errors.append('缺少 addJarTree() 实现')
if 'f.isDirectory()' not in src or 'zout.putNextEntry(new ZipEntry(name))' not in src:
    errors.append('addJarTree 未递归目录 / 未写 ZipEntry')

# 5. 打包细节与去重、MANIFEST 仍在
for token in ('META-INF/MANIFEST.MF', 'names.add(name)', 'name.endsWith(".class")'):
    if token not in src:
        errors.append('打包细节缺失：' + token)

# 6. 保留根因注释，避免后人改回 zipfs 写法
if 'cant find zipfs support' not in src:
    errors.append('缺少根因注释（cant find zipfs support）')

if errors:
    print('FAIL: DEX 转 JAR 无 zipfs 自检未通过')
    for x in errors:
        print(' -', x)
    sys.exit(1)
print('PASS: DEX 转 JAR 无 zipfs 自检 11 项全部通过（目录输出 / 禁止文件 Path / 目录打包 / MANIFEST / 根因注释）')
