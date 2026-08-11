# `@deepseek-ai/dsh-cordis-fabric`

English | [中文](README.zh.md)

The Fabric/Mixin extension layer as an installable DSH profile bundle. The root package contains the trusted load-time transformation service and exports the cooperative Mod API through `@deepseek-ai/dsh-cordis-fabric/api`; the browser face combines the low-level bridge and the Mod-facing client facade in one `dshClient` entry.

## Repository shape

```text
package.json              # root package and dsh.bundle/dshClient manifests
AGENTS.md                 # repository-local contributor rules
cordis.patch.yml          # explicit Fabric host rows
docs/                     # detailed Fabric, API, and contract references
patches/README.md         # optional pnpm dependency-patch contract
scripts/                  # self-contained prepare and boundary verification
src/                      # Fabric host, contracts, loader, browser, and testkit entries
tests/                    # transformation, facade, composition, and serve suites
lib/                      # generated install artifacts
```

The package keeps the two logical faces without requiring two Git-installed packages:

```text
@deepseek-ai/dsh-cordis-fabric          host transformation service
@deepseek-ai/dsh-cordis-fabric/api      Host cooperative facade
@deepseek-ai/dsh-cordis-fabric/client   combined browser face
```

## Repository boundary

This repository is fully self-contained: every source file, compiler setting, test fixture, contributor instruction, and build helper lives below this repository root, and every development input resolves from this repository's own manifest and lockfile. The DSH host packages (`@deepseek-ai/dsh-agent`, `@deepseek-ai/dsh-invariants`, and the other `@deepseek-ai/dsh-*` services the facades delegate to) are private and not installable from the npm registry; `src/host-contracts.ts` declares the narrow structural contracts the package needs, and a composed DSH profile supplies the real services at runtime.

Run `pnpm run verify:self-contained` to enforce the boundary: it rejects local-path dependency specs, compiler or code paths that leave the repository, external or broken Markdown links, absolute workstation paths, and the removal of any repository-layout contract.

## Bundle behavior

The bundle adds both Host rows as disabled opt-ins:

```yaml
- id: cordis-fabric
  name: '@deepseek-ai/dsh-cordis-fabric'
  disabled: false

- id: cordis-fabric-api
  name: '@deepseek-ai/dsh-cordis-fabric/api'
  disabled: false
```

Fabric patch handlers are trusted code registered through `ctx.fabric.register()`. Patch descriptors are configuration metadata, but executable handlers are never deserialized from YAML or model input. The service supports Node ESM/CommonJS load-time transformation, browser build-time transformation, priority composition, HMR-safe disposal, static target validation, generator delegation, and watched browser transforms.

The bundle patch only composes these package rows. Profile bootstrap, browser transform serving, client build seams, catalogs, and launcher dependencies must come from the DSH version selected by the profile.

## Development

```sh
pnpm install
pnpm run verify:self-contained
pnpm run typecheck
pnpm test
pnpm run build
```

`pnpm run prepare` is the consumer-side artifact build for Git and tarball installation: it emits declarations and runtime bundles from `src/` using only this repository's installed dependencies, so a Git install does not require sibling project references or another checkout. pnpm may require the profile to allow the package's prepare script; only approve a pinned, trusted checkout.

## Model Experience

The low-level transformer contributes no model-visible content. The cooperative API delegates prompt, tools, commands, agent events, and browser command/slot registrations to their authoritative DSH services; those owners retain logging, permissions, approval, cancellation, and rendering semantics.

## Known Limitations and Deferred Work

- Node load-time transformation requires precompiled JavaScript; browser transforms strip TypeScript before applying handlers.
- The browser face is intentionally combined for Git/profile installation; consumers that need the complete typed SlotMap should use the authoritative DSH slot service instead of widening this facade.
- The former host integration patch for older DSH snapshots was removed with the restructure; a bundle cannot add missing loader or browser build seams.
