/**
 * The Fabric Agent API module: a stable, Mod-facing subset of agent/session
 * lifecycle observation and operation-local context injection.
 *
 * The facade delegates to the authoritative `agent/*` events and the Agent's
 * own injection path. It deliberately does not expose the concrete
 * `dsh-agent-loop`, private queue state, or mutable session internals:
 * callbacks receive the live Agent only where the owning event already does,
 * and every registration returns the exact disposer of the underlying
 * `ctx.on()` effect, so disposal and scope semantics are inherited unchanged.
 * @module @deepseek-ai/dsh-cordis-fabric-api/agent
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type { Agent, AgentStatus, SettleReason } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'

declare module 'cordis' {
  interface Context {
    /** The Fabric Agent API, provided by this package. */
    fabricAgent: FabricAgentService
  }
}

/**
 * Cooperative Mod-facing Agent lifecycle API.
 *
 * The service is thin by design: it selects a stable subset of the
 * authoritative agent events and the logged injection path, and passes the
 * underlying disposer through untouched. A listener or injected message is
 * owned by the calling fiber and removed with it.
 */
export class FabricAgentService extends Service {
  /** Service key under which this class registers on `ctx`. */
  static provide = 'fabricAgent'

  /**
   * Create and install the Agent API.
   * @param ctx - Cordis context that owns the service.
   */
  constructor(ctx: Context) {
    super(ctx, 'fabricAgent')
  }

  /**
   * Observe a live agent being created.
   * @param listener - called with the created agent.
   * @returns the exact `ctx.on()` disposer removing this listener.
   */
  onCreated(listener: (agent: Agent) => void): () => boolean {
    return this.ctx.on('agent/created', (agent) => { listener(agent) })
  }

  /**
   * Observe a live agent being disposed.
   * @param listener - called with the disposed agent.
   * @returns the exact `ctx.on()` disposer removing this listener.
   */
  onDisposed(listener: (agent: Agent) => void): () => boolean {
    return this.ctx.on('agent/disposed', (agent) => { listener(agent) })
  }

  /**
   * Observe an agent's idle/running status transitions.
   * @param listener - called with the agent and its new status.
   * @returns the exact `ctx.on()` disposer removing this listener.
   */
  onStatus(listener: (agent: Agent, status: AgentStatus) => void): () => boolean {
    return this.ctx.on('agent/status', (agent, status) => { listener(agent, status) })
  }

  /**
   * Observe a turn settling (completed, aborted, disposed, or failed).
   * @param listener - called with the agent, the settled turn, and the reason.
   * @returns the exact `ctx.on()` disposer removing this listener.
   */
  onSettled(listener: (agent: Agent, turn: number, reason: SettleReason) => void): () => boolean {
    return this.ctx.on('agent/settled', (agent, turn, reason) => { listener(agent, turn, reason) })
  }

  /**
   * Inject a logged, model-visible user message into one agent's context.
   *
   * The message goes through `agent.inject()`, the Agent's own durable
   * injection path: anything this API contributes to a model request is
   * reconstructable from the session log. No provider request is assembled
   * here.
   * @param agent - the live agent to inject into.
   * @param message - the sourced user message to append.
   */
  inject(agent: Agent, message: UserMessage): void {
    agent.inject(message)
  }
}
