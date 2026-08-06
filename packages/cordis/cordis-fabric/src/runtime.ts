/**
 * Process-local Fabric runtime: owns patch lifecycle state and dispatches
 * transformed calls published through the shared bridge.
 *
 * The runtime is intentionally Cordis-free. Transformed target code runs
 * before any Cordis context exists and must never receive a `Context`;
 * dispatch happens through the bridge's in-memory listener set, keyed by
 * patch id. The Cordis service attaches and detaches handlers here.
 *
 * The subscription is installed on first enable and intentionally never
 * removed while the process lives: transformed modules are already evaluated
 * and keep publishing to the bridge, and removing the subscription would
 * strand them with a dead slot across fiber reloads. Disabling a patch
 * removes its handler, so transformed code then delegates to the original
 * body through the no-listener path in the bridge.
 * @module @deepseek-ai/dsh-cordis-fabric/runtime
 */

import { subscribeBridge, type FabricBridgeCall } from './bridge.ts'
import type { FabricCall, FabricHandler, FabricOperation, FabricPatchInfo, FabricTarget, PatchId } from './types.ts'

/** Runtime state of one registered patch. */
interface PatchEntry {
  /** Static patch metadata (no handler functions). */
  info: FabricPatchInfo
  /** Currently installed handler, when the patch is enabled. */
  handler: FabricHandler | undefined
}

/**
 * Validate a patch id for use in diagnostics and bridge dispatch.
 * @param id - the patch id to validate.
 * @throws when the id is empty, too long, or contains unsafe characters.
 */
export function validatePatchId(id: PatchId): void {
  if (!/^[A-Za-z0-9._:/+-]{1,120}$/.test(id)) {
    throw new Error(`fabric: patch id ${JSON.stringify(id)} must be 1-120 chars of [A-Za-z0-9._:/+-]`)
  }
}

/**
 * Validate the static fields of a patch descriptor: the target's module,
 * version range, and file shape, plus the operation kind. Both the service
 * registration path and the loader instrumentation path enforce the same
 * checks, so a malformed descriptor fails loud no matter which plane it
 * crossed.
 * @param patch - the descriptor's static part.
 * @throws when a target field or the operation is malformed.
 */
export function validatePatchStatic(patch: { target: FabricTarget; operation: FabricOperation }): void {
  const target = patch.target
  if (typeof target.module !== 'string' || target.module.length === 0) {
    throw new Error('fabric: patch target.module must be a non-empty string')
  }
  if (typeof target.versionRange !== 'string' || target.versionRange.length === 0) {
    throw new Error('fabric: patch target.versionRange must be a non-empty string')
  }
  if (typeof target.filePath !== 'string' && !(target.filePath instanceof RegExp)) {
    throw new Error('fabric: patch target.filePath must be a string or RegExp')
  }
  if (!['before', 'after', 'around', 'replace'].includes(patch.operation)) {
    throw new Error(`fabric: unknown operation ${JSON.stringify(patch.operation)}`)
  }
}

/** Whether a value is a thenable (the async-target result shape). */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && 'then' in value
    && typeof value.then === 'function'
}

/**
 * Registry of enabled Fabric patches with the shared bridge subscription.
 */
export class FabricRuntime {
  private readonly entries = new Map<PatchId, PatchEntry>()
  private subscribed = false

  /**
   * Register a patch's static metadata; the patch stays disabled until
   * {@link FabricRuntime.enable} installs its handler.
   * @param info - validated patch metadata.
   * @returns whether the id was newly registered (false re-registers metadata).
   * @throws when another `replace` patch already claims the same target.
   */
  register(info: FabricPatchInfo): boolean {
    const previous = this.entries.get(info.id)
    if (info.operation === 'replace') {
      const key = targetKey(info.target)
      // A re-registration of this id that already holds replace on the same
      // target is the entry itself; every other replace registration must
      // pass the exclusive-target scan (a first registration as `before`
      // must not be able to re-register into an already-claimed replace
      // target by bypassing the check).
      const selfClaim = previous?.info.operation === 'replace' && targetKey(previous.info.target) === key
      if (!selfClaim) {
        for (const [id, existing] of this.entries) {
          if (id === info.id) continue
          if (existing.info.operation === 'replace' && targetKey(existing.info.target) === key) {
            throw new Error(
              `fabric: replace patch ${JSON.stringify(info.id)} conflicts with existing `
              + `replace patch ${JSON.stringify(existing.info.id)} on the same target`,
            )
          }
        }
      }
    }
    this.entries.set(info.id, { info, handler: previous?.handler })
    return previous === undefined
  }

  /**
   * Install a patch's handler and ensure the bridge subscription exists.
   * @param id - the patch id.
   * @param handler - the trusted runtime handler.
   */
  enable(id: PatchId, handler: FabricHandler): void {
    const entry = this.entries.get(id)
    if (!entry) throw new Error(`fabric: cannot enable unregistered patch ${JSON.stringify(id)}`)
    if (typeof handler !== 'function') {
      // Fail loud at enable (the earliest resolvable point) instead of
      // crashing inside a transformed call when dispatch tries to run it.
      throw new Error(`fabric: handler for patch ${JSON.stringify(id)} must be a function`)
    }
    entry.handler = handler
    this.subscribe()
  }

  /**
   * Remove a patch's handler; the bridge subscription (if any) stays alive.
   * @param id - the patch id.
   */
  disable(id: PatchId): void {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.handler = undefined
  }

  /**
   * Remove a patch entirely. The bridge subscription stays alive so any
   * transformed module already evaluated keeps delegating to the original
   * body rather than publishing into a dead slot.
   * @param id - the patch id.
   */
  remove(id: PatchId): void {
    this.entries.delete(id)
  }

  /**
   * Whether a patch is currently registered and enabled.
   * @param id - the patch id.
   * @returns true when the patch has an active handler.
   */
  isEnabled(id: PatchId): boolean {
    return this.entries.get(id)?.handler !== undefined
  }

  /**
   * Ordered diagnostic snapshot of all registered patches.
   * @returns the patch infos sorted by priority then id.
   */
  list(): FabricPatchInfo[] {
    return [...this.entries.values()]
      .map(entry => ({ ...entry.info, enabled: entry.handler !== undefined }))
      .sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  private subscribe(): void {
    if (this.subscribed) return
    this.subscribed = true
    subscribeBridge((call) => {
      const entry = this.entries.get(call.id)
      if (!entry) return call.traced()
      return dispatch(entry, call)
    })
  }
}

/** Stable identity of a patch target for conflict detection. */
function targetKey(target: FabricTarget): string {
  const selector = target.astQuery ?? JSON.stringify(target.functionQuery ?? null)
  return [target.module, target.versionRange, String(target.filePath), selector].join('|')
}

/**
 * Run the enabled handler for one transformed call. `before` mutates
 * arguments then delegates; `after` delegates then mutates the result;
 * `around` and `replace` decide whether the original body runs and may
 * supply their own result.
 * @param entry - the patch's runtime state.
 * @param call - the call record published by the transform.
 * @returns the value the wrapped function should return: the handler's
 * result for `around`/`replace`, the traced body's result otherwise.
 */
function dispatch(entry: PatchEntry, call: FabricBridgeCall): unknown {
  const handler = entry.handler
  if (!handler) return call.traced()
  // The handler union's members are distinguished only by their arity; the
  // operation switch selects the calling convention at runtime.
  const observe = handler as (call: FabricCall) => unknown

  const record: FabricCall = {
    arguments: call.arguments,
    self: call.self,
  }
  const invoke = (): unknown => call.traced()

  switch (entry.info.operation) {
    case 'before': {
      observe(record)
      return invoke()
    }
    case 'after': {
      const result = invoke()
      if (isThenable(result)) {
        // Async target: rewrite after the promise settles. The caller already
        // holds the original promise, so the rewritten promise is returned
        // and the caller's await resolves to the final value. A handler that
        // returns `undefined` keeps the (possibly in-place mutated)
        // `record.result`, mirroring the sync branch below.
        return result.then((value) => {
          record.result = value
          const rewritten = observe(record)
          return rewritten === undefined ? record.result : rewritten
        })
      }
      record.result = result
      const rewritten = observe(record)
      return rewritten === undefined ? record.result : rewritten
    }
    case 'around':
    case 'replace': {
      // The handler union is a plain intersection of callable signatures;
      // `around` and `replace` share the two-argument calling convention.
      return handler(record, invoke)
    }
  }
}

/** Singleton runtime shared by the Cordis service and the transform hooks. */
export const runtime = new FabricRuntime()
