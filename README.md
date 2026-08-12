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
lib/                      # generated install artifacts (per package)
```

## Repository boundary

This repository is fully self-contained: every source file, compiler setting, test fixture, contributor instruction, and build helper lives below this repository root, and every development input resolves from this repository's own manifests and lockfile. The DSH host packages (`@deepseek-ai/dsh-agent`, `@deepseek-ai/dsh-invariants`, and the other `@deepseek-ai/dsh-*` services the facades delegate to) are private and not installable from the npm registry; `packages/cordis-fabric-dsh/src/host-contracts.ts` declares the narrow structural contracts the facades need, and a composed DSH profile supplies the real services at runtime.

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

The bundle patch only composes these package rows. The launcher/bootstrap and browser build seams the trio needs to RUN are host-side code outside the three packages and are carried as `patches/fabric-host-integration.patch` (apply it to a deepseek-harness checkout at snapshot `4ee4ae88`; see `patches/README.md`). A host already at the split commit needs nothing.

## Development

```sh
pnpm install
pnpm run verify:self-contained
pnpm run typecheck
pnpm test
pnpm run build
```

`pnpm run prepare` is the consumer-side artifact build for Git and tarball installation: it emits declarations and runtime bundles for all three packages using only this repository's installed dependencies, so a Git install does not require sibling project references or another checkout. pnpm may require the profile to allow the package's prepare script; only approve a pinned, trusted checkout.

## Model Experience

The low-level transformer contributes no model-visible content. The cooperative facades delegate prompt, tools, commands, agent events, and browser command/slot registrations to their authoritative DSH services; those owners retain logging, permissions, approval, cancellation, and rendering semantics.

## Known Limitations and Deferred Work

- Node load-time transformation requires precompiled JavaScript; browser transforms strip TypeScript before applying handlers.
- The browser faces are split across the two dual-face packages (`cordis-fabric/client` for the bridge and service, `cordis-fabric-dsh/client` for the Mod-facing facade); consumers that need the complete typed SlotMap should use the authoritative DSH slot service instead of widening the facade.
- The former host integration patch for older DSH snapshots was removed with the restructure; a bundle cannot add missing loader or browser build seams.
