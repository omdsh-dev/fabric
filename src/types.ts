/**
 * Fabric descriptor, operation, and handler contracts shared by the Cordis
 * service, the runtime bridge, and the Node transformation hooks.
 * @module @deepseek-ai/dsh-cordis-fabric/types
 */

import type { FunctionQuery } from '@apm-js-collab/code-transformer'

/** Stable identity of one Fabric patch (unique within one Fabric runtime). */
export type PatchId = string

/**
 * What a patch may do to its target function. `before` mutates arguments
 * before the original body runs, `after` mutates the successful result,
 * `around` decides whether the original body runs and may replace the result,
 * and `replace` owns the call entirely.
 */
export type FabricOperation = 'before' | 'after' | 'around' | 'replace'

/**
 * Target of one Fabric patch: the npm package, version range, package-relative
 * file, and the function or AST query selecting the injection point.
 */
export interface FabricTarget {
  /** npm package name matched against the resolved module's owner. */
  module: string
  /** semver range the owning package version must satisfy. */
  versionRange: string
  /** File path or pattern relative to the package root. */
  filePath?: string | RegExp
  /**
   * Convenience for the dual-form idiom: every package-relative file path in
   * this list matches under one patch id (each entry expands into its own
   * instrumentation sharing the id, with one binding record per matched
   * file). Mutually exclusive with `filePath`.
   */
  filePaths?: string[]
  /** Name-based function query (function, method, class, private method…). */
  functionQuery?: FunctionQuery
  /** Raw esquery selector; when set it takes precedence over name matching. */
  astQuery?: string
  /**
   * Which match to transform when the selector picks several functions in
   * one file: a zero-based index, or null/omitted to transform every match.
   * Read for raw `astQuery` targets (forwarded as the behavior `index`);
   * name-based `functionQuery` targets carry their own `index` with the
   * same default.
   */
  index?: number | null
}

/** Runtime call record published to a patch's tracing channel. */
export interface FabricCall {
  /** Actual call arguments; subscribers may mutate them in place. */
  arguments: unknown[]
  /** `this` receiver of the original call. */
  self: unknown
  /** Version of the owning package captured at transformation time. */
  moduleVersion?: string
  /** Successful result of the traced body (a thenable for async targets). */
  result?: unknown
}

/**
 * Call the original traced body with the (possibly mutated) call arguments.
 * The returned value is a thenable exactly when the original target is async.
 */
export type FabricInvoke = () => unknown

/**
 * `before` handler: observes and rewrites the call arguments. The original
 * body runs with the mutated arguments; the return value is ignored.
 * @param call - the call record whose `arguments` array the handler may mutate.
 */
export type FabricBeforeHandler = (call: FabricCall) => void

/**
 * `after` handler: observes and rewrites the successful result. May return a
 * replacement value (a promise for async targets) or mutate the call's
 * `result` field in place and return `undefined`.
 * @param call - the call record whose `result` holds the original outcome.
 */
export type FabricAfterHandler = (call: FabricCall) => unknown

/**
 * `around` handler: decides whether the original body runs and may replace
 * its result. Call `invoke()` to run the original body with the mutated
 * arguments; skip it to veto the original body and supply a result directly.
 * @param call - the call record for this invocation.
 * @param invoke - runs the original body with the current call arguments.
 */
export type FabricAroundHandler = (call: FabricCall, invoke: FabricInvoke) => unknown

/**
 * `replace` handler: owns the call. `invoke()` still runs the original body
 * with the mutated arguments when the handler chooses to delegate.
 * @param call - the call record for this invocation.
 * @param invoke - runs the original body with the current call arguments.
 */
export type FabricReplaceHandler = (call: FabricCall, invoke: FabricInvoke) => unknown

/** Dispatcher accepted for every operation kind. */
export type FabricHandler = FabricBeforeHandler | FabricAfterHandler | FabricAroundHandler | FabricReplaceHandler

/**
 * One registered Fabric patch. The handler is trusted code bound at
 * registration time; executable handlers are never deserialized from
 * configuration.
 */
export interface FabricPatch {
  /**
   * Id within one Fabric runtime. Re-registering an id updates the metadata
   * and reports not-first; the first registration's fiber effect still owns
   * disposal.
   */
  id: PatchId
  /** The module, file, and function this patch transforms. */
  target: FabricTarget
  /** Behavior kind of this patch. */
  operation: FabricOperation
  /**
   * Load-time contract: when true, the bootstrap must observe at least one
   * transformed file for this patch after the application boots. A required
   * patch that bound nothing fails startup loud (naming the patch id)
   * instead of silently shipping an inert transform — the filePath may be
   * the wrong launch form (src vs lib) or the function may have moved.
   * Defaults to false.
   */
  required?: boolean
  /** Numeric ordering key; higher priorities run first, equal priorities preserve stable registration order. */
  priority?: number
  /** Runtime behavior installed for this patch. */
  handler: FabricHandler
}

/** One load-time binding of a patch: a file its transform actually rewrote. */
export interface FabricBinding {
  /** Package name of the bound module. */
  module: string
  /** Package-relative file path that was transformed. */
  file: string
  /** Function nodes rewritten in that file. */
  nodes: number
}

/** One file's binding record with its patch id — the shape the browser
 * transform attaches to its output and the loader-thread channel forwards. */
export interface FabricBindingReport extends FabricBinding {
  /** The patch id the node count belongs to. */
  patchId: PatchId
}

/** Immutable diagnostic snapshot of one registered patch (no handler functions). */
export interface FabricPatchInfo {
  /** Patch id. */
  id: PatchId
  /** Target descriptor. */
  target: FabricTarget
  /** Behavior kind. */
  operation: FabricOperation
  /** Registration priority (defaults to 0); higher runs first. */
  priority: number
  /** Whether the patch is currently installed. */
  enabled: boolean
  /**
   * Load-time bindings recorded for this patch, in recording order. Always
   * present on `list()` entries; registration inputs may omit it.
   */
  bindings?: readonly FabricBinding[]
}

/** A patch descriptor without a runtime handler — the static shape
 * configuration may carry (handlers are trusted code bound at registration).
 */
export type FabricPatchStub = Omit<FabricPatch, 'handler'>
