import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry from '@deepseek-ai/dsh-tools'
import CommandService from '@deepseek-ai/dsh-commands'
import * as api from '../../src/index.ts'
import { FabricAgentService } from '../../src/host/agent.ts'
import { FabricToolsService } from '../../src/host/tools.ts'
import { FabricPromptService } from '../../src/host/prompt.ts'
import { FabricCommandsService } from '../../src/host/commands.ts'

describe('cordis-fabric-dsh Host bundle', () => {
  it('mounts all four Host modules with the declared injections', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRegistry)
    await ctx.plugin(CommandService)
    const fiber = await ctx.plugin(api)
    expect(ctx.fabricAgent).toBeInstanceOf(FabricAgentService)
    expect(ctx.fabricTools).toBeInstanceOf(FabricToolsService)
    expect(ctx.fabricPrompt).toBeInstanceOf(FabricPromptService)
    expect(ctx.fabricCommands).toBeInstanceOf(FabricCommandsService)
    await fiber.dispose()
    expect(ctx.fabricAgent).toBeUndefined()
    expect(ctx.fabricTools).toBeUndefined()
    expect(ctx.fabricPrompt).toBeUndefined()
    expect(ctx.fabricCommands).toBeUndefined()
  })
})
