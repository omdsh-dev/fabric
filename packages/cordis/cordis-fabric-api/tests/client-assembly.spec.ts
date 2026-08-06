import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import Loader from '@cordisjs/plugin-loader'
import type { SlashSource } from '@deepseek-ai/dsh-client-ui-slash/client'
import { CommandService } from '@deepseek-ai/dsh-client-ui-command/client'
import { SlotsService } from '@deepseek-ai/dsh-client-runtime/client'
import type { CommandContribution } from '@deepseek-ai/dsh-client-ui-command/client'
import { apply, FabricClientService } from '../src/client/index.ts'

/**
 * Browser assembly: the real browser command and slot services (the
 * `cordis-fabric-api` client row's `ctx.command`/`ctx.slots` delegates) over
 * fake slash/sessions/connection faces, plus the real Loader booting an
 * unmodified browser fixture Mod through `ctx.fabricClient`. This mirrors the
 * web-roster composition with the opt-in row enabled.
 */
async function assemble() {
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
  await ctx.plugin(SlotsService)
  await ctx.plugin(CommandService)
  await apply(ctx)
  // Observe the slot registry notifications from the Mod's registration.
  const changed: string[] = []
  const listen = ctx.on('slots/changed', (key: string) => { changed.push(key) })
  await ctx.plugin(Loader)
  const id = await ctx.loader.create({
    name: new URL('./fixtures/node_modules/fabric-client-fixture-mod/index.mjs', import.meta.url).href,
  })
  await ctx.loader.await()
  return { ctx, id, changed, listen }
}

const sameCommand = (): CommandContribution => ({
  name: 'modclientcmd',
  description: 'fixture client command',
  available: () => true,
  ui: { kind: 'popupSelect', options: async () => [], onSelect: () => {} },
})

describe('Fabric API browser assembly', () => {
  it('boots a browser fixture Mod whose contributions reach the real client services', async () => {
    const { ctx, id, changed, listen } = await assemble()
    const client = ctx.get('fabricClient') as FabricClientService

    // The client command contribution lives in the authoritative command
    // service: a duplicate registration fails loud while it is live.
    expect(() => client.registerCommand(sameCommand())).toThrow()

    // The slot contribution reached the real slot registry: the single 'root'
    // hole is occupied, and the registration emitted slots/changed.
    expect(() => client.registerSlot({ name: 'root' }, () => null)).toThrow(/single/)
    expect(changed).toContain('root')
    listen()

    await ctx.loader.remove(id)

    // HMR: both contributions are gone with the Mod fiber.
    expect(() => client.registerCommand(sameCommand())).not.toThrow()
    expect(() => client.registerSlot({ name: 'root' }, () => null)).not.toThrow()

    await ctx.fiber.dispose()
  })
})
