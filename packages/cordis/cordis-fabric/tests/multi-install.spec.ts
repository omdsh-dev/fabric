import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const runner = fileURLToPath(new URL('./multi-install.mjs', import.meta.url))

function runScenario(name: string): string {
  const result = spawnSync(process.execPath, ['--import', 'tsx/esm', runner, name], {
    cwd: fileURLToPath(new URL('../../..', import.meta.url)),
    encoding: 'utf8',
  })
  expect(result.status, `scenario ${name} exited 0\n${result.stdout}\n${result.stderr}`).toBe(0)
  return result.stdout
}

describe('cordis-fabric concurrent installations (child processes)', () => {
  it('transforms through each installation\'s own matcher', () => {
    const out = runScenario('concurrent')
    expect(out).toContain('PASS concurrent add(2,3): 23')
    expect(out).toContain('PASS concurrent greet(world): "hello WORLD"')
  })

  it('disposing an earlier installation leaves later ones intact', () => {
    const out = runScenario('disposeFirst')
    expect(out).toContain('PASS after disposeA add(2,3): 5')
    expect(out).toContain('PASS after disposeA greet(world): "hello WORLD"')
  })
})
