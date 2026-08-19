# RFC: dsh-external-fabric — repository purpose, architecture, and decision record

English | [中文](README.zh.md)

- Status: **living document** (each section records the decision and its history)
- Scope: this standalone Fabric extension workspace
- Upstream anchors: deepseek-harness snapshots `7b9644f2` (0812) / `9f9e2782a4` (0813),
  fork tip `65bcaf9902` (`feat-fabric`)

This document explains *why* this repository is shaped the way it is. Every
non-obvious arrangement below was reached through a concrete failure recorded
in the commit history; the sections follow the repository's evolution rather
than its file layout.

---

## 1. Purpose: an external Fabric extension, not a fork

deepseek-harness is a private monorepo. The Fabric/Mixin extension layer lives
there as three extension packages, but a consumer cannot install them from the
registry. This repository externalizes exactly those three packages so they can
be installed through the official plugin channel:

```
dsh plugin --profile <p> add github:dsh-external/fabric
```

**Boundary (hard rule):** the workspace ships exactly three complete packages —
`cordis-fabric` (pure transformation service), `cordis-fabric-api` (pure compat
facade), `cordis-fabric-dsh` (DSH-facing facades, invariant, profile
bootstrap). Anything else — the official `@deepseek-ai/dsh-tool-cordis`
toolset included — is never added as a fourth package; official packages remain upstream dependencies and are not republished here.

## 2. Host integration: launcher-provided wiring

The three packages install hooks and mount facades through the compiled launcher.
`src/fabric-dsh.ts` compiles to `lib/fabric-dsh.js`, and the launcher injects
`packages/cordis-fabric/preload.mjs` before the official CLI loads. No host patch
checkout is required.

Everything the official channels already cover is deliberately excluded:
installing the trio (`dsh plugin add`), bundle roster rows and dependencies,
catalog generation, invariant/gate exemptions for trio-in-workspace, and all
documentation (`README*`, `docs/`, `.agents/`). What remains is what no channel
can provide: launcher bootstrap (`apps/cli/src/profile-boot.ts` calls
`installFabricBootstrap` before any target import and
`checkFabricRequiredPatches` after boot), the `clientBundle` source-transform
build seam (`packages/client/tsdown.client.ts`), catalog entries compiled into
the official `tool-cordis` package, their tests, and the pnpm-policy seams.

### 2.1 The disabled opt-in rows

The web-app bundle layer inserts `cordis-fabric` / `cordis-fabric-dsh` rows as
**disabled opt-ins**: the pure `cordis-fabric` package is a library with no
plugin `apply`, so an enabled row fails every boot ("invalid plugin"). A
profile opts in by enabling the rows; the bundle layer applies on every boot,
so pre-existing profiles are covered without edits.

### 2.2 The TSX dead end (recorded and reverted)

The `dsh` source launch (`node --import tsx/esm apps/cli/src/bin.ts`) once
appeared to need `TSX_TSCONFIG_PATH` or a register preload: `FiberState` (a
const enum, only in `vendor/cordis/src`) failed to resolve. Both workarounds
shipped and were then **reverted** — the real cause was a stale
`TSX_TSCONFIG_PATH` in the shell pointing at an old staging checkout. With a
clean environment tsx auto-discovers the entry's tsconfig (extending the base)
and resolves the aliases to `src`. The official script runs unchanged; no
host-specific workaround is required.

## 3. Install model: git subdirectory specs + prepare

The trio is consumed as git subdirectory specs:

```
github:dsh-external/fabric#main&path:/packages/cordis-fabric
```

- Host source installs declare them in `apps/cli/package.json`; with launcher-provided host wiring, `scripts/install.sh` installs and builds the harness, then
  seeds the profile's pnpm settings, installs the bundle through the plugin
  channel (`dsh plugin --profile web add github:dsh-external/fabric`, joining
  `cordis-fabric-bundle` to `dsh.profile.bundles`), and enables the
  `cordis-fabric-dsh` row. Launches go through the compiled `lib/fabric-dsh.js`.
- Consumer-side builds run `prepare` (`tsdown.prepare.config.ts` for
  ex-setting, and the root `build` script runs tsdown directly for the trio and
  the `fabric-dsh` launcher) in an isolated environment —
  devDependencies install there, so `lightningcss` and friends are available.

### 3.1 pnpm 11 supply-chain seams

pnpm 11 blocks git-resolved installs by default; three seams make them work:

- `blockExoticSubdeps: false` in the profile template (git-resolved
  subdependencies);
- `dangerouslyAllowAllBuilds: true` in the host workspace and profile template
  (`allowBuilds` only accepts exact `git+url#commit` keys, which change every
  push);
- `minimumReleaseAgeExclude: ['@deepseek-ai/dsh-*']` in this workspace — the
  dsh-* rc train ships inside the 24h window and a name-only entry exempts all
  versions.

## 4. Registry dependency policy

The dsh-* host packages publish fast rc trains; this repository tracks them
through registry ranges, and each lesson below came from a real breakage.

### 4.1 The dsh-compact trap

`@deepseek-ai/dsh-client-runtime@0.0.1-rc.1` depended on
`@deepseek-ai/dsh-compact`, which was **never published** (upstream deleted the
package after publishing that runtime). The `0.1.0-rc.x` series dropped the
dependency; verified installable end-to-end.

### 4.2 The missing rc.5

Upstream code is versioned `0.1.0-rc.5`, but the registry jumps
`rc.3 → rc.6` — rc.5 was never published. Ranges therefore read `^0.1.0-rc.0`
(resolving the newest published rc, and `rc.0` keeps stable releases in range
too). Peers use the same range, which the host workspace's rc.5 satisfies —
host installs reuse workspace packages instead of registry copies.

### 4.3 Real host types, not a local contract

The trio once declared a `host-contracts.ts` facade plus a global
`@deepseek-ai/cordis` Events injection. That broke type-checking across host
packages and was deleted in favor of importing the real `@deepseek-ai/dsh-*`
types (declared as peers + devDeps) — exactly the upstream shape. `ctx.slots`
typing comes from `dsh-client-runtime`'s declaration, as upstream.

### 4.4 Runtime peers of the published libs

With `autoInstallPeers: false`, the published `dsh-*` libs' load-time imports
(`dsh-scope`, `dsh-llm`, `dsh-timeout`, `dsh-typert-protocol`) must be listed
as devDependencies explicitly — each was added after a "Cannot find package"
at test load.

## 5. Browser client format: the closure factory

The web shell loads `/plugins/<id>/client.js` as a classic script and resolves
value imports through the loader module table (a synchronous `require` inside
the factory). Plain ESM bundles cannot load there at all. Consequently both
trio browser halves ship as closure factories:

```js
window.__ModuleLoader__.load({ id: "cordis-fabric", factory: (require) => { ...; return module.exports; } })
```

with `@deepseek-ai/cordis` external (a platform seed) and everything else
inlined. `cordis-fabric` was converted first; `cordis-fabric-dsh` followed
(the same gap, fixed after the ex-setting install exposed the first one).
Upstream never notices this — its monorepo builds both through the shared
`clientBundle()` preset.

### 5.1 ex-setting's three lessons (same contract, external repo)

The sibling `omdsh-dev/ex-setting` bundle hit the same contract three times:

1. Its `dsh.client` manifest must be **nested** (`"dsh": { "client": ... }`),
   not a top-level `dshClient` field — client-modules scans the nested form;
2. its consumer-side build must use the **prepare config**, not just the local
   one, or git installs serve the old artifact;
3. cross-bundle value imports must not rely on a disabled row's factory —
   ex-setting inlines/avoids what the module table cannot answer, and installs
   static styles directly instead of routing them through a Fabric publish the
   transform could not produce (browser-transform cannot match inside the
   closure artifact).

## 6. Test strategy

The upstream suite resolves `src` through tsconfig paths; this repository only
has registry `lib` artifacts, which drove the evolution below.

- **serve.spec** mounts the real `@deepseek-ai/dsh-host-webserver`
  (`^0.1.0-rc.0` — rc.1 still registers `httpServer`; `webServer` landed in
  rc.3, matching the serve primitive).
- **hmr-e2e-runner** drives config HMR by toggling the row's `disabled` flag
  in `cordis.yml`: the vendored fork's `hmr.registerConfig` and include
  `internal/update` are fork-private and exist in **no** registry version
  (verified against latest 1.0.16/1.0.6).
- **client specs** originally faked `CommandUiRuntime`/`SlotRegistry` because
  the runtime rc.1 tree was uninstallable and the bundles are closure
  factories. After rc.6 became installable the real reason remained the
  factory format, so the specs now mount the **real services** through a test
  module loader (`packages/cordis-fabric-dsh/tests/browser/module-loader.ts`): happy-dom provides `window`; the
  `__ModuleLoader__` sink installs at helper module load; platform seeds
  (`cordis`, `ui-slots`, `react`) preload as ESM namespaces (the factory
  `require` is synchronous and node cannot `require` ESM);
  `ui-primitives` — a render-only heavy package — is stubbed; `materialize()`
  executes a factory with the module-table require (recursing into other
  registered bundles, memoized, `stripClientSuffix` normalizing `pkg/client`).
  Loader `baseUrl` and fixture URLs are pinned to file paths because
  happy-dom's `location` is `http://localhost:3000`.

## 7. Timeline (abridged)

| Commit | Decision |
|---|---|
| `1e04b1a`..`2a42254` | externalization: standalone Fabric bundle, self-contained template |
| `4018661`, `8ffaac4` | port the upstream three-package split + full host patch; HMR e2e |
| `d9228c4`, `40600d4` | official plugin channel install; source-host install script |
| `1ba7077`, `3331b80` | web-app bundle composes the rows; rows become disabled opt-ins |
| `7b8e913`, `3fd3106` | patch rebases: 0812 baseline → 0813 baseline |
| `9158f5d` | delete `host-contracts.ts`; real `@deepseek-ai/dsh-*` types |
| `30ed5ff`, `b58c643` | registry dependency policy (rc.5 peer, installable suites) |
| `58fbe75`, `33955ef` | both browser halves become closure factories |
| `aa58a52` | publish publicly (upstream parity) |
| `62ced22` | revert the TSX workarounds (environment misdiagnosis) |
| `3fd1a56` | happy-dom + ModuleLoader materializer; real browser services in tests |

## 8. Future work

- If the registry ever publishes node-importable builds (plain ESM or the
  `src` halves), the test module loader disappears and the specs import
  packages directly.
- Upstream promoting `createSnapshotStore` out of `dsh-client-runtime` shrinks
  the seed table.
- Upstream publishing `hmr.registerConfig` / `internal/update` would let the
  HMR runner mirror the in-tree config flow again.
