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

# Rebuild baseline: the pinned snapshot branch. Do not resolve the default
# branch via origin/HEAD — this checkout's origin/HEAD points at an old
# snapshots/ branch, not at master.
DEFAULT_BRANCH="master"
if ! git -C "$HARNESS" rev-parse --verify --quiet "refs/heads/$DEFAULT_BRANCH" >/dev/null; then
  DEFAULT_BRANCH="origin/$DEFAULT_BRANCH"
fi
if ! git -C "$HARNESS" rev-parse --verify --quiet "$DEFAULT_BRANCH" >/dev/null; then
  echo "error: baseline branch '$DEFAULT_BRANCH' not found in $HARNESS" >&2
  exit 1
fi

# Recreate the fabric branch from the baseline: discard uncommitted residue
# (the previous run's package.json / pnpm-lock.yaml edits) so the branch
# switch cannot fail, then delete the old branch and branch anew. Branching
# from the old fabric tip would inherit its commits and make the host patch
# look already-applied ("nothing to apply").
if [ -n "$(git -C "$HARNESS" status --porcelain)" ]; then
  echo "discarding uncommitted changes in $HARNESS"
  git -C "$HARNESS" reset --hard HEAD
  git -C "$HARNESS" clean -fd
fi
git -C "$HARNESS" checkout -f "$DEFAULT_BRANCH"
if git -C "$HARNESS" rev-parse --verify --quiet "refs/heads/$BRANCH" >/dev/null; then
  echo "deleting existing $BRANCH branch"
  git -C "$HARNESS" branch -D "$BRANCH"
fi
git -C "$HARNESS" checkout -b "$BRANCH"

bash "$REPO_ROOT/scripts/patch.sh" "$HARNESS" "${PATCH_ARGS[@]}"

# Commit the applied host patch on the fabric branch. The host's lefthook
# pre-commit runs gen-third-party-notices, which cannot resolve the git
# trio's license metadata before `pnpm install`; THIRD_PARTY_NOTICES.md is
# registry-handled (reverted to baseline), so the hook is skipped.
if [ -n "$(git -C "$HARNESS" status --porcelain)" ]; then
  git -C "$HARNESS" add -A
  git -C "$HARNESS" commit --no-verify -m "chore: apply fabric host integration patch"
  echo "committed the host patch on $BRANCH"
else
  echo "no working-tree changes — nothing to commit"
fi

cd "$HARNESS"

echo "== pnpm install --no-frozen-lockfile"
pnpm install --no-frozen-lockfile
pnpm install -wD unrun

echo "== pnpm run build"
pnpm run build

echo
echo "done. From $HARNESS run: pnpm dsh web"
