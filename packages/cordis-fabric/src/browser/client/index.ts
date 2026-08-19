/**
 * Browser half of `cordis-fabric`: a dshClient plugin entry
 * that installs the bridge handle and mounts the platform-free
 * `FabricService` in the browser Cordis tree.
 *
 * Client bundles are transformed at build time and their calls fall back to
 * the original body until this entry materializes and installs the bridge —
 * so a patch only takes effect for calls that happen after the browser
 * Fabric runtime is up. Patch handlers are registered by other browser
 * plugins through `ctx.fabric.register`.
 *
 * The exports are limited to platform-free faces (`../../service.ts`,
 * `../../bridge.ts`, `../../runtime.ts`): the node half of this package
 * imports `node:*` modules and must never enter the browser bundle.
 * @module cordis-fabric/browser/client
 */

import { installBridge } from '../../bridge.ts'
import { FabricService } from '../../service.ts'
import { runtime } from '../../runtime.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { FabricPatch, FabricPatchInfo } from '../../types.ts'

export { FabricService, installBridge, runtime }
export type { FabricPatch, FabricPatchInfo }

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'cordis-fabric'

/**
 * Install the Fabric runtime for the browser Cordis tree.
 * @param ctx - Cordis context that owns the service.
 */
export async function apply(ctx: Context): Promise<void> {
  installBridge()
  await ctx.plugin(FabricService)
}
