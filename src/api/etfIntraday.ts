import { apiUrl } from '@/api/base'
import type {
  EtfIntradayBar,
  EtfIntradayResult,
  LocalEtfIntradayDay,
} from '@/types/market'

type EmKlineResponse = {
  data?: {
    code?: string
    name?: string
    klines?: string[]
  }
}

type EmTrendsResponse = {
  data?: {
    code?: string
    name?: string
    trends?: string[]
  }
}

const CACHE_TTL_MS = 60_000

/** code → 已合并归档（含近端同步） */
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

function summarizeBars(
  bars: EtfIntradayBar[],
): Pick<LocalEtfIntradayDay, 'open' | 'close' | 'high' | 'low' | 'volume' | 'amountYi'> {
  const first = bars[0]!
  const last = bars[bars.length - 1]!
  let high = first.high
  let low = first.low
  let volume = 0
  let amountYi = 0
  for (const b of bars) {
    high = Math.max(high, b.high)
    low = Math.min(low, b.low)
    volume += b.volume
    amountYi += b.amountYi
  }
  return {
    open: first.open,
    close: last.close,
    high,
    low,
    volume,
    amountYi: Math.round(amountYi * 1e6) / 1e6,
  }
}

function toLocalDay(
  code: string,
  name: string,
  date: string,
  source: 'kline' | 'trends2',
  bars: EtfIntradayBar[],
): LocalEtfIntradayDay {
  return {
    date,
    code,
    name,
    updatedAt: new Date().toISOString(),
    source,
    bars,
    ...summarizeBars(bars),
  }
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

function parseKlineAll(klines: string[]): Map<string, EtfIntradayBar[]> {
  const byDate = new Map<string, EtfIntradayBar[]>()
  for (const row of klines) {
    const parts = row.split(',')
    if (parts.length < 7) continue
    const stamp = parts[0]
    if (!stamp || stamp.length < 16) continue
    const date = stamp.slice(0, 10)
    const time = stamp.slice(11, 16)
    const open = Number(parts[1])
    const close = Number(parts[2])
    const high = Number(parts[3])
    const low = Number(parts[4])
    const volume = Number(parts[5])
    const amount = Number(parts[6])
    if (![open, close, high, low, volume, amount].every(Number.isFinite)) continue
    let list = byDate.get(date)
    if (!list) {
      list = []
      byDate.set(date, list)
    }
    list.push({
      time,
      open,
      close,
      high,
      low,
      volume,
      amountYi: amount / 1e8,
    })
  }
  return byDate
}

/** trends2：近约 5 日；字段 time,?,price,high,low,vol,amount,avg */
function parseTrendsAll(trends: string[]): Map<string, EtfIntradayBar[]> {
  const byDate = new Map<string, EtfIntradayBar[]>()
  const prevCloseByDate = new Map<string, number>()
  for (const row of trends) {
    const parts = row.split(',')
    if (parts.length < 7) continue
    const stamp = parts[0]
    if (!stamp || stamp.length < 16) continue
    const date = stamp.slice(0, 10)
    const time = stamp.slice(11, 16)
    const price = Number(parts[2])
    const high = Number(parts[3])
    const low = Number(parts[4])
    const volume = Number(parts[5])
    const amount = Number(parts[6])
    if (![price, high, low, volume, amount].every(Number.isFinite)) continue
    const prev = prevCloseByDate.get(date)
    const open = prev == null ? price : prev
    let list = byDate.get(date)
    if (!list) {
      list = []
      byDate.set(date, list)
    }
    list.push({
      time,
      open,
      close: price,
      high: Math.max(high, open, price),
      low: Math.min(low, open, price),
      volume,
      amountYi: amount / 1e8,
    })
    prevCloseByDate.set(date, price)
  }
  return byDate
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
    // 未挂载中间件 / KV 时忽略
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
  /** 本次从东财拉到并写回的日期 */
  syncedDates: Set<string>
  warnings: string[]
}

/**
 * 拉取东财近约 5 日分钟线，合并进本地/KV 归档并回写。
 * 更早日期保留在归档中，从而实现持续积累。
 */
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
  const remote = new Map<string, LocalEtfIntradayDay>()
  const warnings: string[] = []

  try {
    const trendsJson = await fetchEmJson<EmTrendsResponse>(
      `/api/eastmoney/api/qt/stock/trends2/get` +
        `?secid=${encodeURIComponent(secid)}` +
        `&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13` +
        `&fields2=f51,f52,f53,f54,f55,f56,f57,f58` +
        `&ut=fa5fd1943c7b386f172d6893dbfba10b` +
        `&ndays=5&iscr=0&iscca=0`,
    )
    const trends = trendsJson.data?.trends ?? []
    if (!trends.length) {
      warnings.push('东财 trends2 返回空（近约 5 日分钟线未写入）')
    } else {
      const remoteName = trendsJson.data?.name || name
      for (const [date, bars] of parseTrendsAll(trends)) {
        if (!bars.length) continue
        remote.set(date, toLocalDay(code, remoteName, date, 'trends2', bars))
      }
      if (!remote.size) {
        warnings.push('东财 trends2 有数据但解析后为空')
      }
    }
  } catch (e) {
    warnings.push(
      `近 5 日 trends2 同步失败：${e instanceof Error ? e.message : String(e)}`,
    )
  }

  try {
    await sleep(120)
    const klineJson = await fetchEmJson<EmKlineResponse>(
      `/api/eastmoney/api/qt/stock/kline/get` +
        `?secid=${encodeURIComponent(secid)}` +
        `&fields1=f1,f2,f3,f4,f5,f6` +
        `&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61` +
        `&klt=1&fqt=1&beg=0&end=20500101&lmt=1000`,
    )
    const remoteName = klineJson.data?.name || name
    let klineDays = 0
    for (const [date, bars] of parseKlineAll(klineJson.data?.klines ?? [])) {
      if (!bars.length) continue
      // 最新交易日用真 1 分钟 K 覆盖 trends2
      remote.set(date, toLocalDay(code, remoteName, date, 'kline', bars))
      klineDays += 1
    }
    if (!klineDays) {
      warnings.push('东财 1 分钟 K 无数据')
    }
  } catch (e) {
    warnings.push(
      `当日 1 分钟 K 同步失败：${e instanceof Error ? e.message : String(e)}`,
    )
  }

  const merged = new Map(local)
  let saveFail = 0
  for (const [date, day] of remote) {
    merged.set(date, day)
    const ok = await saveLocalDay(day)
    if (!ok) saveFail += 1
  }
  if (saveFail > 0) {
    warnings.push(`有 ${saveFail} 日未能写入本地/KV 归档`)
  }

  const syncedDates = new Set(remote.keys())
  memCache.set(code, { at: now, days: merged, syncedDates, warnings })
  return { days: merged, syncedDates, warnings }
}

/**
 * 指定交易日 ETF 分钟 K：先同步近 5 日写归档，再读合并结果。
 * 更早日期依赖本地 / KV 历史积累。
 */
export async function fetchEtfIntradayKline(input: {
  secid: string
  code: string
  name: string
  date: string
}): Promise<EtfIntradayResult> {
  const { code, secid, name, date } = input
  let { days, syncedDates, warnings } = await syncEtfIntradayArchive({
    code,
    secid,
    name,
  })

  // 缺日时强制再拉一次（避免首次 trends2 失败后 60s 内只命中「仅今日 K」缓存）
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

  const source: EtfIntradayResult['source'] = syncedDates.has(date) ? day.source : 'cache'
  return toResult(day, source)
}
