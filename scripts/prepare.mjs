import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
const packages = ['cordis-fabric', 'cordis-fabric-api', 'cordis-fabric-dsh']

function packageFile(packageName, relativePath) {
  return join(dirname(require.resolve(`${packageName}/package.json`)), relativePath)
}

function run(name, entry, args, cwd) {
  if (!existsSync(entry)) {
    console.error(`prepare: missing local executable ${entry}; run pnpm install first`)
    process.exit(1)
  }
  const result = spawnSync(process.execPath, [entry, ...args], { cwd, stdio: 'inherit' })
  if (result.error !== undefined) {
    console.error(`prepare: failed to run ${name}: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const tsdown = packageFile('tsdown', 'dist/run.mjs')

// tsdown compiles each package directly from src and emits both JavaScript and
// declaration files. It also cleans the package output before each build.
for (const pkg of packages) {
  run('tsdown', tsdown, ['--config-loader', 'unrun', '--config', 'tsdown.config.ts'], join(root, 'packages', pkg))
}
