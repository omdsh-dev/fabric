/**
 * Local host-service fakes for the cordis-fabric test suite.
 *
 * The authoritative DSH webserver (`httpServer`) is a private package that
 * cannot be installed from the npm registry. The serve suite exercises the
 * exact-over-prefix route contract through this repository-local structural
 * fake over a real `node:http` listener.
 * @module tests/fakes
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'

/** One registered webserver route. */
export interface FakeRoute {
  readonly kind: 'exact' | 'prefix'
  readonly path: string
  readonly handler: (req: IncomingMessage, res: ServerResponse) => void
}

/**
 * Cordis plugin providing a fake `httpServer` service over a real
 * `node:http` listener. Exact routes outrank prefix routes regardless of
 * registration order, matching the webserver contract the serve primitive
 * relies on.
 * @param ctx - Cordis context that owns the service.
 * @param config - listen host and port (`port: 0` picks a free port).
 */
export async function FakeHttpServerService(
  ctx: Context,
  config: { host: string; port: number },
): Promise<void> {
  const routes: FakeRoute[] = []
  const server = createServer((req, res) => {
    const url = req.url ?? ''
    const exact = routes.find(route => route.kind === 'exact' && route.path === url)
    if (exact !== undefined) {
      exact.handler(req, res)
      return
    }
    const prefix = routes.find(route => route.kind === 'prefix' && url.startsWith(route.path))
    if (prefix !== undefined) {
      prefix.handler(req, res)
      return
    }
    res.writeHead(404)
    res.end()
  })
  ctx.provide('httpServer', {
    get port(): number {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        throw new Error('fake httpServer: not listening')
      }
      return address.port
    },
    register(route: FakeRoute): () => void {
      routes.push(route)
      return () => {
        const index = routes.indexOf(route)
        if (index >= 0) routes.splice(index, 1)
      }
    },
  })
  ctx.effect(() => () => { server.close() }, 'fake-httpServer.close')
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(config.port, config.host, () => resolve())
  })
}
