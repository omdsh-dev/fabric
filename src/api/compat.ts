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
 * @module @deepseek-ai/dsh-cordis-fabric/api/compat
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import { getFabric, isFabricInstalled, patchInstrumentation, serveBrowserTransform } from '@deepseek-ai/dsh-cordis-fabric'
import type { FabricService } from '@deepseek-ai/dsh-cordis-fabric'
import type { FabricInstrumentationConfig } from '@deepseek-ai/dsh-cordis-fabric'
import type {
  FabricCall, FabricHandler, FabricOperation, FabricPatch, FabricTarget, PatchId, ServeBrowserTransformOptions,
} from '@deepseek-ai/dsh-cordis-fabric'

export type {
  FabricCall, FabricHandler, FabricInvoke, FabricOperation, FabricPatch, FabricTarget, PatchId, ServeBrowserTransformOptions,
} from '@deepseek-ai/dsh-cordis-fabric'

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

  /** The low-level Fabric registry this facade drives (mounted on demand). */
  private readonly fabric: FabricService
  private readonly targets = new Map<string, FabricCompatTarget>()
  /** Patch ids claimed by the declared observation targets (a stable namespace). */
  private readonly targetIds = new Set<PatchId>()
  /** Runtime patch registrations made through this service, by id. */
  private readonly registered = new Map<PatchId, FabricPatch>()
  private readonly observers = new Map<string, Set<(call: FabricCall) => void>>()

  /**
   * Create and install the compat adapter.
   * @param ctx - Cordis context that owns the service.
   * @param config - declared observation targets; duplicate names fail loud.
   */
  constructor(ctx: Context, config: FabricCompatConfig) {
    super(ctx, 'fabricCompat')
    // The low-level registry is optional and mounted on demand: a consumer
    // mounts this facade alone and never imports the low-level package.
    this.fabric = getFabric(ctx)
    for (const target of config.targets ?? []) {
      if (this.targets.has(target.name)) {
        throw new Error(`fabric-compat: target "${target.name}" is declared more than once`)
      }
      this.targets.set(target.name, target)
      this.targetIds.add(target.patch.id)
    }
  }

  /**
   * Register a runtime patch through the cooperative facade.
   *
   * The facade owns an exclusive id namespace: registering an id that is
   * already claimed — by another registration or by a declared observation
   * target — fails loud, where the low-level registry would silently update
   * the existing patch. The patch is enabled immediately and removed with
   * the calling fiber (the low-level registration is the fiber's effect).
   * @param patch - the patch descriptor with its trusted handler.
   * @returns the registered patch id.
   * @throws when the id is already claimed.
   */
  registerPatch(patch: FabricPatch): PatchId {
    if (this.registered.has(patch.id) || this.targetIds.has(patch.id)) {
      throw new Error(`fabric-compat: patch id "${patch.id}" is already claimed (registerPatch or a declared observation target)`)
    }
    // No bridge check here: binding a handler is harmless when the
    // transforms are absent (the low-level registry has the same posture) —
    // the bridge check belongs to observe, whose contract promises delivery.
    this.fabric.register(patch)
    this.registered.set(patch.id, patch)
    return patch.id
  }

  /**
   * Disable and remove a patch registered through this service.
   * @param id - the patch id.
   */
  unregisterPatch(id: PatchId): void {
    if (!this.registered.has(id)) return
    this.fabric.disable(id)
    this.registered.delete(id)
  }

  /**
   * Disable a registered patch's handler; transformed code delegates to the
   * original body until the patch is enabled again.
   * @param id - the patch id.
   */
  disablePatch(id: PatchId): void {
    this.fabric.disable(id)
  }

  /**
   * Enable a previously disabled registered patch with a fresh handler.
   * @param id - the patch id.
   * @param handler - the trusted runtime handler.
   */
  enablePatch(id: PatchId, handler: FabricHandler): void {
    this.fabric.enable(id, handler)
  }

  /**
   * Serve a transformed browser bundle through the runtime bundle
   * primitive — the cooperative entry for browser-side bundle rewrites
   * (the low-level {@link serveBrowserTransform} under the facade).
   * @param options - route, patch(es), and degradation policy.
   * @returns a disposer removing the route.
   */
  serveBundle(options: ServeBrowserTransformOptions): () => void {
    return serveBrowserTransform(this.ctx, options)
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
      this.fabric.register({
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
        this.fabric.disable(target.patch.id)
      }
    }
  }
}

export default FabricCompatService
