/**
 * Cordis Fabric API: the cooperative compat facade over the pure
 * `cordis-fabric` registry.
 *
 * The package exposes the patch-backed gap adapter for target domains with
 * no cooperative extension point: `FabricCompatService` (register, observe,
 * serve bundles) plus the load-time instrumentation builder. Everything
 * DSH-specific lives in `cordis-fabric-dsh`; this package depends only on
 * Cordis and `cordis-fabric`.
 * @module @oh-my-dsh/cordis-fabric-api
 */

export {
  buildCompatInstrumentations,
} from './compat/instrumentation.ts'
export {
  FabricCompatService,
} from './compat/service.ts'
export type {
  FabricCompatConfig, FabricCompatPatch, FabricCompatTarget,
} from './compat/types.ts'
