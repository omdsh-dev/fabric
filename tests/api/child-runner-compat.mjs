/**
 * Child-process harness for the Fabric compat adapter spec: each case runs in
 * a fresh Node process so the synchronous module hooks and the
 * already-transformed module cache never leak between cases. The bridge must
 * be installed before the target module is imported, so installation order
 * is part of what each case exercises.
 */

import { Context } from 'cordis'
import { installFabricHooks, FabricService } from '@deepseek-ai/dsh-cordis-fabric'
import FabricCompatService, { buildCompatInstrumentations } from '@deepseek-ai/dsh-cordis-fabric/api/compat'

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
} else if (caseName === 'registerPatch') {
  // The runtime registration binds a handler to a transform installed at
  // load time (here: a second instrumentation alongside the observe targets
  // — in a real deployment the launcher bootstrap's config.fabric.patches
  // carries it). The facade's id namespace stays exclusive: an id claimed
  // by a declared observation target fails loud.
  installFabricHooks([
    ...buildCompatInstrumentations(config),
    {
      channelName: 'compat/greet-upper',
      module: { name: 'fabric-compat-target', versionRange: '^1.0.0', filePath: 'index.mjs' },
      functionQuery: { functionName: 'greet', kind: 'Sync' },
      transform: 'fabric',
      fabricPatchId: 'compat/greet-upper',
      fabricOperation: 'after',
      fabricPriority: 0,
      astQuery: 'FunctionDeclaration[id.name="greet"][async], VariableDeclarator[id.name="greet"] > FunctionExpression[async], VariableDeclarator[id.name="greet"] > ArrowFunctionExpression[async]',
    },
  ])
  const mod = await import(fixtureUrl)
  const ctx = new Context()
  await ctx.plugin(FabricService)
  await ctx.plugin(FabricCompatService, config)
  const id = ctx.fabricCompat.registerPatch({
    id: 'compat/greet-upper',
    target: { module: 'fabric-compat-target', versionRange: '^1.0.0', filePath: 'index.mjs', functionQuery },
    operation: 'after',
    handler(call) {
      return String(call.result).toUpperCase()
    },
  })
  check('registerPatch returns id', id, 'compat/greet-upper')
  check('registerPatch rewrites', mod.greet('world'), 'HELLO WORLD')
  // The facade's id namespace is exclusive: an id claimed by a declared
  // observation target, or by an earlier registration, fails loud — the
  // low-level registry would silently update instead.
  let threw = ''
  try {
    ctx.fabricCompat.registerPatch({
      id: 'compat/greet-observe',
      target: { module: 'fabric-compat-target', versionRange: '^1.0.0', filePath: 'index.mjs', functionQuery },
      operation: 'after',
      handler() {},
    })
  } catch (error) {
    threw = error.message
  }
  check('registerPatch target-id conflict throws', threw.includes('already claimed'), true)
  threw = ''
  try {
    ctx.fabricCompat.registerPatch({
      id: 'compat/greet-upper',
      target: { module: 'fabric-compat-target', versionRange: '^1.0.0', filePath: 'index.mjs', functionQuery },
      operation: 'after',
      handler() {},
    })
  } catch (error) {
    threw = error.message
  }
  check('registerPatch self conflict throws', threw.includes('already claimed'), true)
  // Unregistering disables the handler; transformed code delegates to the
  // original body.
  ctx.fabricCompat.unregisterPatch(id)
  check('unregister delegates to original', mod.greet('world'), 'hello world')
  await ctx.fiber.dispose()
}
