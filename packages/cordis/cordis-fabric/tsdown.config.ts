import { defineConfig } from 'tsdown'
import { clientBundle } from '../../client/tsdown.client.ts'

/**
 * cordis-fabric is a dual-face package: the node half (index, invariant, and
 * the loader-thread hook entry) plus the browser client bundle. The client
 * preset provides both the node-half shape and the lazy CJS browser bundle;
 * the hook entry is a third node artifact the async loader fallback resolves.
 */
const [nodeHalf, browserHalf] = clientBundle(
  '@deepseek-ai/dsh-cordis-fabric',
  ['lib/types/index.js', 'lib/types/invariant.js'],
)

export default defineConfig([
  nodeHalf,
  {
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
  },
  browserHalf,
])
