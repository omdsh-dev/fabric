/**
 * Cordis Fabric API modules: cooperative extension contracts for Mods.
 *
 * The package mounts four independently injectable Host facades
 * (`ctx.fabricAgent`, `ctx.fabricTools`, `ctx.fabricPrompt`,
 * `ctx.fabricCommands`) and a browser facade (`ctx.fabricClient`) that
 * delegate to the authoritative DSH services. Mount this entry to provide
 * all Host modules; mount a subpath to provide one module.
 * @module @deepseek-ai/dsh-cordis-fabric/api
 */

import type { Context } from 'cordis'
import { FabricAgentService } from './agent.ts'
import { FabricToolsService } from './tools.ts'
import { FabricPromptService } from './prompt.ts'
import { FabricCommandsService } from './commands.ts'

export { FabricAgentService } from './agent.ts'
export { FabricToolsService } from './tools.ts'
export { FabricPromptService } from './prompt.ts'
export { FabricCommandsService } from './commands.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'cordis-fabric-api'
/** The four authoritative Host services the modules delegate to. */
export const inject = ['tools', 'systemPrompt', 'commands']

/**
 * Mount all four Host Fabric API modules.
 * @param ctx - Cordis context that owns the services.
 */
export async function apply(ctx: Context): Promise<void> {
  await ctx.plugin(FabricAgentService)
  await ctx.plugin(FabricToolsService)
  await ctx.plugin(FabricPromptService)
  await ctx.plugin(FabricCommandsService)
}
