import { beforeEach, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import Loader from '@cordisjs/plugin-loader'
import type { HostAgent } from '../../src/host-contracts.ts'
import { FakeCommandRegistryService, FakeSystemPromptService, FakeToolRegistryService } from '../fakes.ts'
import * as api from '../../src/api/index.ts'

const fakeAgent = { id: 'assembly-agent', status: 'idle' } as HostAgent

/** Boot a real Loader composition: fake authoritative services + the Host bundle + the fixture Mod. */
async function assemble() {
  const ctx = new Context()
  const fixtureUrl = new URL('./fixtures/node_modules/fabric-api-fixture-mod/index.mjs', import.meta.url).href
  ctx.baseUrl = new URL('./fixtures/', import.meta.url).href
  await ctx.plugin(FakeSystemPromptService)
  await ctx.plugin(FakeToolRegistryService)
  await ctx.plugin(FakeCommandRegistryService)
  await ctx.plugin(api)
  await ctx.plugin(Loader)
  const id = await ctx.loader.create({ name: fixtureUrl })
  await ctx.loader.await()
  return { ctx, id }
}

describe('Fabric API assembled composition', () => {
  beforeEach(() => {
    Reflect.deleteProperty(globalThis, '__fabricApiFixtureSeen')
  })

  it('boots an unmodified fixture Mod and observes all four effects through the assembled app', async () => {
    const { ctx } = await assemble()

    // Tool contribution through the authoritative registry.
    expect(ctx.tools.schemas().map(t => t.name)).toContain('mod-fixture-tool')

    // Prompt section/context/variable through the authoritative assembly.
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.map(s => s.name)).toContain('mod-fixture-section')
    expect(assembly.contexts.map(c => c.name)).toContain('mod-fixture-context')
    expect(assembly.variables['fixture_var']).toBe('fixture-value')

    // Human command through the authoritative registry.
    expect(ctx.commands.list(fakeAgent).map(c => c.name)).toContain('modfixture')

    // Agent listener through the real event bus: the facade-registered
    // listener observes a dispatched status transition.
    ctx.emit('agent/status', { agent: fakeAgent, status: 'running' })
    expect((globalThis as Record<string, unknown>).__fabricApiFixtureSeen).toContain('assembly-agent:running')

    await ctx.fiber.dispose()
  })

  it('removes every contribution when the Mod fiber is disposed (HMR safety)', async () => {
    const { ctx, id } = await assemble()
    expect(ctx.tools.schemas().map(t => t.name)).toContain('mod-fixture-tool')

    await ctx.loader.remove(id)

    expect(ctx.tools.schemas().map(t => t.name)).not.toContain('mod-fixture-tool')
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.map(s => s.name)).not.toContain('mod-fixture-section')
    expect(assembly.contexts.map(c => c.name)).not.toContain('mod-fixture-context')
    expect(assembly.variables['fixture_var']).toBeUndefined()
    expect(ctx.commands.list(fakeAgent).map(c => c.name)).not.toContain('modfixture')
    expect((globalThis as Record<string, unknown>).__fabricApiFixtureSeen).toBeUndefined()

    await ctx.fiber.dispose()
  })
})
