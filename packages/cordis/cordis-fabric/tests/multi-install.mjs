/**
 * Multi-install regression harness: concurrent `installFabricHooks` calls must
 * transform through their own matchers, and disposing an installation must
 * not tear down later ones.
 */

import { installFabricHooks, patchInstrumentation, runtime } from '@deepseek-ai/dsh-cordis-fabric/src/index.ts'

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
} else {
  throw new Error(`unknown scenario ${scenario}`)
}
