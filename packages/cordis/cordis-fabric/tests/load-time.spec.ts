import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const runner = fileURLToPath(new URL('./child-runner.mjs', import.meta.url))

/** Run one Fabric child case and return its stdout. */
function runCase(name: string): string {
  const result = spawnSync(process.execPath, ['--import', 'tsx/esm', runner, name], {
    cwd: fileURLToPath(new URL('../../..', import.meta.url)),
    encoding: 'utf8',
    env: { ...process.env },
  })
  expect(result.status, `child ${name} exited 0\n${result.stdout}\n${result.stderr}`).toBe(0)
  return result.stdout
}

describe('cordis-fabric load-time transformation (child processes)', () => {
  it('before rewrites arguments before the original body', () => {
    const out = runCase('before')
    expect(out).toContain('PASS before add(2,3): 23')
  })

  it('after rewrites the successful result', () => {
    const out = runCase('after')
    expect(out).toContain('PASS after greet(world): "HELLO WORLD"')
  })

  it('around can veto the original body or delegate', () => {
    const out = runCase('around')
    expect(out).toContain('PASS around add(99,1): "vetoed"')
    expect(out).toContain('PASS around add(1,2): 3')
  })

  it('replace owns the call on a class method', () => {
    const out = runCase('replace')
    expect(out).toContain('PASS replace Calc.multiply(5): 5000')
  })

  it('after rewrites async results after settlement', () => {
    const out = runCase('afterAsync')
    expect(out).toContain('PASS afterAsync fetchCount(ab): "COUNT:2"')
  })

  it('keeps the result when a sync after handler mutates in place', () => {
    const out = runCase('afterMutate')
    expect(out).toContain('PASS afterMutate greet(world): "HELLO WORLD"')
  })

  it('keeps the settled value when an async after handler mutates in place', () => {
    const out = runCase('afterAsyncMutate')
    expect(out).toContain('PASS afterAsyncMutate fetchCount(ab): "COUNT:2"')
  })

  it('transforms async functions whose body awaits', () => {
    const out = runCase('asyncAwait')
    expect(out).toContain('PASS asyncAwait withAwait(2): 50')
  })

  it('leaves generator functions untouched', () => {
    const out = runCase('generator')
    expect(out).toContain('PASS generator counter(3) untouched: "[0,1,2]"')
  })

  it('transforms arrow functions with plain identifier parameters', () => {
    const out = runCase('arrow')
    expect(out).toContain('PASS arrow double(2): 40')
  })

  it('orders per-function handlers by priority, higher first', () => {
    const out = runCase('priorityOrder')
    expect(out).toContain('PASS priority order add(2,3): "high,low"')
  })

  it('keeps installation order for equal priorities', () => {
    const out = runCase('priorityStable')
    expect(out).toContain('PASS priority stable add(2,3): "second,first"')
  })

  it('handles arrow parameters that collide with injected names', () => {
    const out = runCase('collide')
    expect(out).toContain('PASS collide param (2): 5')
  })

  it('falls back to the original body when the bridge is absent', () => {
    const out = runCase('noBridge')
    expect(out).toContain('PASS noBridge add(2,3) falls back: 5')
  })

  it('transforms CommonJS modules reached through require()', () => {
    const out = runCase('cjs')
    expect(out).toContain('PASS cjs baseline add(2,3): 5')
    expect(out).toContain('PASS cjs patched add(2,3): 23')
  })

  it('re-transforms an already-evaluated CommonJS module (HMR invalidation)', () => {
    const out = runCase('retransform')
    expect(out).toContain('PASS retransform v1 add(2,3): 23')
    expect(out).toContain('PASS retransform cached add(2,3): 23')
    expect(out).toContain('PASS retransform reloaded add(2,3): 203')
  })
})
