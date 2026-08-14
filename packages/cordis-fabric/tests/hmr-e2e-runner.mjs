/**
 * Child-process harness for the Fabric HMR end-to-end spec. Each mode runs in
 * a fresh Node process so the synchronous module hooks (which cannot be
 * unregistered) and the already-transformed module cache never leak between
 * cases. The child boots a real Loader tree (cordis loader, include, hmr and
 * timer plugins) with the Fabric service and transformation hooks, then
 * drives one HMR surface against a transformed fixture:
 *
 * - `config`: config-only HMR — the consumer row's `disabled` flag in the
 *   watched `cordis.yml`; toggling it must mount and unmount the consumer
 *   plugin and with it register and release the Fabric patch, flipping the
 *   transformed behavior (23 → original 5 → 23) without a process restart.
 * - `module`: module-reload HMR — the consumer plugin file sits inside the
 *   HMR watch root; rewriting it reloads the plugin under the same loader
 *   entry (the HMR service re-applies the row with `fiber.entry` preserved,
 *   transferring patch ownership to the new generation), so the new
 *   generation's handler takes over (23 → 203) and stays owned.
 *
 * The upstream suite drives the config case through the vendored fork's
 * `hmr.registerConfig` + include `internal/update` re-applying `config.patches`;
 * neither exists on the registry plugins, so this standalone repo toggles the
 * row's own `disabled` flag in `cordis.yml` instead — the HMR plugin refreshes
 * include entries on file change, which exercises the same row lifecycle.
 * The `@deepseek-ai/cordis-plugin-*` imports map to the registry
 * `@cordisjs/plugin-*` equivalents and `cordis-fabric/src/*` resolves
 * relatively, matching the other child-runner fixtures.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Hmr from '@deepseek-ai/cordis-plugin-hmr'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import { FabricService, installFabricHooks, patchInstrumentation } from '../src/index.ts'

const mode = process.argv[2]
if (mode !== 'config' && mode !== 'module') {
  console.error(`unknown HMR e2e mode: ${mode}`)
  process.exit(2)
}

/** The one patch under test: multiply the first argument before `add` runs. */
const PATCH = {
  id: 'hmr-e2e/multiply',
  target: {
    module: 'fabric-target-fixture',
    versionRange: '^1.0.0',
    filePath: 'index.mjs',
    functionQuery: { functionName: 'add', kind: 'Sync' },
  },
  operation: 'before',
}

const fixtureUrl = new URL('./fixtures/node_modules/fabric-target-fixture/index.mjs', import.meta.url)

/** Report one check line; mark the process failed on mismatch. */
function check(label, actual, expected) {
  const ok = actual === expected
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expect ${JSON.stringify(expected)})`}`)
  if (!ok) process.exitCode = 1
}

/** Poll until the predicate holds or the deadline passes. */
async function eventually(test, message, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (!test()) {
    if (Date.now() >= deadline) {
      console.error(`FAIL ${message}`)
      process.exitCode = 1
      return false
    }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return true
}

/**
 * Chokidar coalesces rapid writes to one file (the same atomic-write window
 * the app-boot user-patch tests throttle); consecutive patch-file writes
 * must land outside that window or a refresh is silently dropped.
 */
const settleWatch = () => new Promise(resolve => setTimeout(resolve, 75))

/**
 * The consumer plugin source. `config` mode reads the multiplier from the
 * row's config (HMR row lifecycle), `module` mode from a module constant the
 * reload rewrites (HMR module regeneration).
 */
function consumerSource(mode) {
  const multiplier = mode === 'module' ? 'MULTIPLIER' : 'config.multiplier'
  return [
    mode === 'module' ? 'const MULTIPLIER = 10' : null,
    "export const name = 'fabric-consumer'",
    "export const inject = ['fabric']",
    'export function apply(ctx, config = {}) {',
    '  ctx.fabric.register({',
    "    id: 'hmr-e2e/multiply',",
    '    target: { module: "fabric-target-fixture", versionRange: "^1.0.0", filePath: "index.mjs", functionQuery: { functionName: "add", kind: "Sync" } },',
    "    operation: 'before',",
    `    handler: (call) => { call.arguments[0] = call.arguments[0] * ${multiplier} },`,
    '  })',
    '}',
    '',
  ].filter(Boolean).join('\n')
}

/**
 * Boot a real Loader tree: the plugins on the root fiber, the Fabric service
 * on the root fiber, and one file-backed Include entry mounting the consumer
 * row from `cordis.yml`.
 */
async function bootTree(dir, hmrRoot) {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(dir).href + '/'
  await ctx.plugin(Loader)
  await ctx.plugin(Timer)
  await ctx.plugin(Hmr, { root: hmrRoot, ignored: [], debounce: 0 })
  await ctx.plugin(FabricService)
  ctx.loader.builtins.include = Include
  const includeId = await ctx.loader.create({
    id: 'include',
    name: 'cordis:include',
    config: { path: pathToFileURL(join(dir, 'cordis.yml')).href },
  })
  const entry = ctx.loader.resolve(includeId)
  await ctx.loader.await()
  return { ctx, entry }
}

// The load-time transformation hooks precede every target module import; the
// runtime handler is registered later by the consumer plugin's apply.
installFabricHooks([patchInstrumentation(PATCH)])

async function main() {
  const dir = mkdtempSync(join(tmpdir(), `dsh-fabric-hmr-${mode}-`))
  try {
    writeFileSync(join(dir, 'fabric-consumer.mjs'), consumerSource(mode))
    writeFileSync(join(dir, 'cordis.yml'), [
      '- id: fabric-consumer',
      '  name: ./fabric-consumer.mjs',
      '  config:',
      '    multiplier: 10',
      '',
    ].join('\n'))

    if (mode === 'config') {
      // Config-only HMR: the consumer row's `disabled` flag lives in the
      // watched cordis.yml. The HMR plugin refreshes include entries on file
      // change, so toggling the flag mounts and unmounts the consumer row
      // and with it registers and releases the Fabric patch.
      const yml = join(dir, 'cordis.yml')
      const row = (disabled) => [
        '- id: fabric-consumer',
        '  name: ./fabric-consumer.mjs',
        ...(disabled ? ['  disabled: true'] : []),
        '  config:',
        '    multiplier: 10',
        '',
      ].join('\n')
      const { ctx } = await bootTree(dir, [dir])
      try {
        const fixture = await import(fixtureUrl)
        check('config v1 add(2,3)', fixture.add(2, 3), 23)

        writeFileSync(yml, row('disabled'))
        await settleWatch()
        await eventually(() => fixture.add(2, 3) === 5, 'config: disabling the row did not release the patch')
        check('config disabled add(2,3)', fixture.add(2, 3), 5)

        writeFileSync(yml, row(''))
        await settleWatch()
        await eventually(() => fixture.add(2, 3) === 23, 'config: re-enabling the row did not re-register the patch')
        check('config re-enabled add(2,3)', fixture.add(2, 3), 23)

        // A second cycle proves the lifecycle is repeatable without residue.
        writeFileSync(yml, row('disabled'))
        await settleWatch()
        await eventually(() => fixture.add(2, 3) === 5, 'config: second disable did not release the patch')
        check('config second disable add(2,3)', fixture.add(2, 3), 5)

        writeFileSync(yml, row(''))
        await settleWatch()
        await eventually(() => fixture.add(2, 3) === 23, 'config: second re-enable did not re-register the patch')
        check('config second re-enable add(2,3)', fixture.add(2, 3), 23)
      } finally {
        await ctx.fiber.dispose()
      }
      return
    }

    // Module-reload HMR: the consumer plugin file lives in the watch root,
    // so rewriting it triggers the HMR plugin's partial reload — the loader
    // re-imports the module and re-applies the row under the same entry.
    const { ctx } = await bootTree(dir, [dir])
    try {
      const fixture = await import(fixtureUrl)
      check('module v1 add(2,3)', fixture.add(2, 3), 23)

      writeFileSync(join(dir, 'fabric-consumer.mjs'), consumerSource(mode).replace('const MULTIPLIER = 10', 'const MULTIPLIER = 100'))
      await eventually(() => fixture.add(2, 3) === 203, 'module: reload did not transfer the patch to the new generation')
      check('module reloaded add(2,3)', fixture.add(2, 3), 203)
      // The reloaded generation keeps owning the patch: the stale fiber's
      // disposer must not unregister the new registration.
      check('module reload stable add(2,3)', fixture.add(2, 3), 203)
    } finally {
      await ctx.fiber.dispose()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

await main()
