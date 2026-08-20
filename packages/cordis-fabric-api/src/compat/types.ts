import type {
  FabricOperation,
  FabricTarget,
  PatchId,
} from '@oh-my-dsh/cordis-fabric'

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
