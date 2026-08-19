import { defineConfig } from 'tsdown'

/**
 * cordis-fabric-dsh is a dual-face package: the Host half (index plus the
 * DSH facade module entries, the profile bootstrap, and the invariant
 * companion) plus the browser client bundle. The module entries are
 * additional node exports resolved from `lib`.
 */
export default [
  defineConfig({
    entry: {
      index: 'src/index.ts',
      'host/agent': 'src/host/agent.ts',
      'host/tools': 'src/host/tools.ts',
      'host/prompt': 'src/host/prompt.ts',
      'host/commands': 'src/host/commands.ts',
      'bootstrap/profile': 'src/bootstrap/profile.ts',
      'browser/client': 'src/browser/client/index.ts',
      invariant: 'src/invariant.ts',
    },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    clean: true,
  }),
  defineConfig({
    entry: {
      client: 'src/browser/client/index.ts',
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
    deps: {
      neverBundle: ['@deepseek-ai/cordis'],
      alwaysBundle: (id) => !id.startsWith('@deepseek-ai/cordis'),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "cordis-fabric-dsh", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }),
]
