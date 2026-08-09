import { defineConfig } from 'tsdown'

export default [
  defineConfig({
    entry: {
      index: 'src/index.ts',
      invariant: 'src/invariant.ts',
      'hook-entry': 'src/hook-entry.ts',
      testkit: 'src/testkit.ts',
      'testkit-runner': 'src/testkit-runner.ts',
      api: 'src/api/index.ts',
      'api-agent': 'src/api/agent.ts',
      'api-tools': 'src/api/tools.ts',
      'api-prompt': 'src/api/prompt.ts',
      'api-commands': 'src/api/commands.ts',
      'api-compat': 'src/api/compat.ts',
      'api-invariant': 'src/api/invariant.ts',
    },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: true,
  }),
  defineConfig({
    entry: {
      client: 'src/client/index.ts',
      'api-client': 'src/client/api.ts',
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
