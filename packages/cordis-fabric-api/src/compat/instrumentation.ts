import { patchInstrumentation } from '@oh-my-dsh/cordis-fabric'
import type { FabricInstrumentationConfig } from '@oh-my-dsh/cordis-fabric'
import type { FabricCompatConfig } from './types.ts'

/**
 * Build load-time instrumentations for all declared compat observation targets.
 * Malformed targets fail during bootstrap rather than becoming inert silently.
 */
export function buildCompatInstrumentations(config: FabricCompatConfig): FabricInstrumentationConfig[] {
  return (config.targets ?? []).map(target =>
    patchInstrumentation({
      id: target.patch.id,
      target: target.patch.target,
      operation: target.patch.operation,
    }))
}
