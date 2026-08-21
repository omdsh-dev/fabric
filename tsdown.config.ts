import { defineConfig } from 'tsdown'

/**
 * The published bundle exposes a Node launcher and its native Node preload.
 * Keep both sources in `src` with the rest of the build inputs, then emit
 * self-contained ESM files under `lib` alongside their source maps.
 */
export default defineConfig({
  entry: {
    'stent-dsh': 'src/stent-dsh.ts',
    'stent-dsh-preload': 'src/stent-dsh-preload.ts',
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
