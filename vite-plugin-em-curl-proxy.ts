/**
 * 本机 Vite 开发时，用系统 curl 转发东财行情，避免 Node http-proxy
 * 访问 push2his / push2 时频繁 socket hang up / schannel 掐断。
 */
import { execFile } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { promisify } from 'node:util'
import type { Connect, Plugin, PreviewServer, ViteDevServer } from 'vite'

const execFileAsync = promisify(execFile)
const CURL = process.platform === 'win32' ? 'curl.exe' : 'curl'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const ROUTES: Array<{ prefix: string; origin: string }> = [
  { prefix: '/api/em-push2', origin: 'https://push2.eastmoney.com' },
  { prefix: '/api/eastmoney', origin: 'https://push2his.eastmoney.com' },
]

function send(res: ServerResponse, status: number, body: string, contentType: string) {
  res.statusCode = status
  res.setHeader('Content-Type', contentType)
  res.end(body)
}

async function curlGet(url: string): Promise<string> {
  const args = [
    '-sS',
    '--connect-timeout',
    '20',
    '--max-time',
    '60',
    '-L',
    '-H',
    `User-Agent: ${UA}`,
    '-H',
    'Referer: https://quote.eastmoney.com/',
    url,
  ]
  const { stdout } = await execFileAsync(CURL, args, {
    maxBuffer: 32 * 1024 * 1024,
    encoding: 'utf8',
    windowsHide: true,
  })
  return stdout
}

function attach(middlewares: Connect.Server) {
  middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const raw = req.url ?? ''
    if (req.method !== 'GET') return next()

    const rule = ROUTES.find((r) => raw.startsWith(r.prefix))
    if (!rule) return next()

    const pathAndQuery = raw.slice(rule.prefix.length) || '/'
    const dest = `${rule.origin}${pathAndQuery}`

    try {
      let lastErr: unknown
      let body = ''
      for (let i = 0; i < 3; i++) {
        try {
          body = await curlGet(dest)
          if (body?.trim()) {
            send(res, 200, body, 'application/json; charset=utf-8')
            return
          }
          lastErr = new Error('empty body')
        } catch (e) {
          lastErr = e
          await new Promise((r) => setTimeout(r, 250 * (i + 1)))
        }
      }
      const msg = lastErr instanceof Error ? lastErr.message : String(lastErr)
      send(res, 502, JSON.stringify({ message: `em curl proxy failed: ${msg}` }), 'application/json')
    } catch (e) {
      send(
        res,
        500,
        JSON.stringify({ message: e instanceof Error ? e.message : String(e) }),
        'application/json',
      )
    }
  })
}

export function emCurlProxyPlugin(): Plugin {
  return {
    name: 'em-curl-proxy',
    configureServer(server: ViteDevServer) {
      attach(server.middlewares)
    },
    configurePreviewServer(server: PreviewServer) {
      attach(server.middlewares)
    },
  }
}
