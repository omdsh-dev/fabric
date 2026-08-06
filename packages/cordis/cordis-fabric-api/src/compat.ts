/**
 * The Fabric compat adapter module: a patch-backed gap adapter that turns a
 * low-level Fabric transformation into a cooperative observation API.
 *
 * The adapter exists for target domains with no cooperative extension point
 * (no event, no registry): its targets are declared statically in the module
 * config and their instrumentations are installed by
 * {@link buildCompatInstrumentations} before the target module is loaded.
 * The public contract stays cooperative — `observe(name, listener)` — and
 * never exposes `FabricPatch`, AST selectors, file paths, or `invoke()`.
 * Target version drift leaves the adapter unavailable rather than pretending
 * compatibility: the installed instrumentation simply never matches, and the
 * service's diagnostics surface the declared target.
 * @module @deepseek-ai/dsh-cordis-fabric-api/compat
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import { isFabricInstalled, patchInstrumentation } from '@deepseek-ai/dsh-cordis-fabric'
import type { FabricInstrumentationConfig } from '@deepseek-ai/dsh-cordis-fabric'
import type { FabricCall, FabricOperation, FabricTarget, PatchId } from '@deepseek-ai/dsh-cordis-fabric'

declare module 'cordis' {
  interface Context {
    /** The Fabric compat adapter, provided by this package. */
    fabricCompat: FabricCompatService
  }
}

/** Static patch descriptor of one compat target (the handler is bound at runtime). */
export interface FabricCompatPatch {
  /** Patch id; must be stable and match the instrumentation installed at bootstrap. */
  readonly id: PatchId
  /** Target descriptor: module, version range, file path, and function selector. */
  readonly target: FabricTarget
  /** Behavior kind of the underlying patch. */
  readonly operation: FabricOperation
}

/** One declared observation target: a stable name for a low-level patch. */
export interface FabricCompatTarget {
  /** Stable name callers pass to {@link FabricCompatService.observe}. */
  readonly name: string
  /** The low-level patch behind this observation. */
  readonly patch: FabricCompatPatch
}

/** Module configuration: the declared observation targets. */
export interface FabricCompatConfig {
  /** Declared targets; an empty or absent list is valid (the service still checks installation). */
  readonly targets?: readonly FabricCompatTarget[]
}

/**
 * Build the load-time instrumentations for the declared compat targets.
 *
 * Call this before the target modules are imported and pass the result to
 * `installFabricHooks` (the launcher's `cordis-fabric` bootstrap carries its
 * own configured patches; a compat user either merges these into that
 * bootstrap or calls `installFabricHooks` explicitly). Malformed targets
 * fail loud here, at instrumentation build time.
 * @param config - the compat module config.
 * @returns Orchestrion instrumentations for every declared target.
 */
export function buildCompatInstrumentations(config: FabricCompatConfig): FabricInstrumentationConfig[] {
  return (config.targets ?? []).map(target =>
    patchInstrumentation({
      id: target.patch.id,
      target: target.patch.target,
      operation: target.patch.operation,
    }))
}

/**
 * Cooperative observation over a patch-backed target.
 *
 * The service owns the low-level patch registration as the calling fiber's
 * effect and dispatches each observed call to the listeners registered for
 * that target name. Disposing the returned disposer removes the listener and
 * disables the patch once the last listener for that name is gone.
 */
export class FabricCompatService extends Service {
  /** Service key under which this class registers on `ctx`. */
  static provide = 'fabricCompat'
  /** The low-level Fabric patch registry must be mounted. */
  static inject = ['fabric']

  private readonly targets = new Map<string, FabricCompatTarget>()
  private readonly observers = new Map<string, Set<(call: FabricCall) => void>>()

  /**
   * Create and install the compat adapter.
   * @param ctx - Cordis context that owns the service.
   * @param config - declared observation targets; duplicate names fail loud.
   */
  constructor(ctx: Context, config: FabricCompatConfig) {
    super(ctx, 'fabricCompat')
    for (const target of config.targets ?? []) {
      if (this.targets.has(target.name)) {
        throw new Error(`fabric-compat: target "${target.name}" is declared more than once`)
      }
      this.targets.set(target.name, target)
    }
  }

  /**
   * Observe calls to a declared target.
   *
   * Fails loud when the Fabric bridge is not installed: resolving `ctx.fabric`
   * alone does not imply the load-time hooks or browser bridge are active, and
   * an adapter must not register a patch that can never take effect.
   * @param name - the declared target name.
   * @param listener - called with each observed call record.
   * @returns a disposer removing this listener (the patch stays enabled while
   * other listeners remain).
   */
  observe(name: string, listener: (call: FabricCall) => void): () => void {
    const target = this.targets.get(name)
    if (target === undefined) {
      throw new Error(`fabric-compat: unknown target "${name}" (declared targets: ${[...this.targets.keys()].join(', ') || 'none'})`)
    }
    if (!isFabricInstalled()) {
      throw new Error('fabric-compat: the Fabric bridge is not installed; install the compat instrumentations (buildCompatInstrumentations) before loading the target module')
    }
    const listeners = this.observers.get(name) ?? new Set<(call: FabricCall) => void>()
    listeners.add(listener)
    this.observers.set(name, listeners)
    if (listeners.size === 1) {
      this.ctx.fabric.register({
        id: target.patch.id,
        target: target.patch.target,
        operation: target.patch.operation,
        handler: (call: FabricCall) => {
          for (const current of [...listeners]) current(call)
        },
      })
    }
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) {
        this.observers.delete(name)
        this.ctx.fabric.disable(target.patch.id)
      }
    }
  }
}

export default FabricCompatService
