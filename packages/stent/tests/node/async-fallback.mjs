/**
 * Child-process harness for the async `module.register` fallback: forces the
 * async hook path (STENT_FORCE_ASYNC_HOOKS=1) and runs the fixture
 * through the loader-thread hook entry. Runs against the BUILT lib (plain
 * Node, no tsx) because the hook entry is a build artifact the loader thread
 * resolves next to the built loader.
 */

import { installStentHooks, patchInstrumentation, retransformEsm, runtime } from '../../lib/index.js'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)

const patch = {
  id: 'async/before-add',
  target: {
    module: 'stent-target-fixture',
    versionRange: '^1.0.0',
    filePath: 'index.mjs',
    functionQuery: { functionName: 'add', kind: 'Sync' },
  },
  operation: 'before',
  handler(call) {
    call.arguments[0] = call.arguments[0] * 10
  },
}

const fixture = new URL('../fixtures/node_modules/stent-target-fixture/index.mjs', import.meta.url)

const disposeV1 = installStentHooks([patchInstrumentation(patch)])
const mod = await import(fixture.href)
runtime.register({ id: patch.id, target: patch.target, operation: patch.operation, priority: 0, enabled: false })
runtime.enable(patch.id, patch.handler)
const actual = mod.add(2, 3)
const ok = actual === 23
console.log(`${ok ? 'PASS' : 'FAIL'} async-fallback add(2,3): ${JSON.stringify(actual)}${ok ? '' : ' (expect 23)'}`)
if (!ok) process.exitCode = 1

// CommonJS never reaches the loader-thread load hook (plain require() skips
// it); the main-thread _compile patch must transform it on the async path.
const cjsPatch = {
  id: 'async/before-add-cjs',
  target: {
    module: 'stent-target-fixture',
    versionRange: '^1.0.0',
    filePath: 'index.cjs',
    functionQuery: { methodName: 'add', kind: 'Sync' },
  },
  operation: 'before',
  handler(call) {
    call.arguments[0] = call.arguments[0] * 10
  },
}

installStentHooks([patchInstrumentation(cjsPatch)])
const cjs = require(new URL('../fixtures/node_modules/stent-target-fixture/index.cjs', import.meta.url).pathname)
runtime.register({ id: cjsPatch.id, target: cjsPatch.target, operation: cjsPatch.operation, priority: 0, enabled: false })
runtime.enable(cjsPatch.id, cjsPatch.handler)
const cjsActual = cjs.add(2, 3)
const cjsOk = cjsActual === 23
console.log(`${cjsOk ? 'PASS' : 'FAIL'} async-fallback cjs add(2,3): ${JSON.stringify(cjsActual)}${cjsOk ? '' : ' (expect 23)'}`)
if (!cjsOk) process.exitCode = 1

// ESM re-transformation works on the async path too: the loader-thread entry
// reads the shared configuration on every load, so an HMR cycle (dispose the
// old installation, install a new one) re-transforms the evicted module with
// the new stack.
disposeV1()
const patchV2 = {
  id: 'async/esm-v2',
  target: patch.target,
  operation: 'before',
  handler(call) {
    call.arguments[0] = call.arguments[0] * 100
  },
}
installStentHooks([patchInstrumentation(patchV2)])
const reloaded = await retransformEsm(fixture.href)
runtime.register({ id: patchV2.id, target: patchV2.target, operation: patchV2.operation, priority: 0, enabled: false })
runtime.enable(patchV2.id, patchV2.handler)
const reloadedActual = reloaded.add(2, 3)
const reloadedOk = reloadedActual === 203
console.log(`${reloadedOk ? 'PASS' : 'FAIL'} async-fallback reloaded add(2,3): ${JSON.stringify(reloadedActual)}${reloadedOk ? '' : ' (expect 203)'}`)
if (!reloadedOk) process.exitCode = 1

// Cross-installation stacking matches the sync hook chain: the later
// installation wraps outermost regardless of priority, so its handler runs
// first (a globally merged priority sort would run the higher-priority A
// first and produce "hello worldAB" instead).
const greetTarget = {
  module: 'stent-target-fixture',
  versionRange: '^1.0.0',
  filePath: 'index.mjs',
  functionQuery: { functionName: 'greet', kind: 'Sync' },
}
const greetA = {
  id: 'async/greet-a',
  target: greetTarget,
  operation: 'before',
  priority: 10,
  handler(call) {
    call.arguments[0] = `${call.arguments[0]}A`
  },
}
const greetB = {
  id: 'async/greet-b',
  target: greetTarget,
  operation: 'before',
  priority: 0,
  handler(call) {
    call.arguments[0] = `${call.arguments[0]}B`
  },
}
installStentHooks([patchInstrumentation(greetA)])
installStentHooks([patchInstrumentation(greetB)])
const restacked = await retransformEsm(fixture.href)
for (const p of [greetA, greetB]) {
  runtime.register({ id: p.id, target: p.target, operation: p.operation, priority: p.priority, enabled: false })
  runtime.enable(p.id, p.handler)
}
const stackedActual = restacked.greet('world')
const stackedOk = stackedActual === 'hello worldBA'
console.log(`${stackedOk ? 'PASS' : 'FAIL'} async-fallback stacked greet(world): ${JSON.stringify(stackedActual)}${stackedOk ? '' : ' (expect "hello worldBA")'}`)
if (!stackedOk) process.exitCode = 1
