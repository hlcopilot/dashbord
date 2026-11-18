import fs from 'node:fs/promises'
import path from 'node:path'
import type { Connect, Plugin, PreviewServer, ViteDevServer } from 'vite'
import {
  ETF_KLINE_FULL_LIMIT,
  buildEtfFlowSeries,
  normalizeCache,
  parseEmKlines,
  type EtfFlowCache,
} from './etf-flow-core.ts'
import { fetchEtfShareWan } from './etf-share-fetch.ts'
import { DEFAULT_ETF_CODE, getEtfByCode } from './etf-universe.ts'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const CACHE_DIR = path.resolve(process.cwd(), 'data/etf-share')

function sendJson(res: import('node:http').ServerResponse, status: number, data: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

async function readCache(code: string): Promise<EtfFlowCache> {
  try {
    const raw = await fs.readFile(path.join(CACHE_DIR, `${code}.json`), 'utf8')
    return normalizeCache(JSON.parse(raw))
  } catch {
    return normalizeCache(null)
  }
}

async function writeCache(code: string, cache: EtfFlowCache) {
  await fs.mkdir(CACHE_DIR, { recursive: true })
  const payload = {
    updatedAt: cache.updatedAt || new Date().toISOString(),
    code,
    closes: cache.closes,
    shares: cache.shares,
  }
  await fs.writeFile(
    path.join(CACHE_DIR, `${code}.json`),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8',
  )
}

async function fetchKlines(secid: string, limit: number) {
  try {
    const dest =
      `https://push2his.eastmoney.com/api/qt/stock/kline/get` +
      `?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6` +
      `&fields2=f51,f52,f53,f54,f55,f56,f57` +
      `&klt=101&fqt=1&beg=0&end=20500101&lmt=${limit}`
    const r = await fetch(dest, {
      headers: { Referer: 'https://quote.eastmoney.com/', 'User-Agent': UA },
    })
    if (!r.ok) throw new Error(`ETF 日线请求失败: ${r.status}`)
    return parseEmKlines((await r.json()) as { data?: { klines?: string[] } })
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e))
  }
}

async function handleEtfFlow(req: Connect.IncomingMessage, res: import('node:http').ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (req.method !== 'GET') return sendJson(res, 405, { message: 'method not allowed' })

  const code = url.searchParams.get('code') || DEFAULT_ETF_CODE
  const meta = getEtfByCode(code)
  const backfillLimit = Number(url.searchParams.get('backfill') || '40')

  try {
    const result = await buildEtfFlowSeries(meta, {
      concurrency: 8,
      backfillLimit: Number.isFinite(backfillLimit) ? backfillLimit : 40,
      retryRecent: 8,
      fetchKlines,
      fetchShareWan: fetchEtfShareWan,
      loadCache: readCache,
      saveCache: writeCache,
    })
    return sendJson(res, 200, result)
  } catch (e) {
    return sendJson(res, 502, {
      message: e instanceof Error ? e.message : String(e),
    })
  }
}

function attach(middlewares: Connect.Server) {
  middlewares.use(async (req, res, next) => {
    const pathname = (req.url ?? '').split('?')[0]
    if (pathname !== '/api/etf/flow') return next()
    try {
      await handleEtfFlow(req, res)
    } catch (e) {
      sendJson(res, 500, { message: e instanceof Error ? e.message : String(e) })
    }
  })
}

/** 开发/预览：ETF 净流入；份额+收盘价缓存到 data/etf-share */
export function etfFlowPlugin(): Plugin {
  return {
    name: 'etf-flow',
    configureServer(server: ViteDevServer) {
      attach(server.middlewares)
    },
    configurePreviewServer(server: PreviewServer) {
      attach(server.middlewares)
    },
  }
}

export { ETF_KLINE_FULL_LIMIT, fetchKlines, fetchEtfShareWan as fetchShareWan, readCache, writeCache }
