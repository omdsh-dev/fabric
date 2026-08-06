/**
 * Async module-hook entry for Fabric, used by `installFabricHooks` on Node
 * versions without the synchronous `registerHooks` API. Registered through
 * `module.register` (which runs this module on the loader thread), it
 * transforms matching ESM modules at load time and defers CommonJS to the
 * `_compile` patch installed by the Node loader.
 *
 * The entry is deliberately small: it reuses `createBrowserTransform` with
 * the node-modules identity resolver, so a module is transformed when its
 * URL resolves to an installed package the instrumentations target.
 * @module @deepseek-ai/dsh-cordis-fabric/hook-entry
 */

import { createBrowserTransform, nodeModulesResolver } from './browser-transform.ts'
import type { FabricInstrumentationConfig } from './node-loader.ts'

/** Active transform; installed by `initialize` on the loader thread. */
let transform: ReturnType<typeof createBrowserTransform> | undefined

/**
 * Initialize the loader-thread transform.
 * @param data - `module.register` data carrying the instrumentations.
 */
export function initialize(data: { instrumentations?: FabricInstrumentationConfig[] } = {}): void {
  transform = createBrowserTransform(data.instrumentations ?? [], nodeModulesResolver())
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
  if (!transform || result.format === 'commonjs') return result
  const source = typeof result.source === 'string'
    ? result.source
    : result.source == null ? '' : Buffer.from(result.source).toString('utf8')
  const output = transform(source, url)
  if (!output) return result
  return { ...result, source: output.code, shortCircuit: true }
}
