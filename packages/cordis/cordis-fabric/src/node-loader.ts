/**
 * Node transformation hooks for Fabric: installs the bridge handle and the
 * synchronous ESM/CJS load hooks that rewrite target modules with the
 * Orchestrion Fabric transform before they are evaluated.
 *
 * The hooks must be installed before any target module is imported (the
 * Cordis Loader imports plugin modules only after entries are created, so a
 * bootstrap call during application preparation is early enough). The
 * transformation itself is registration-free: transformed code publishes to
 * the bridge channel, and the runtime decides per patch whether a handler is
 * active — so handlers may be registered, enabled, disabled, or disposed
 * after the module was already transformed.
 *
 * Node's `registerHooks` API has no unregister; hooks compose and stay for
 * the process lifetime. The returned disposer therefore deactivates the
 * loader's state (hooks become pass-through, cached transformers are freed)
 * rather than removing the hook functions themselves.
 * @module @deepseek-ai/dsh-cordis-fabric/node-loader
 */

import { Module, createRequire, register, registerHooks } from 'node:module'
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { create, type InstrumentationConfig } from '@apm-js-collab/code-transformer'
import parse from 'module-details-from-path'
import { installBridge } from './bridge.ts'
import { getPackageVersion } from './module-identity.ts'
import { validatePatchId, validatePatchStatic } from './runtime.ts'
import { registerFabricTransform } from './transform.ts'
import type { FabricPatchStub } from './types.ts'

/**
 * An Orchestrion config extended with the Fabric fields the transform reads
 * from the merged state: the patch id and operation stamped by the config
 * builder, and the custom `'fabric'` transform name selecting the DSH
 * operator. `InstrumentationConfig` is a union type, so the extension is a
 * local intersection rather than a declaration merge.
 */
export type FabricInstrumentationConfig = InstrumentationConfig & {
  /** Patch id stamped into every generated call. */
  fabricPatchId: string
  /** Operation kind stamped into every generated call. */
  fabricOperation: string
  /** Patch priority: instrumentations apply in ascending priority order, so a higher-priority handler runs first (outermost). */
  fabricPriority: number
  /** Must be `'fabric'` to select the DSH operator. */
  transform: 'fabric'
  /** Raw esquery selector choosing the node(s) to instrument. */
  astQuery: string
}

export type { InstrumentationConfig }

/** The `Module.prototype._compile` internals this loader wraps for CJS. */
type CompileFn = (this: Module, content: string, filename: string) => unknown

/**
 * Build the Orchestrion config for one Fabric patch.
 *
 * Validates the static patch shape: descriptors reach this point from the
 * configuration plane (the CLI reads `config.patches` from YAML), so a
 * malformed target must fail loud here instead of silently installing a
 * config that never matches.
 * @param patch - patch descriptor.
 * @returns the instrumentation config the transform hooks consume.
 */
export function patchInstrumentation(patch: FabricPatchStub): FabricInstrumentationConfig {
  validatePatchId(patch.id)
  validatePatchStatic(patch)
  const target = patch.target
  const rawQuery = target.astQuery
  if (typeof rawQuery === 'string' && rawQuery.trim().length === 0) {
    throw new Error('fabric: patch target astQuery must not be blank')
  }
  const query = rawQuery ?? queryFromFunction(patch)
  return {
    channelName: patch.id,
    module: {
      name: target.module,
      versionRange: target.versionRange,
      filePath: target.filePath,
    },
    astQuery: query,
    // The function query doubles as the behavior bag: name-based targets carry
    // their matching fields; raw astQuery targets have only behavior fields
    // (index) read. The default flips the upstream first-match-only (index 0)
    // to every match (index null): the selector picks the functions, so all
    // of them are rewritten.
    functionQuery: target.functionQuery && !target.astQuery
      ? { ...target.functionQuery, index: target.functionQuery.index ?? null }
      : { index: target.index ?? null },
    transform: 'fabric',
    fabricPatchId: patch.id,
    fabricOperation: patch.operation,
    fabricPriority: patch.priority ?? 0,
  }
}

/**
 * Order instrumentations by ascending priority (stable for equal keys).
 * Orchestrion applies transforms in array order, so the last instrumentation
 * wraps the outermost layer and its handler runs first; ascending order
 * therefore makes a higher-priority patch run before a lower-priority one
 * while equal priorities keep their installation order.
 * @param instrumentations - Fabric instrumentations to order.
 * @returns a new array ordered by priority.
 */
export function orderInstrumentations(
  instrumentations: readonly FabricInstrumentationConfig[],
): FabricInstrumentationConfig[] {
  return [...instrumentations].sort((left, right) => left.fabricPriority - right.fabricPriority)
}

/**
 * Derive the esquery selector for a target, mirroring the built-in
 * transformer's `#fromFunctionQuery` so class methods, object-literal
 * properties, and function declarations all match. The Fabric path always
 * goes through `astQuery` so the custom operator runs.
 * @param patch - the patch whose target carries a name-based query.
 * @returns the esquery selector for the target function.
 */
function queryFromFunction(patch: FabricPatchStub): string {
  const q = patch.target.functionQuery
  if (!q) throw new Error('fabric: patch target must carry functionQuery or astQuery')
  const queries: string[] = []
  const method = 'methodName' in q ? q.methodName : 'privateMethodName' in q ? q.privateMethodName : undefined
  if (method) {
    const keyType = 'privateMethodName' in q ? 'PrivateIdentifier' : 'Identifier'
    queries.push(
      `ClassBody > [key.name="${method}"][key.type=${keyType}] > [async]`,
      `Property[key.name="${method}"][key.type=${keyType}] > [async]`,
    )
  }
  if ('functionName' in q) {
    queries.push(
      `FunctionDeclaration[id.name="${q.functionName}"][async]`,
      `VariableDeclarator[id.name="${q.functionName}"] > FunctionExpression[async]`,
      `VariableDeclarator[id.name="${q.functionName}"] > ArrowFunctionExpression[async]`,
    )
  }
  if ('expressionName' in q) {
    queries.push(
      `FunctionExpression[id.name="${q.expressionName}"][async]`,
      `ArrowFunctionExpression[id.name="${q.expressionName}"][async]`,
      `VariableDeclarator[id.name="${q.expressionName}"] > FunctionExpression[async]`,
      `VariableDeclarator[id.name="${q.expressionName}"] > ArrowFunctionExpression[async]`,
    )
  }
  if (queries.length === 0) throw new Error('fabric: unsupported functionQuery shape')
  return queries.join(', ')
}

/**
 * Convenience bootstrap for application preparation: validate patches, build
 * their instrumentations, and install the transformation hooks. Call this in
 * the host's `boot()` `prepare` hook (or any point before the target plugin's
 * first import); then mount `FabricService` and let patch plugins register
 * handlers through `ctx.fabric.register`.
 * @param patches - validated patch descriptors; each target must carry a
 * `functionQuery` or `astQuery`.
 * @returns a disposer that deactivates the installation.
 */
export function bootstrapFabric(patches: FabricPatchStub[]): () => void {
  return installFabricHooks(patches.map(patchInstrumentation))
}

/** Loader state shared by every hook installation of this module. */
interface LoaderState {
  /** Whether this installation is currently active. */
  active: boolean
  /** Orchestrion matcher with the Fabric transform registered. */
  matcher: ReturnType<typeof create>
  /** The ordered instrumentations, serialized to the async hook entry. */
  instrumentations: FabricInstrumentationConfig[]
  /** Transformers resolved per module URL. */
  transformers: Map<string, ReturnType<ReturnType<typeof create>['getTransformer']>>
  /** URLs already transformed (guards the CJS double-path). */
  seen: Set<string>
}

/** Active installations in installation order. Each installation's ESM hooks
 * capture their own state, and the CJS `_compile` wrapper chains every active
 * installation in order, so concurrent installations all transform through
 * their own matchers. */
const states: LoaderState[] = []

/** Package-version lookup cache (resolve and _compile both read per module). */
const versionCache = new Map<string, string>()

function cachedPackageVersion(basedir: string): string {
  let version = versionCache.get(basedir)
  if (version === undefined) {
    version = getPackageVersion(basedir)
    versionCache.set(basedir, version)
  }
  return version
}

/**
 * Whether this Node version exposes a reliable synchronous `registerHooks`
 * API. The function exists from 22.19.0, but before 22.22.3 / 24.11.1 its
 * synchronous load chain returns no source for CommonJS modules when
 * loader-thread hooks (`module.register`, e.g. tsx on those versions) are
 * also present, which crashes Node's load validation; the stable API lands
 * in 22.22.3 and 24.11.1. Below those, the async fallback keeps every hook
 * on one loader-thread chain.
 */
function supportsSyncHooks(): boolean {
  // DSH_FABRIC_FORCE_ASYNC_HOOKS exercises the async `module.register`
  // fallback on runtimes that do have `registerHooks` (test seam).
  if (process.env.DSH_FABRIC_FORCE_ASYNC_HOOKS === '1') return false
  if (typeof registerHooks !== 'function') return false
  const [major = 0, minor = 0, patch = 0] = process.versions.node.split('.').map(Number)
  if (major === 22) return minor > 22 || (minor === 22 && patch >= 3)
  if (major === 24) return minor > 11 || (minor === 11 && patch >= 1)
  return major > 24
}

/** Whether the async loader-thread hook entry has been registered (once). */
let asyncHooksInstalled = false

/** Shared configuration file the loader-thread entry reads on every load. */
let asyncConfigPath: string | undefined

/**
 * Remove the shared configuration file on process exit (once). The loader
 * thread only reads the file during module loads, which cannot happen after
 * the exit event; a hard crash may leave the pid-scoped file behind and
 * tmpdir policy owns those leftovers.
 */
function scheduleAsyncConfigCleanup(path: string): void {
  process.once('exit', () => {
    try {
      unlinkSync(path)
    } catch {
      // Already removed or never written; nothing else can reach it here.
    }
  })
}

/**
 * Register the async loader-thread hooks (`module.register`) used when the
 * synchronous `registerHooks` API is unavailable (or unreliable — see
 * {@link supportsSyncHooks}). The hook entry runs on the loader thread and
 * transforms matching ESM modules; CommonJS stays on the main thread's
 * `_compile` patch (plain `require()` calls never reach the loader-thread
 * load hook).
 *
 * The entry is registered exactly once; later installations and disposals do
 * not re-register (there is no unregister), they update the shared
 * configuration file, which the entry reads on every load. Registration-time
 * snapshots therefore become load-time state: a new installation replaces
 * the transform on the next module evaluation, disposing one removes its
 * instrumentations, and `retransformEsm` works exactly as on the sync path.
 * @param configPath - the shared configuration file path.
 */
function installAsyncHooks(configPath: string): void {
  if (asyncHooksInstalled) return
  asyncHooksInstalled = true
  register(new URL('./hook-entry.js', import.meta.url).href, import.meta.url, {
    data: { configPath },
  })
}

/** Serialize the installation stack for the async hook entry. */
function writeAsyncConfig(): void {
  if (!asyncConfigPath) return
  writeFileSync(asyncConfigPath, JSON.stringify(states.map(state => ({
    active: state.active,
    instrumentations: state.instrumentations,
  }))))
}

/**
 * Install Fabric transformation hooks and the bridge handle.
 *
 * Registers the bridge into `globalThis` and registers synchronous module
 * hooks that transform matching modules on load (or the async loader-thread
 * fallback when `registerHooks` is unavailable). Every config must carry
 * `transform: 'fabric'` plus the `fabricPatchId` / `fabricOperation` fields
 * the Fabric transform reads from the merged state.
 *
 * Both hook modes share one main-thread installation state: the sync path
 * runs ESM and CJS through it, the async path runs CJS through it while the
 * loader thread handles ESM.
 * @param instrumentations - Orchestrion configs selecting target modules,
 * files, and functions.
 * @returns a disposer that deactivates this installation (hooks themselves
 * stay registered for the process lifetime).
 */
export function installFabricHooks(instrumentations: FabricInstrumentationConfig[]): () => void {
  installBridge()
  const ordered = orderInstrumentations(instrumentations)
  const syncHooks = supportsSyncHooks()
  if (!syncHooks) {
    if (asyncConfigPath === undefined) {
      asyncConfigPath = join(tmpdir(), `dsh-fabric-config-${process.pid}.json`)
      scheduleAsyncConfigCleanup(asyncConfigPath)
    }
    installAsyncHooks(asyncConfigPath)
  }

  const matcher = create(ordered)
  registerFabricTransform(matcher)

  const state: LoaderState = {
    active: true,
    instrumentations: ordered,
    matcher,
    transformers: new Map(),
    seen: new Set(),
  }
  states.push(state)
  if (!syncHooks) writeAsyncConfig()

  if (syncHooks) {
    registerHooks({
      resolve: (specifier, context, nextResolve) => {
        const resolved = nextResolve(specifier, context)
        if (!state.active) return resolved
        const details = parse(resolved.url)
        if (!details) return resolved
        const version = cachedPackageVersion(details.basedir)
        const transformer = state.matcher.getTransformer(details.name, version, details.path)
        if (transformer) state.transformers.set(resolved.url, transformer)
        return resolved
      },
      load: (url, context, nextLoad) => {
        const result = nextLoad(url, context)
        const stateRef = state
        if (!stateRef.active) return result
        const transformer = stateRef.transformers.get(url)
        if (!transformer) return result
        // Track by filesystem path: the CJS `_compile` patch below records the
        // same key, so a CommonJS module reached through both the ESM graph and
        // plain require() is transformed exactly once.
        const path = url.startsWith('file:') ? fileURLToPath(url) : url
        if (stateRef.seen.has(path)) return result
        stateRef.seen.add(path)
        try {
          const source = readSource(result, url)
          const moduleType = context.format === 'module' ? 'esm' : 'cjs'
          const transformed = transformer.transform(source, moduleType)
          return { ...result, source: transformed.code, shortCircuit: true }
        } catch (error) {
          stateRef.transformers.delete(url)
          throw new Error(`fabric: failed to transform ${url}`, { cause: error })
        }
      },
    })
  }

  // CommonJS files reached through plain require() (not via the ESM graph)
  // do not pass through the load hook; transform them at compile time. The
  // wrapper is installed once per process and consults the active-installation
  // stack, so concurrent installations never overwrite each other's patch and
  // the disposer needs no restoration.
  installCompileWrapper()

  return () => {
    state.active = false
    const index = states.indexOf(state)
    if (index >= 0) states.splice(index, 1)
    for (const transformer of state.transformers.values()) transformer?.free()
    state.transformers.clear()
    writeAsyncConfig()
  }
}

/** Whether the singleton CJS `_compile` wrapper is installed. */
let compileWrapperInstalled = false

/**
 * Install the process-wide `_compile` wrapper once. With no active
 * installation it passes through to the original compile function; with one
 * or more it chains the content through every active installation's matcher
 * in installation order, mirroring the sync ESM hook chain (a later
 * installation's transform applies last, wrapping outermost). Disposed
 * installations are spliced out of the stack and skipped.
 */
function installCompileWrapper(): void {
  if (compileWrapperInstalled) return
  compileWrapperInstalled = true
  const modulePrototype = Module.prototype as unknown as Record<string, unknown>
  const compileKey = '_compile'
  const originalCompile = modulePrototype[compileKey] as CompileFn
  modulePrototype[compileKey] = function (this: Module, content: string, filename: string) {
    const details = parse(filename)
    if (details) {
      const version = cachedPackageVersion(details.basedir)
      for (const state of states) {
        if (!state.active) continue
        const transformer = state.matcher.getTransformer(details.name, version, details.path)
        if (!transformer || state.seen.has(filename)) continue
        state.seen.add(filename)
        try {
          content = transformer.transform(content, 'cjs').code
        } catch (error) {
          state.seen.delete(filename)
          throw new Error(`fabric: failed to transform ${filename}`, { cause: error })
        }
      }
    }
    return originalCompile.call(this, content, filename)
  }
}

/**
 * Resolve the source text of a module being loaded.
 * @param result - the load-hook result.
 * @param url - the module URL, used to read CommonJS sources Node leaves null.
 * @returns the source string.
 */
function readSource(result: { source?: string | ArrayBuffer | NodeJS.TypedArray | null | undefined }, url: string): string {
  if (typeof result.source === 'string') return result.source
  if (result.source instanceof ArrayBuffer) return Buffer.from(new Uint8Array(result.source)).toString('utf8')
  if (result.source != null) return Buffer.from(result.source as Uint8Array).toString('utf8')
  return readFileSync(fileURLToPath(url), 'utf8')
}

const require = createRequire(import.meta.url)

/**
 * Re-evaluate an already-loaded CommonJS module under the current
 * instrumentation stack.
 *
 * HMR-style invalidation for CommonJS: the module's `require.cache` entry is
 * dropped and its `seen` marks are cleared, so the next `require()` runs the
 * `_compile` wrapper again and transforms the module with the top-of-stack
 * installation's current matcher. The same file may also sit in the ESM graph
 * (import()ed): its `loadCache` entry is evicted too (the same dual-cache
 * invalidation the vendored Loader's HMR performs), so both graphs observe
 * the fresh evaluation. The returned value is the NEW module exports object;
 * references to the old one keep the old transformation.
 * @param filename - the absolute module path used as the `require.cache` key.
 * @returns the freshly evaluated module exports.
 */
export function retransformCommonJs(filename: string): unknown {
  // oxlint-disable-next-line typescript/no-dynamic-delete -- require.cache eviction is the sanctioned invalidation API.
  delete require.cache[filename]
  const cache = internalLoader()?.loadCache
  if (cache) {
    Map.prototype.delete.call(cache, pathToFileURL(filename).href)
  }
  for (const state of states) state.seen.delete(filename)
  return require(filename)
}

interface InternalLoader {
  /** Node-internal ESM module cache, keyed by module URL. */
  readonly loadCache?: Map<string, unknown>
}

let cachedInternalLoader: InternalLoader | undefined

/**
 * Locate Node's internal cascaded module loader (Node >= 22), used to evict
 * ESM cache entries. The same mechanism the vendored Loader's HMR uses;
 * it is an internal API and its shape may change across Node versions.
 */
function internalLoader(): InternalLoader | undefined {
  if (cachedInternalLoader) return cachedInternalLoader
  const require = createRequire(import.meta.url)
  let raw: { getOrInitializeCascadedLoader?: () => unknown } | undefined
  try {
    // node-addon-require-builtin ships no declarations; the addon surface is
    // a single requireBuiltin(id) returning the Node-internal module.
    const addon = require('node-addon-require-builtin') as { requireBuiltin(id: string): unknown }
    raw = addon.requireBuiltin('internal/modules/esm/loader') as { getOrInitializeCascadedLoader?: () => unknown } | undefined
  } catch {
    return undefined
  }
  const loader = raw?.getOrInitializeCascadedLoader?.() as InternalLoader | undefined
  if (loader) cachedInternalLoader = loader
  return loader
}

/**
 * Re-evaluate an already-loaded ESM module under the current instrumentation
 * stack.
 *
 * HMR-style invalidation for ESM: the module's entry in Node's internal
 * `loadCache` is evicted (the same mechanism the vendored Loader's HMR uses)
 * and the `seen` marks are cleared, so the next `import()` of the same URL
 * re-evaluates the module and the load hooks transform it with the
 * top-of-stack installation's current matcher. The returned value is the NEW
 * module namespace; references to the old one keep the old transformation.
 *
 * A failed re-import restores the evicted cache entry (the same rollback the
 * vendored Loader's HMR performs): the module falls back to the previous
 * instance instead of being left unevaluatable, and a later `import()` of the
 * URL serves the restored instance without re-evaluating it.
 *
 * Requires the Node internal loader (Node >= 22) and the synchronous
 * `registerHooks` path — the async `module.register` fallback transforms ESM
 * in the loader thread, where a main-thread eviction alone does not reach.
 * @param url - the module URL used as the `loadCache` key.
 * @returns the freshly evaluated module namespace.
 */
export async function retransformEsm(url: string): Promise<Record<string, unknown>> {
  const loader = internalLoader()
  const cache = loader?.loadCache
  if (!cache) {
    throw new Error('fabric: ESM re-transformation requires the Node internal module loader (Node >= 22)')
  }
  // Back up the cached job so a failed re-import can restore the previous
  // module instance instead of leaving the URL unevaluatable.
  const job: unknown = Map.prototype.get.call(cache, url)
  // Map.prototype.delete removes the entry completely on both Node 22/23
  // (plain Map) and Node 24 (LoadCache whose own delete only clears the slot).
  Map.prototype.delete.call(cache, url)
  const path = url.startsWith('file:') ? fileURLToPath(url) : url
  for (const state of states) state.seen.delete(path)
  try {
    const module = await import(url) as Record<string, unknown>
    return module
  } catch (error) {
    if (job !== undefined) Map.prototype.set.call(cache, url, job)
    throw error
  }
}
