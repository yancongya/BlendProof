#!/usr/bin/env bash
# Production release through GitHub Actions (manual workflow_dispatch).
#
# The CI job runs the same 11-step gate and the same deploy script used locally,
# so this wrapper deliberately does NOT re-run the gate. It adds the operator
# side that CI cannot do: the explicit authorization gate, proof that the
# released ref is pushed and clean, bounded run tracking that surfaces a
# required-reviewer wait instead of hanging, and an independent routes-only
# verification of the live site from this machine.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${BLENDPROOF_PRODUCTION_APPROVED:-}" != "YES" ]]; then
  echo "未执行生产部署：请在明确复核目标 Cloudflare 账户、Worker、D1、R2 和发布窗口后设置 BLENDPROOF_PRODUCTION_APPROVED=YES。" >&2
  exit 2
fi

command -v gh >/dev/null 2>&1 || { echo "缺少 gh CLI，无法触发 GitHub Actions 发布。" >&2; exit 2; }

ref="${1:-}"
if [[ -z "$ref" ]]; then
  ref="$(git rev-parse --abbrev-ref HEAD)"
fi
if [[ -z "$ref" || "$ref" == "HEAD" ]]; then
  echo "无法确定发布分支（detached HEAD）：请显式传入分支名。" >&2
  exit 2
fi

# CI builds only pushed commits; never imply local edits are included.
if [[ -n "$(git status --porcelain)" ]]; then
  echo "工作区存在未提交改动，CI 不会包含它们；先提交或清理后再发布。" >&2
  exit 2
fi
local_head="$(git rev-parse HEAD)"
remote_head="$(git ls-remote origin "refs/heads/${ref}" | cut -f1)"
if [[ -z "$remote_head" ]]; then
  echo "远端不存在分支 ${ref}；先推送再发布。" >&2
  exit 2
fi
if [[ "$remote_head" != "$local_head" ]]; then
  echo "origin/${ref}（${remote_head:0:7}）与本地 HEAD（${local_head:0:7}）不一致；先推送再发布。" >&2
  exit 2
fi

before="$(gh run list --workflow deploy.yml --limit 1 --json databaseId --jq '.[0].databaseId // empty')"

echo "[BlendProof] 触发 Actions 生产发布：ref=${ref} commit=${local_head:0:7}"
gh workflow run deploy.yml --ref "$ref" -f approve_production=YES

# Poll interval is overridable so tests do not have to wait on real seconds.
poll_seconds="${BLENDPROOF_ACTIONS_POLL_SECONDS:-3}"
run_id=""
for _ in $(seq 1 30); do
  sleep "$poll_seconds"
  run_id="$(gh run list --workflow deploy.yml --branch "$ref" --limit 10 --json databaseId,headSha \
    --jq ".[] | select(.headSha==\"${local_head}\") | select((.databaseId|tostring)!=\"${before}\") | .databaseId" | head -1)"
  [[ -n "$run_id" ]] && break
done
if [[ -z "$run_id" ]]; then
  echo "在 30 次轮询内未定位到新的 workflow run；请到 Actions 页面确认后再处理，不要重复触发。" >&2
  exit 3
fi
echo "[BlendProof] run id: ${run_id}"

# A required reviewer leaves the run parked; report it instead of waiting forever.
for _ in $(seq 1 120); do
  status="$(gh run view "$run_id" --json status --jq .status)"
  case "$status" in
    completed) break ;;
    waiting|requested|pending)
      echo "run ${run_id} 处于 ${status}：production environment 可能配置了 required reviewers。" >&2
      echo "请在 Actions 页面批准后，用 npm run verify:production -- --routes-only 完成验收。" >&2
      exit 3
      ;;
  esac
  sleep 10
done

conclusion="$(gh run view "$run_id" --json status,conclusion --jq '.status + ":" + (.conclusion // "none")')"
if [[ "$conclusion" != "completed:success" ]]; then
  echo "[BlendProof] CI 发布未成功：run ${run_id} -> ${conclusion}" >&2
  gh run view "$run_id" --log-failed 2>/dev/null | tail -40 >&2 || true
  echo "门禁失败时 Wrangler 不会被调用；HTTP 验证失败则表示已部署但验收未通过，不自动回滚。" >&2
  exit 4
fi

echo "[BlendProof] CI 发布成功：run ${run_id}"
# CI already compared hashes against its own build. A local cross-platform build
# may differ byte-wise, so verify routes/redirects/404s/health here and record
# live artifact hashes for the report.
npm run verify:production -- --routes-only
