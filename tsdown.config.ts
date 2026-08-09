import { defineConfig } from 'tsdown'

export default [
  defineConfig({
    entry: {
      index: 'lib/types/index.js',
      invariant: 'lib/types/invariant.js',
      'hook-entry': 'lib/types/hook-entry.js',
      testkit: 'lib/types/testkit.js',
      'testkit-runner': 'lib/types/testkit-runner.js',
      api: 'lib/types/api/index.js',
      'api-agent': 'lib/types/api/agent.js',
      'api-tools': 'lib/types/api/tools.js',
      'api-prompt': 'lib/types/api/prompt.js',
      'api-commands': 'lib/types/api/commands.js',
      'api-compat': 'lib/types/api/compat.js',
      'api-invariant': 'lib/types/api/invariant.js',
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
      'api-client': 'lib/types/client/api.js',
    },
    outDir: 'lib',
    format: ['esm'],
    platform: 'browser',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
  }),
]
