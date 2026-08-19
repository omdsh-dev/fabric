import { defineConfig } from 'tsdown'

/**
 * cordis-fabric-api is a pure host package with two node entries: the
 * aggregate index and the compat facade.
 */
export default defineConfig({
  entry: {
    index: 'lib/types/index.js',
    'compat/service': 'lib/types/compat/service.js',
    'compat/instrumentation': 'lib/types/compat/instrumentation.js',
    'compat/types': 'lib/types/compat/types.js',
  },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
