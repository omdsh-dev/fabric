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
- Target validation is fail-loud: a malformed target (bad id, module, version range, file, operation, selector, or index) throws at registration instead of installing a config that never matches. A well-formed target that matches nothing — different installed version, different file layout — silently leaves the module untransformed; the matcher only rewrites what its selectors pick.
- A selector that picks several functions in one file rewrites every match by default (the upstream first-match-only default is flipped: `index: null`); pass a zero-based `index` (`target.index` for a raw `astQuery`, `functionQuery.index` for a name query) to rewrite a single match. Constructor targets are rejected loudly at transformation time — a moved constructor body cannot carry `super()` or `new.target` — so patch a method or factory instead.

## Platform support

- **Node Host (ESM + CommonJS):** supported via synchronous `module.registerHooks` (Node ≥ 22.22.3 / ≥ 24.11.1) and the CJS `_compile` path. Module identity resolves through the npm-layout parser first and falls back to the nearest `package.json` (`nodePackageResolver`) — Node realpaths workspace links, so a workspace package's loaded URL has no `node_modules` boundary for the layout parser to name, while the nearest manifest always can. This is what lets patches target first-party workspace packages (e.g. a host tool bundle) at their real paths. `registerHooks` exists from 22.19.0, but before 22.22.3 / 24.11.1 its synchronous load chain returns no source for CommonJS modules when loader-thread hooks (`module.register`, e.g. tsx on those versions) are also present, which crashes Node's load validation; those versions therefore use the async `module.register` fallback through the `./hook-entry` loader-thread module. The entry is registered once and reads a shared configuration file (rewritten by the main thread on every installation and disposal) on each load, so re-transformation, disposal, and concurrent installations behave the same on both paths.
- **Browser/Web:** the bundle-time rewrite (`createWatchedBrowserTransform` (or `createBrowserTransform` for a static set) + `repoSourceResolver`, wired through `clientBundle(id, libEntry, { transform })`) rewrites client plugin functions, and the package's own client half (`./client`) installs the bridge and mounts `ctx.fabric` in the browser Cordis tree. Client bundles fall back to the original body until that entry materializes, so patches take effect for calls after the browser Fabric runtime is up. The web roster row `cordis-fabric` is disabled by default (opt-in).

## Browser build usage

```ts ignore-check
import { createWatchedBrowserTransform, repoSourceResolver } from '@deepseek-ai/dsh-cordis-fabric'
import { clientBundle } from '../tsdown.client.js'

const fabric = createWatchedBrowserTransform(
  new URL('./fabric.patches.json', import.meta.url).pathname,
  repoSourceResolver('@deepseek-ai/dsh-client-my-plugin', new URL('..', import.meta.url).pathname, '0.0.1'),
)

export default clientBundle('@deepseek-ai/dsh-client-my-plugin', ['lib/types/index.js', 'lib/types/invariant.js'], {
  transform: fabric,
})
```

The patches file holds a JSON array of static patch stubs (the same shape the launcher's `config.patches` row carries; JSON cannot express a `RegExp` `filePath`, so file paths are strings), and a malformed file fails the build loudly. The transform registers the file in the bundler's watch graph on every module, so under `tsdown --watch` (`pnpm run dev:web`) an edit rebuilds the bundle with the new patch set — the build trigger — and the client-hmr chain (stat poll, `rebuilt` frame, invalidate/prefetch/fiber swap) delivers it to the browser. A static in-memory patch set can still use `createBrowserTransform` directly.

The resolver maps the package's own source tree to its package identity; the upstream adapter is not used because it requires a `node_modules` boundary that repository source builds do not have. TypeScript sources are stripped to plain JavaScript before transformation (the transformer parses emitted JavaScript).

## Model Experience

None, as this package is host-side load-time transformation and patch registry machinery; patches register through code, never through model-written configuration.

#### KV Cache effect

None; the package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Hooks stay for the process lifetime, state does not.** `registerHooks` hooks compose and stay registered; the disposer removes the installation's state (hooks become pass-through, cached transformers are freed). Each installation captures its own state and transforms through its own matcher, so concurrent installations are isolated; the shared CommonJS `_compile` wrapper chains every active installation in installation order (mirroring the sync hook chain), and disposing an earlier one leaves later ones intact. The async `module.register` fallback reaches the same semantics through its shared configuration file: the single loader-thread entry reads the current installation stack on every load, so a disposed installation stops transforming ESM on the next evaluation. The pid-scoped configuration file is removed on process exit.
- **CommonJS and ESM modules re-transform on both hook paths.** An already-evaluated module can be re-evaluated under the current installation stack: `retransformCommonJs(filename)` drops the `require.cache` entry (and the same file's Node-internal `loadCache` entry, so both graphs observe the fresh evaluation) and seen marks, and `retransformEsm(url)` evicts the module's Node-internal `loadCache` entry (the same mechanism the vendored Loader's HMR uses) — the next `require()`/`import()` runs the hooks again with the current installation stack (the sync hooks read the main-thread stack; the async entry reads the shared configuration). An HMR cycle replaces an old installation by disposing it before re-evaluating, so the fresh module carries only the new instrumentation; the old exports object keeps the old transformation. A failed ESM re-import restores the evicted entry, so the previous instance survives instead of leaving the URL unevaluatable. ESM re-transformation requires Node ≥ 22 (the internal module loader); the async `module.register` fallback supports it too, since the loader thread re-reads the configuration on the re-import.
- **Multiple patches on one function stack by priority.** Instrumentations apply in ascending priority order, so a higher-priority handler runs first (the outermost layer); equal priorities keep installation order (the later instrumentation wraps the outermost layer, so its handler runs first). Across installations, nesting follows installation order on every hook path — the later installation wraps outermost regardless of priority — because the sync hooks, the CJS `_compile` wrapper, and the async loader-thread entry all chain transforms per installation. Two `replace` patches on the same target are rejected at registration.
- **Arrow targets support every parameter pattern** (identifiers, rest, defaults, and destructuring — the patterns bind their names before the injected statements run), and a body referencing the enclosing `arguments` object is preserved by capturing it first. An arrow whose parameter is literally named `arguments` (it would shadow that capture) is skipped. Generator functions transform through delegation: the traced generator is `yield*`-delegated on the no-handler and `before`/`around`-invoke paths, so iteration semantics survive; a handler-supplied replacement that is not iterable is returned directly. `after` observes the generator object before iteration (the operation cannot intercept between yields).
- **Node load-time transformation requires precompiled JavaScript.** The loader parses emitted JS; `.ts` sources passed raw to the Node load hook fail loudly. The browser build path strips TypeScript annotations (and JSX) before transformation.
