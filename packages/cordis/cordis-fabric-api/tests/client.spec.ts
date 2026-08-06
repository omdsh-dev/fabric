import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import type { CommandContribution } from '@deepseek-ai/dsh-client-ui-command/client'
import { CommandService } from '@deepseek-ai/dsh-client-ui-command/client'
import type { SlashSource } from '@deepseek-ai/dsh-client-ui-slash/client'
import { FabricClientService, apply, name, type FabricSlotOptions } from '../src/client/index.ts'

/** Real CommandService over fake slash/sessions/connection faces, plus a fake slots registry. */
async function bench() {
  const ctx = new Context()
  const slots = new Map<string, { options: FabricSlotOptions; component: unknown; dispose: () => void }>()
  ctx.provide('slash', {
    registerSource(_source: SlashSource) { return () => {} },
  })
  ctx.provide('sessions', {
    scope: () => undefined,
    scopeOf: () => undefined,
  })
  ctx.provide('connection', {
    api: { commands: { list: () => Promise.resolve({ result: { ok: true, value: { commands: [] } } }) } },
  })
  ctx.provide('slots', {
    register(options: FabricSlotOptions, component: unknown) {
      const record = { options, component, dispose: () => { slots.delete(options.name) } }
      slots.set(options.name, record)
      return record.dispose
    },
  })
  await ctx.plugin(CommandService)
  await apply(ctx)
  return { ctx, slots }
}

const commandContribution = (name: string): CommandContribution => ({
  name,
  description: 'fixture command',
  available: () => true,
  ui: {
    kind: 'popupSelect',
    options: async () => [],
    onSelect: () => {},
  },
})

describe('cordis-fabric-api browser entry', () => {
  it('exports the browser plugin faces', () => {
    expect(name).toBe('cordis-fabric-api')
    expect(typeof apply).toBe('function')
    expect(FabricClientService).toBeDefined()
  })

  it('mounts ctx.fabricClient so browser Mods can register', async () => {
    const { ctx } = await bench()
    expect(ctx.get('fabricClient')).toBeInstanceOf(FabricClientService)
    await ctx.fiber.dispose()
  })

  it('delegates client command registration to the real command service', async () => {
    const { ctx } = await bench()
    const service = ctx.get('fabricClient') as FabricClientService
    const dispose = service.registerCommand(commandContribution('modfixture'))
    // The contribution reaches the authoritative client command service: a
    // duplicate registration fails loud while the first claim is live.
    expect(() => service.registerCommand(commandContribution('modfixture'))).toThrow()
    dispose()
    expect(() => service.registerCommand(commandContribution('modfixture'))).not.toThrow()
    await ctx.fiber.dispose()
  })

  it('delegates slot registration and its disposer', async () => {
    const { ctx, slots } = await bench()
    const service = ctx.get('fabricClient') as FabricClientService
    const component = () => null
    const dispose = service.registerSlot({ name: 'root' }, component)
    expect(slots.get('root')?.component).toBe(component)
    dispose()
    expect(slots.has('root')).toBe(false)
    await ctx.fiber.dispose()
  })

  it('removes a command when its contributing fiber disposes (HMR safety)', async () => {
    const ctx = new Context()
    ctx.provide('slash', {
      registerSource(_source: SlashSource) { return () => {} },
    })
    ctx.provide('sessions', {
      scope: () => undefined,
      scopeOf: () => undefined,
    })
    ctx.provide('connection', {
      api: { commands: { list: () => Promise.resolve({ result: { ok: true, value: { commands: [] } } }) } },
    })
    ctx.provide('slots', {
      register() { return () => {} },
    })
    await ctx.plugin(CommandService)
    await apply(ctx)
    const mod = await ctx.plugin({
      name: 'mod-client',
      inject: ['fabricClient'],
      apply(modCtx: Context) {
        modCtx.fabricClient.registerCommand(commandContribution('modscoped'))
      },
    })
    // The authoritative command service owns the registration as the mod
    // fiber's effect; the same name becomes available again after disposal.
    const client = ctx.get('fabricClient') as FabricClientService
    expect(() => client.registerCommand(commandContribution('modscoped'))).toThrow()
    await mod.dispose()
    expect(() => client.registerCommand(commandContribution('modscoped'))).not.toThrow()
    await ctx.fiber.dispose()
  })
})
