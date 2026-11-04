#!/usr/bin/env bash

set -euo pipefail
cd "$(dirname "$0")/.."
# Optional analytics must not hold local gates or production releases open.
export WRANGLER_SEND_METRICS="${WRANGLER_SEND_METRICS:-false}"

if [[ "${BLENDPROOF_PRODUCTION_APPROVED:-}" != "YES" ]]; then
  echo "未执行生产部署：请在明确复核目标 Cloudflare 账户、Worker、D1、R2 和发布窗口后设置 BLENDPROOF_PRODUCTION_APPROVED=YES。" >&2
  exit 2
fi

env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID npm run verify:release

npx wrangler deploy --keep-vars

# A successful upload is followed by HTTP route and artifact verification.
# Settle before probing: the edge needs a few seconds after upload, and an
# immediate probe reported a false failure on an otherwise healthy release.
env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID npm run verify:production -- --settle-ms 8000
