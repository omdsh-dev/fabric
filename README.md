# Cordis Fabric Workspace

English | [中文](README.zh.md)

The Fabric/Mixin extension layer for DSH as a self-contained workspace of three packages plus an installable profile bundle carrier. The workspace mirrors the upstream fabric split: a pure-Cordis pair (`cordis-fabric`, `cordis-fabric-api`) and the DSH integration package (`cordis-fabric-dsh`) that supplies the Host and browser facades, the package invariant, and the profile bootstrap.

## Packages

| Package | Kind | Contents |
|---|---|---|
| `cordis-fabric` | pure Cordis | Trusted load-time transformation service (`FabricService`, `bootstrapFabric`), Orchestrion transform, node-loader hooks, bridge, browser transform, testkit. No DSH imports. |
| `cordis-fabric-api` | pure Cordis | Cooperative compat facade over the fabric registry: `FabricCompatService` + `buildCompatInstrumentations`. Peers only Cordis and `cordis-fabric`. |
| `cordis-fabric-dsh` | DSH-facing | Mod-facing facades (`ctx.fabricAgent`, `ctx.fabricTools`, `ctx.fabricPrompt`, `ctx.fabricCommands`), browser facade (`ctx.fabricClient`), the package invariant, and the profile bootstrap (`installFabricBootstrap`). |

Only these three packages exist as code in this repository. Anything outside them — for example the official `@deepseek-ai/dsh-tool-cordis` toolset or a corrected upstream dependency — is never added as a fourth package; it is applied as a pnpm dependency patch stored in `patches/` (see `patches/README.md`).

## Repository shape

```text
package.json              # workspace root and dsh.bundle bundle carrier
pnpm-workspace.yaml       # packages/* workspace
cordis.patch.yml          # explicit Fabric profile rows (opt-in, disabled)
AGENTS.md                 # repository-local contributor rules
docs/                     # detailed Fabric, API, and contract references
patches/README.md         # pnpm dependency-patch contract
scripts/                  # self-contained prepare and boundary verification
packages/
  cordis-fabric/          # pure transformation service + browser client entry
  cordis-fabric-api/      # pure compat facade (peer-only library)
  cordis-fabric-dsh/      # DSH facades, invariant, profile bootstrap
lib/                      # build outputs (ignored; each package prepares its own on install)
```

## Repository boundary

This repository is fully self-contained: every source file, compiler setting, test fixture, contributor instruction, and build helper lives below this repository root, and every development input resolves from this repository's own manifests and lockfile. The DSH host packages (`@deepseek-ai/dsh-agent`, `@deepseek-ai/dsh-invariants`, and the other `@deepseek-ai/dsh-*` services the facades delegate to) are installable from the npm registry; the facades import their real types directly (declared as peer + dev dependencies), and a composed DSH profile supplies the real services at runtime.

Run `pnpm run verify:self-contained` to enforce the boundary: it rejects local-path dependency specs, compiler or code paths that leave the repository, external or broken Markdown links, absolute workstation paths, and the removal of any repository-layout contract.

## Bundle behavior

The bundle carrier adds both profile rows as disabled opt-ins:

```yaml
- id: cordis-fabric
  name: 'cordis-fabric'
  disabled: true

- id: cordis-fabric-dsh
  name: 'cordis-fabric-dsh'
  disabled: true
```

Fabric patch handlers are trusted code registered through `ctx.fabric.register()`. Patch descriptors are configuration metadata, but executable handlers are never deserialized from YAML or model input. The service supports Node ESM/CommonJS load-time transformation, browser build-time transformation, priority composition, HMR-safe disposal, static target validation, generator delegation, and watched browser transforms.

The bundle patch only composes these package rows. The launcher/bootstrap and browser build seams the trio needs to RUN are host-side code outside the three packages and are carried as `patches/fabric-host-integration.patch` (apply it to a deepseek-harness checkout at snapshot `9f9e2782a4` (0813); see `patches/README.md`). A host already at the split commit needs nothing.

## Installation

The bundle installs through DSH's official bundle-plugin channel; the trio resolves from this same GitHub repository through git subdirectory specs, so nothing is published:

```sh
dsh plugin --profile web add github:dsh-external/fabric
```

Restart the web app afterwards. The profile rows are disabled opt-ins; enable `cordis-fabric` / `cordis-fabric-dsh` in the profile composition to activate the Fabric layer.

The repository carries no build artifacts: the trio's `prepare` scripts build `lib/` during a Git install (pnpm installs the package's devDependencies and runs `prepare` on the consumer machine). Installations track `main`.

For the Fabric layer to actually engage, the host launcher must call the trio's bootstrap before any target module import. Official DSH master does not do this yet. Two host situations:

**Source host (fully usable now)** — a deepseek-harness checkout plus the host patch (`patches/fabric-host-integration.patch`, see `patches/README.md`). The patch wires the launcher, the browser build seam, and the tool-cordis catalog, and the CLI's trio dependencies are git specs, so a plain official checkout resolves and builds the trio on `pnpm install`:

```sh
git clone <deepseek-harness> && cd deepseek-harness
pnpm run patch:host -- .          # from this bundle repo; or git apply the patch
pnpm install --no-frozen-lockfile # first install: lockfile gains the two git deps,
                                  # pulls the trio from GitHub, prepare builds it
pnpm run build
pnpm dsh web            # the web-app bundle layer already composes the fabric rows
```

Or in one step from this bundle repo: `pnpm run install:host -- <deepseek-harness-checkout>` (apply patch, install, build).

**npm-installed official `dsh`** — cannot take the source patch (the CLI ships prebuilt); it works once the official repository merges the wiring (the fork at `65bcaf9902` contains it).

Two prerequisites:

- pnpm resolves GitHub dependencies over SSH, so the installing machine needs GitHub SSH access for `dsh-external/fabric`.
- The load-time transformation hooks must be installed by the host launcher before any target module import; see the host situations above.

## Development

```sh
pnpm install
pnpm run verify:self-contained
pnpm run typecheck
pnpm test
pnpm run build
```

`lib/` is a build output, never committed: it is recreated by the trio's `prepare` scripts (the root `build` script runs them locally). In this workspace, the root manifest's git subdirectory specs for the trio are redirected to the local packages through `pnpm-workspace.yaml` overrides, so `pnpm install` never re-clones the repository.

## Model Experience

The low-level transformer contributes no model-visible content. The cooperative facades delegate prompt, tools, commands, agent events, and browser command/slot registrations to their authoritative DSH services; those owners retain logging, permissions, approval, cancellation, and rendering semantics.

## Known Limitations and Deferred Work

- Node load-time transformation requires precompiled JavaScript; browser transforms strip TypeScript before applying handlers.
- The browser faces are split across the two dual-face packages (`cordis-fabric/client` for the bridge and service, `cordis-fabric-dsh/client` for the Mod-facing facade); consumers that need the complete typed SlotMap should use the authoritative DSH slot service instead of widening the facade.
- On an npm-installed official `dsh`, the load-time and browser build seams do not engage (the CLI ships prebuilt and cannot take the source patch); those hosts work once the official repository merges the wiring. Source hosts use `patches/fabric-host-integration.patch` to add the seams (see `patches/README.md`).
