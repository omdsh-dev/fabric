import { defineConfig } from 'tsdown'

/**
 * cordis-fabric is a dual-face package: the node half (index, the
 * loader-thread hook entry, and the testkit pair) plus the browser client
 * bundle. The shared prepare step emits the node half and companions; the
 * hook entry is a third node artifact the async loader fallback resolves.
 */
export default [
  defineConfig({
    entry: {
      index: 'lib/types/index.js',
      'hook-entry': 'lib/types/hook-entry.js',
      testkit: 'lib/types/testkit.js',
      'testkit-runner': 'lib/types/testkit-runner.js',
    },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  }),
  defineConfig({
    entry: {
      client: 'lib/types/client/index.js',
    },
    outDir: 'lib',
    // Browser half ships in the dsh closure-factory artifact: the web shell
    // loads /plugins/<id>/client.js as a classic script and resolves value
    // imports through the loader module table (require), so the bundle
    // registers window.__ModuleLoader__.load({id, factory}) and keeps
    // @deepseek-ai/cordis external (a platform seed entry).
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: true,
    external: ['@deepseek-ai/cordis'],
    noExternal: true,
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "cordis-fabric", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }),
]
