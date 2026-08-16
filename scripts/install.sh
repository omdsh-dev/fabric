#!/usr/bin/env bash
# Prepares a plain official deepseek-harness source checkout for fabric-dsh
# launches. The host patch is now empty (every seam rides the fabric-dsh
# launcher), so there is no branch, patch, or commit step — this script only
# installs the workspace dependencies (pulling the trio through its git
# specs) and builds the CLI and client bundles.
#
# Usage:
#   scripts/install.sh <deepseek-harness-checkout>
#
# In the checkout:
#   pnpm install --no-frozen-lockfile   # lockfile gains the three git deps
#   pnpm run build                      # CLI + client bundles
#
# Afterwards, launch through fabric-dsh (the host source stays untouched):
#
#   DSH_HOME=$HOME/.dsh_dev node <bundle-repo>/scripts/fabric-dsh.mjs \
#     --harness <deepseek-harness-checkout> --profile web web --port 8000
#
# On Ubuntu hosts the tsdown unrun loader may be missing; when the build
# reports it, this script installs it with `npm install unrun -w` and
# re-runs.
set -euo pipefail

HARNESS="${1:?usage: scripts/install.sh <deepseek-harness-checkout>}"

if ! git -C "$HARNESS" rev-parse --git-dir >/dev/null 2>&1; then
  echo "error: $HARNESS is not a git checkout" >&2
  exit 1
fi

cd "$HARNESS"

echo "== pnpm install --no-frozen-lockfile"
pnpm install --no-frozen-lockfile
pnpm install -wD unrun

echo "== pnpm run build"
pnpm run build

echo
echo "done. Launch through fabric-dsh, e.g.:"
echo "  DSH_HOME=\$HOME/.dsh_dev node <bundle-repo>/scripts/fabric-dsh.mjs --harness $HARNESS --profile web web --port 8000"
