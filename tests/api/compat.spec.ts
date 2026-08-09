import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const runner = fileURLToPath(new URL('./child-runner-compat.mjs', import.meta.url))

/** Run one compat child case and return its stdout. */
function runCase(name: string): string {
  const result = spawnSync(process.execPath, ['--import', 'tsx/esm', runner, name], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    encoding: 'utf8',
    env: { ...process.env },
  })
  expect(result.status, `child ${name} exited 0\n${result.stdout}\n${result.stderr}`).toBe(0)
  return result.stdout
}

describe('FabricCompatService (child processes)', () => {
  it('observes a patch-backed target and stops on disposer', () => {
    const out = runCase('observe')
    expect(out).toContain('PASS observe results: "hello world,hello fabric"')
    expect(out).toContain('PASS observe seen: "hello world|hello fabric"')
    expect(out).toContain('PASS observe after dispose: 2')
  })

  it('fails loud when the bridge is not installed', () => {
    const out = runCase('noBridge')
    expect(out).toContain('PASS noBridge throws: true')
  })

  it('fails loud on an unknown target name', () => {
    const out = runCase('unknownTarget')
    expect(out).toContain('PASS unknown target throws: true')
  })

  it('registers runtime patches with an exclusive id namespace', () => {
    const out = runCase('registerPatch')
    expect(out).toContain('PASS registerPatch returns id: "compat/greet-upper"')
    expect(out).toContain('PASS registerPatch rewrites: "HELLO WORLD"')
    expect(out).toContain('PASS registerPatch target-id conflict throws: true')
    expect(out).toContain('PASS registerPatch self conflict throws: true')
    expect(out).toContain('PASS unregister delegates to original: "hello world"')
  })
})

describe('FabricCompatService (unit)', () => {
  it('rejects a patch id already claimed by a declared observation target, even without a bridge', async () => {
    // The conflict check runs before the bridge check, so a claimed id fails
    // loud in any process; the bridge check only guards actual registration.
    const { Context } = await import('cordis')
    const { FabricService } = await import('@deepseek-ai/dsh-cordis-fabric')
    const FabricCompatService = (await import('@deepseek-ai/dsh-cordis-fabric/api/compat')).default
    const ctx = new Context()
    await ctx.plugin(FabricService)
    await ctx.plugin(FabricCompatService, {
      targets: [{
        name: 'greet',
        patch: { id: 'compat/greet-observe', target: { module: 'fabric-compat-target', versionRange: '*', filePath: 'index.mjs' }, operation: 'after' },
      }],
    })
    expect(() => {
      ctx.fabricCompat.registerPatch({
        id: 'compat/greet-observe',
        target: { module: 'fabric-compat-target', versionRange: '*', filePath: 'index.mjs' },
        operation: 'after',
        handler: () => {},
      })
    }).toThrow(/already claimed/)
    await ctx.fiber.dispose()
  })
})
