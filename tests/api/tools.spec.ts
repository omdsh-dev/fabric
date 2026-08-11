import { describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import type { HostPreToolDecision } from '../../src/host-contracts.ts'
import { FakeSystemPromptService, FakeToolRegistryService } from '../fakes.ts'
import { FabricToolsService } from '../../src/api/tools.ts'

async function setup() {
  const ctx = new Context()
  await ctx.plugin(FakeSystemPromptService)
  await ctx.plugin(FakeToolRegistryService)
  await ctx.plugin(FabricToolsService)
  return ctx
}

const echoTool = {
  name: 'mod-echo',
  description: 'echo arguments back',
  async execute(args: unknown) {
    return (args as { text?: string }).text ?? ''
  },
}

describe('FabricToolsService', () => {
  it('registers through the authoritative registry and unregisters on the disposer', async () => {
    const ctx = await setup()
    const dispose = ctx.fabricTools.register(echoTool)
    expect(ctx.tools.schemas().map(t => t.name)).toContain('mod-echo')
    dispose()
    expect(ctx.tools.schemas().map(t => t.name)).not.toContain('mod-echo')
  })

  it('removes a registered tool when its contributing fiber disposes (HMR safety)', async () => {
    const ctx = await setup()
    const mod = await ctx.plugin({
      name: 'mod-tool',
      inject: ['fabricTools'],
      apply(modCtx: Context) {
        modCtx.fabricTools.register(echoTool)
      },
    })
    expect(ctx.tools.schemas().map(t => t.name)).toContain('mod-echo')
    await mod.dispose()
    expect(ctx.tools.schemas().map(t => t.name)).not.toContain('mod-echo')
  })

  it('inherits the authoritative registry validation', async () => {
    const ctx = await setup()
    expect(() => ctx.fabricTools.register({ name: 'broken' } as never)).toThrow()
  })

  it('preserves the waterfall veto contract', async () => {
    const ctx = await setup()
    const veto = vi.fn()
    const pass = vi.fn()
    ctx.fabricTools.onPreExecute(((_exec: never, _next: never) => { veto() }) as never)
    ctx.fabricTools.onPreExecute((_exec, next) => { pass(); return next() })
    const exec = { name: 'mod-echo' } as never
    const decision = await ctx.waterfall('tools/pre-execute', exec, () => Promise.resolve<HostPreToolDecision>({ kind: 'allow' }))
    expect(veto).toHaveBeenCalledTimes(1)
    expect(pass).not.toHaveBeenCalled()
    expect(decision).toBeUndefined()
  })

  it('delegates through next() when a listener allows', async () => {
    const ctx = await setup()
    const pass = vi.fn()
    ctx.fabricTools.onPreExecute((_exec, next) => { pass(); return next() })
    const exec = { name: 'mod-echo' } as never
    const decision = await ctx.waterfall('tools/pre-execute', exec, () => Promise.resolve<HostPreToolDecision>({ kind: 'allow' }))
    expect(pass).toHaveBeenCalledTimes(1)
    expect(decision).toEqual({ kind: 'allow' })
  })
})
