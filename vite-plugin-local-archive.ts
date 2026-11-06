import fs from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import type { Connect, Plugin, PreviewServer, ViteDevServer } from 'vite'

const DATA_DIR = path.resolve(process.cwd(), 'data/intraday')

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true })
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

function attachLocalArchiveMiddleware(middlewares: Connect.Server) {
  middlewares.use(async (req, res, next) => {
    const url = req.url ?? ''
    if (!url.startsWith('/api/local/intraday')) return next()

    try {
      await ensureDataDir()
      const pathname = url.split('?')[0]

      // GET /api/local/intraday → 日期列表
      if (req.method === 'GET' && pathname === '/api/local/intraday') {
        const files = await fs.readdir(DATA_DIR)
        const dates = files
          .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
          .map((f) => f.replace(/\.json$/, ''))
          .sort()
        return sendJson(res, 200, { dates })
      }

      // GET /api/local/intraday/all → 全部归档
      if (req.method === 'GET' && pathname === '/api/local/intraday/all') {
        const files = await fs.readdir(DATA_DIR)
        const days: Record<string, unknown> = {}
        for (const f of files) {
          if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(f)) continue
          const raw = await fs.readFile(path.join(DATA_DIR, f), 'utf8')
          days[f.replace(/\.json$/, '')] = JSON.parse(raw)
        }
        return sendJson(res, 200, { days })
      }

      const match = pathname.match(/^\/api\/local\/intraday\/(\d{4}-\d{2}-\d{2})$/)
      if (!match) return sendJson(res, 404, { message: 'not found' })
      const date = match[1]
      const filePath = path.join(DATA_DIR, `${date}.json`)

      if (req.method === 'GET') {
        try {
          const raw = await fs.readFile(filePath, 'utf8')
          return sendJson(res, 200, JSON.parse(raw))
        } catch {
          return sendJson(res, 404, { message: `no local archive for ${date}` })
        }
      }

      if (req.method === 'PUT') {
        const body = await readBody(req)
        const parsed = JSON.parse(body) as { date?: string; minutes?: Record<string, number> }
        if (parsed.date !== date || !parsed.minutes) {
          return sendJson(res, 400, { message: 'invalid payload' })
        }
        await fs.writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
        return sendJson(res, 200, { ok: true, date })
      }

      return sendJson(res, 405, { message: 'method not allowed' })
    } catch (e) {
      return sendJson(res, 500, {
        message: e instanceof Error ? e.message : String(e),
      })
    }
  })
}

/** 开发/预览态把分时数据读写到项目 data/intraday 目录 */
export function localArchivePlugin(): Plugin {
  return {
    name: 'local-archive',
    configureServer(server: ViteDevServer) {
      attachLocalArchiveMiddleware(server.middlewares)
    },
    configurePreviewServer(server: PreviewServer) {
      attachLocalArchiveMiddleware(server.middlewares)
    },
  }
}
