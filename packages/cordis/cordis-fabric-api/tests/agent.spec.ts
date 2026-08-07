import { describe, expect, it, vi } from 'vitest'
import { Context } from 'cordis'
import type { Agent, AgentStatus } from '@deepseek-ai/dsh-agent'
import { FabricAgentService } from '../src/agent.ts'

/** Minimal live-agent stand-in: the facade touches only the listed members. */
function fakeAgent(inject = vi.fn()): Agent {
  return { inject } as unknown as Agent
}

async function setup() {
  const ctx = new Context()
  await ctx.plugin(FabricAgentService)
  return { ctx }
}

describe('FabricAgentService', () => {
  it('forwards lifecycle events and removes a listener on its disposer', async () => {
    const { ctx } = await setup()
    const seen: AgentStatus[] = []
    const dispose = ctx.fabricAgent.onStatus((_agent, status) => { seen.push(status) })
    ctx.emit('agent/status', { agent: fakeAgent(), status: 'running' })
    expect(seen).toEqual(['running'])
    dispose()
    ctx.emit('agent/status', { agent: fakeAgent(), status: 'idle' })
    expect(seen).toEqual(['running'])
  })

  it('forwards created and disposed observations', async () => {
    const { ctx } = await setup()
    const created: Agent[] = []
    const disposed: Agent[] = []
    ctx.fabricAgent.onCreated((agent) => { created.push(agent) })
    ctx.fabricAgent.onDisposed((agent) => { disposed.push(agent) })
    const agent = fakeAgent()
    ctx.emit('agent/created', { agent })
    ctx.emit('agent/disposed', { agent })
    expect(created).toEqual([agent])
    expect(disposed).toEqual([agent])
  })

  it('removes a listener when its contributing fiber disposes (HMR safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(FabricAgentService)
    const seen: AgentStatus[] = []
    const mod = await ctx.plugin({
      name: 'mod-observer',
      inject: ['fabricAgent'],
      apply(modCtx: Context) {
        modCtx.fabricAgent.onStatus((_agent, status) => { seen.push(status) })
      },
    })
    ctx.emit('agent/status', { agent: fakeAgent(), status: 'running' })
    await mod.dispose()
    ctx.emit('agent/status', { agent: fakeAgent(), status: 'idle' })
    expect(seen).toEqual(['running'])
  })

  it('injects through the agent\'s own logged path', async () => {
    const { ctx } = await setup()
    const inject = vi.fn()
    const agent = fakeAgent(inject)
    const message = { role: 'user', content: [{ type: 'text', text: 'hi' }] } as never
    ctx.fabricAgent.inject(agent, message)
    expect(inject).toHaveBeenCalledTimes(1)
    expect(inject).toHaveBeenCalledWith(message)
  })
})
