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

The bundle patch only composes these package rows. The launcher/bootstrap wiring the trio needs to RUN is supplied at launch by the plug-and-play `fabric-dsh` command — the host source stays completely untouched (the host patch is now empty; see `patches/README.md`). Running plain `dsh` walks official code only; `fabric-dsh` injects the loader hooks.

## Installation

The bundle installs through DSH's official bundle-plugin channel from the prebuilt release artifact:

```sh
dsh plugin add https://github.com/omdsh-dev/fabric/releases/latest/download/pkg.tgz
```

Restart the web app afterwards. The profile rows are disabled opt-ins; enable `cordis-fabric` / `cordis-fabric-dsh` in the profile composition to activate the Fabric layer.

The repository carries no build artifacts: the trio's `prepare` scripts build `lib/` during a Git install (pnpm installs the package's devDependencies and runs `prepare` on the consumer machine). Installations track `main`. The release workflow (`.github/workflows/release.yml`) builds on every push to `main` and packs a prebuilt bundle tarball to the `v<version>` GitHub Release.

For the Fabric layer to actually engage, the load-time transformation hooks must exist before any target module import. The `fabric-dsh` launcher does exactly that with zero host changes. It ships inside the installed bundle, so once the profile has the bundle, no bundle checkout is needed — run the profile's own bin:

```sh
# with dsh installed from the registry (project dependency or on PATH)
$DSH_HOME/profiles/web/node_modules/.bin/fabric-dsh --port 8000

# against a plain official deepseek-harness checkout
$DSH_HOME/profiles/web/node_modules/.bin/fabric-dsh \
  --source <deepseek-harness-checkout> web --port 8000
```

(home and profile derive from the install path. Without `--source` the launcher runs a registry-installed `@deepseek-ai/dsh` — the published CLI entry is plain ESM, so neither tsx nor a checkout is needed; the CLI resolves from `DSH_CLI`, the caller's project dependencies, or a `dsh` on PATH, following pnpm's cmd-shim scripts. The checkout form `node <bundle-repo>/scripts/fabric-dsh.mjs --source <checkout> --profile web ...` stays available for development.)

First-time setup from this bundle repo: `pnpm run install:host -- <deepseek-harness-checkout> [--dsh-home <dir>]` — harness deps + build, profile seed (pnpm settings the git-resolved trio needs), bundle install through the official plugin channel (`dsh plugin --profile web add https://github.com/omdsh-dev/fabric/releases/latest/download/pkg.tgz`, which joins `cordis-fabric-bundle` to `dsh.profile.bundles`), and the `cordis-fabric-dsh` row enable. The host patch is empty, so nothing is patched or branched.

`fabric-dsh` composes the profile's patch layers, writes the composed descriptors to `$DSH_FABRIC_CONFIG`, injects `packages/cordis-fabric/preload.mjs` through `--import` (which registers the loader hooks before the CLI entry loads, resolving the trio from the profile so hooks and plugins share one module instance — healing the profile's module fallback first, since the preload runs before the CLI's own boot heals it), pins the tsx tsconfig for source checkouts, and appends the profile's pnpm settings (`blockExoticSubdeps: false`, `dangerouslyAllowAllBuilds: true`) when missing. A row that declares `config.fabric.patches` is Fabric-required: it ships disabled, and fabric-dsh enables such rows through a generated overlay — a plain `dsh` boot skips them entirely (the app runs, the dependent plugins stay unloaded), while fabric-dsh loads them with the hooks installed; the Host plugin then verifies required bindings one tick after boot, and a Fabric-required row explicitly enabled on plain `dsh` fails the launch loud. The boot output identifies a fabric-enabled launch on stderr: a `fabric-dsh:` marker when the hooks install, then a hook summary listing every patch and the target file it hooked.

The launcher installs no-op SIGINT/SIGTERM handlers: without them a bare `spawnSync` parent hangs after its child dies of a signal, keeping the terminal's foreground job alive until a second ^C kills the hung launcher. The child (the official CLI) receives every signal directly — the kernel delivers to the whole foreground process group — and owns its own first-^C graceful / second-^C force escalation, so the shell regains the prompt after one ^C.

**npm-installed official `dsh`** — works directly: a `fabric-dsh` launch without `--source` runs the registry-installed CLI (the prebuilt entry is plain ESM and takes the preload the same way), with no source checkout, tsx, or host patch involved.

Two prerequisites:

- pnpm resolves GitHub dependencies over SSH, so the installing machine needs GitHub SSH access for `dsh-external/fabric`.
- The launch must go through `fabric-dsh` (plain `dsh` never activates the Fabric hooks); see above.

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
- On an npm-installed official `dsh`, `fabric-dsh` cannot run (the CLI ships prebuilt and there is no source entry to preload); those hosts work once the official repository merges the wiring. Source hosts launch through `fabric-dsh` (see the Installation section).
