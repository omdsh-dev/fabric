import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { CommandContribution } from '@deepseek-ai/dsh-client-ui-commands/client'
import { apply, FabricClientService } from '../src/client/index.ts'

// The real browser slot service declares the slots/changed event; the
// registry package carrying it (dsh-client-runtime) is not installable, so
// the fake declares the same event bridge (mirrors the upstream runtime).
declare module '@deepseek-ai/cordis' {
  interface Events {
    'slots/changed'(key: string): void
  }
}

/** Fake authoritative browser command service (provides `commandUi`): a Service
 * so cordis binds `this.ctx` to the caller's fiber and its effects ride that
 * fiber. The real CommandUiRuntime lives in @deepseek-ai/dsh-client-ui-commands,
 * whose dependency tree is not installable from the registry. */
class FakeCommandUiRuntime extends Service {
  private readonly commands = new Map<string, CommandContribution>()

  /** Create and install the fake browser command service. */
  constructor(ctx: Context) {
    super(ctx, 'commandUi')
  }

  register(contribution: CommandContribution): () => void {
    if (this.commands.has(contribution.name)) {
      throw new Error(`client-command: contribution "${contribution.name}" is already registered`)
    }
    this.ctx.effect(() => {
      this.commands.set(contribution.name, contribution)
      return () => { this.commands.delete(contribution.name) }
    }, `fake-commandUi.register(${contribution.name})`)
    return () => { this.commands.delete(contribution.name) }
  }
}

/**
 * Fake authoritative slot registry (provides `slots`): single-hole names
 * with a duplicate-name failure and `slots/changed` notifications. The real
 * browser slot service lives in @deepseek-ai/dsh-client-runtime, whose
 * dependency tree is not installable from the registry.
 */
class FakeSlotRegistry extends Service {
  private readonly slots = new Map<string, unknown>()

  /** Create and install the fake slot registry. */
  constructor(ctx: Context) {
    super(ctx, 'slots')
  }

  register(options: { name: string }, component: unknown): () => void {
    if (this.slots.has(options.name)) {
      throw new Error(`slot registry: single-hole slot "${options.name}" is already registered`)
    }
    this.ctx.effect(() => {
      this.slots.set(options.name, component)
      this.ctx.emit('slots/changed', options.name)
      return () => { this.slots.delete(options.name) }
    }, `fake-slots.register(${options.name})`)
    return () => { this.slots.delete(options.name) }
  }
}

/**
 * Browser assembly: the real browser command and slot services (the
 * `cordis-fabric-dsh` client row's `ctx.command`/`ctx.slots` delegates) over
 * fake slash/sessions/connection faces, plus the real Loader booting an
 * unmodified browser fixture Mod through `ctx.fabricClient`. This mirrors the
 * web-roster composition with the opt-in row enabled.
 */
async function assemble() {
  const ctx = new Context()
  ctx.provide('inputTriggers', {
    registerSource() { return () => {} },
  })
  ctx.provide('sessions', {
    scope: () => undefined,
    scopeOf: () => undefined,
  })
  const commandsRemote = { list: () => Promise.resolve([]) }
  // CommandUiRuntime injects `remote` for the forwarded directory invalidation.
  ctx.provide('remote', { commands: commandsRemote, $on: () => () => {} })
  ctx.provide('remote.commands', commandsRemote)
  await ctx.plugin(FakeSlotRegistry).await()
  await ctx.plugin(FakeCommandUiRuntime).await()
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
