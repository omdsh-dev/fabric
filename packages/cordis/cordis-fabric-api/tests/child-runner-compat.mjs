/**
 * Child-process harness for the Fabric compat adapter spec: each case runs in
 * a fresh Node process so the synchronous module hooks and the
 * already-transformed module cache never leak between cases. The bridge must
 * be installed before the target module is imported, so installation order
 * is part of what each case exercises.
 */

import { Context } from 'cordis'
import { installFabricHooks, FabricService } from '@deepseek-ai/dsh-cordis-fabric/src/index.ts'
import FabricCompatService, { buildCompatInstrumentations } from '@deepseek-ai/dsh-cordis-fabric-api/src/compat.ts'

const fixtureUrl = new URL('./fixtures/node_modules/fabric-compat-target/index.mjs', import.meta.url)

const functionQuery = { functionName: 'greet', kind: 'Sync' }

const config = {
  targets: [
    {
      name: 'greet',
      patch: {
        id: 'compat/greet-observe',
        target: {
          module: 'fabric-compat-target',
          versionRange: '^1.0.0',
          filePath: 'index.mjs',
          functionQuery,
        },
        operation: 'after',
      },
    },
  ],
}

/** Report one check line; mark the process failed on mismatch. */
function check(label, actual, expected) {
  const ok = actual === expected
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expect ${JSON.stringify(expected)})`}`)
  if (!ok) process.exitCode = 1
}

const caseName = process.argv[2]

if (caseName === 'observe') {
  installFabricHooks(buildCompatInstrumentations(config))
  const mod = await import(fixtureUrl)
  const ctx = new Context()
  await ctx.plugin(FabricService)
  await ctx.plugin(FabricCompatService, config)
  const seen = []
  const dispose = ctx.fabricCompat.observe('greet', (call) => { seen.push(call.result) })
  check('observe results', `${mod.greet('world')},${mod.greet('fabric')}`, 'hello world,hello fabric')
  check('observe seen', seen.join('|'), 'hello world|hello fabric')
  dispose()
  mod.greet('again')
  check('observe after dispose', seen.length, 2)
  await ctx.fiber.dispose()
} else if (caseName === 'noBridge') {
  // No installFabricHooks: the bridge is absent even though ctx.fabric exists.
  const ctx = new Context()
  await ctx.plugin(FabricService)
  let threw = ''
  try {
    await ctx.plugin(FabricCompatService, config)
    ctx.fabricCompat.observe('greet', () => {})
  } catch (error) {
    threw = error.message
  }
  check('noBridge throws', threw.startsWith('fabric-compat: the Fabric bridge is not installed'), true)
  await ctx.fiber.dispose()
} else if (caseName === 'unknownTarget') {
  installFabricHooks([])
  const ctx = new Context()
  await ctx.plugin(FabricService)
  await ctx.plugin(FabricCompatService, config)
  let threw = ''
  try {
    ctx.fabricCompat.observe('missing', () => {})
  } catch (error) {
    threw = error.message
  }
  check('unknown target throws', threw.includes('unknown target "missing"'), true)
  await ctx.fiber.dispose()
}
