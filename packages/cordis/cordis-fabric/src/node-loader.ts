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
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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
    ...(target.functionQuery && !target.astQuery
      ? { functionQuery: target.functionQuery }
      : {}),
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
  /** Transformers resolved per module URL. */
  transformers: Map<string, ReturnType<ReturnType<typeof create>['getTransformer']>>
  /** URLs already transformed (guards the CJS double-path). */
  seen: Set<string>
}

/** Active installations in order; the latest (top of the stack) owns the CJS
 * `_compile` wrapper. Each installation's hooks capture their own state, so
 * concurrent installations transform through their own matchers. */
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
 * Whether this Node version exposes the synchronous `registerHooks` API.
 * DSH's engine range (^22.19) always does; the async fallback covers older
 * runtimes.
 */
function supportsSyncHooks(): boolean {
  // DSH_FABRIC_FORCE_ASYNC_HOOKS exercises the async `module.register`
  // fallback on runtimes that do have `registerHooks` (test seam).
  return process.env.DSH_FABRIC_FORCE_ASYNC_HOOKS !== '1' && typeof registerHooks === 'function'
}

/**
 * Install the async loader-thread hooks (`module.register`) used when the
 * synchronous `registerHooks` API is unavailable. The hook entry runs on the
 * loader thread and transforms matching ESM modules; CommonJS stays on the
 * main thread's `_compile` patch (plain `require()` calls never reach the
 * loader-thread load hook).
 * @param instrumentations - Orchestrion configs selecting target modules.
 */
function installAsyncHooks(instrumentations: FabricInstrumentationConfig[]): void {
  register(new URL('./hook-entry.js', import.meta.url).href, import.meta.url, {
    data: { instrumentations },
  })
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
  if (!syncHooks) installAsyncHooks(ordered)

  const matcher = create(ordered)
  registerFabricTransform(matcher)

  const state: LoaderState = {
    active: true,
    matcher,
    transformers: new Map(),
    seen: new Set(),
  }
  states.push(state)

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
  }
}

/** Whether the singleton CJS `_compile` wrapper is installed. */
let compileWrapperInstalled = false

/**
 * Install the process-wide `_compile` wrapper once. With no active
 * installation it passes through to the original compile function; with one
 * or more it transforms matching CommonJS files through the top-of-stack
 * installation.
 */
function installCompileWrapper(): void {
  if (compileWrapperInstalled) return
  compileWrapperInstalled = true
  const modulePrototype = Module.prototype as unknown as Record<string, unknown>
  const compileKey = '_compile'
  const originalCompile = modulePrototype[compileKey] as CompileFn
  modulePrototype[compileKey] = function (this: Module, content: string, filename: string) {
    const stateRef = states[states.length - 1]
    if (stateRef?.active) {
      const details = parse(filename)
      if (details) {
        const version = cachedPackageVersion(details.basedir)
        const transformer = stateRef.matcher.getTransformer(details.name, version, details.path)
        if (transformer && !stateRef.seen.has(filename)) {
          stateRef.seen.add(filename)
          try {
            content = transformer.transform(content, 'cjs').code
          } catch (error) {
            stateRef.seen.delete(filename)
            throw new Error(`fabric: failed to transform ${filename}`, { cause: error })
          }
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
 * installation's current matcher. The returned value is the NEW module
 * exports object; references to the old one keep the old transformation.
 * ESM modules have no equivalent (the ESM cache has no unload path).
 * @param filename - the absolute module path used as the `require.cache` key.
 * @returns the freshly evaluated module exports.
 */
export function retransformCommonJs(filename: string): unknown {
  // oxlint-disable-next-line typescript/no-dynamic-delete -- require.cache eviction is the sanctioned invalidation API.
  delete require.cache[filename]
  for (const state of states) state.seen.delete(filename)
  return require(filename)
}
