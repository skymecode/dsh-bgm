import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { BgmHelperManager } from './helper-manager.ts'

export const BGM_STATE_PATH = '/api/bgm/state'
export const BGM_EVENTS_PATH = '/api/bgm/events'
const HEARTBEAT_MS = 15_000

function isLoopback(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function rejectRemote(res: ServerResponse): void {
  res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ error: 'forbidden: loopback-only' }))
}

/** Register the state snapshot and live SSE stream. */
export function registerBgmRoutes(ctx: Context, manager: BgmHelperManager): () => void {
  const disposeState = ctx.webServer.register({
    kind: 'exact',
    path: BGM_STATE_PATH,
    handler(req, res) {
      if (!isLoopback(req)) return rejectRemote(res)
      if (req.method !== 'GET') {
        res.writeHead(405)
        res.end()
        return
      }
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(JSON.stringify(manager.snapshot()))
    },
  })

  const disposeEvents = ctx.webServer.register({
    kind: 'exact',
    path: BGM_EVENTS_PATH,
    handler(req, res) {
      if (!isLoopback(req)) return rejectRemote(res)
      if (req.method !== 'GET') {
        res.writeHead(405)
        res.end()
        return
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      })
      res.write(': connected\n\n')
      const disposeSubscription = manager.subscribe((snapshot) => {
        if (!res.writableEnded) res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`)
      })
      const heartbeat = setInterval(() => {
        if (!res.writableEnded) res.write(': heartbeat\n\n')
      }, HEARTBEAT_MS)
      const close = (): void => {
        clearInterval(heartbeat)
        disposeSubscription()
      }
      req.once('close', close)
      res.once('close', close)
    },
  })

  return () => {
    disposeEvents()
    disposeState()
  }
}
