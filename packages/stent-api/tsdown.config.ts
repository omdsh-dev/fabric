import { defineConfig } from 'tsdown'

/**
 * stent-api is a pure host package with two node entries: the
 * aggregate index and the compat facade.
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'compat/service': 'src/compat/service.ts',
    'compat/instrumentation': 'src/compat/instrumentation.ts',
    'compat/types': 'src/compat/types.ts',
  },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: true,
  clean: true,
})
