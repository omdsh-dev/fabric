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
      'node/loader': 'lib/types/node/loader.js',
      'node/hook-entry': 'lib/types/node/hook-entry.js',
      'node/identity': 'lib/types/node/identity.js',
      'node/wire': 'lib/types/node/wire.js',
      'browser/transform': 'lib/types/browser/transform.js',
      'browser/serve': 'lib/types/browser/serve.js',
      'hmr/ownership': 'lib/types/hmr/ownership.js',
      'hmr/reload': 'lib/types/hmr/reload.js',
      'transform/config': 'lib/types/transform/config.js',
      'transform/transform': 'lib/types/transform/transform.js',
      'testing/testkit': 'lib/types/testing/testkit.js',
      'testing/testkit-runner': 'lib/types/testing/testkit-runner.js',
      'browser/client': 'lib/types/browser/client/index.js',
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
      client: 'lib/types/browser/client/index.js',
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
