#!/usr/bin/env bash

set -euo pipefail
cd "$(dirname "$0")/.."

step=0
run_step() {
  step=$((step + 1))
  echo "[BlendProof] ${step}/10 $1"
  shift
  "$@"
}

run_step "生成并校验落地页 WebP 素材" npm run optimize:landing-images
run_step "检查前端类型" npm run check
run_step "检查 Worker 类型" npm run check:worker
run_step "检查项目结构" npm run check:arch
run_step "运行后端与 Viewer 测试" npm run test:backend
run_step "运行 Worker 合同测试" npm run test:worker
run_step "构建完整发布目录（工作台 + 落地页）" npm run build
run_step "运行落地页资源与交互冒烟测试" npm run test:landing
run_step "校验 Cloudflare 发布包" npm run worker:dry-run
run_step "校验最终 dist 入口、资源和敏感文件边界" npm run verify:release-assets

echo "[BlendProof] 发布前本地门禁全部通过。真实浏览器和生产 URL 验收仍需按 web-perf-owned 流程单独执行。"
