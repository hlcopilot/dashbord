import { apiUrl } from '@/api/base'
import {
  buildRemoteDaysFromEm,
  emMinuteKlineProxyPath,
  emTrends2ProxyPath,
  type LocalEtfIntradayDay,
} from '../../etf-intraday-core.ts'
import type { EtfIntradayResult } from '@/types/market'

type EmKlineResponse = {
  data?: { code?: string; name?: string; klines?: string[] }
}

type EmTrendsResponse = {
  data?: { code?: string; name?: string; trends?: string[] }
}

const CACHE_TTL_MS = 60_000

const memCache = new Map<
  string,
  {
    at: number
    days: Map<string, LocalEtfIntradayDay>
    syncedDates: Set<string>
    warnings: string[]
  }
>()

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function toResult(day: LocalEtfIntradayDay, source: EtfIntradayResult['source']): EtfIntradayResult {
  return {
    code: day.code,
    name: day.name || day.code,
    date: day.date,
    source,
    bars: day.bars,
    open: day.open,
    close: day.close,
    high: day.high,
    low: day.low,
    volume: day.volume,
    amountYi: day.amountYi,
  }
}

async function fetchEmJson<T>(pathAndQuery: string, retries = 2): Promise<T> {
  let lastError: unknown
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(apiUrl(pathAndQuery))
      if (!res.ok) throw new Error(`ETF 分钟行情请求失败: ${res.status}`)
      return (await res.json()) as T
    } catch (e) {
      lastError = e
      if (i < retries) await sleep(300 * (i + 1))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function loadLocalArchive(code: string): Promise<Map<string, LocalEtfIntradayDay>> {
  const out = new Map<string, LocalEtfIntradayDay>()
  try {
    const res = await fetch(apiUrl(`/api/local/etf-intraday/${encodeURIComponent(code)}/all`))
    if (!res.ok) return out
    const json = (await res.json()) as { days?: Record<string, LocalEtfIntradayDay> }
    for (const [date, day] of Object.entries(json.days ?? {})) {
      if (day?.bars?.length) out.set(date, day)
    }
  } catch {
    /* 未挂载中间件 / KV */
  }
  return out
}

async function saveLocalDay(day: LocalEtfIntradayDay): Promise<boolean> {
  try {
    const res = await fetch(
      apiUrl(`/api/local/etf-intraday/${encodeURIComponent(day.code)}/${day.date}`),
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(day),
      },
    )
    return res.ok
  } catch {
    return false
  }
}

type SyncResult = {
  days: Map<string, LocalEtfIntradayDay>
  syncedDates: Set<string>
  warnings: string[]
}

/** 拉取东财近约 5 日并写回归档；更早日期保留 */
export async function syncEtfIntradayArchive(
  input: { code: string; secid: string; name: string },
  force = false,
): Promise<SyncResult> {
  const { code, secid, name } = input
  const now = Date.now()
  const hit = memCache.get(code)
  if (!force && hit && now - hit.at < CACHE_TTL_MS) {
    return {
      days: hit.days,
      syncedDates: hit.syncedDates,
      warnings: hit.warnings,
    }
  }

  const local = await loadLocalArchive(code)

  let trends: string[] | null = null
  let trendsName: string | null = null
  let trendsError: string | null = null
  try {
    const trendsJson = await fetchEmJson<EmTrendsResponse>(emTrends2ProxyPath(secid))
    trends = trendsJson.data?.trends ?? []
    trendsName = trendsJson.data?.name ?? null
  } catch (e) {
    trendsError = e instanceof Error ? e.message : String(e)
  }

  let klines: string[] | null = null
  let klineName: string | null = null
  let klineError: string | null = null
  try {
    await sleep(120)
    const klineJson = await fetchEmJson<EmKlineResponse>(emMinuteKlineProxyPath(secid))
    klines = klineJson.data?.klines ?? []
    klineName = klineJson.data?.name ?? null
  } catch (e) {
    klineError = e instanceof Error ? e.message : String(e)
  }

  const { days: remote, warnings } = buildRemoteDaysFromEm({
    code,
    name,
    trends,
    trendsName,
    trendsError,
    klines,
    klineName,
    klineError,
  })

  const merged = new Map(local)
  let saveFail = 0
  for (const [, day] of remote) {
    merged.set(day.date, day)
    if (!(await saveLocalDay(day))) saveFail += 1
  }
  if (saveFail > 0) warnings.push(`有 ${saveFail} 日未能写入本地/KV 归档`)

  const syncedDates = new Set(remote.keys())
  memCache.set(code, { at: now, days: merged, syncedDates, warnings })
  return { days: merged, syncedDates, warnings }
}

export async function fetchEtfIntradayKline(input: {
  secid: string
  code: string
  name: string
  date: string
}): Promise<EtfIntradayResult> {
  const { code, secid, name, date } = input
  let { days, syncedDates, warnings } = await syncEtfIntradayArchive({ code, secid, name })

  if (!days.get(date)?.bars?.length) {
    ;({ days, syncedDates, warnings } = await syncEtfIntradayArchive(
      { code, secid, name },
      true,
    ))
  }

  const available = [...days.keys()].sort()
  const day = days.get(date)
  if (!day?.bars?.length) {
    const warnText = warnings.length ? `；同步提示：${warnings.join('；')}` : ''
    throw new Error(
      `暂无 ${code} ${date} 的分钟 K。请在有网时打开弹层同步近约 5 日；更早日期依赖归档（data/etf-intraday/${code}）。当前归档：${
        available.length
          ? `${available[0]} ~ ${available.at(-1)}（${available.length} 日）`
          : '空'
      }${warnText}`,
    )
  }

  return toResult(day, syncedDates.has(date) ? day.source : 'cache')
}
