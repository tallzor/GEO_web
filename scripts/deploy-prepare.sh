#!/usr/bin/env bash
# 服务器端构建准备脚本：安装依赖 → 构建 → 整理 standalone 产物到 deploy/ 目录。
# 在项目根目录执行：bash scripts/deploy-prepare.sh
# 产物布局（PM2 ecosystem.config.cjs 依赖此布局）：
#   deploy/server.js            ← 来自 .next/standalone/server.js
#   deploy/.next/static/        ← 来自 .next/static（前端静态资源）
#   deploy/public/              ← 来自 public（如有）
#   deploy/node_modules/        ← 来自 .next/standalone/node_modules（最小依赖）
set -euo pipefail

cd "$(dirname "$0")/.."

echo "[1/6] 安装依赖（仅生产依赖 + 构建依赖）..."
npm ci

echo "[2/6] 检查 Supabase migration 状态（防止代码依赖了未执行的 migration）..."
# 读 .env.production（服务器部署用）；若不存在则跳过 env-file，脚本会因缺变量退出码 2。
if ! node --env-file-if-exists=.env.production scripts/verify-migration-state.mjs; then
  echo ""
  echo "❌ Migration 检查未通过，已中止构建。"
  echo "   退出码 1 = 有缺失的 migration，请先在 Supabase Dashboard → SQL Editor 执行缺失的 .sql 文件"
  echo "   退出码 2 = 环境变量未配置（检查 .env.production 是否含 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY）"
  exit 1
fi

echo "[3/6] 类型检查与构建..."
npm run typecheck
npm run build

echo "[4/6] 整理 standalone 产物到 deploy/..."
rm -rf deploy
mkdir -p deploy

# standalone 自带的 server.js 和最小 node_modules
cp -a .next/standalone/. deploy/

# standalone 不会自带静态资源，需要手动补齐
mkdir -p deploy/.next
cp -a .next/static deploy/.next/static

# public 目录（如果存在）
if [ -d public ]; then
  cp -a public deploy/public
fi

echo "[5/6] 校验产物..."
test -f deploy/server.js || { echo "❌ deploy/server.js 不存在，构建失败"; exit 1; }
test -d deploy/.next/static || { echo "❌ deploy/.next/static 不存在"; exit 1; }

echo "[6/6] 完成。产物大小："
du -sh deploy/

echo ""
echo "✅ 构建完成。接下来："
echo "   pm2 start ecosystem.config.cjs --env production"
echo "   pm2 save"
