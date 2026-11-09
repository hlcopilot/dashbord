/**
 * Cloudflare Worker：承接 /api/*
 * - 行情代理（搜狐 / 东财 / 新浪）
 * - 分时归档（KV，对应本地 data/intraday）
 * - ETF 申赎净流入（上交所份额 + 东财日 K）
 */

import {
  DEFAULT_ETF_CODE,
  DEFAULT_ETF_NAME,
  DEFAULT_ETF_SECID,
  ETF_KLINE_FULL_LIMIT,
  buildEtfFlowSeries,
  normalizeCache,
  parseEmKlines,
  parseSseShareWan,
} from '../../etf-flow-core'

export interface Env {
  /** 可选：未绑定时代理仍可用，仅归档读写不可用 */
  INTRADAY_KV?: KVNamespace
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

type ProxyRule = {
  prefix: string
  origin: string
  strip: string
  headers: Record<string, string>
}

const PROXY_RULES: ProxyRule[] = [
  {
    prefix: '/api/sohu',
    origin: 'https://q.stock.sohu.com',
    strip: '/api/sohu',
    headers: { Referer: 'https://q.stock.sohu.com/', 'User-Agent': UA },
  },
  {
    prefix: '/api/sina',
    origin: 'https://hq.sinajs.cn',
    strip: '/api/sina',
    headers: { Referer: 'https://finance.sina.com.cn', 'User-Agent': UA },
  },
  // emdc 必须在 eastmoney 之前（前缀更长）
  {
    prefix: '/api/emdc',
    origin: 'https://datacenter-web.eastmoney.com',
    strip: '/api/emdc',
    headers: { Referer: 'https://data.eastmoney.com/rzrq/', 'User-Agent': UA },
  },
  {
    prefix: '/api/eastmoney',
    origin: 'https://push2his.eastmoney.com',
    strip: '/api/eastmoney',
    headers: { Referer: 'https://quote.eastmoney.com/', 'User-Agent': UA },
  },
]

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}

function corsPass(res: Response): Response {
  const out = new Response(res.body, res)
  out.headers.set('Access-Control-Allow-Origin', '*')
  return out
}

async function proxyRequest(request: Request, rule: ProxyRule): Promise<Response> {
  const incoming = new URL(request.url)
  const upstreamPath = incoming.pathname.slice(rule.strip.length) || '/'
  const dest = new URL(upstreamPath + incoming.search, rule.origin)

  const headers = new Headers(rule.headers)
  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'follow',
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body
  }

  const res = await fetch(dest.toString(), init)
  return corsPass(res)
}

function dayKey(date: string) {
  return `day:${date}`
}

async function handleIntradayArchive(request: Request, env: Env): Promise<Response> {
  const kv = env.INTRADAY_KV
  if (!kv) {
    return json(
      {
        message:
          'INTRADAY_KV 未绑定：代理可用，但云端分时归档不可用。请按 DEPLOY-CLOUDFLARE.md 创建 KV。',
      },
      503,
    )
  }

  const url = new URL(request.url)
  const pathname = url.pathname.replace(/\/+$/, '') || '/'

  if (request.method === 'OPTIONS') {
    return json({ ok: true })
  }

  if (request.method === 'GET' && pathname === '/api/local/intraday') {
    const listed = await kv.list({ prefix: 'day:' })
    const dates = listed.keys
      .map((k) => k.name.replace(/^day:/, ''))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort()
    return json({ dates })
  }

  if (request.method === 'GET' && pathname === '/api/local/intraday/all') {
    const listed = await kv.list({ prefix: 'day:' })
    const days: Record<string, unknown> = {}
    for (const key of listed.keys) {
      const date = key.name.replace(/^day:/, '')
      const raw = await kv.get(key.name)
      if (raw) {
        try {
          days[date] = JSON.parse(raw)
        } catch {
          // skip bad record
        }
      }
    }
    return json({ days })
  }

  const match = pathname.match(/^\/api\/local\/intraday\/(\d{4}-\d{2}-\d{2})$/)
  if (!match) return json({ message: 'not found' }, 404)
  const date = match[1]
  const key = dayKey(date)

  if (request.method === 'GET') {
    const raw = await kv.get(key)
    if (!raw) return json({ message: `no archive for ${date}` }, 404)
    return new Response(raw, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
    })
  }

  if (request.method === 'PUT') {
    const body = await request.json<{
      date?: string
      minutes?: Record<string, number>
      updatedAt?: string
      totalYi?: number
    }>()
    if (body.date !== date || !body.minutes) {
      return json({ message: 'invalid payload' }, 400)
    }
    const payload = {
      date,
      updatedAt: body.updatedAt || new Date().toISOString(),
      minutes: body.minutes,
      totalYi: body.totalYi ?? 0,
    }
    await kv.put(key, JSON.stringify(payload))
    return json({ ok: true, date })
  }

  return json({ message: 'method not allowed' }, 405)
}

function etfCacheKey(code: string) {
  return `etfcache:${code}`
}

async function handleEtfFlow(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ message: 'method not allowed' }, 405)

  const url = new URL(request.url)
  const code = url.searchParams.get('code') || DEFAULT_ETF_CODE
  const backfillLimit = Number(url.searchParams.get('backfill') || '40')
  const kv = env.INTRADAY_KV

  try {
    const result = await buildEtfFlowSeries(
      { code, name: DEFAULT_ETF_NAME, secid: DEFAULT_ETF_SECID },
      {
        concurrency: 8,
        backfillLimit: Number.isFinite(backfillLimit) ? backfillLimit : 40,
        retryRecent: 8,
        async fetchKlines(secid, limit) {
          const dest =
            `https://push2his.eastmoney.com/api/qt/stock/kline/get` +
            `?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6` +
            `&fields2=f51,f52,f53,f54,f55,f56,f57` +
            `&klt=101&fqt=1&beg=0&end=20500101&lmt=${limit || ETF_KLINE_FULL_LIMIT}`
          const r = await fetch(dest, {
            headers: { Referer: 'https://quote.eastmoney.com/', 'User-Agent': UA },
          })
          if (!r.ok) throw new Error(`ETF 日线请求失败: ${r.status}`)
          return parseEmKlines((await r.json()) as { data?: { klines?: string[] } })
        },
        async fetchShareWan(etfCode, date) {
          const qs = new URLSearchParams({
            isPagination: 'true',
            'pageHelp.pageSize': '10000',
            'pageHelp.pageNo': '1',
            'pageHelp.beginPage': '1',
            'pageHelp.cacheSize': '1',
            'pageHelp.endPage': '1',
            sqlId: 'COMMON_SSE_ZQPZ_ETFZL_XXPL_ETFGM_SEARCH_L',
            STAT_DATE: date,
          })
          const r = await fetch(`https://query.sse.com.cn/commonQuery.do?${qs}`, {
            headers: { Referer: 'https://www.sse.com.cn/', 'User-Agent': UA },
          })
          if (!r.ok) return null
          return parseSseShareWan(
            (await r.json()) as { result?: Array<Record<string, string>> },
            etfCode,
          )
        },
        async loadCache(etfCode) {
          if (!kv) return normalizeCache(null)
          const raw = await kv.get(etfCacheKey(etfCode))
          if (!raw) return normalizeCache(null)
          try {
            return normalizeCache(JSON.parse(raw))
          } catch {
            return normalizeCache(null)
          }
        },
        async saveCache(etfCode, cache) {
          if (!kv) return
          await kv.put(
            etfCacheKey(etfCode),
            JSON.stringify({
              updatedAt: cache.updatedAt || new Date().toISOString(),
              code: etfCode,
              closes: cache.closes,
              shares: cache.shares,
            }),
          )
        },
      },
    )
    return json(result)
  } catch (e) {
    return json({ message: e instanceof Error ? e.message : String(e) }, 502)
  }
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const pathname = new URL(request.url).pathname

  if (request.method === 'OPTIONS') {
    return json({ ok: true })
  }

  if (pathname.startsWith('/api/local/intraday')) {
    return handleIntradayArchive(request, env)
  }

  if (pathname === '/api/etf/flow') {
    return handleEtfFlow(request, env)
  }

  const rule = PROXY_RULES.find((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`))
  if (rule) {
    try {
      return await proxyRequest(request, rule)
    } catch (e) {
      return json(
        { message: e instanceof Error ? e.message : 'upstream proxy failed' },
        502,
      )
    }
  }

  return json({ message: `no api route for ${pathname}` }, 404)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleApi(request, env)
  },
}
