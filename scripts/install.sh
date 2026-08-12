#!/usr/bin/env bash
# Installs the DSH source host for the Fabric bundle: creates a local
# fabric branch, applies the host patch and commits it, installs workspace
# dependencies (pulling the trio through its git specs), and builds the
# CLI and client bundles.
#
# Usage:
#   scripts/install.sh <deepseek-harness-checkout> [--patch <path>] [--branch <name>]
#
# Runs scripts/patch.sh first (idempotent), then in the checkout:
#   pnpm install --no-frozen-lockfile   # lockfile gains the two git deps
#   pnpm run build                      # CLI + client bundles
#
# --branch <name> names the local branch the patch is committed to
# (default: fabric). Afterwards, from the checkout: `pnpm dsh web`. The
# web-app bundle layer already composes the fabric rows, so no profile edit
# is needed — the trio resolves from this checkout's node_modules. On Ubuntu
# hosts the tsdown unrun loader may be missing; when the build reports it,
# install it with `npm install unrun -w` and re-run.
set -euo pipefail

HARNESS="${1:?usage: scripts/install.sh <deepseek-harness-checkout> [--patch <path>] [--branch <name>]}"
shift

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PATCH_ARGS=()
BRANCH="fabric"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --patch) PATCH_ARGS+=(--patch "${2:?--patch needs a value}"); shift 2 ;;
    --branch) BRANCH="${2:?--branch needs a value}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

if ! git -C "$HARNESS" rev-parse --git-dir >/dev/null 2>&1; then
  echo "error: $HARNESS is not a git checkout" >&2
  exit 1
fi

# Recreate the fabric branch from the current HEAD: an existing branch is
# deleted (with its commits) so the applied host patch always lands as one
# fresh commit on a clean branch.
if git -C "$HARNESS" rev-parse --verify --quiet "refs/heads/$BRANCH" >/dev/null; then
  if [ "$(git -C "$HARNESS" branch --show-current)" = "$BRANCH" ]; then
    git -C "$HARNESS" checkout --detach
  fi
  git -C "$HARNESS" branch -D "$BRANCH"
fi
git -C "$HARNESS" checkout -b "$BRANCH"

bash "$REPO_ROOT/scripts/patch.sh" "$HARNESS" "${PATCH_ARGS[@]}"

# Commit the applied host patch on the fabric branch.
if [ -n "$(git -C "$HARNESS" status --porcelain)" ]; then
  git -C "$HARNESS" add -A
  git -C "$HARNESS" commit -m "chore: apply fabric host integration patch"
  echo "committed the host patch on $BRANCH"
else
  echo "no working-tree changes — nothing to commit"
fi

cd "$HARNESS"

echo "== pnpm install --no-frozen-lockfile"
pnpm install --no-frozen-lockfile

echo "== pnpm run build"
pnpm run build

echo
echo "done. From $HARNESS run: pnpm dsh web"
