/**
 * The Fabric Command API module: a stable, Mod-facing surface for human
 * commands over the authoritative command registry.
 *
 * The facade delegates every call to `ctx.commands`. Commands remain outside
 * model turns unless the owning command contract explicitly starts one, and
 * registration conflicts, availability, and disposal use the domain
 * registry's rules.
 * @module cordis-fabric-dsh/commands
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type {
  HostAgent,
  HostCommandDefinition,
  HostCommandDescriptor,
} from './host-contracts.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The Fabric Command API, provided by this package. */
    fabricCommands: FabricCommandsService
  }
}

/**
 * Cooperative Mod-facing command registry API.
 *
 * Registrations return the exact effect disposer of the owning registry and
 * keep its conflict and disposal semantics. The service never stores a
 * parallel copy of command state.
 */
export class FabricCommandsService extends Service {
  /** Service key under which this class registers on `ctx`. */
  static provide = 'fabricCommands'
  /** The authoritative command registry must be mounted. */
  static inject = ['commands']

  /**
   * Create and install the Command API.
   * @param ctx - Cordis context that owns the service.
   */
  constructor(ctx: Context) {
    super(ctx, 'fabricCommands')
  }

  /**
   * Register one human command through the authoritative registry.
   * @param definition - discovery metadata and direct UI handler.
   * @returns the exact effect disposer that unregisters this definition.
   */
  register(definition: HostCommandDefinition): () => void {
    return this.ctx.commands.register(definition)
  }

  /**
   * List the effective immutable command descriptors for one agent.
   * @param agent - exact receiving agent and scoped-layer key.
   * @returns name-sorted descriptors after scoped shadowing.
   */
  list(agent: HostAgent): readonly HostCommandDescriptor[] {
    return this.ctx.commands.list(agent)
  }
}
