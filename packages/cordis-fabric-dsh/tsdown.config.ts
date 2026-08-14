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
      index: 'lib/types/index.js',
      agent: 'lib/types/agent.js',
      tools: 'lib/types/tools.js',
      prompt: 'lib/types/prompt.js',
      commands: 'lib/types/commands.js',
      'profile-bootstrap': 'lib/types/profile-bootstrap.js',
      invariant: 'lib/types/invariant.js',
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
      banner: 'window.__ModuleLoader__.load({ id: "cordis-fabric-dsh", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }),
]
