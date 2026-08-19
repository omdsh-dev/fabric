/**
 * DSH integrations for the Cordis Fabric layer.
 *
 * The package mounts the DSH-facing Host facades (`ctx.fabricAgent`,
 * `ctx.fabricTools`, `ctx.fabricPrompt`, `ctx.fabricCommands`), a browser
 * facade (`ctx.fabricClient`) that delegates to the authoritative DSH
 * client services, the package invariant companion, and the DSH profile
 * bootstrap (`installFabricBootstrap`) that composes the pure
 * `cordis-fabric` transformation hooks from profile rows. Mount this entry
 * to provide all Host modules; mount a subpath to provide one module.
 * @module cordis-fabric-dsh
 */

import type { Context } from '@deepseek-ai/cordis'
import { FabricAgentService } from './host/agent.ts'
import { FabricToolsService } from './host/tools.ts'
import { FabricPromptService } from './host/prompt.ts'
import { FabricCommandsService } from './host/commands.ts'
import { scheduleRequiredPatchCheck } from './bootstrap/profile.ts'
import { registerCatalogEntries } from './catalog.ts'

export { FabricAgentService } from './host/agent.ts'
export { FabricToolsService } from './host/tools.ts'
export { FabricPromptService } from './host/prompt.ts'
export { FabricCommandsService } from './host/commands.ts'
export {
  installFabricBootstrap, checkFabricRequiredPatches, scheduleRequiredPatchCheck,
  type FabricProfileRow, type FabricProfileRows,
} from './bootstrap/profile.ts'
export { FABRIC_CATALOG_ENTRIES, registerCatalogEntries } from './catalog.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'cordis-fabric-dsh'
/** The four authoritative Host services the modules delegate to. */
export const inject = ['tools', 'systemPrompt', 'commands']

/**
 * Mount all four Host Fabric API modules.
 * @param ctx - Cordis context that owns the services.
 */
export async function apply(ctx: Context): Promise<void> {
  void registerCatalogEntries()
  await ctx.plugin(FabricAgentService)
  await ctx.plugin(FabricToolsService)
  await ctx.plugin(FabricPromptService)
  await ctx.plugin(FabricCommandsService)
  // Post-boot patch verification under the fabric-dsh launcher (no-op for
  // plain dsh): the launcher injects the hooks and writes the composed
  // descriptors to $DSH_FABRIC_CONFIG; the Host plugin owns the loud check.
  scheduleRequiredPatchCheck(ctx)
}
