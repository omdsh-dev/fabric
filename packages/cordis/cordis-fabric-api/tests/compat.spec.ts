import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const runner = fileURLToPath(new URL('./child-runner-compat.mjs', import.meta.url))

/** Run one compat child case and return its stdout. */
function runCase(name: string): string {
  const result = spawnSync(process.execPath, ['--import', 'tsx/esm', runner, name], {
    cwd: fileURLToPath(new URL('../../..', import.meta.url)),
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
})
