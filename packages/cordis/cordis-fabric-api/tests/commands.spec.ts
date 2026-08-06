import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandService from '@deepseek-ai/dsh-commands'
import { FabricCommandsService } from '../src/commands.ts'

const fakeAgent = {} as Agent

async function setup() {
  const ctx = new Context()
  await ctx.plugin(CommandService)
  await ctx.plugin(FabricCommandsService)
  return ctx
}

describe('FabricCommandsService', () => {
  it('registers through the authoritative registry and unregisters on the disposer', async () => {
    const ctx = await setup()
    const dispose = ctx.fabricCommands.register({
      name: 'modstatus',
      description: 'mod status',
      handler: () => ({ kind: 'success' as const, text: 'ok' }),
    })
    expect(ctx.fabricCommands.list(fakeAgent).map(c => c.name)).toContain('modstatus')
    dispose()
    expect(ctx.fabricCommands.list(fakeAgent).map(c => c.name)).not.toContain('modstatus')
  })

  it('removes a command when its contributing fiber disposes (HMR safety)', async () => {
    const ctx = await setup()
    const mod = await ctx.plugin({
      name: 'mod-command',
      inject: ['fabricCommands'],
      apply(modCtx: Context) {
        modCtx.fabricCommands.register({
          name: 'modscoped',
          description: 'mod scoped',
          handler: () => ({ kind: 'success' as const }),
        })
      },
    })
    expect(ctx.fabricCommands.list(fakeAgent).map(c => c.name)).toContain('modscoped')
    await mod.dispose()
    expect(ctx.fabricCommands.list(fakeAgent).map(c => c.name)).not.toContain('modscoped')
  })

  it('inherits authoritative duplicate-name failures', async () => {
    const ctx = await setup()
    const definition = {
      name: 'dup',
      description: 'dup',
      handler: () => ({ kind: 'success' as const }),
    }
    ctx.fabricCommands.register(definition)
    expect(() => ctx.fabricCommands.register(definition)).toThrow(/already registered/)
  })
})
