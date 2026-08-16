/**
 * The Cordis Fabric service: the runtime face of the Fabric extension layer.
 * Trusted plugins register patches (target + operation + handler) here; the
 * transformation hooks installed by {@link installFabricHooks} rewrite the
 * target functions, and this service attaches and detaches the handlers in
 * the shared runtime.
 *
 * The service is platform-free (no `node:*` imports) so the same class
 * serves the Node host and the browser Cordis tree. It is opt-in: nothing in
 * the default DSH composition mounts it, and a plugin only receives
 * `ctx.fabric` when it declares the service.
 * @module cordis-fabric/service
 */

import { Service } from '@deepseek-ai/cordis'
import { registerCatalogEntries } from './catalog.ts'
import type { Context } from '@deepseek-ai/cordis'
import { runtime, validatePatchId, validatePatchStatic } from './runtime.ts'
import type { FabricBinding, FabricPatch, FabricPatchInfo, FabricHandler, PatchId } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The Fabric patch registry, provided by this package. */
    fabric: FabricService
  }
}

/**
 * The Fabric registry service. Keeps patch metadata and handler state in the
 * process-local runtime and ties every registration to the owning fiber's
 * lifecycle.
 */
export class FabricService extends Service {
  /** Service key under which this class registers on `ctx`. */
  static provide = 'fabric'

  /**
   * Create and install the Fabric registry.
   * @param ctx - Cordis context that owns the service.
   */
  constructor(ctx: Context) {
    super(ctx, 'fabric')
    // Register the fabric inspect-catalog entries at mount (the host patch
    // used to bake them into the official tool-cordis catalog). Fire and
    // forget: a built host without the src export degrades to uncatalogued
    // rows, never a failure.
    void registerCatalogEntries()
  }

  /**
   * Register a patch and enable its handler for the current fiber.
   *
   * Every registration is an effect on the calling fiber: disposing the
   * fiber disables and removes the patch, so transformed code falls back to
   * the original body. The disposer only removes the entry while this fiber
   * still owns it — a same-owner re-registration (an HMR generation taking
   * its plugin's patch back) transfers fiber ownership, so the previous
   * generation's cleanup becomes a no-op instead of unregistering the newer
   * registration. Registering an id already owned by a different plugin
   * fails loud: a patch id is exclusive to one owner.
   * @param patch - validated patch descriptor.
   * @returns the registered patch id.
   * @throws when the id is already registered by a different plugin owner.
   */
  register(patch: FabricPatch): PatchId {
    validatePatchId(patch.id)
    validatePatch(patch)
    const fiber = this.ctx.fiber
    const owner = registrationOwner(this.ctx)
    // The effect goes first: a disposed (or unloading) fiber rejects the
    // registration before it can leave a half-installed entry behind, and a
    // later cross-owner throw from the runtime still leaves a disposer that
    // no-ops (it never owned the entry).
    this.ctx.effect(() => {
      return () => {
        if (runtime.isOwnedBy(patch.id, fiber)) {
          runtime.disable(patch.id)
          runtime.remove(patch.id)
        }
      }
    }, `fabric:register(${patch.id})`)
    runtime.register(patchInfo(patch), owner, fiber)
    runtime.enable(patch.id, patch.handler)
    return patch.id
  }

  /**
   * Ordered diagnostic snapshot of all registered patches.
   * @returns the patch infos sorted by priority then id.
   */
  list(): FabricPatchInfo[] {
    return runtime.list()
  }

  /**
   * Disable a patch's handler; transformed code delegates to the original
   * body until the patch is enabled again.
   * @param id - the patch id.
   */
  disable(id: string): void {
    runtime.disable(id)
  }

  /**
   * Enable a previously disabled patch with a fresh handler binding.
   * @param id - the patch id.
   * @param handler - the trusted runtime handler.
   */
  enable(id: string, handler: FabricHandler): void {
    runtime.enable(id, handler)
  }

  /**
   * Remove a patch entirely; transformed code delegates to the original body
   * until the patch is registered again. The registering fiber's effect
   * still owns the entry, so a removal here cannot be undone by a later
   * fiber disposal (the disposer no-ops once the entry is gone).
   * @param id - the patch id.
   */
  remove(id: string): void {
    runtime.remove(id)
  }

  /**
   * Whether the entry for a patch id is still owned by the given fiber —
   * the ownership check a cooperative disposer (e.g. the compat facade's
   * observer) runs before disabling, so a stale generation's cleanup cannot
   * disable a newer generation's registration that took the entry over.
   * @param id - the patch id.
   * @param fiber - the fiber token the registration was made on.
   * @returns true while the entry exists and is owned by that fiber.
   */
  owns(id: string, fiber: unknown): boolean {
    return runtime.isOwnedBy(id, fiber)
  }

  /**
   * Snapshot of load-time bindings: the files the transformation hooks
   * actually rewrote for one patch — the ground truth the `required` check
   * and this package's diagnostics are built on.
   * @param id - the patch id; when omitted, every recorded binding across
   * patches, flattened in patch-id order.
   * @returns the recorded binding records.
   */
  bindings(id?: PatchId): readonly FabricBinding[] {
    return id === undefined ? runtime.allBindings() : runtime.bindingsOf(id)
  }
}

/**
 * Mount-aware accessor for the optional Fabric registry: returns the
 * already-mounted service on this context, or mounts a fresh registry and
 * returns it. Cordis removes the registry with the owning fiber and rejects
 * a second registration, so repeated calls on a live context reuse the
 * mounted service (the context's view of it — a traceable wrapper on plain
 * contexts — never a fresh registry). Declared injection remains the
 * preferred route: this is the documented fallback for plugins that cannot
 * declare the optional service, and it reads the global store strictly, per
 * the optional-service convention.
 * @param ctx - the Cordis context to read from or mount on.
 * @returns the mounted Fabric registry (the context's view).
 */
export function getFabric(ctx: Context): FabricService {
  const existing = ctx.get('fabric')
  if (existing !== undefined) return existing
  return new FabricService(ctx)
}

/**
 * Resolve the identity a registration belongs to — the token the runtime
 * uses to keep a patch id exclusive to one owner while letting that owner's
 * HMR generations take it back.
 *
 * Under the Loader, every fiber in an entry tree carries the entry row
 * (`fiber.entry`), which is stable across that row's HMR generations and
 * distinct across rows, so it is the exact identity. Without a Loader
 * (unit/child harnesses), the plugin callback is the fallback: re-applying
 * the same plugin reuses its runtime record, while different plugins keep
 * distinct callbacks. The fiber itself is the last resort (root context).
 * @param ctx - the context the registration was made on.
 * @returns the registration owner token.
 */
function registrationOwner(ctx: Context): unknown {
  // The Loader augments Fiber with `entry` (see @cordisjs/plugin-loader); it
  // is a plain property, so no type-level dependency is needed here.
  const entry = (ctx.fiber as { entry?: unknown }).entry
  if (entry !== undefined) return entry
  const runtime = ctx.fiber.runtime
  return runtime?.callback ?? ctx.fiber
}

/** Validate the static fields of a patch descriptor. */
function validatePatch(patch: FabricPatch): void {
  validatePatchStatic(patch)
  if (typeof patch.handler !== 'function') {
    throw new Error('fabric: patch.handler must be a function')
  }
  const target = patch.target
  if (target.functionQuery === undefined && target.astQuery === undefined) {
    throw new Error('fabric: patch target must carry functionQuery or astQuery')
  }
  if (typeof target.astQuery === 'string' && target.astQuery.trim().length === 0) {
    throw new Error('fabric: patch target astQuery must not be blank')
  }
}

/** Build the immutable runtime info snapshot for a patch. */
function patchInfo(patch: FabricPatch): FabricPatchInfo {
  return {
    id: patch.id,
    target: patch.target,
    operation: patch.operation,
    priority: patch.priority ?? 0,
    enabled: true,
  }
}
