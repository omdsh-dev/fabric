/**
 * Test-only ambient events for the host seams the facade delegates to.
 *
 * The DSH host declares these events itself; this package must NOT inject
 * them globally (that would pollute every host program that loads the
 * package's types). The specs mount real host-like fibers, so they re-declare
 * the narrow event shapes here, inside the test tree only.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  HostAgent,
  HostAgentStatus,
  HostPreToolDecision,
  HostPostToolDecision,
  HostToolExecution,
  HostToolExecutionResult,
} from '../src/host-contracts.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** A live agent was created. */
    'agent/created'(this: Context, payload: { agent: HostAgent }): void
    /** A live agent was disposed. */
    'agent/disposed'(this: Context, payload: { agent: HostAgent }): void
    /** An agent's idle/running status transitioned. */
    'agent/status'(this: Context, payload: { agent: HostAgent; status: HostAgentStatus }): void
    /** Waterfall around tool dispatch; call `next()` to delegate. */
    'tools/pre-execute'(
      this: Context,
      exec: HostToolExecution,
      next: () => Promise<HostPreToolDecision>,
    ): Promise<HostPreToolDecision>
    /** Waterfall around a normalized dispatch outcome; call `next()` to accept. */
    'tools/post-execute'(
      this: Context,
      exec: HostToolExecution,
      result: Readonly<HostToolExecutionResult>,
      next: () => Promise<HostPostToolDecision>,
    ): Promise<HostPostToolDecision>
    /** A browser slot registry emitted a change for one slot name. */
    'slots/changed'(this: Context, name: string): void
  }
}
