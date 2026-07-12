#!/usr/bin/env bash
# Deploy to Cloudflare Pages and wait for Wrangler's final completion marker.
set -euo pipefail

public_dir="${1:?Usage: $0 <public_dir> <project_name> [branch]}"
project_name="${2:?Usage: $0 <public_dir> <project_name> [branch]}"

find_workspace_root() {
  local current
  current=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

  while [ "$current" != "/" ]; do
    if [ -f "$current/AGENTS.md" ] && [ -d "$current/tmp" ]; then
      printf '%s\n' "$current"
      return 0
    fi
    current=$(dirname "$current")
  done

  return 1
}

repo_root=$(git rev-parse --show-toplevel)
current_branch=$(git branch --show-current)
branch="${3:-$current_branch}"
if [ -z "$branch" ]; then
  echo "ERROR: provide a Pages branch when HEAD is detached." >&2
  exit 1
fi
if [ "$branch" = "main" ] && [ "$current_branch" != "main" ] && [ "${BRINGS_ALLOW_PRODUCTION:-}" != "1" ]; then
  echo "ERROR: refusing to deploy a non-main worktree as the production branch." >&2
  exit 1
fi

if workspace_root=$(find_workspace_root); then
  scratch_root="$workspace_root/tmp/outputs"
else
  scratch_root="${RUNNER_TEMP:-$repo_root/.tmp}"
fi
mkdir -p "$scratch_root"
log_file=$(mktemp "$scratch_root/brings-pages-deploy.XXXXXX.log")
wrangler_pid=""

cleanup() {
  if [ -n "$wrangler_pid" ] && kill -0 "$wrangler_pid" 2>/dev/null; then
    kill "$wrangler_pid" 2>/dev/null || true
    wait "$wrangler_pid" 2>/dev/null || true
  fi
  rm -f "$log_file"
}
trap cleanup EXIT

env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy \
  CI=true CLOUDFLARE_TELEMETRY_DISABLED=1 NO_UPDATE_NOTIFIER=1 \
  wrangler pages deploy "$public_dir" --project-name "$project_name" --branch "$branch" --commit-dirty=true \
  >"$log_file" 2>&1 &
wrangler_pid=$!

success=false
line_count=0
for _ in {1..300}; do
  current_lines=$(wc -l <"$log_file")
  if [ "$current_lines" -gt "$line_count" ]; then
    tail -n +"$((line_count + 1))" "$log_file"
    line_count=$current_lines
  fi
  if grep -q "Deployment complete!" "$log_file"; then
    success=true
    break
  fi
  if ! kill -0 "$wrangler_pid" 2>/dev/null; then
    break
  fi
  sleep 0.5
done

if [ "$success" = true ]; then
  echo "Cloudflare Pages deployment finished successfully."
  exit 0
fi

echo "Cloudflare Pages deployment failed or timed out." >&2
exit 1
