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
 * @module @deepseek-ai/dsh-cordis-fabric/service
 */

import { Service } from 'cordis'
import type { Context } from 'cordis'
import { runtime, validatePatchId, validatePatchStatic } from './runtime.ts'
import type { FabricPatch, FabricPatchInfo, FabricHandler, PatchId } from './types.ts'

declare module 'cordis' {
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
  }

  /**
   * Register a patch and enable its handler for the current fiber.
   *
   * The registration is an effect: disposing the fiber disables and removes
   * the patch, so transformed code falls back to the original body. The
   * effect attaches on the first registration of an id only; a later
   * re-registration from another fiber updates metadata and handler without
   * changing disposal ownership.
   * @param patch - validated patch descriptor.
   * @returns the registered patch id.
   */
  register(patch: FabricPatch): PatchId {
    validatePatchId(patch.id)
    validatePatch(patch)
    const first = runtime.register(patchInfo(patch))
    runtime.enable(patch.id, patch.handler)
    if (first) {
      this.ctx.effect(() => {
        return () => {
          runtime.disable(patch.id)
          runtime.remove(patch.id)
        }
      }, `fabric:register(${patch.id})`)
    }
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
