import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry from '@deepseek-ai/dsh-tools'
import CommandService from '@deepseek-ai/dsh-commands'
import * as api from '../../src/api/index.ts'
import { FabricAgentService } from '../../src/api/agent.ts'
import { FabricToolsService } from '../../src/api/tools.ts'
import { FabricPromptService } from '../../src/api/prompt.ts'
import { FabricCommandsService } from '../../src/api/commands.ts'

describe('cordis-fabric-api Host bundle', () => {
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
