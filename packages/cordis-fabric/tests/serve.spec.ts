// The serveBrowserTransform primitive: boots the REAL webserver and proves
// the exact route outranks the module host's prefix table, serves the
// transformed fixture bundle (bridge marker present), leaves every other
// path to the fallback or a prefix route, rejects non-GET methods, and is
// loud by default when the selector rewrites nothing.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { FakeHttpServerService } from './fakes.ts'
import { serveBrowserTransform, type ServeBrowserTransformOptions } from '../src/index.ts'

const contexts: Context[] = []
const worlds: string[] = []

/** Boot a real webserver plus one served transform. */
async function boot(options: ServeBrowserTransformOptions, baseUrl = import.meta.url) {
  const ctx = new Context()
  ctx.baseUrl = baseUrl
  contexts.push(ctx)
  await ctx.plugin(FakeHttpServerService, { host: '127.0.0.1', port: 0 })
  serveBrowserTransform(ctx, options)
  return { ctx, port: ctx.httpServer.port }
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) {
    await ctx.fiber.dispose()
  }
  for (const world of worlds.splice(0)) {
    await rm(world, { recursive: true, force: true })
  }
})

/** The exact route the fixture bundle is served under. */
const ROUTE = '/plugins/@deepseek-ai/dsh-client-ui-conversation/client.js'

/** The neutralizer patch: rewrites the fixture's bashToolviewSample.apply. */
const neutralizer = {
  id: 'serve-test/neutralize-sample',
  target: {
    module: 'cordis-fabric',
    versionRange: '>=0.0.1-0',
    filePath: 'tests/fixtures/serve-target/browser.js',
    astQuery: 'VariableDeclarator[id.name="bashToolviewSample"] > ObjectExpression > Property[key.name="apply"] > FunctionExpression',
  },
  operation: 'around',
} as const

/** A patch whose selector cannot match anything in the fixture. */
const missing = {
  id: 'serve-test/missing',
  target: {
    module: 'cordis-fabric',
    versionRange: '>=0.0.1-0',
    filePath: 'tests/fixtures/serve-target/browser.js',
    functionQuery: { functionName: 'noSuchFunction', kind: 'Sync' },
  },
  operation: 'before',
} as const

/** A second patch on the SAME file (the plan sample), for the multi-patch cases. */
const planNeutralizer = {
  id: 'serve-test/neutralize-plan',
  target: {
    module: 'cordis-fabric',
    versionRange: '>=0.0.1-0',
    filePath: 'tests/fixtures/serve-target/browser.js',
    astQuery: 'VariableDeclarator[id.name="planToolviewSample"] > ObjectExpression > Property[key.name="apply"] > FunctionExpression',
  },
  operation: 'around',
} as const

describe('serveBrowserTransform', () => {
  it('requires the composition base URL at registration', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(FakeHttpServerService, { host: '127.0.0.1', port: 0 })
    expect(() => { serveBrowserTransform(ctx, { route: ROUTE, patch: neutralizer }) })
      .toThrow(/requires ctx\.baseUrl/)
  })

  it('resolves a target package from the composition dependency tree', async () => {
    const world = await mkdtemp(join(tmpdir(), 'fabric-serve-world-'))
    worlds.push(world)
    const packageDir = join(world, 'node_modules', '@fixture', 'browser-target')
    await mkdir(packageDir, { recursive: true })
    await writeFile(join(packageDir, 'package.json'), JSON.stringify({
      name: '@fixture/browser-target',
      version: '1.0.0',
      type: 'module',
    }))
    await writeFile(
      join(packageDir, 'browser.js'),
      'const fixtureSample = { apply: function () { return "raw" } };\nexport { fixtureSample };\n',
    )
    const configPath = join(world, 'cordis.yml')
    await writeFile(configPath, '')
    const patch = {
      id: 'serve-test/composition-anchor',
      target: {
        module: '@fixture/browser-target',
        versionRange: '>=0.0.1-0',
        filePath: 'browser.js',
        astQuery: 'VariableDeclarator[id.name="fixtureSample"] > ObjectExpression > Property[key.name="apply"] > FunctionExpression',
      },
      operation: 'around',
    } as const
    const { port } = await boot({ route: ROUTE, patch }, pathToFileURL(configPath).href)
    const res = await fetch(`http://127.0.0.1:${port}${ROUTE}`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('__dshFabricBridge')
  })

  it('serves the transformed bundle at the exact path', async () => {
    const { port } = await boot({ route: ROUTE, patch: neutralizer })
    const res = await fetch(`http://127.0.0.1:${port}${ROUTE}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/javascript')
    const body = await res.text()
    // The sample's apply was rewritten into a bridge call: the served bytes
    // carry the fabric bridge handle, and the sample name is preserved.
    expect(body).toContain('__dshFabricBridge')
    expect(body).toContain('bashToolviewSample')
  })

  it('leaves the source-map path to the fallback', async () => {
    const { port } = await boot({ route: ROUTE, patch: neutralizer })
    const res = await fetch(`http://127.0.0.1:${port}${ROUTE}.map`)
    // No fallback seat in this harness: 404 — the point is the primitive
    // claims ONLY the exact bundle path.
    expect(res.status).toBe(404)
  })

  it('leaves every other /plugins path to the fallback', async () => {
    const { port } = await boot({ route: ROUTE, patch: neutralizer })
    const res = await fetch(`http://127.0.0.1:${port}/plugins/@deepseek-ai/dsh-client-connection/client.js`)
    expect(res.status).toBe(404)
  })

  it('the exact route outranks a later prefix route on the same path space', async () => {
    const { ctx, port } = await boot({ route: ROUTE, patch: neutralizer })
    // A prefix route registered AFTER the exact one (the module host's shape).
    ctx.httpServer.register({ kind: 'prefix', path: '/plugins', handler: async (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      res.end('prefix-owner')
    } })
    const exact = await fetch(`http://127.0.0.1:${port}${ROUTE}`)
    expect(await exact.text()).toContain('__dshFabricBridge')
    const other = await fetch(`http://127.0.0.1:${port}/plugins/@deepseek-ai/dsh-client-connection/client.js`)
    expect(await other.text()).toBe('prefix-owner')
  })

  it('rejects non-GET methods on the exact route', async () => {
    const { port } = await boot({ route: ROUTE, patch: neutralizer })
    const res = await fetch(`http://127.0.0.1:${port}${ROUTE}`, { method: 'POST' })
    expect(res.status).toBe(405)
  })

  it('fails loud with a 500 when the selector rewrites nothing (default)', async () => {
    const { port } = await boot({ route: ROUTE, patch: missing })
    const res = await fetch(`http://127.0.0.1:${port}${ROUTE}`)
    expect(res.status).toBe(500)
    expect(await res.text()).toContain('serve-test/missing')
  })

  it('serves the raw bundle when a miss degrades with fallback raw', async () => {
    const { port } = await boot({ route: ROUTE, patch: missing, fallback: 'raw' })
    const res = await fetch(`http://127.0.0.1:${port}${ROUTE}`)
    expect(res.status).toBe(200)
    const body = await res.text()
    // Untouched: no bridge marker, no rewritten apply.
    expect(body).not.toContain('__dshFabricBridge')
    expect(body).toContain('bashToolviewSample')
  })

  it('answers 404 when the bundle file cannot be read', async () => {
    const { port } = await boot({
      route: ROUTE,
      patch: { ...neutralizer, target: { ...neutralizer.target, filePath: 'tests/fixtures/serve-target/nope.js' } },
    })
    const res = await fetch(`http://127.0.0.1:${port}${ROUTE}`)
    expect(res.status).toBe(404)
  })

  it('stacks several patches on the same file under one route', async () => {
    const { port } = await boot({ route: ROUTE, patch: [neutralizer, planNeutralizer] })
    const res = await fetch(`http://127.0.0.1:${port}${ROUTE}`)
    expect(res.status).toBe(200)
    const body = await res.text()
    // Both rewrites landed: each patch id names its emitted bridge channel.
    expect(body).toContain('serve-test/neutralize-sample')
    expect(body).toContain('serve-test/neutralize-plan')
    expect(body).toContain('__dshFabricBridge')
  })

  it('fails loud naming every unbound patch when only some stack', async () => {
    const { port } = await boot({ route: ROUTE, patch: [neutralizer, missing] })
    const res = await fetch(`http://127.0.0.1:${port}${ROUTE}`)
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).toContain('serve-test/missing')
    expect(text).not.toContain('serve-test/neutralize-sample')
  })

  it('degrades to the raw bundle when any stacked patch misses with fallback raw', async () => {
    const { port } = await boot({ route: ROUTE, patch: [neutralizer, missing], fallback: 'raw' })
    const res = await fetch(`http://127.0.0.1:${port}${ROUTE}`)
    expect(res.status).toBe(200)
    const body = await res.text()
    // Untouched: no bridge marker, no rewritten apply.
    expect(body).not.toContain('__dshFabricBridge')
  })

  it('rejects patches targeting different files at registration', async () => {
    const ctx = new Context()
    ctx.baseUrl = import.meta.url
    contexts.push(ctx)
    await ctx.plugin(FakeHttpServerService, { host: '127.0.0.1', port: 0 })
    expect(() => {
      serveBrowserTransform(ctx, {
        route: ROUTE,
        patch: [neutralizer, { ...neutralizer, id: 'serve-test/other-file', target: { ...neutralizer.target, filePath: 'tests/fixtures/serve-target/nope.js' } }],
      })
    }).toThrow(/must all target the same file/)
  })

  it('disposing the owning fiber removes the route', async () => {
    const ctx = new Context()
    ctx.baseUrl = import.meta.url
    contexts.push(ctx)
    await ctx.plugin(FakeHttpServerService, { host: '127.0.0.1', port: 0 })
    // The route owner lives on its own plugin fiber, so disposing it removes
    // the route while the webserver keeps serving.
    const routeFiber = await ctx.plugin((c) => {
      serveBrowserTransform(c, { route: ROUTE, patch: neutralizer })
    })
    const port = ctx.httpServer.port
    expect((await fetch(`http://127.0.0.1:${port}${ROUTE}`)).status).toBe(200)
    await routeFiber.dispose()
    expect((await fetch(`http://127.0.0.1:${port}${ROUTE}`)).status).toBe(404)
  })
})
