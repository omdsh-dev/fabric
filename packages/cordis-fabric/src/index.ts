/**
 * Cordis Fabric service: the runtime face of the experimental Fabric/Mixin
 * extension layer. Trusted plugins register patches (target + operation +
 * handler) here; the transformation hooks installed by
 * {@link installFabricHooks} rewrite the target functions, and this service
 * attaches and detaches the handlers in the shared runtime.
 *
 * The service is opt-in: nothing in the default DSH composition mounts it,
 * and a plugin only receives `ctx.fabric` when it declares the service.
 * @module cordis-fabric
 */

export {
  GLOBAL_BRIDGE_KEY,
  installBridge,
  isFabricInstalled,
  publish,
  type FabricBridgeCall,
} from './bridge.ts'
export { bootstrapFabric, checkRequiredPatches, expandPatchStub, flushBindingReports, installFabricHooks, patchInstrumentation, retransformCommonJs, retransformEsm, type FabricInstrumentationConfig, type InstrumentationConfig } from './node/loader.ts'
export {
  createBrowserTransform,
  createWatchedBrowserTransform,
  nodeModulesResolver,
  nodePackageResolver,
  repoSourceResolver,
  type IdentityResolver,
  type ModuleIdentity,
  type TransformOutput,
  type WatchedBrowserTransform,
} from './browser/transform.ts'
export { runtime, validatePatchId, validatePatchStatic } from './runtime.ts'
export { serveBrowserTransform, type ServeBrowserTransformOptions } from './browser/serve.ts'
export { createFabricTransform } from './transform/transform.ts'
export type {
  FabricAfterHandler,
  FabricAroundHandler,
  FabricBeforeHandler,
  FabricBinding,
  FabricBindingReport,
  FabricCall,
  FabricHandler,
  FabricInvoke,
  FabricOperation,
  FabricPatch,
  FabricPatchInfo,
  FabricPatchStub,
  FabricReplaceHandler,
  FabricTarget,
  PatchId,
} from './types.ts'

export { FabricService, getFabric } from './service.ts'
