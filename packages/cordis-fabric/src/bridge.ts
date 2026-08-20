/**
 * The Fabric runtime bridge — the single process-local entrypoint that
 * transformed target code calls. The bootstrap installs `publish` as a
 * `globalThis` handle; transformed code (ESM or CJS) emits
 * `globalThis[<key>].publish(call)` with no module import of its own.
 *
 * The bridge is deliberately tiny and Cordis-free: it carries no `Context`,
 * no registry state, and no knowledge of the target module. It is also
 * platform-free: dispatch runs through an in-memory listener set with no
 * `node:*` imports, so the same bridge serves the Node host and the browser
 * build (the runtime subscribes through {@link subscribeBridge}).
 * @module @oh-my-dsh/cordis-fabric/bridge
 */

import type { FabricOperation, PatchId } from './types.ts'

/** Global handle under which the bootstrap installs the bridge. */
export const GLOBAL_BRIDGE_KEY = '__dshFabricBridge'

/** Call record published by transformed code and consumed by the runtime. */
export interface FabricBridgeCall {
  /** The patch id this transformed call belongs to. */
  id: PatchId
  /** Operation kind the transform was generated for. */
  operation: FabricOperation
  /** Call arguments; `before` handlers mutate them in place. */
  arguments: unknown[]
  /** `this` receiver of the original call. */
  self: unknown
  /** The original function body, invoked with the current arguments. */
  traced: () => unknown
}

/** One bridge listener: dispatches a call and returns its result. */
export type BridgeListener = (call: FabricBridgeCall) => unknown

/** Bridge listeners in registration order (the runtime registers exactly one). */
const listeners = new Set<BridgeListener>()

/**
 * Subscribe to transformed calls.
 * @param listener - dispatch function for every published call.
 * @returns a disposer removing the listener.
 */
export function subscribeBridge(listener: BridgeListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Publish one transformed call to the runtime. Returns the value the caller
 * should return: the handler's result for `around`/`replace`, or the traced
 * body's result (rewritten by `after` handlers) for `before`/`after`.
 *
 * With multiple listeners (e.g. several `FabricRuntime` instances in one
 * process), every listener sees the call in registration order — earlier
 * listeners' argument/result mutations are visible to later ones — and the
 * last listener's result is returned.
 * @param call - the call record assembled by the transform.
 * @returns the value to return from the wrapped function.
 */
export function publish(call: FabricBridgeCall): unknown {
  if (listeners.size === 0) {
    // No handler is registered for this patch (disabled, disposed, or the
    // patch was never enabled): delegate to the original body untouched.
    return call.traced()
  }
  let result: unknown
  for (const listener of listeners) {
    result = listener(call)
  }
  return result
}

/**
 * Install the bridge handle into the current global object.
 * @param globalObject - target global object; defaults to `globalThis`.
 */
export function installBridge(globalObject: object = globalThis): void {
  ;(globalObject as Record<string, unknown>)[GLOBAL_BRIDGE_KEY] = { publish }
}

/**
 * Whether the Fabric bridge handle is installed in the current global object.
 *
 * The bridge is installed by `installFabricHooks` (Node host) and by the
 * browser entry's `apply`, so its presence marks the transformation
 * machinery as active: on the Node host, load-time hooks accompany the
 * bridge, and in the browser, build-time transforms fall back to the
 * original body until this handle exists. A consumer that needs the bridge
 * before registering a patch (e.g. a patch-backed adapter) checks this
 * instead of assuming `ctx.fabric` implies installation.
 * @param globalObject - target global object; defaults to `globalThis`.
 * @returns whether the bridge handle is present.
 */
export function isFabricInstalled(globalObject: object = globalThis): boolean {
  return (globalObject as Record<string, unknown>)[GLOBAL_BRIDGE_KEY] !== undefined
}
