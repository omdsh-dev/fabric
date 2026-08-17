#!/usr/bin/env bash
# One-step Fabric setup for a plain official deepseek-harness checkout:
#
#   1. harness — pnpm install --no-frozen-lockfile (plus the tsdown unrun
#      loader some Ubuntu hosts lack) and the CLI/client bundle build;
#   2. profile ($DSH_HOME, default ~/.dsh) — seed the pnpm settings the
#      git-resolved trio needs (pnpm >=10 blocks exotic subdeps and builds
#      by default), then install the bundle through the official plugin
#      channel (`dsh plugin --profile web add https://github.com/omdsh-dev/fabric/releases/download/latest/pkg.tgz`),
#      which also joins cordis-fabric-bundle to dsh.profile.bundles;
#   3. enable the cordis-fabric-dsh row in the profile's cordis.patch.yml
#      (idempotent). The cordis-fabric row stays disabled — the pure package
#      is a library with no plugin apply, only the canonical carrier for
#      `config.fabric.patches` descriptors. Fabric-required rows (those
#      declaring the patches themselves, e.g. the ex-setting crawler) ship
#      disabled too: plain `dsh` skips them, and the fabric-dsh launcher
#      enables them at launch.
#
# Usage:
#   scripts/install.sh <deepseek-harness-checkout> [--dsh-home <dir>]
#
# Afterwards (the bundle ships the launcher — no bundle checkout needed):
#   <dir>/profiles/web/node_modules/.bin/fabric-dsh \
#     --harness <deepseek-harness-checkout> web --port 8000
set -euo pipefail

HARNESS="${1:?usage: scripts/install.sh <deepseek-harness-checkout> [--dsh-home <dir>]}"
shift

DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dsh-home) DSH_HOME_DIR="${2:?--dsh-home needs a value}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

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

PROFILE_DIR="$DSH_HOME_DIR/profiles/web"
mkdir -p "$PROFILE_DIR"

# Seed the pnpm settings the git-resolved trio needs. initProfile never
# touches existing files, so writing this before the plugin add sticks.
WS="$PROFILE_DIR/pnpm-workspace.yaml"
if [ ! -f "$WS" ]; then
  printf 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\nblockExoticSubdeps: false\ndangerouslyAllowAllBuilds: true\n' > "$WS"
else
  grep -q '^blockExoticSubdeps:' "$WS" || printf 'blockExoticSubdeps: false\n' >> "$WS"
  grep -q '^dangerouslyAllowAllBuilds:' "$WS" || printf 'dangerouslyAllowAllBuilds: true\n' >> "$WS"
fi

echo "== dsh plugin --profile web add https://github.com/omdsh-dev/fabric/releases/download/latest/pkg.tgz"
DSH_HOME="$DSH_HOME_DIR" pnpm dsh plugin --profile web add https://github.com/omdsh-dev/fabric/releases/download/latest/pkg.tgz

# Enable the Host plugin row (idempotent; the pure cordis-fabric row stays
# disabled — it has no plugin apply and only carries descriptors).
PATCH="$PROFILE_DIR/cordis.patch.yml"
if ! grep -q 'id: cordis-fabric-dsh' "$PATCH"; then
  if grep -q '^\[\]$' "$PATCH"; then
    sed -i 's/^\[\]$/- id: cordis-fabric-dsh\n  disabled: false/' "$PATCH"
  else
    printf '\n- id: cordis-fabric-dsh\n  disabled: false\n' >> "$PATCH"
  fi
fi

echo
echo "done. The bundle ships the fabric-dsh launcher; launch it from the profile:"
echo "  $DSH_HOME_DIR/profiles/web/node_modules/.bin/fabric-dsh --harness $HARNESS web --port 8000"
