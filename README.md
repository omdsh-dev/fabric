# `@deepseek-ai/dsh-cordis-fabric`

English | [中文](README.zh.md)

The Fabric/Mixin extension layer as an installable DSH profile bundle. The root package contains the trusted load-time transformation service and exports the cooperative Mod API through `@deepseek-ai/dsh-cordis-fabric/api`; the browser face combines the low-level bridge and the Mod-facing client facade in one `dshClient` entry.

## Repository shape

```text
package.json              # root package and dsh.bundle/dshClient manifests
cordis.patch.yml          # explicit Fabric host rows
src/                      # Fabric host, API, loader, browser, and testkit entries
lib/                      # generated install artifacts
legacy/                   # source-compatible host integration patch for older DSH snapshots
docs/                     # detailed Fabric and API references
tests/fabric/              # transformation, loader, browser, and testkit tests
tests/api/                 # cooperative Host/client facade tests
```

The package keeps the two logical faces without requiring two Git-installed packages:

```text
@deepseek-ai/dsh-cordis-fabric          host transformation service
@deepseek-ai/dsh-cordis-fabric/api      Host cooperative facade
@deepseek-ai/dsh-cordis-fabric/client   combined browser face
```

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

The bundle patch only composes these package rows. Profile bootstrap, browser transform serving, client build seams, catalogs, and launcher dependencies must come from the DSH version selected by the profile. The previous host integration diff is retained in `legacy/` for older DSH snapshots and is not part of the new bundle contract.

## Development

A full typecheck expects sibling checkouts:

```text
~/git/deepseek-harness
~/git/fabric
```

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
```

The `prepare` script builds the host, loader, testkit, API, and browser entries directly from `src/`, so a Git install does not require sibling project references. pnpm 10 may require the profile to allow the package's prepare script; only approve a pinned, trusted checkout.

## Model Experience

The low-level transformer contributes no model-visible content. The cooperative API delegates prompt, tools, commands, agent events, and browser command/slot registrations to their authoritative DSH services; those owners retain logging, permissions, approval, cancellation, and rendering semantics.

## Known Limitations and Deferred Work

- Node load-time transformation requires precompiled JavaScript; browser transforms strip TypeScript before applying handlers.
- The browser face is intentionally combined for Git/profile installation; consumers that need the complete typed SlotMap should use the authoritative DSH slot service instead of widening this facade.
- Older DSH snapshots require the host integration patch in `legacy/` because a bundle cannot add missing loader or browser build seams.
