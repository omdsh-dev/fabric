# `@deepseek-ai/dsh-cordis-fabric-api`

English | [中文](README.zh.md)

Cooperative Fabric API modules: stable, Mod-facing Cordis extension contracts that delegate to the authoritative DSH services. The package is the DSH counterpart of Minecraft's Fabric API — an optional library above the loader and the Mixin subsystem — and it is opt-in: nothing in the default DSH composition mounts it.

## What it does

Three layers make up the Fabric-style extension architecture. The first two already exist; this package is the third:

| Layer | Owner | Contract |
|---|---|---|
| Mod loader | Cordis Loader | Discovers configured plugins, resolves injection, mounts fibers, and disposes effects. |
| Mixin subsystem | [`@deepseek-ai/dsh-cordis-fabric`](../cordis-fabric/README.md) | Transforms target code and dispatches trusted low-level patches. |
| Cooperative Mod API | this package | Stable, domain-level registrations and events backed by existing DSH owners. |

A Mod remains an ordinary Cordis plugin that declares injection of only the Fabric API module services it consumes. Each facade delegates to the authoritative service — `ctx.tools`, `ctx.systemPrompt`, `ctx.commands`, the `agent/*` events, and the browser `ctx.command`/`ctx.slots` — and returns the exact disposer of the underlying effect. No facade stores a parallel copy of domain state, and none can bypass policy, approval, timeout, logging, cancellation, or the authoritative executor.

## Modules

| Entry | Service | Platform | Delegates to |
|---|---|---|---|
| `.` (Host bundle) | mounts all four Host modules | Host | the four entries below |
| `./agent` | `ctx.fabricAgent` | Host | `agent/*` events and `agent.inject()` |
| `./tools` | `ctx.fabricTools` | Host | `ctx.tools` and `tools/*` |
| `./prompt` | `ctx.fabricPrompt` | Host | `ctx.systemPrompt` |
| `./commands` | `ctx.fabricCommands` | Host | `ctx.commands` |
| `./compat` | `ctx.fabricCompat` | Host | low-level `dsh-cordis-fabric` patches (gap adapter) |
| `./client` | `ctx.fabricClient` | Web | `ctx.command` and `ctx.slots` |

The root entry is the standard Host bundle; every subpath is also directly mountable for thin compositions. The browser entry is a `dshClient` artifact with a disabled web-roster row (opt-in).

## Installation

Mount the Host bundle (or one subpath) where the authoritative services are present:

```ts ignore-check
import * as fabricApi from '@deepseek-ai/dsh-cordis-fabric-api'

// mounts ctx.fabricAgent, ctx.fabricTools, ctx.fabricPrompt, ctx.fabricCommands
await ctx.plugin(fabricApi)
```

```yaml
# User overlay: enable the Host bundle row.
- id: cordis-fabric-api
  disabled: false
```

A Mod declares only the modules it consumes:

```ts ignore-check
export const name = 'my-mod'
export const inject = ['fabricAgent', 'fabricPrompt']

export function apply(ctx: Context): void {
  ctx.fabricAgent.onStatus((agent, status) => {
    ctx.logger.info('agent %s is %s', agent.id, status)
  })
  ctx.fabricPrompt.section({
    name: 'my-mod-identity',
    order: -80,
    text: 'my-mod is active',
  })
}
```

## Contracts

Every registration is a fiber effect: disposing the contributing plugin removes the contribution, matching the authoritative owner's disposal semantics (HMR-safe). Facade methods return the exact underlying disposer.

- **Agent API.** A stable subset of lifecycle observation (`onCreated`, `onDisposed`, `onStatus`) and operation-local context injection (`inject`). It never exposes the concrete loop, private queue state, or mutable session internals; callbacks receive the live Agent only where the owning event already does.
- **Tool API.** `register` and pre/post execution listeners through `ctx.tools`. A Fabric API tool has the same schema and result obligations as a native DSH tool, including model-visible logging and render intent. A waterfall listener must call `next()` unless it intentionally vetoes.
- **Prompt API.** Ordered system sections, cache-safe contexts, tool-schema providers, and prompt variables through `ctx.systemPrompt`. There is no shortcut that inserts unlogged model-visible text or assembles provider requests directly.
- **Command API.** Human commands through `ctx.commands`; commands remain outside model turns unless the owning contract starts one.
- **Compat API.** The cooperative entry for the low-level patch machinery. Two faces: `observe(name, listener)` keeps the static observation adapter for target domains with no cooperative extension point (targets declared in the module config, `buildCompatInstrumentations` produces the load-time instrumentations, and the public contract exposes only the declared target names). `registerPatch(patch)` / `unregisterPatch` / `disablePatch` / `enablePatch` open the full runtime patch surface — handlers bound at runtime to transforms the launcher bootstrap already installed (the web roster's `config.fabric.patches` stubs) — with an EXCLUSIVE id namespace: an id already claimed by a declared observation target or an earlier registration fails loud, where the low-level registry silently updates. `serveBundle(options)` exposes the runtime browser-bundle primitive (`serveBrowserTransform`) so bundle rewrites also enter through the cooperative facade. All faces verify the bridge installation capability (`isFabricInstalled`) and fail loud when the hooks are absent.
- **Client API.** Client commands and named UI slots through `ctx.command` and `ctx.slots`. The slot registration face is intentionally narrow (`FabricSlotOptions`): the full SlotMap type machinery lives in `@deepseek-ai/dsh-client-ui-slots`, whose declaration merging only sees the packages each consumer imports. `registerKeyedSlot(name, key, options, component)` adds ARBITRATION for keyed slots: the host invariant (one owner per key, loud on duplicates) stays, but the owner is decided by declared `priority` instead of mount timing — losing claimants queue and take over automatically when the owner disposes (`onGain`), a higher-priority claimant displaces the incumbent without force-disposing it (`onLost` informs it), and equal priorities keep registration order with a warning. Direct `ctx.slots.register` users still get the host throw.

The public surface exports no AST selector, module file path, `FabricPatch`, raw bridge handle, or bypass around tool/command/prompt policy. Low-level patches remain the Mixin subsystem's escape hatch and are never part of this package's contract.

## Security and trust model

- Fabric API is safe to grant more broadly than `ctx.fabric`, but it is not automatically available to model-written temporary plugins: each facade reaches real process capabilities through its owning service, and repository/temporary-plugin policy grants modules explicitly.
- Missing required module services fail during Cordis activation (declared `inject`), and optional capabilities are read with `ctx.get()`.
- The facade never widens the authority of the service it delegates to.

## Platform support

- **Node Host:** all five Host modules, via the authoritative Host services (the compat adapter additionally requires the Fabric load-time hooks).
- **Browser/Web:** the `./client` entry mounts `ctx.fabricClient` in the browser Cordis tree; the web roster row `cordis-fabric-api` is disabled by default (opt-in).

## Model Experience

Indirectly, through the authoritative owners it delegates to: tools, prompt sections, and command handlers registered through this package are model-visible exactly as the owning registry makes them model-visible, and the session log reconstructs everything that reaches a model request.

#### KV Cache effect

None; the package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The facades are curated subsets, not complete mirrors.** A module enters Fabric API only when a real Mod consumer needs a compatibility boundary the domain service itself does not promise; the domain services remain the authoritative surface for everything else.
- **The client slot face is a narrow subset.** `ctx.fabricClient.registerSlot` accepts a stable option shape (`FabricSlotOptions`); declaration merging and composed-props inference stay in `dsh-client-ui-slots`, so a Mod that needs the full typed register contract uses that service directly.
- **The Cordis service catalog does not list the module services.** The catalog projector records service classes living in `src/index.ts` or `src/service.ts`; each Fabric API module lives in its own entry file, so `ctx.fabricAgent` and friends are documented here rather than in the generated catalog.
