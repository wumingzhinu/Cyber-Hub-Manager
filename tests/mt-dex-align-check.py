#!/usr/bin/env python3
"""校验 Cyber-Hub-Manager 的「DEX 重新划分 / DEX 混淆对抗」是否与 MT2.26.11.apk
反编译还原的规格对齐（tests/fixtures/mt-dex-spec.json）。

用法：
  python3 tests/mt-dex-align-check.py [--tsv /path/to/mt_strings.tsv] [--out result.json]
退出码 0 表示全部通过。--tsv 可选：给出时会额外校验 fixture 文案确实存在于 MT
APK 导出的字符串表中，证明规格来自 MT 本体而非推测。
"""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests/fixtures/mt-dex-spec.json"
APP_JS = ROOT / "app/src/main/assets/app.js"
DEX_TOOLS = ROOT / "app/src/main/java/com/cyberhub/manager/DexTools.java"
DEOBF = ROOT / "app/src/main/java/com/cyberhub/manager/DexDeobfuscator.java"

spec = json.loads(FIXTURE.read_text(encoding="utf-8"))
S = spec["strings"]
checks = []


def add(name, path, needle, positive=True, kind="literal"):
    checks.append(dict(name=name, file=str(path.relative_to(ROOT)),
                       needle=needle, positive=positive, kind=kind))


# ---- 前端：MT 对话框文案与交互 ----
add("模式一「均匀分配」", APP_JS, "均匀分配")
add("模式二「按限制分配」", APP_JS, "按限制分配")
add("参数「生成的Dex数量」", APP_JS, S["0x7f120294"])
add("参数「方法数量限制」", APP_JS, S["0x7f120298"])
add("标签「分配方式」", APP_JS, S["0x7f120299"])
add("均匀分配说明文案", APP_JS, S["0x7f120293"])
add("按限制分配说明文案", APP_JS, S["0x7f120297"])
add("多 dex 的 Android 5.0 警告", APP_JS, S["0x7f12029a"])
add("数量不足确认文案", APP_JS, S["0x7f120292"])
add("进度文案「正在重新分配…」", APP_JS, S["0x7f12029b"])
add("按限制分配默认 64000（MT 推荐）", APP_JS, 'value="64000"')
add("方法数上限 65536", APP_JS, 'max="65536"')
add("前端识别 NEED_MORE_DEX", APP_JS, "NEED_MORE_DEX")
add("前端确认后带 autoIncrease 重跑", APP_JS, "autoIncrease:true")
add("前端使用 confirmBox 询问", APP_JS, "confirmBox('DEX 重新划分'")
add("旧的「指定 DEX 数量」已移除", APP_JS, "指定 DEX 数量", False)
add("旧的「按每个 DEX 的类数」已移除", APP_JS, "按每个 DEX 的类数", False)
add("旧的默认值 60000 已移除", APP_JS, 'value="60000"', False)

# ---- 后端：MT 划分算法与硬约束 ----
add("65536 方法数硬上限常量", DEX_TOOLS, "DEX_METHOD_LIMIT = 65536")
add("MT 推荐值 64000 常量", DEX_TOOLS, "MT_RECOMMENDED_LIMIT = 64000")
add("按限制分配参数 methodLimit", DEX_TOOLS, 'optInt("methodLimit", 0)')
add("均匀分配参数 count", DEX_TOOLS, 'optInt("count", 0)')
add("数量不足时抛 NEED_MORE_DEX", DEX_TOOLS, '"NEED_MORE_DEX:"')
add("autoIncrease 确认开关", DEX_TOOLS, 'optBoolean("autoIncrease", false)')
add("分组数超出请求数时拦截", DEX_TOOLS, "groups.size() > count")
add("单类方法数超 65536 明确报错", DEX_TOOLS, "weight.methods > DEX_METHOD_LIMIT")
add("单组方法数参与切分", DEX_TOOLS, "sum.methods + weight.methods > methodLimit")
add("输出标记 autoIncreased", DEX_TOOLS, '"autoIncreased"')
add("maxClasses 默认已修为 0", DEX_TOOLS, 'Math.max(0, opts.optInt("maxClasses", 0))')
add("缺陷根因 Math.max(1,maxClasses) 已消除", DEX_TOOLS,
    'Math.max(1, opts.optInt("maxClasses"', False)
add("MT 规格依据注释", DEX_TOOLS, "0x7f120290")

# ---- 混淆对抗：MT 匹配规则与 dex 合法性 ----
add("按 $ 分割内部类（MT 0x7f120263）", DEOBF, 'simple.split("\\\\$")')
add("引用 MT 0x7f120263 规则说明", DEOBF, "0x7f120263")
add("保留集合 existingTypes", DEOBF, "existingTypes")
add("三参命名器 reservedTypes", DEOBF, "reservedTypes")
add("去掉描述符分号", DEOBF, 's.endsWith(";")')
add("候选名避开原有类", DEOBF, "reservedFull.contains(candidate)")
add("两参兼容重载保留", DEOBF, "generateReadableName(typeDesc, classMap, null)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tsv", help="MT APK 导出的 mt_strings.tsv（可选，用于核对文案来源）")
    ap.add_argument("--out", help="结果 JSON 输出路径")
    args = ap.parse_args()

    results = []
    for c in checks:
        p = ROOT / c["file"]
        text = p.read_text(encoding="utf-8", errors="replace") if p.exists() else ""
        if c["kind"] == "regex":
            hit = re.search(c["needle"], text) is not None
        else:
            hit = c["needle"] in text
        ok = hit if c["positive"] else not hit
        results.append(dict(name=c["name"], file=c["file"], ok=ok,
                            mode="must-contain" if c["positive"] else "must-not-contain"))

    # 可选：核对 fixture 文案确实来自 MT APK 字符串表
    if args.tsv and Path(args.tsv).exists():
        tsv = Path(args.tsv).read_text(encoding="utf-8", errors="replace")
        for sid, zh in S.items():
            key = zh.split("\n")[0][:12]
            results.append(dict(name=f"MT 文案来源核对 {sid}", file="mt_strings.tsv",
                                ok=key in tsv, mode="must-contain"))

    passed = sum(1 for r in results if r["ok"])
    out = dict(total=len(results), passed=passed, failed=len(results) - passed,
               spec_source=spec["source"], results=results)
    (Path(args.out).write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
     if args.out else print(json.dumps(out, ensure_ascii=False, indent=2)))
    bad = [r for r in results if not r["ok"]]
    if bad:
        print(f"FAIL {len(bad)}/{len(results)}:", file=sys.stderr)
        for r in bad:
            print(f"  - {r['name']} [{r['mode']}] @ {r['file']}", file=sys.stderr)
        return 1
    print(f"PASS {passed}/{len(results)}：MT DEX 规格对齐校验通过", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
