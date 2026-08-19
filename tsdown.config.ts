import { defineConfig } from 'tsdown'

/**
 * The published bundle exposes one Node launcher. Keep the launcher source in
 * `src` with the rest of the build inputs, then emit a self-contained ESM bin
 * under `lib` alongside its source map.
 */
export default defineConfig({
  entry: {
    'fabric-dsh': 'src/fabric-dsh.ts',
  },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  fixedExtension: false,
  dts: false,
  clean: true,
  sourcemap: true,
})
