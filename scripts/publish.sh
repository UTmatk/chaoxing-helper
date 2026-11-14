#!/usr/bin/env bash
# 发布到 GitHub：创建仓库并推送当前 main 分支
# 用法: bash scripts/publish.sh [public|private]
set -euo pipefail

REPO_NAME="chaoxing-helper"
VISIBILITY="${1:-private}"
DESC="学习通答题助手 — MV3 浏览器扩展：抓题 + 调用 OpenAI 兼容模型生成答案，人工确认后填充；含 iframe 支持与离线单测"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

GH="$ROOT/.tools/bin/gh.exe"
[ -x "$GH" ] || { echo "找不到 gh: $GH"; exit 1; }

# 1) 认证检查
if ! "$GH" auth status >/dev/null 2>&1; then
  echo "未登录 GitHub，先执行："
  echo "  printf '\\n' | $GH auth login --hostname github.com --git-protocol https --web"
  exit 2
fi
LOGIN="$("$GH" api user --jq .login)"
echo "已登录账号: $LOGIN"

# 2) 提交身份对齐到真实账号（noreply 邮箱不暴露真实邮箱）
"$GH" api user --jq .id >/dev/null
git config user.name "$LOGIN"
git config user.email "${LOGIN}@users.noreply.github.com"

# 3) 创建仓库并推送（已存在则直接推送）
if "$GH" repo view "$LOGIN/$REPO_NAME" >/dev/null 2>&1; then
  echo "仓库已存在：$LOGIN/$REPO_NAME，直接推送"
  git remote remove origin 2>/dev/null || true
  git remote add origin "https://github.com/$LOGIN/$REPO_NAME.git"
  git push -u origin main
else
  "$GH" repo create "$REPO_NAME" "--$VISIBILITY" --description "$DESC" --source=. --remote=origin --push
fi

echo
echo "完成: https://github.com/$LOGIN/$REPO_NAME"
