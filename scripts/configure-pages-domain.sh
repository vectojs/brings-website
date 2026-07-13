#!/usr/bin/env bash
# Keep the historical CI entry point while delegating reconciliation to typed code.
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
exec bun "$script_dir/configure-pages-domain.ts" "$@"
