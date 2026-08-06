/**
 * The Fabric Client API module: a stable, Mod-facing surface for client
 * commands and named UI slots over the browser command and slot services.
 *
 * The facade delegates to `@deepseek-ai/dsh-client-ui-command` (`ctx.command`)
 * and `@deepseek-ai/dsh-client-ui-slots` (`ctx.slots`). It exposes no raw DOM
 * access, transport internals, or Host capabilities: render contributions
 * stay pure over their declared inputs, and Host/Web communication uses the
 * existing contracts owned by those services. The complete slot type
 * machinery (SlotMap declaration merging, composed props) lives in
 * `dsh-client-ui-slots`; this facade only narrows the registration face.
 * @module @deepseek-ai/dsh-cordis-fabric-api/client
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import type { CommandContribution } from '@deepseek-ai/dsh-client-ui-command/client'
import type { SlotEntryDef, SlotLabel, SlotSpec, StoreDecl } from '@deepseek-ai/dsh-client-ui-slots'

declare module 'cordis' {
  interface Context {
    /** The Fabric Client API, provided by this package. */
    fabricClient: FabricClientService
  }
}

/**
 * Narrow registration face for one UI-slot contribution.
 *
 * The shape is a stable Mod-facing subset of the slot registration options;
 * the authoritative type machinery (declaration merging, composed-props
 * inference, renders checks) remains in `dsh-client-ui-slots`. The `inject`
 * factory uses an untyped parameter list because the parameter types derive
 * from the slot declaration, which this facade intentionally does not
 * re-derive.
 */
export interface FabricSlotOptions {
  /** The declared slot name to contribute to. */
  readonly name: string
  /** Child-slot declaration table: keys are the declared (and claimed) holes. */
  readonly children?: Record<string, SlotSpec<SlotEntryDef>>
  /** Optional store seat whose handle joins the composed props. */
  readonly store?: StoreDecl
  /** Optional business-face factory; parameters derive from the declaration. */
  /* oxlint-disable-next-line typescript/no-explicit-any --
   * narrow-contract position only; the authoritative typing lives in the
   * slot service's public overloads, which this face does not re-derive. */
  readonly inject?: ((...args: any[]) => Record<string, unknown>) | undefined
  /** Keyed-kind slot key (required for keyed slots). */
  readonly key?: string
  /** List-kind item id (required for list slots). */
  readonly id?: string
  /** List-kind ordering. */
  readonly order?: number
  /** List-kind label. */
  readonly label?: SlotLabel
  /** Chain-kind routing priority. */
  readonly priority?: number
}

/**
 * Cooperative Mod-facing browser API.
 *
 * Every registration returns the exact disposer of the underlying service
 * and keeps its conflict and disposal semantics. The service never stores a
 * parallel copy of command or slot state.
 */
export class FabricClientService extends Service {
  /** Service key under which this class registers on `ctx`. */
  static provide = 'fabricClient'
  /** The browser command and slot services must be mounted. */
  static inject = ['command', 'slots']

  /**
   * Create and install the Client API.
   * @param ctx - Cordis context that owns the service.
   */
  constructor(ctx: Context) {
    super(ctx, 'fabricClient')
  }

  /**
   * Register one client command contribution.
   * @param contribution - slash-menu entry whose behavior lives entirely on the client.
   * @returns the exact effect disposer that unregisters it.
   */
  registerCommand(contribution: CommandContribution): () => void {
    return this.ctx.command.register(contribution)
  }

  /**
   * Contribute a component to a declared slot and optionally declare child slots.
   * @param options - the narrow registration face (see {@link FabricSlotOptions}).
   * @param component - component honoring the composed-props contract of the declared slot.
   * @returns the disposer removing the registration and its declarations.
   */
  registerSlot(options: FabricSlotOptions, component: unknown): () => void {
    // The public slot-registration overloads derive their slot names from the
    // merged SlotMap, visible only in packages that import the declaring
    // client plugin; this facade intentionally exposes a stable narrow face
    // instead. The call targets the implementation signature, which accepts
    // the same fields.
    return (this.ctx.slots as unknown as {
      register(options: FabricSlotOptions, component: unknown): () => void
    }).register(options, component)
  }
}

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'cordis-fabric-api'

/**
 * Mount the Fabric Client API for the browser Cordis tree.
 * @param ctx - Cordis context that owns the service.
 */
export async function apply(ctx: Context): Promise<void> {
  await ctx.plugin(FabricClientService)
}
