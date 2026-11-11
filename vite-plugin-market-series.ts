import fs from 'node:fs/promises'
import path from 'node:path'
import type { Connect, Plugin, PreviewServer, ViteDevServer } from 'vite'
import {
  buildMarginSeries,
  normalizeMarginCache,
  type MarginCache,
} from './margin-series-core.ts'
import {
  buildTurnoverSeries,
  normalizeTurnoverCache,
  type TurnoverCache,
} from './turnover-series-core.ts'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const CACHE_DIR = path.resolve(process.cwd(), 'data/series')

function sendJson(res: import('node:http').ServerResponse, status: number, data: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

async function readJsonFile(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return null
  }
}

async function writeJsonFile(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

async function fetchSohuIndexAmount(
  code: 'zs_000001' | 'zs_399001',
  start: string,
  end: string,
): Promise<Map<string, number>> {
  const url =
    `https://q.stock.sohu.com/hisHq?code=${code}&start=${start}&end=${end}&stat=1&order=A&period=d`
  let lastError: unknown
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Referer: 'https://q.stock.sohu.com/', 'User-Agent': UA },
      })
      if (!res.ok) throw new Error(`sohu ${code}: ${res.status}`)
      const data = (await res.json()) as Array<{
        status: number
        hq?: Array<[string, string, string, string, string, string, string, string, string, string]>
      }>
      const item = data?.[0]
      if (!item || item.status !== 0 || !item.hq?.length) {
        throw new Error(`sohu ${code}: empty`)
      }
      const map = new Map<string, number>()
      for (const row of item.hq) {
        // 成交额：万元 → 亿元；收盘价直接 Number(row[2])
        map.set(row[0], Number(row[8]) / 10000)
      }
      return map
    } catch (e) {
      lastError = e
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function fetchSohuCloseMap(start: string, end: string): Promise<Map<string, number>> {
  const url =
    `https://q.stock.sohu.com/hisHq?code=zs_000001&start=${start}&end=${end}&stat=1&order=A&period=d`
  const res = await fetch(url, {
    headers: { Referer: 'https://q.stock.sohu.com/', 'User-Agent': UA },
  })
  if (!res.ok) throw new Error(`上证指数请求失败: ${res.status}`)
  const data = (await res.json()) as Array<{
    status: number
    hq?: Array<[string, string, string, string, string, string, string, string, string, string]>
  }>
  const item = data?.[0]
  const map = new Map<string, number>()
  if (!item || item.status !== 0 || !item.hq?.length) return map
  for (const row of item.hq) map.set(row[0], Number(row[2]))
  return map
}

async function fetchMarginPage(pageNumber: number, pageSize = 800) {
  const url =
    `https://datacenter-web.eastmoney.com/api/data/v1/get` +
    `?reportName=RPTA_RZRQ_LSHJ` +
    `&columns=DIM_DATE,RZRQYE,RZYE,RQYE` +
    `&pageNumber=${pageNumber}&pageSize=${pageSize}` +
    `&sortTypes=-1&sortColumns=DIM_DATE&source=WEB&client=WEB`
  const res = await fetch(url, {
    headers: { Referer: 'https://data.eastmoney.com/rzrq/', 'User-Agent': UA },
  })
  if (!res.ok) throw new Error(`两融余额请求失败: ${res.status}`)
  const json = (await res.json()) as {
    result?: { data?: Array<{ DIM_DATE: string; RZRQYE: number; RZYE: number; RQYE: number }>; pages?: number }
    message?: string
  }
  return {
    rows: json.result?.data ?? [],
    pages: json.result?.pages ?? 1,
  }
}

async function handleTurnover(res: import('node:http').ServerResponse) {
  const file = path.join(CACHE_DIR, 'turnover.json')
  try {
    const result = await buildTurnoverSeries({
      fetchIndexAmount: fetchSohuIndexAmount,
      async loadCache() {
        return normalizeTurnoverCache(await readJsonFile(file))
      },
      async saveCache(cache: TurnoverCache) {
        await writeJsonFile(file, cache)
      },
    })
    return sendJson(res, 200, result)
  } catch (e) {
    return sendJson(res, 502, { message: e instanceof Error ? e.message : String(e) })
  }
}

async function handleMargin(res: import('node:http').ServerResponse) {
  const file = path.join(CACHE_DIR, 'margin.json')
  try {
    const result = await buildMarginSeries({
      fetchMarginPage,
      fetchSseCloseMap: fetchSohuCloseMap,
      async loadCache() {
        return normalizeMarginCache(await readJsonFile(file))
      },
      async saveCache(cache: MarginCache) {
        await writeJsonFile(file, cache)
      },
    })
    return sendJson(res, 200, result)
  } catch (e) {
    return sendJson(res, 502, { message: e instanceof Error ? e.message : String(e) })
  }
}

function attach(middlewares: Connect.Server) {
  middlewares.use(async (req, res, next) => {
    const pathname = (req.url ?? '').split('?')[0]
    if (pathname === '/api/turnover/series') {
      if (req.method !== 'GET') return sendJson(res, 405, { message: 'method not allowed' })
      return handleTurnover(res)
    }
    if (pathname === '/api/margin/series') {
      if (req.method !== 'GET') return sendJson(res, 405, { message: 'method not allowed' })
      return handleMargin(res)
    }
    return next()
  })
}

/** 成交额 / 两融日频：缓存优先，增量补齐 → data/series */
export function marketSeriesPlugin(): Plugin {
  return {
    name: 'market-series',
    configureServer(server: ViteDevServer) {
      attach(server.middlewares)
    },
    configurePreviewServer(server: PreviewServer) {
      attach(server.middlewares)
    },
  }
}
