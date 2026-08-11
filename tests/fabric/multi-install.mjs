/**
 * Multi-install regression harness: concurrent `installFabricHooks` calls must
 * transform through their own matchers, and disposing an installation must
 * not tear down later ones.
 */

import { createRequire } from 'node:module'
import { installFabricHooks, patchInstrumentation, runtime } from '../../src/index.ts'

const require = createRequire(import.meta.url)

const target = {
  module: 'fabric-target-fixture',
  versionRange: '^1.0.0',
  filePath: 'index.mjs',
}

const patchA = {
  id: 'multi/before-add',
  target: { ...target, functionQuery: { functionName: 'add', kind: 'Sync' } },
  operation: 'before',
  handler(call) {
    call.arguments[0] = call.arguments[0] * 10
  },
}
const patchB = {
  id: 'multi/before-greet',
  target: { ...target, functionQuery: { functionName: 'greet', kind: 'Sync' } },
  operation: 'before',
  handler(call) {
    call.arguments[0] = String(call.arguments[0]).toUpperCase()
  },
}

const fixture = new URL('./fixtures/node_modules/fabric-target-fixture/index.mjs', import.meta.url)
const cjsFixture = new URL('./fixtures/node_modules/fabric-target-fixture/index.cjs', import.meta.url)

/** CJS patches mirroring patchA/patchB, targeting the object-literal methods. */
const cjsTarget = {
  module: 'fabric-target-fixture',
  versionRange: '^1.0.0',
  filePath: 'index.cjs',
}
const cjsPatchA = {
  id: 'multi/cjs-before-add',
  target: { ...cjsTarget, functionQuery: { methodName: 'add', kind: 'Sync' } },
  operation: 'before',
  handler(call) {
    call.arguments[0] = call.arguments[0] * 10
  },
}
const cjsPatchB = {
  id: 'multi/cjs-before-greet',
  target: { ...cjsTarget, functionQuery: { methodName: 'greet', kind: 'Sync' } },
  operation: 'before',
  handler(call) {
    call.arguments[0] = String(call.arguments[0]).toUpperCase()
  },
}
function check(label, actual, expected) {
  const ok = actual === expected
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expect ${JSON.stringify(expected)})`}`)
  if (!ok) process.exitCode = 1
}
function reg(p) {
  runtime.register({ id: p.id, target: p.target, operation: p.operation, priority: 0, enabled: false })
  runtime.enable(p.id, p.handler)
}

const scenario = process.argv[2]

if (scenario === 'concurrent') {
  // Two live installations transform through their own matchers.
  installFabricHooks([patchInstrumentation(patchA)])
  installFabricHooks([patchInstrumentation(patchB)])
  const mod = await import(fixture.href)
  reg(patchA)
  reg(patchB)
  check('concurrent add(2,3)', mod.add(2, 3), 23)
  check('concurrent greet(world)', mod.greet('world'), 'hello WORLD')
} else if (scenario === 'disposeFirst') {
  // Disposing the first installation leaves the second fully functional and
  // the first's hooks inert: the module loads transformed only by B.
  const disposeA = installFabricHooks([patchInstrumentation(patchA)])
  disposeA()
  installFabricHooks([patchInstrumentation(patchB)])
  const mod = await import(fixture.href)
  reg(patchB)
  check('after disposeA add(2,3)', mod.add(2, 3), 5)
  check('after disposeA greet(world)', mod.greet('world'), 'hello WORLD')
} else if (scenario === 'concurrentCjs') {
  // Two live installations both transform plain-require CommonJS through the
  // shared `_compile` chain: patch A (installed first) must stay effective
  // after patch B's installation lands.
  installFabricHooks([patchInstrumentation(cjsPatchA)])
  installFabricHooks([patchInstrumentation(cjsPatchB)])
  const mod = require(cjsFixture.pathname)
  reg(cjsPatchA)
  reg(cjsPatchB)
  check('concurrent cjs add(2,3)', mod.add(2, 3), 23)
  check('concurrent cjs greet(world)', mod.greet('world'), 'hello WORLD')
} else if (scenario === 'disposeFirstCjs') {
  // The disposed installation drops out of the CJS chain; the surviving one
  // still transforms.
  const disposeA = installFabricHooks([patchInstrumentation(cjsPatchA)])
  disposeA()
  installFabricHooks([patchInstrumentation(cjsPatchB)])
  const mod = require(cjsFixture.pathname)
  reg(cjsPatchB)
  check('after disposeA cjs add(2,3)', mod.add(2, 3), 5)
  check('after disposeA cjs greet(world)', mod.greet('world'), 'hello WORLD')
} else if (scenario === 'stackedGreet') {
  // Cross-installation stacking on one function: the later installation wraps
  // outermost regardless of priority, so its before handler runs first.
  const greetA = {
    id: 'multi/greet-a',
    target: { ...target, functionQuery: { functionName: 'greet', kind: 'Sync' } },
    operation: 'before',
    priority: 10,
    handler(call) {
      call.arguments[0] = `${call.arguments[0]}A`
    },
  }
  const greetB = {
    id: 'multi/greet-b',
    target: { ...target, functionQuery: { functionName: 'greet', kind: 'Sync' } },
    operation: 'before',
    priority: 0,
    handler(call) {
      call.arguments[0] = `${call.arguments[0]}B`
    },
  }
  installFabricHooks([patchInstrumentation(greetA)])
  installFabricHooks([patchInstrumentation(greetB)])
  const mod = await import(fixture.href)
  reg(greetA)
  reg(greetB)
  check('stacked greet(world)', mod.greet('world'), 'hello worldBA')
} else {
  throw new Error(`unknown scenario ${scenario}`)
}
