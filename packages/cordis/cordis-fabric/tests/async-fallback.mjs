/**
 * Child-process harness for the async `module.register` fallback: forces the
 * async hook path (DSH_FABRIC_FORCE_ASYNC_HOOKS=1) and runs the fixture
 * through the loader-thread hook entry. Runs against the BUILT lib (plain
 * Node, no tsx) because the hook entry is a build artifact the loader thread
 * resolves next to the built loader.
 */

import { installFabricHooks, patchInstrumentation, runtime } from '@deepseek-ai/dsh-cordis-fabric'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)

const patch = {
  id: 'async/before-add',
  target: {
    module: 'fabric-target-fixture',
    versionRange: '^1.0.0',
    filePath: 'index.mjs',
    functionQuery: { functionName: 'add', kind: 'Sync' },
  },
  operation: 'before',
  handler(call) {
    call.arguments[0] = call.arguments[0] * 10
  },
}

const fixture = new URL('./fixtures/node_modules/fabric-target-fixture/index.mjs', import.meta.url)

installFabricHooks([patchInstrumentation(patch)])
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

installFabricHooks([patchInstrumentation(cjsPatch)])
const cjs = require(new URL('./fixtures/node_modules/fabric-target-fixture/index.cjs', import.meta.url).pathname)
runtime.register({ id: cjsPatch.id, target: cjsPatch.target, operation: cjsPatch.operation, priority: 0, enabled: false })
runtime.enable(cjsPatch.id, cjsPatch.handler)
const cjsActual = cjs.add(2, 3)
const cjsOk = cjsActual === 23
console.log(`${cjsOk ? 'PASS' : 'FAIL'} async-fallback cjs add(2,3): ${JSON.stringify(cjsActual)}${cjsOk ? '' : ' (expect 23)'}`)
if (!cjsOk) process.exitCode = 1
