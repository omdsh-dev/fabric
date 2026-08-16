/**
 * DSH profile bootstrap for the Fabric layer: read the composed
 * `cordis-fabric` row's static patch descriptors from a profile's rows and
 * install the load-time transformation hooks before any target plugin
 * module imports, plus the post-boot binding verification. This is the DSH
 * assembly half of `cordis-fabric` — the pure package only knows how to
 * install hooks from descriptors, not where a deployment composes them.
 * @module cordis-fabric-dsh/profile-bootstrap
 */

import type { Context } from '@deepseek-ai/cordis'
import type { FabricPatchStub } from 'cordis-fabric'

/** One composed profile row's config surface (the loader row shape). */
export interface FabricProfileRow {
  name?: string
  config?: unknown
}

/** The composed profile rows this bootstrap reads (id → row). */
export type FabricProfileRows = ReadonlyMap<string, FabricProfileRow>

/** One Fabric row's config surface: the namespaced patch stubs and the deprecated legacy key. */
interface FabricRowConfig {
  fabric?: { patches?: unknown }
  patches?: unknown
}

/**
 * Read the composed `cordis-fabric` row's patch stubs from the dedicated
 * `config.fabric.patches` section, falling back to the deprecated
 * `config.patches` key with a warning. The row's `disabled` flag governs
 * mounting the plugin only; the bootstrap reads this section whenever it is
 * present.
 * @param rowConfig - the row's config, when the row exists.
 * @param warn - deprecation sink.
 * @returns the patch descriptors, or undefined when none are declared.
 */
function fabricDescriptors(rowConfig: FabricRowConfig | undefined, warn: (message: string) => void): unknown {
  if (rowConfig?.fabric?.patches !== undefined) return rowConfig.fabric.patches
  if (rowConfig?.patches !== undefined) {
    warn('cordis-fabric: config.patches is deprecated; move the patch stubs under config.fabric.patches')
    return rowConfig.patches
  }
  return undefined
}

/**
 * Install the Fabric transformation hooks from the composed profile rows.
 *
 * The optional `cordis-fabric` row may carry static patch descriptors under
 * `config.fabric.patches` (id/target/operation — handlers are trusted code
 * bound at registration); the deprecated `config.patches` key is still
 * honored with a warning. The hooks must exist before any target plugin
 * module is imported, so this runs in the boot `prepare` phase, before the
 * config tree mounts. The row's `disabled` flag governs mounting the plugin
 * (the browser roster keeps the row disabled by default); it does not
 * suppress the load-time bootstrap — patches from the composed row apply
 * whenever the row carries them. When the row is absent or carries no
 * patches, nothing is installed.
 * @param rows - the fully composed profile rows for this invocation.
 * @param warn - deprecation sink for the legacy config key.
 */
export async function installFabricBootstrap(rows: FabricProfileRows, warn: (message: string) => void = () => {}): Promise<void> {
  const fabricRow = [...rows].find(([id]) => id === 'cordis-fabric')?.[1]
  const descriptors = fabricDescriptors(fabricRow?.config as FabricRowConfig | undefined, warn)
  if (!Array.isArray(descriptors) || descriptors.length === 0) return
  const { bootstrapFabric } = await import('cordis-fabric')
  bootstrapFabric(descriptors as FabricPatchStub[])
}

/**
 * Verify the composed profile's `required` Fabric patches bound at load
 * time. Runs after the config tree mounts (boot completion), when every
 * target module has been imported and the transformation hooks recorded
 * their bindings; a required patch that bound nothing fails the launch
 * loud, naming the patch id and its target, instead of shipping an inert
 * transform.
 * @param rows - the fully composed profile rows for this invocation.
 */
export async function checkFabricRequiredPatches(rows: FabricProfileRows): Promise<void> {
  const fabricRow = [...rows].find(([id]) => id === 'cordis-fabric')?.[1]
  const descriptors = fabricDescriptors(fabricRow?.config as FabricRowConfig | undefined, () => {})
  if (!Array.isArray(descriptors) || descriptors.length === 0) return
  const { checkRequiredPatches } = await import('cordis-fabric')
  checkRequiredPatches(descriptors as FabricPatchStub[])
}

/**
 * Boot-completion patch check for the fabric-dsh launcher: the launcher
 * writes the composed descriptors to $DSH_FABRIC_CONFIG and injects the
 * loader hooks through a preload, so no host boot code needs patching. The
 * Host plugin schedules this check one tick after mount (all tree entries
 * have applied by then); a required patch that bound nothing fails the
 * launch loud, like the patched profile-boot used to. Without the env the
 * check is a no-op (plain `dsh` stays untouched).
 * @param ctx - the owning context (effects ride its fiber).
 */
export function scheduleRequiredPatchCheck(ctx: Context): void {
  const configPath = process.env.DSH_FABRIC_CONFIG
  if (configPath === undefined || configPath === '') return
  ctx.effect(() => {
    const timer = setTimeout(() => {
      void (async () => {
        const { readFileSync } = await import('node:fs')
        const { checkRequiredPatches } = await import('cordis-fabric')
        const descriptors = JSON.parse(readFileSync(configPath, 'utf8'))
        checkRequiredPatches(descriptors)
      })()
    }, 0)
    return () => { clearTimeout(timer) }
  }, 'fabric: required patch check')
}
