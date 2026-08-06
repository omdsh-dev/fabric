# `@deepseek-ai/dsh-cordis-fabric`

English | [中文](README.zh.md)

Fabric/Mixin-style extension layer over [Orchestrion-JS](https://github.com/nodejs/orchestrion-js) for trusted Cordis plugins. The service is opt-in: nothing in the default DSH composition mounts it, and patches register through trusted code.

## What it does

A trusted plugin (A) can change the behavior of another plugin's function (B) **without editing B's source**, by registering a Fabric patch against B's module, file, and function:

| Operation | What the handler can do |
|---|---|
| `before` | Mutate the call arguments before the original body runs. |
| `after` | Observe or replace the successful result (including async results, after settlement). |
| `around` | Decide whether the original body runs and optionally replace its result (call `invoke()` to delegate). |
| `replace` | Own the call entirely; the original body only runs if the handler calls `invoke()`. |

The mechanism is load-time code transformation: the transform hooks rewrite the target function's body to publish a call record to a process-local bridge channel, and the runtime dispatches it to the currently registered handler. When no handler is active (disabled, disposed, or never enabled), transformed code delegates to the original body untouched.

## Installation and bootstrap

```ts ignore-check
import { bootstrapFabric, FabricService } from '@deepseek-ai/dsh-cordis-fabric'

// 1. Before any target module is imported (application preparation):
const disposeHooks = bootstrapFabric([patch])

// 2. Mount the service so plugins can register handlers:
await ctx.plugin(FabricService)
```

`bootstrapFabric` validates the patches, builds their Orchestrion instrumentations, and installs the transformation hooks. In the `dsh` host, a `cordis-fabric` composition row with `config.patches` (static descriptors — handlers are trusted code bound at registration) is bootstrapped automatically during `boot()` preparation, before any config-tree entry mounts; `installFabricHooks` is the lower-level form when instrumentations are already built.

```yaml
# User overlay (e.g. $DSH_HOME/config.yaml or a --config file): enable the row
# and declare the static patch descriptors. Handlers are NOT configured here —
# plugins register them through ctx.fabric at runtime.
- id: cordis-fabric
  disabled: false
  config:
    patches:
      - id: vendor/rewrite-greeting
        target:
          module: '@example/target-package'
          versionRange: '^1.0.0'
          filePath: 'lib/index.js'
          functionQuery: { functionName: 'greet', kind: 'Sync' }
        operation: 'before'
```

The same row's browser half (`./client`) mounts `ctx.fabric` in the web tree when the row is enabled; client bundles transform at build time and only take effect after that entry materializes.

The hooks must be installed before the target module's first evaluation; a patch registered after that point only takes effect for modules transformed later. The `registerHooks` API has no unregister, so the returned disposer deactivates the installation's state rather than removing the hooks.


## Registering a patch

```ts ignore-check
export const inject = ['fabric']

export function apply(ctx: Context): void {
  ctx.fabric.register({
    id: 'my-vendor/rewrite-greeting',
    target: {
      module: '@example/target-package',
      versionRange: '^1.0.0',
      filePath: 'lib/index.js',
      functionQuery: { functionName: 'greet', kind: 'Sync' },
    },
    operation: 'before',
    handler(call: { arguments: unknown[] }) {
      call.arguments[0] = String(call.arguments[0]).toUpperCase()
    },
  })
}
```

The registration is a fiber effect: disposing the plugin disables and removes the patch. `ctx.fabric.list()` returns an ordered diagnostic snapshot; `ctx.fabric.disable(id)` / `ctx.fabric.enable(id, handler)` toggle a patch without removing it.

## Security and trust model

- Patch handlers are trusted code bound at registration time; executable handlers are never deserialized from YAML or model input.
- Transformed code has process-level authority inside the target module. `cordis_mount` temporary plugins and repository plugins must not receive Fabric capability without an explicit grant.
- Ids must match `[A-Za-z0-9._:/+-]{1,120}` (they are embedded in diagnostics and generated code).
- Target validation is fail-loud: a malformed target (bad id, module, version range, file, operation, or selector) throws at registration instead of installing a config that never matches. A well-formed target that matches nothing — different installed version, different file layout — silently leaves the module untransformed; the matcher only rewrites what its selectors pick.

## Platform support

- **Node Host (ESM + CommonJS):** supported via synchronous `module.registerHooks` (Node ≥ 22.22.3 / ≥ 24.11.1) and the CJS `_compile` path. Node versions without `registerHooks` use the async `module.register` fallback through the `./hook-entry` loader-thread module.
- **Browser/Web:** the bundle-time rewrite (`createBrowserTransform` + `repoSourceResolver`, wired through `clientBundle(id, libEntry, { transform })`) rewrites client plugin functions, and the package's own client half (`./client`) installs the bridge and mounts `ctx.fabric` in the browser Cordis tree. Client bundles fall back to the original body until that entry materializes, so patches take effect for calls after the browser Fabric runtime is up. The web roster row `cordis-fabric` is disabled by default (opt-in).

## Browser build usage

```ts ignore-check
import { createBrowserTransform, repoSourceResolver, patchInstrumentation } from '@deepseek-ai/dsh-cordis-fabric'
import { clientBundle } from '../tsdown.client.js'

const fabric = createBrowserTransform(
  [patchInstrumentation(patch)],
  repoSourceResolver('@deepseek-ai/dsh-client-my-plugin', new URL('..', import.meta.url).pathname, '0.0.1'),
)

export default clientBundle('@deepseek-ai/dsh-client-my-plugin', ['lib/types/index.js', 'lib/types/invariant.js'], {
  transform: (code, id) => fabric(code, id) ?? undefined,
})
```

The resolver maps the package's own source tree to its package identity; the upstream adapter is not used because it requires a `node_modules` boundary that repository source builds do not have. TypeScript sources are stripped to plain JavaScript before transformation (the transformer parses emitted JavaScript).

## Model Experience

None, as this package is host-side load-time transformation and patch registry machinery; patches register through code, never through model-written configuration.

#### KV Cache effect

None; the package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Hooks stay for the process lifetime, state does not.** `registerHooks` hooks compose and stay registered; the disposer removes the installation's state (hooks become pass-through, cached transformers are freed). Each installation captures its own state and transforms through its own matcher, so concurrent installations are isolated; the shared CommonJS `_compile` wrapper consults the top-of-stack installation, and disposing an earlier one leaves later ones intact.
- **CommonJS modules re-transform; ESM modules do not.** An already-evaluated CommonJS module can be re-evaluated under the current installation stack with `retransformCommonJs(filename)`: its `require.cache` entry and seen marks are dropped, and the next `require()` runs the `_compile` wrapper again. An HMR cycle replaces an old installation by disposing it (its hooks become pass-through) before re-evaluating, so the fresh module carries only the new instrumentation; the old exports object keeps the old transformation. ESM modules have no equivalent — the ESM cache has no unload path — so disabling a patch makes transformed ESM code delegate to the original body, but the module is not re-transformed.
- **Multiple patches on one function stack by priority.** Instrumentations apply in ascending priority order, so a higher-priority handler runs first (the outermost layer); equal priorities keep installation order (the later instrumentation wraps the outermost layer, so its handler runs first). Two `replace` patches on the same target are rejected at registration.
- **Arrow targets support plain identifier parameters only** (no rest, defaults, or destructuring), and arrows whose body reads the enclosing `arguments` object are skipped (the traced function would shadow it); other arrows are skipped. Generator function targets are skipped (the injected return would break iteration semantics).
- **Node load-time transformation requires precompiled JavaScript.** The loader parses emitted JS; `.ts` sources passed raw to the Node load hook fail loudly. The browser build path strips TypeScript annotations (and JSX) before transformation.
