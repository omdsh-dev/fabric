import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { FakeCommandRegistryService, FakeSystemPromptService, FakeToolRegistryService } from './fakes.ts'
import * as api from '../src/index.ts'
import { FabricAgentService } from '../src/agent.ts'
import { FabricToolsService } from '../src/tools.ts'
import { FabricPromptService } from '../src/prompt.ts'
import { FabricCommandsService } from '../src/commands.ts'

describe('cordis-fabric-dsh Host bundle', () => {
  it('mounts all four Host modules with the declared injections', async () => {
    const ctx = new Context()
    await ctx.plugin(FakeSystemPromptService)
    await ctx.plugin(FakeToolRegistryService)
    await ctx.plugin(FakeCommandRegistryService)
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
