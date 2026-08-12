/**
 * Cordis Fabric API: the cooperative compat facade over the pure
 * `cordis-fabric` registry.
 *
 * The package exposes the patch-backed gap adapter for target domains with
 * no cooperative extension point: `FabricCompatService` (register, observe,
 * serve bundles) plus the load-time instrumentation builder. Everything
 * DSH-specific lives in `cordis-fabric-dsh`; this package depends only on
 * Cordis and `cordis-fabric`.
 * @module cordis-fabric-api
 */

export {
  buildCompatInstrumentations,
  FabricCompatService,
  default,
} from './compat.ts'
export type {
  FabricCompatConfig, FabricCompatPatch, FabricCompatTarget,
} from './compat.ts'
