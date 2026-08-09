/**
 * Combined browser entry for the Fabric bundle.
 *
 * The root package owns both the low-level bridge/service and the cooperative
 * Mod-facing client API. Keeping one dshClient entry makes Git/profile
 * installation self-contained while the host API remains available through the
 * `./api` subpath.
 */
import type { Context } from 'cordis'
import { apply as applyFabric } from './fabric.ts'
import { apply as applyApi } from './api.ts'

/** Combined browser plugin name used by Loader diagnostics. */
export const name = 'cordis-fabric-client'

/** Mount the bridge/service and the cooperative client facade. */
export async function apply(ctx: Context): Promise<void> {
  await applyFabric(ctx)
  await applyApi(ctx)
}
