/**
 * Child-process harness for the Fabric integration spec: each case runs in a
 * fresh Node process so the synchronous module hooks (which cannot be
 * unregistered) and the already-transformed module cache never leak between
 * cases. The child imports the Fabric source entry through the package's
 * `./src/*` export and is launched with tsx from the repository root.
 */

import { installFabricHooks, patchInstrumentation, retransformCommonJs, retransformEsm, runtime, GLOBAL_BRIDGE_KEY } from '@deepseek-ai/dsh-cordis-fabric/src/index.ts'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const fixtureUrl = new URL('./fixtures/node_modules/fabric-target-fixture/index.mjs', import.meta.url)

const target = {
  module: 'fabric-target-fixture',
  versionRange: '^1.0.0',
  filePath: 'index.mjs',
}

/** Report one check line; mark the process failed on mismatch. */
function check(label, actual, expected) {
  const ok = actual === expected
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expect ${JSON.stringify(expected)})`}`)
  if (!ok) process.exitCode = 1
}

/** Register and enable one patch, then run the given checks. */
async function withPatch(patch, checks) {
  installFabricHooks([patchInstrumentation(patch)])
  const mod = await import(fixtureUrl)
  runtime.register({ id: patch.id, target: patch.target, operation: patch.operation, priority: 0, enabled: false })
  runtime.enable(patch.id, patch.handler)
  await checks(mod)
}

const caseName = process.argv[2]

switch (caseName) {
  case 'before':
    await withPatch({
      id: 'e2e/before-add',
      target: { ...target, functionQuery: { functionName: 'add', kind: 'Sync' } },
      operation: 'before',
      handler(call) {
        call.arguments[0] = call.arguments[0] * 10
      },
    }, async (mod) => {
      check('before add(2,3)', mod.add(2, 3), 23)
    })
    break

  case 'after':
    await withPatch({
      id: 'e2e/after-greet',
      target: { ...target, functionQuery: { functionName: 'greet', kind: 'Sync' } },
      operation: 'after',
      handler(call) {
        return String(call.result).toUpperCase()
      },
    }, async (mod) => {
      check('after greet(world)', mod.greet('world'), 'HELLO WORLD')
    })
    break

  case 'around':
    await withPatch({
      id: 'e2e/around-add',
      target: { ...target, functionQuery: { functionName: 'add', kind: 'Sync' } },
      operation: 'around',
      handler(call, invoke) {
        if (call.arguments[0] === 99) return 'vetoed'
        return invoke()
      },
    }, async (mod) => {
      check('around add(99,1)', mod.add(99, 1), 'vetoed')
      check('around add(1,2)', mod.add(1, 2), 3)
    })
    break

  case 'replace':
    await withPatch({
      id: 'e2e/replace-multiply',
      target: {
        ...target,
        functionQuery: { className: 'Calc', methodName: 'multiply', kind: 'Sync' },
      },
      operation: 'replace',
      handler(call) {
        return call.arguments[0] * 1000
      },
    }, async (mod) => {
      check('replace Calc.multiply(5)', new mod.Calc(3).multiply(5), 5000)
    })
    break

  case 'afterAsync':
    await withPatch({
      id: 'e2e/after-fetch',
      target: { ...target, functionQuery: { functionName: 'fetchCount', kind: 'Async' } },
      operation: 'after',
      handler(call) {
        return String(call.result).toUpperCase()
      },
    }, async (mod) => {
      check('afterAsync fetchCount(ab)', await mod.fetchCount('ab'), 'COUNT:2')
    })
    break

  case 'afterAsyncMutate':
    await withPatch({
      id: 'e2e/after-fetch-mutate',
      target: { ...target, functionQuery: { functionName: 'fetchCount', kind: 'Async' } },
      operation: 'after',
      handler(call) {
        // In-place mutation with no replacement value must keep the result.
        call.result = String(call.result).toUpperCase()
      },
    }, async (mod) => {
      check('afterAsyncMutate fetchCount(ab)', await mod.fetchCount('ab'), 'COUNT:2')
    })
    break

  case 'afterMutate':
    await withPatch({
      id: 'e2e/after-mutate',
      target: { ...target, functionQuery: { functionName: 'greet', kind: 'Sync' } },
      operation: 'after',
      handler(call) {
        call.result = String(call.result).toUpperCase()
      },
    }, async (mod) => {
      check('afterMutate greet(world)', mod.greet('world'), 'HELLO WORLD')
    })
    break

  case 'asyncAwait':
    await withPatch({
      id: 'e2e/async-await',
      target: { ...target, functionQuery: { functionName: 'withAwait', kind: 'Async' } },
      operation: 'after',
      handler(call) {
        return call.result * 10
      },
    }, async (mod) => {
      check('asyncAwait withAwait(2)', await mod.withAwait(2), 50)
    })
    break

  case 'generator':
    {
      // Generators transform through delegation: without a handler publish
      // hands back the traced generator and `yield*` preserves iteration; a
      // before handler's argument mutation flows into the replayed generator.
      const patch = {
        id: 'e2e/generator-before',
        target: { ...target, functionQuery: { functionName: 'counter', kind: 'Sync' } },
        operation: 'before',
        handler(call) {
          call.arguments[0] = call.arguments[0] * 2
        },
      }
      installFabricHooks([patchInstrumentation(patch)])
      const mod = await import(fixtureUrl)
      check('generator untouched counter(3)', JSON.stringify([...mod.counter(3)]), JSON.stringify([0, 1, 2]))
      runtime.register({ id: patch.id, target: patch.target, operation: patch.operation, priority: 0, enabled: false })
      runtime.enable(patch.id, patch.handler)
      check('generator patched counter(3)', JSON.stringify([...mod.counter(3)]), JSON.stringify([0, 1, 2, 3, 4, 5]))
    }
    break

  case 'asyncGenerator':
    {
      const patch = {
        id: 'e2e/async-gen-before',
        target: { ...target, functionQuery: { functionName: 'asyncCounter', kind: 'Async' } },
        operation: 'before',
        handler(call) {
          call.arguments[0] = call.arguments[0] * 2
        },
      }
      installFabricHooks([patchInstrumentation(patch)])
      const mod = await import(fixtureUrl)
      runtime.register({ id: patch.id, target: patch.target, operation: patch.operation, priority: 0, enabled: false })
      runtime.enable(patch.id, patch.handler)
      const out = []
      for await (const value of mod.asyncCounter(3)) out.push(value)
      check('asyncGenerator patched asyncCounter(3)', JSON.stringify(out), JSON.stringify([0, 1, 2, 3, 4, 5]))
    }
    break

  case 'arrow':
    await withPatch({
      id: 'e2e/arrow-double',
      target: { ...target, functionQuery: { functionName: 'double', kind: 'Sync' } },
      operation: 'before',
      handler(call) {
        call.arguments[0] = call.arguments[0] * 10
      },
    }, async (mod) => {
      check('arrow double(2)', mod.double(2), 40)
    })
    break

  case 'arrowRest':
    await withPatch({
      id: 'e2e/arrow-rest',
      target: { ...target, functionQuery: { functionName: 'sumRest', kind: 'Sync' } },
      operation: 'before',
      handler(call) {
        call.arguments[0] = call.arguments[0] * 10
      },
    }, async (mod) => {
      check('arrowRest sumRest(1,2,3)', mod.sumRest(1, 2, 3), 15)
    })
    break

  case 'arrowDefault':
    await withPatch({
      id: 'e2e/arrow-default',
      target: { ...target, functionQuery: { functionName: 'withDefault', kind: 'Sync' } },
      operation: 'before',
      handler(call) {
        call.arguments[0] = call.arguments[0] * 10
      },
    }, async (mod) => {
      check('arrowDefault withDefault(2)', mod.withDefault(2), 30)
      check('arrowDefault withDefault(2,3)', mod.withDefault(2, 3), 23)
    })
    break

  case 'arrowDestructure':
    await withPatch({
      id: 'e2e/arrow-destructure',
      target: { ...target, functionQuery: { functionName: 'pickName', kind: 'Sync' } },
      operation: 'before',
      handler(call) {
        call.arguments[0].name = 'z'
      },
    }, async (mod) => {
      check('arrowDestructure pickName', mod.pickName({ name: 'n', meta: { tag: 't' } }, ['a', 'b', 'c']), 'z:t:a:2')
    })
    break

  case 'arrowOuterArgs':
    await withPatch({
      id: 'e2e/arrow-outer-args',
      target: { ...target, functionQuery: { functionName: 'inner', kind: 'Sync' } },
      operation: 'after',
      handler(call) {
        return String(call.result * 10)
      },
    }, async (mod) => {
      check('arrowOuterArgs callOuterArgs(7)', mod.callOuterArgs(7), '140')
    })
    break

  case 'priorityOrder':
    installFabricHooks([
      patchInstrumentation({
        id: 'e2e/prio-low',
        target: { ...target, functionQuery: { functionName: 'add', kind: 'Sync' } },
        operation: 'before',
        priority: 0,
      }),
      patchInstrumentation({
        id: 'e2e/prio-high',
        target: { ...target, functionQuery: { functionName: 'add', kind: 'Sync' } },
        operation: 'before',
        priority: 10,
      }),
    ])
    {
      const mod = await import(fixtureUrl)
      const order = []
      const functionQuery = { functionName: 'add', kind: 'Sync' }
      runtime.register({ id: 'e2e/prio-low', target: { ...target, functionQuery }, operation: 'before', priority: 0, enabled: false })
      runtime.enable('e2e/prio-low', () => { order.push('low') })
      runtime.register({ id: 'e2e/prio-high', target: { ...target, functionQuery }, operation: 'before', priority: 10, enabled: false })
      runtime.enable('e2e/prio-high', () => { order.push('high') })
      mod.add(2, 3)
      check('priority order add(2,3)', order.join(','), 'high,low')
    }
    break

  case 'priorityStable':
    installFabricHooks([
      patchInstrumentation({
        id: 'e2e/stable-first',
        target: { ...target, functionQuery: { functionName: 'add', kind: 'Sync' } },
        operation: 'before',
        priority: 5,
      }),
      patchInstrumentation({
        id: 'e2e/stable-second',
        target: { ...target, functionQuery: { functionName: 'add', kind: 'Sync' } },
        operation: 'before',
        priority: 5,
      }),
    ])
    {
      const mod = await import(fixtureUrl)
      const order = []
      const functionQuery = { functionName: 'add', kind: 'Sync' }
      runtime.register({ id: 'e2e/stable-first', target: { ...target, functionQuery }, operation: 'before', priority: 5, enabled: false })
      runtime.enable('e2e/stable-first', () => { order.push('first') })
      runtime.register({ id: 'e2e/stable-second', target: { ...target, functionQuery }, operation: 'before', priority: 5, enabled: false })
      runtime.enable('e2e/stable-second', () => { order.push('second') })
      mod.add(2, 3)
      // Equal priorities keep installation order: the later instrumentation
      // wraps the outermost layer, so its handler runs first.
      check('priority stable add(2,3)', order.join(','), 'second,first')
    }
    break

  case 'collide':
    await withPatch({
      id: 'e2e/collide-param',
      target: { ...target, functionQuery: { functionName: 'collide', kind: 'Sync' } },
      operation: 'before',
      handler(call) {
        call.arguments[0] = call.arguments[0] * 2
      },
    }, async (mod) => {
      check('collide param (2)', mod.collide(2), 5)
    })
    break

  case 'noBridge':
    {
      const patch = {
        id: 'e2e/no-bridge',
        target: { ...target, functionQuery: { functionName: 'add', kind: 'Sync' } },
        operation: 'before',
        handler(call) {
          call.arguments[0] = call.arguments[0] * 10
        },
      }
      installFabricHooks([patchInstrumentation(patch)])
      const mod = await import(fixtureUrl)
      runtime.register({ id: patch.id, target: patch.target, operation: patch.operation, priority: 0, enabled: false })
      runtime.enable(patch.id, patch.handler)
      // A browser-like scenario: the module is transformed at build time but
      // the bridge is not installed yet (no FabricService mounted). Calls must
      // fall back to the original body instead of throwing.
      delete globalThis[GLOBAL_BRIDGE_KEY]
      check('noBridge add(2,3) falls back', mod.add(2, 3), 5)
    }
    break

  case 'cjs':
    {
      const patch = {
        id: 'e2e/cjs-before',
        target: {
          module: 'fabric-target-fixture',
          versionRange: '^1.0.0',
          filePath: 'index.cjs',
          functionQuery: { methodName: 'add', kind: 'Sync' },
        },
        operation: 'before',
        handler(call) {
          call.arguments[0] = call.arguments[0] * 10
        },
      }
      installFabricHooks([patchInstrumentation(patch)])
      const cjs = require(new URL('./fixtures/node_modules/fabric-target-fixture/index.cjs', import.meta.url).pathname)
      check('cjs baseline add(2,3)', cjs.add(2, 3), 5)
      runtime.register({ id: patch.id, target: patch.target, operation: patch.operation, priority: 0, enabled: false })
      runtime.enable(patch.id, patch.handler)
      check('cjs patched add(2,3)', cjs.add(2, 3), 23)
    }
    break

  case 'retransform':
    {
      const cjsPath = new URL('./fixtures/node_modules/fabric-target-fixture/index.cjs', import.meta.url).pathname
      const cjsTarget = {
        module: 'fabric-target-fixture',
        versionRange: '^1.0.0',
        filePath: 'index.cjs',
        functionQuery: { methodName: 'add', kind: 'Sync' },
      }
      const patchV1 = {
        id: 'e2e/retransform-v1',
        target: cjsTarget,
        operation: 'before',
        handler(call) {
          call.arguments[0] = call.arguments[0] * 10
        },
      }
      const disposeV1 = installFabricHooks([patchInstrumentation(patchV1)])
      const m1 = require(cjsPath)
      runtime.register({ id: patchV1.id, target: patchV1.target, operation: patchV1.operation, priority: 0, enabled: false })
      runtime.enable(patchV1.id, patchV1.handler)
      check('retransform v1 add(2,3)', m1.add(2, 3), 23)
      const patchV2 = {
        id: 'e2e/retransform-v2',
        target: cjsTarget,
        operation: 'before',
        handler(call) {
          call.arguments[0] = call.arguments[0] * 100
        },
      }
      // HMR: the old installation is replaced by a new one (its load hook
      // becomes pass-through) before the module is re-evaluated.
      disposeV1()
      installFabricHooks([patchInstrumentation(patchV2)])
      runtime.register({ id: patchV2.id, target: patchV2.target, operation: patchV2.operation, priority: 0, enabled: false })
      runtime.enable(patchV2.id, patchV2.handler)
      // The already-evaluated module keeps the v1 transformation...
      check('retransform cached add(2,3)', m1.add(2, 3), 23)
      // ...until retransformCommonJs re-evaluates it under the v2 installation.
      const m2 = retransformCommonJs(cjsPath)
      check('retransform reloaded add(2,3)', m2.add(2, 3), 203)
    }
    break

  case 'retransformEsm':
    {
      const functionQuery = { functionName: 'add', kind: 'Sync' }
      const patchV1 = {
        id: 'e2e/esm-v1',
        target: { ...target, functionQuery },
        operation: 'before',
        handler(call) {
          call.arguments[0] = call.arguments[0] * 10
        },
      }
      const disposeV1 = installFabricHooks([patchInstrumentation(patchV1)])
      const m1 = await import(fixtureUrl)
      runtime.register({ id: patchV1.id, target: patchV1.target, operation: patchV1.operation, priority: 0, enabled: false })
      runtime.enable(patchV1.id, patchV1.handler)
      check('retransformEsm v1 add(2,3)', m1.add(2, 3), 23)
      const patchV2 = {
        id: 'e2e/esm-v2',
        target: { ...target, functionQuery },
        operation: 'before',
        handler(call) {
          call.arguments[0] = call.arguments[0] * 100
        },
      }
      // HMR: the old installation is replaced by a new one before the module
      // is evicted from Node's internal loadCache and re-imported.
      disposeV1()
      installFabricHooks([patchInstrumentation(patchV2)])
      runtime.register({ id: patchV2.id, target: patchV2.target, operation: patchV2.operation, priority: 0, enabled: false })
      runtime.enable(patchV2.id, patchV2.handler)
      check('retransformEsm cached add(2,3)', m1.add(2, 3), 23)
      const m2 = await retransformEsm(fixtureUrl.href)
      check('retransformEsm reloaded add(2,3)', m2.add(2, 3), 203)
    }
    break

  case 'retransformEsmRollback':
    {
      const rollbackUrl = new URL('./fixtures/node_modules/fabric-target-fixture/rollback.mjs', import.meta.url).href
      const m1 = await import(rollbackUrl)
      check('retransformEsmRollback initial value', m1.value, 1)
      process.env.DSH_FABRIC_ROLLBACK_BOOM = '1'
      let failed = false
      try {
        await retransformEsm(rollbackUrl)
      } catch {
        failed = true
      }
      check('retransformEsmRollback re-import fails', failed, true)
      delete process.env.DSH_FABRIC_ROLLBACK_BOOM
      // The evicted entry was restored: import() serves the previous instance
      // from the cache instead of re-evaluating (which would have thrown again).
      const m2 = await import(rollbackUrl)
      check('retransformEsmRollback restores cached instance', m2 === m1, true)
    }
    break

  case 'retransformCjsDual':
    {
      const cjsPath = new URL('./fixtures/node_modules/fabric-target-fixture/index.cjs', import.meta.url).pathname
      const cjsUrl = pathToFileURL(cjsPath).href
      const cjsTarget = {
        module: 'fabric-target-fixture',
        versionRange: '^1.0.0',
        filePath: 'index.cjs',
        functionQuery: { methodName: 'add', kind: 'Sync' },
      }
      const patchV1 = {
        id: 'e2e/dual-v1',
        target: cjsTarget,
        operation: 'before',
        handler(call) {
          call.arguments[0] = call.arguments[0] * 10
        },
      }
      const disposeV1 = installFabricHooks([patchInstrumentation(patchV1)])
      const esm = await import(cjsUrl)
      const cjs = require(cjsPath)
      runtime.register({ id: patchV1.id, target: patchV1.target, operation: patchV1.operation, priority: 0, enabled: false })
      runtime.enable(patchV1.id, patchV1.handler)
      check('retransformCjsDual shared instance', esm.add === cjs.add, true)
      check('retransformCjsDual v1 add(2,3)', cjs.add(2, 3), 23)
      const patchV2 = {
        id: 'e2e/dual-v2',
        target: cjsTarget,
        operation: 'before',
        handler(call) {
          call.arguments[0] = call.arguments[0] * 100
        },
      }
      disposeV1()
      installFabricHooks([patchInstrumentation(patchV2)])
      runtime.register({ id: patchV2.id, target: patchV2.target, operation: patchV2.operation, priority: 0, enabled: false })
      runtime.enable(patchV2.id, patchV2.handler)
      const m2 = retransformCommonJs(cjsPath)
      check('retransformCjsDual reloaded add(2,3)', m2.add(2, 3), 203)
      check('retransformCjsDual old instance detached', m2.add !== cjs.add, true)
      // The ESM graph must observe the fresh evaluation too: the loadCache
      // entry was evicted, so import() re-loads the file (reusing the fresh
      // require.cache entry the reload above created).
      const esm2 = await import(cjsUrl)
      check('retransformCjsDual esm re-import shares reload', esm2.add === m2.add, true)
      check('retransformCjsDual esm add(2,3)', esm2.add(2, 3), 203)
    }
    break

  default:
    throw new Error(`unknown case ${caseName}`)
}
