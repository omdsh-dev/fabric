/**
 * Cordis Fabric service: the runtime face of the experimental Fabric/Mixin
 * extension layer. Trusted plugins register patches (target + operation +
 * handler) here; the transformation hooks installed by
 * {@link installFabricHooks} rewrite the target functions, and this service
 * attaches and detaches the handlers in the shared runtime.
 *
 * The service is opt-in: nothing in the default DSH composition mounts it,
 * and a plugin only receives `ctx.fabric` when it declares the service.
 * @module @deepseek-ai/dsh-cordis-fabric
 */

export {
  GLOBAL_BRIDGE_KEY,
  installBridge,
  isFabricInstalled,
  publish,
  type FabricBridgeCall,
} from './bridge.ts'
export { bootstrapFabric, installFabricHooks, patchInstrumentation, retransformCommonJs, retransformEsm, type FabricInstrumentationConfig } from './node-loader.ts'
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
} from './browser-transform.ts'
export { runtime, validatePatchId } from './runtime.ts'
export { createFabricTransform } from './transform.ts'
export type {
  FabricAfterHandler,
  FabricAroundHandler,
  FabricBeforeHandler,
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

export { FabricService } from './service.ts'
