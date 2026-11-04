#!/usr/bin/env bash
# One command for the whole release: preflight -> push -> deploy -> verify -> cleanup.
#
# It deliberately does NOT re-run the release gate on the CI channel: the CI job
# runs the same 11-step gate itself, and running it twice for one release is the
# duplication this script exists to remove. Use --gate (or --channel local) when
# you want a local gate run.
set -euo pipefail
cd "$(dirname "$0")/.."

usage() {
  cat <<'USAGE'
用法: npm run ship -- [选项]

  --channel ci|local  发布通道。ci（默认）触发 GitHub Actions，由 CI 跑门禁并部署；
                      local 在本机跑门禁后 wrangler 部署（可逐字节 hash 验收）。
  --ref NAME          发布 ref，默认当前分支。
  --push              本地领先远端时推送该 ref（默认拒绝推送，只报告）。
  --ff-main           同时把 main 快进到该 ref（非快进会被 git 拒绝，不强推）。
  --gate              发布前额外在本地跑一次完整门禁（CI 通道默认不跑）。
  --no-clean          跳过收尾清理（默认发布后执行 clean:task --apply）。
  --dry-run           只打印计划，不推送、不部署、不清理。

发布必须显式授权：BLENDPROOF_PRODUCTION_APPROVED=YES npm run ship -- [选项]
工作区必须干净；本脚本不会替你提交改动。
USAGE
}

channel="ci"; ref=""; do_push=0; ff_main=0; run_gate=0; do_clean=1; dry_run=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --channel) channel="${2:-}"; shift 2 ;;
    --ref) ref="${2:-}"; shift 2 ;;
    --push) do_push=1; shift ;;
    --ff-main) ff_main=1; shift ;;
    --gate) run_gate=1; shift ;;
    --no-clean) do_clean=0; shift ;;
    --dry-run) dry_run=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数：$1" >&2; usage >&2; exit 2 ;;
  esac
done
[[ "$channel" == "ci" || "$channel" == "local" ]] || { echo "--channel 只能是 ci 或 local" >&2; exit 2; }

if [[ "$dry_run" -eq 0 && "${BLENDPROOF_PRODUCTION_APPROVED:-}" != "YES" ]]; then
  echo "未执行发布：请复核目标账户、Worker、D1、R2 与发布窗口后设置 BLENDPROOF_PRODUCTION_APPROVED=YES。" >&2
  exit 2
fi

stage_started=$SECONDS
timings=()
stage() { local label="$1"; shift; local started=$SECONDS status=0
  echo "[ship] ${label}"
  if [[ "$dry_run" -eq 1 ]]; then echo "[ship]   (dry-run) $*"; else "$@" || status=$?; fi
  timings+=("${label}: $((SECONDS - started))s")
  [[ "$status" -eq 0 ]] || { echo "[ship] 失败：${label}（exit ${status}）" >&2; printf '[ship] %s\n' "${timings[@]}" >&2; exit "$status"; }
}

# ---- 1. preflight: the release must be an explicit, pushed commit ----
[[ -z "$(git status --porcelain)" ]] || { echo "工作区有未提交改动；先提交再发布（本脚本不会替你提交）。" >&2; git status --short >&2; exit 2; }
if [[ -z "$ref" ]]; then ref="$(git rev-parse --abbrev-ref HEAD)"; fi
[[ -n "$ref" && "$ref" != "HEAD" ]] || { echo "无法确定发布 ref（detached HEAD）：请用 --ref 指定。" >&2; exit 2; }
local_head="$(git rev-parse HEAD)"
remote_head="$(git ls-remote origin "refs/heads/${ref}" | cut -f1)"
echo "[ship] ref=${ref} local=${local_head:0:7} remote=${remote_head:0:7}"
if [[ "$remote_head" != "$local_head" ]]; then
  if [[ "$do_push" -eq 1 ]]; then
    stage "推送 ${ref}" git push origin "HEAD:refs/heads/${ref}"
    if [[ "$ff_main" -eq 1 && "$ref" != "main" ]]; then
      stage "快进 main" git push origin "HEAD:refs/heads/main"
    fi
  else
    echo "origin/${ref} 与本地 HEAD 不一致；加 --push 推送，或先自行推送。CI 只会构建已推送的提交。" >&2
    exit 2
  fi
elif [[ "$ff_main" -eq 1 && "$ref" != "main" ]]; then
  stage "快进 main" git push origin "HEAD:refs/heads/main"
fi

# ---- 2. optional local gate (never duplicated on the CI channel) ----
if [[ "$run_gate" -eq 1 ]]; then stage "本地完整门禁" npm run verify:release; fi

# ---- 3. deploy through exactly one channel ----
if [[ "$channel" == "ci" ]]; then
  stage "CI 发布与线上验收" bash scripts/deploy-via-actions.sh "$ref"
else
  stage "本机门禁+部署+验收" bash scripts/deploy-production.sh
fi

# ---- 4. end-of-task cleanup (must not mask a successful release) ----
clean_status=0
if [[ "$do_clean" -eq 1 ]]; then
  echo "[ship] 收尾清理"
  if [[ "$dry_run" -eq 1 ]]; then echo "[ship]   (dry-run) npm run clean:task -- --apply"
  else npm run clean:task -- --apply || clean_status=$?; fi
  timings+=("收尾清理: $((SECONDS - stage_started))s 累计")
fi

echo "[ship] 发布完成（ref=${ref} commit=${local_head:0:7} channel=${channel}）"
printf '[ship] %s\n' "${timings[@]}"
if [[ "$clean_status" -ne 0 ]]; then
  echo "[ship] 警告：发布已成功，但收尾清理退出码 ${clean_status}；请手动运行 npm run clean:task。" >&2
  exit "$clean_status"
fi
