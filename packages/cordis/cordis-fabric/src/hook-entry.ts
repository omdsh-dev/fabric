/**
 * Async module-hook entry for Fabric, used by `installFabricHooks` on Node
 * versions without a reliable synchronous `registerHooks` API. Registered
 * exactly once through `module.register` (which runs this module on the
 * loader thread), it transforms matching ESM modules at load time and
 * defers CommonJS to the `_compile` patch installed by the Node loader.
 *
 * The entry reads the shared configuration file (written by the main thread
 * on every installation and disposal) on each load, so the loader thread's
 * transform always reflects the current installation stack: new
 * installations replace the transform on the next module evaluation,
 * disposed ones drop their instrumentations, and an evicted module
 * re-imports under the latest stack. Each active installation gets its own
 * transform and the source chains through them in installation order — the
 * same stacking the sync hook chain and the CJS `_compile` wrapper produce,
 * so installation order (not a globally merged priority sort) decides the
 * nesting across installations on every path. The chain is rebuilt only
 * when the configuration content changes.
 * @module @deepseek-ai/dsh-cordis-fabric/hook-entry
 */

import { readFileSync } from 'node:fs'
import { createBrowserTransform, nodeModulesResolver } from './browser-transform.ts'
import type { FabricInstrumentationConfig } from './node-loader.ts'

/** Shared configuration path, passed through `module.register` data. */
let configPath: string | undefined

/** One installation's transform in the per-installation chain. */
type TransformFn = ReturnType<typeof createBrowserTransform>

/** Cached transform chain for the last-read configuration content. */
let cached: { config: string; transforms: TransformFn[] } | undefined

/**
 * Initialize the loader-thread entry.
 * @param data - `module.register` data carrying the shared config path.
 */
export function initialize(data: { configPath?: string } = {}): void {
  configPath = data.configPath
}

/**
 * Read the shared configuration and return the per-installation transform
 * chain for the currently active installations, in installation order. The
 * chain is rebuilt only when the configuration content changed since the
 * last load.
 * @returns the transform chain (empty when no installation is active or the
 * configuration cannot be read).
 */
function readTransforms(): TransformFn[] {
  if (!configPath) return []
  let raw: string
  try {
    raw = readFileSync(configPath, 'utf8')
  } catch {
    return cached?.transforms ?? []
  }
  if (cached?.config === raw) return cached.transforms
  let parsed: Array<{ active?: boolean; instrumentations?: FabricInstrumentationConfig[] }> = []
  try {
    parsed = JSON.parse(raw) as typeof parsed
  } catch {
    return cached?.transforms ?? []
  }
  const transforms = parsed
    .filter(entry => entry.active === true)
    .map((entry) => {
      const instrumentations = entry.instrumentations ?? []
      return instrumentations.length === 0
        ? undefined
        : createBrowserTransform(instrumentations, nodeModulesResolver())
    })
    .filter((transform): transform is TransformFn => transform !== undefined)
  cached = { config: raw, transforms }
  return transforms
}

/**
 * Transform matching ESM modules before evaluation. CommonJS modules are left
 * to the `_compile` patch, which the async path runs alongside.
 * @param url - the module URL.
 * @param context - the load-hook context.
 * @param nextLoad - the next hook in the chain.
 * @returns the possibly transformed load result.
 */
export async function load(
  url: string,
  context: { format?: string | null },
  nextLoad: (url: string, context: unknown) =>
  Promise<{ source?: string | ArrayBuffer | null; format?: string | null; shortCircuit?: boolean }>,
): Promise<{ source?: string | ArrayBuffer | null; format?: string | null; shortCircuit?: boolean }> {
  const result = await nextLoad(url, context)
  if (result.format === 'commonjs') return result
  const transforms = readTransforms()
  if (transforms.length === 0) return result
  let source = typeof result.source === 'string'
    ? result.source
    : result.source == null ? '' : Buffer.from(result.source).toString('utf8')
  let transformed = false
  for (const transform of transforms) {
    const output = transform(source, url)
    if (output) {
      source = output.code
      transformed = true
    }
  }
  if (!transformed) return result
  return { ...result, source, shortCircuit: true }
}
