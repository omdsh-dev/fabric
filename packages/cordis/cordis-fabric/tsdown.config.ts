import type { UserConfig } from 'tsdown'
import { clientBundle } from '../../client/tsdown.client.ts'

/**
 * cordis-fabric is a dual-face package: the node half (index, invariant, and
 * the loader-thread hook entry) plus the browser client bundle. The shared
 * preset emits the node half and companions during the explicit build phase;
 * the hook entry is a third node artifact the async loader fallback resolves.
 */
const hookEntry: UserConfig = {
  // Loader-thread hook entry for the async `module.register` fallback; the
  // Node loader resolves it relative to its own module URL.
  entry: ['lib/types/hook-entry.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}

const testkit: UserConfig = {
  // Test-only kit: the parent spawns the runner child by its own module URL,
  // so both artifacts must sit next to each other in lib/.
  entry: ['lib/types/testkit.js', 'lib/types/testkit-runner.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}

export default clientBundle(
  '@deepseek-ai/dsh-cordis-fabric',
  ['lib/types/index.js', 'lib/types/invariant.js'],
  { companions: [hookEntry, testkit] },
)
