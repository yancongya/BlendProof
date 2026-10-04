#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "$0")/.."

echo "[BlendProof] 1/7 检查前端类型"
npm run check

echo "[BlendProof] 2/7 检查 Worker 类型"
npm run check:worker

echo "[BlendProof] 3/7 检查项目结构"
npm run check:arch

echo "[BlendProof] 4/7 运行落地页与 Worker 测试"
npm run test:landing
npm run test:worker

echo "[BlendProof] 5/7 构建工作台与落地页"
npm run build

echo "[BlendProof] 6/7 校验 Cloudflare 发布包"
npm run worker:dry-run

echo "[BlendProof] 7/7 部署 Cloudflare Worker"
npx wrangler deploy

