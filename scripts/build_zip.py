#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""打包可加载的扩展发行版 zip。

产物: dist/chaoxing-helper-v<version>.zip
zip 内结构:
    chaoxing-helper/manifest.json
    chaoxing-helper/background.js
    ...
解压后直接在 edge://extensions 里「加载解压缩的扩展」选中 chaoxing-helper 目录即可。
"""
import json
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")

# 只打包扩展运行必需的文件（不含 test/ scripts/ .tools/ .git）
INCLUDE_FILES = [
    "manifest.json",
    "background.js",
    "content.js",
    "popup.html",
    "popup.js",
    "options.html",
    "options.js",
    "README.md",
]
INCLUDE_DIRS = ["icons"]
EXCLUDE_EXT = {".pyc", ".log", ".zip"}


def main() -> int:
    with open(os.path.join(ROOT, "manifest.json"), encoding="utf-8") as f:
        version = json.load(f)["version"]

    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, f"chaoxing-helper-v{version}.zip")
    if os.path.exists(out):
        os.remove(out)

    prefix = "chaoxing-helper"
    count = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name in INCLUDE_FILES:
            src = os.path.join(ROOT, name)
            if not os.path.exists(src):
                print(f"跳过缺失文件: {name}", file=sys.stderr)
                continue
            z.write(src, f"{prefix}/{name}")
            count += 1
        for d in INCLUDE_DIRS:
            base = os.path.join(ROOT, d)
            for dirpath, _dirnames, filenames in os.walk(base):
                for fn in filenames:
                    if os.path.splitext(fn)[1].lower() in EXCLUDE_EXT:
                        continue
                    src = os.path.join(dirpath, fn)
                    rel = os.path.relpath(src, ROOT).replace(os.sep, "/")
                    z.write(src, f"{prefix}/{rel}")
                    count += 1

    size = os.path.getsize(out)
    print(f"打包完成: {out}")
    print(f"文件数: {count}  大小: {size / 1024:.1f} KB  版本: {version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
