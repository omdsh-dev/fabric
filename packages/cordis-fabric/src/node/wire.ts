/** JSON wire helpers for the async Node loader configuration channel. */

import type { FabricInstrumentationConfig } from '../transform/config.ts'

/** Wire form that preserves RegExp file paths through JSON. */
export interface FabricWireInstrumentation extends Omit<FabricInstrumentationConfig, 'module'> {
  module: Omit<FabricInstrumentationConfig['module'], 'filePath'> & {
    filePath: string | { fabricRegexp: [source: string, flags: string] }
  }
}

/** Serialize one instrumentation for the loader-thread configuration file. */
export function serializeInstrumentation(config: FabricInstrumentationConfig): FabricWireInstrumentation {
  const filePath = config.module.filePath
  if (!(filePath instanceof RegExp)) return config as FabricWireInstrumentation
  return {
    ...config,
    module: { ...config.module, filePath: { fabricRegexp: [filePath.source, filePath.flags] } },
  }
}

/** Revive a serialized RegExp file path for the matcher. */
export function reviveInstrumentation(config: FabricWireInstrumentation): FabricInstrumentationConfig {
  const filePath = config.module.filePath
  if (typeof filePath === 'object') {
    return {
      ...config,
      module: { ...config.module, filePath: new RegExp(filePath.fabricRegexp[0], filePath.fabricRegexp[1]) },
    }
  }
  return config as FabricInstrumentationConfig
}
