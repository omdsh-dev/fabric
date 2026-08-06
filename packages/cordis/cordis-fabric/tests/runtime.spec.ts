import { runtime, validatePatchId, FabricService } from '@deepseek-ai/dsh-cordis-fabric'
import { publish, subscribeBridge } from '@deepseek-ai/dsh-cordis-fabric/src/bridge.ts'
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { Context } from 'cordis'

const baseInfo = (id: string, enabled = false) => ({
  id,
  target: { module: 'pkg', versionRange: '*', filePath: 'index.js' },
  operation: 'before' as const,
  priority: 0,
  enabled,
})

describe('fabric runtime registry', () => {
  beforeEach(() => {
    for (const info of runtime.list()) runtime.remove(info.id)
  })

  it('registers, enables, disables, and removes patches', () => {
    expect(runtime.register(baseInfo('a'))).toBe(true)
    expect(runtime.isEnabled('a')).toBe(false)
    const handler = () => {}
    runtime.enable('a', handler)
    expect(runtime.isEnabled('a')).toBe(true)
    runtime.disable('a')
    expect(runtime.isEnabled('a')).toBe(false)
    runtime.remove('a')
    expect(runtime.isEnabled('a')).toBe(false)
    expect(runtime.list()).toHaveLength(0)
  })

  it('re-registering an id keeps metadata but reports not-first', () => {
    runtime.register(baseInfo('a'))
    expect(runtime.register(baseInfo('a'))).toBe(false)
  })

  it('list() orders by priority then id and reflects enabled state', () => {
    runtime.register({ ...baseInfo('b', false), priority: 2 })
    runtime.register({ ...baseInfo('a', false), priority: 1 })
    runtime.register({ ...baseInfo('c', false), priority: 1 })
    runtime.enable('c', () => {})
    const ids = runtime.list().map(info => info.id)
    expect(ids).toEqual(['a', 'c', 'b'])
    expect(runtime.list().find(info => info.id === 'c')?.enabled).toBe(true)
  })

  it('enable on an unregistered id throws', () => {
    expect(() => { runtime.enable('nope', () => {}) }).toThrow(/unregistered/)
  })

  it('enable with a non-function handler fails loud instead of crashing in dispatch', () => {
    runtime.register(baseInfo('a'))
    expect(() => { runtime.enable('a', 42 as never) }).toThrow(/must be a function/)
    expect(runtime.isEnabled('a')).toBe(false)
  })

  it('validatePatchId rejects unsafe ids and accepts safe ones', () => {
    for (const bad of ['', 'has space', '汉字', 'a'.repeat(121), 'semi;colon']) {
      expect(() => { validatePatchId(bad) }).toThrow(/patch id/)
    }
    expect(() => { validatePatchId('vendor/pkg:patch-name_1.2') }).not.toThrow()
  })

  it('rejects a second replace patch on the same target', () => {
    const target = { module: 'pkg', versionRange: '*', filePath: 'index.js', functionQuery: { functionName: 'run', kind: 'Sync' as const } }
    runtime.register({ id: 'r1', target, operation: 'replace', priority: 0, enabled: false })
    expect(() => {
      runtime.register({ id: 'r2', target, operation: 'replace', priority: 0, enabled: false })
    }).toThrow(/conflicts with existing replace patch "r1"/)
    // Re-registering the same id is not a conflict, and a non-replace patch on
    // the same target is allowed (stacking semantics).
    expect(runtime.register({ id: 'r1', target, operation: 'replace', priority: 0, enabled: false })).toBe(false)
    runtime.register({ id: 'b1', target, operation: 'before', priority: 0, enabled: false })
  })

  it('re-registering into an already-claimed replace target still fails', () => {
    const target = { module: 'pkg', versionRange: '*', filePath: 'index.js', functionQuery: { functionName: 'run', kind: 'Sync' as const } }
    // A patch first registered as `before` must not bypass the exclusive
    // replace scan by re-registering the same id as `replace`.
    runtime.register({ id: 'x1', target, operation: 'before', priority: 0, enabled: false })
    runtime.register({ id: 'z1', target, operation: 'replace', priority: 0, enabled: false })
    expect(() => {
      runtime.register({ id: 'x1', target, operation: 'replace', priority: 0, enabled: false })
    }).toThrow(/conflicts with existing replace patch "z1"/)
  })

  it('allows replace patches on different targets', () => {
    runtime.register({
      id: 'x1', target: { module: 'pkg', versionRange: '*', filePath: 'a.js', functionQuery: { functionName: 'f', kind: 'Sync' as const } },
      operation: 'replace', priority: 0, enabled: false,
    })
    runtime.register({
      id: 'x2', target: { module: 'pkg', versionRange: '*', filePath: 'b.js', functionQuery: { functionName: 'g', kind: 'Sync' as const } },
      operation: 'replace', priority: 0, enabled: false,
    })
  })
})

describe('FabricService', () => {
  it('registers a patch tied to the fiber effect', () => {
    const ctx = new Context()
    const service = new FabricService(ctx)
    expect(service).toBeInstanceOf(FabricService)
    const id = service.register({
      id: 'service/a',
      target: { module: 'pkg', versionRange: '*', filePath: 'index.js', functionQuery: { functionName: 'f', kind: 'Sync' as const } },
      operation: 'after',
      handler: () => {},
    })
    expect(id).toBe('service/a')
    expect(service.list().some(info => info.id === id)).toBe(true)
  })

  it('is reachable as ctx.fabric when mounted as a plugin', async () => {
    const ctx = new Context()
    await ctx.plugin(FabricService)
    expect(ctx.fabric).toBeInstanceOf(FabricService)
    ctx.fabric.register({
      id: 'service/b',
      target: { module: 'pkg', versionRange: '*', filePath: 'index.js', functionQuery: { functionName: 'g', kind: 'Sync' as const } },
      operation: 'before',
      handler: () => {},
    })
    expect(ctx.fabric.list().some(info => info.id === 'service/b')).toBe(true)
  })

  it('rejects invalid patches with descriptive errors', () => {
    const ctx = new Context()
    const service = new FabricService(ctx)
    expect(() => service.register({
      id: 'x',
      target: { module: '', versionRange: '*', filePath: 'f.js' },
      operation: 'before',
      handler: () => {},
    })).toThrow(/module/)
    expect(() => service.register({
      id: 'x',
      target: { module: 'm', versionRange: '*', filePath: 'f.js' },
      operation: 'sideways' as never,
      handler: () => {},
    })).toThrow(/operation/)
    expect(() => service.register({
      id: 'x',
      target: { module: 'm', versionRange: '*', filePath: 'f.js' },
      operation: 'before',
      handler: undefined as never,
    })).toThrow(/handler/)
    expect(() => service.register({
      id: 'x',
      target: { module: 'm', versionRange: '*', filePath: 'f.js' },
      operation: 'before',
      handler: () => {},
    })).toThrow(/functionQuery or astQuery/)
    expect(() => service.register({
      id: 'x',
      target: { module: 'm', versionRange: '*', filePath: 'f.js', astQuery: '   ' },
      operation: 'before',
      handler: () => {},
    })).toThrow(/astQuery must not be blank/)
  })
})

describe('bridge multi-listener dispatch', () => {
  const disposers: Array<() => void> = []
  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose()
  })

  const call = (id: string) => ({
    id,
    operation: 'before' as const,
    arguments: [1],
    self: undefined,
    traced: () => 'traced',
  })

  it('runs every listener in registration order and returns the last result', () => {
    const seen: string[] = []
    disposers.push(subscribeBridge(() => { seen.push('first'); return 'first-result' }))
    disposers.push(subscribeBridge(() => { seen.push('second'); return 'second-result' }))
    expect(publish(call('bridge/multi'))).toBe('second-result')
    expect(seen).toEqual(['first', 'second'])
  })

  it('disposed listeners stop receiving calls; the traced fallback takes over', () => {
    const dispose = subscribeBridge(() => 'handled')
    dispose()
    expect(publish(call('bridge/none'))).toBe('traced')
  })
})
