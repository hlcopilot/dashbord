import { apiUrl } from '@/api/base'
import type {
  DailyTurnover,
  IntradayPoint,
  IntradayTurnoverResult,
  LocalIntradayDay,
} from '@/types/market'

type EmSecid = '1.000001' | '0.399001'

interface EmTrendsResponse {
  data?: {
    trends?: string[]
  }
}

/** 内存缓存：合并「本地归档 + 远端近 5 日」后的分钟 map */
let cache: {
  at: number
  /** date -> (HH:mm -> 当分钟两市成交额亿元) */
  days: Map<string, Map<string, number>>
} | null = null
const CACHE_TTL_MS = 60_000

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchEmTrends(secid: EmSecid, retries = 2): Promise<string[]> {
  const url = apiUrl(
    `/api/eastmoney/api/qt/stock/trends2/get` +
      `?fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13` +
      `&fields2=f51,f52,f53,f54,f55,f56,f57,f58` +
      `&ut=fa5fd1943c7b386f172d6893dbfba10b` +
      `&secid=${secid}&ndays=5&iscr=0&iscca=0`,
  )

  let lastError: unknown
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`分时行情请求失败: ${res.status}`)
      const json = (await res.json()) as EmTrendsResponse
      const trends = json.data?.trends
      if (!trends?.length) throw new Error('分时行情无数据')
      return trends
    } catch (e) {
      lastError = e
      if (i < retries) await sleep(300 * (i + 1))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/** 解析为 date -> (HH:mm -> 当分钟成交额亿元) */
function parseMinuteAmountMap(trends: string[]): Map<string, Map<string, number>> {
  const byDate = new Map<string, Map<string, number>>()
  for (const row of trends) {
    const parts = row.split(',')
    if (parts.length < 7) continue
    const [datePart, timePart] = parts[0].split(' ')
    if (!datePart || !timePart) continue
    const time = timePart.slice(0, 5)
    const amountYi = Number(parts[6]) / 1e8
    if (!Number.isFinite(amountYi)) continue
    let dayMap = byDate.get(datePart)
    if (!dayMap) {
      dayMap = new Map()
      byDate.set(datePart, dayMap)
    }
    dayMap.set(time, amountYi)
  }
  return byDate
}

function mergeDayMinutes(
  sh?: Map<string, number>,
  sz?: Map<string, number>,
): Map<string, number> {
  const out = new Map<string, number>()
  const times = new Set<string>([...(sh?.keys() ?? []), ...(sz?.keys() ?? [])])
  for (const t of times) {
    out.set(t, (sh?.get(t) ?? 0) + (sz?.get(t) ?? 0))
  }
  return out
}

function toCumulative(minuteMap: Map<string, number>): Map<string, number> {
  const times = [...minuteMap.keys()].sort()
  const out = new Map<string, number>()
  let sum = 0
  for (const t of times) {
    sum += minuteMap.get(t) ?? 0
    out.set(t, Math.round(sum * 100) / 100)
  }
  return out
}

function mapToRecord(map: Map<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of [...map.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    out[k] = Math.round(v * 10000) / 10000
  }
  return out
}

function recordToMap(record: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(record))
}

function dayTotal(minuteMap: Map<string, number>): number {
  let sum = 0
  for (const v of minuteMap.values()) sum += v
  return Math.round(sum * 10) / 10
}

async function loadLocalArchive(): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>()
  try {
    const res = await fetch(apiUrl('/api/local/intraday/all'))
    if (!res.ok) return out
    const json = (await res.json()) as { days?: Record<string, LocalIntradayDay> }
    for (const [date, day] of Object.entries(json.days ?? {})) {
      if (day?.minutes) out.set(date, recordToMap(day.minutes))
    }
  } catch {
    // 预览/生产未挂载本地中间件时忽略
  }
  return out
}

async function saveLocalDay(date: string, minuteMap: Map<string, number>) {
  const payload: LocalIntradayDay = {
    date,
    updatedAt: new Date().toISOString(),
    minutes: mapToRecord(minuteMap),
    totalYi: dayTotal(minuteMap),
  }
  try {
    await fetch(apiUrl(`/api/local/intraday/${date}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    // 无法写本地时不阻断主流程
  }
}

/**
 * 拉取东财近 5 日分时，合并进本地归档并回写项目文件。
 * 本地已有更早日期会保留，从而实现持续积累。
 */
export async function syncIntradayArchive(force = false): Promise<Map<string, Map<string, number>>> {
  const now = Date.now()
  if (!force && cache && now - cache.at < CACHE_TTL_MS) return cache.days

  const local = await loadLocalArchive()

  let remoteCombined = new Map<string, Map<string, number>>()
  try {
    const shTrends = await fetchEmTrends('1.000001')
    await sleep(150)
    const szTrends = await fetchEmTrends('0.399001')
    const sh = parseMinuteAmountMap(shTrends)
    const sz = parseMinuteAmountMap(szTrends)
    const dates = [...new Set([...sh.keys(), ...sz.keys()])]
    remoteCombined = new Map(
      dates.map((date) => [date, mergeDayMinutes(sh.get(date), sz.get(date))]),
    )
  } catch {
    // 远端失败时仍可用本地归档
  }

  const merged = new Map(local)
  for (const [date, minutes] of remoteCombined) {
    merged.set(date, minutes)
    await saveLocalDay(date, minutes)
  }

  cache = { at: now, days: merged }
  return merged
}

/** A 股常规交易分钟轴（与东财 241 点对齐） */
export function buildTradingTimeline(): string[] {
  const times: string[] = []
  const pushRange = (hStart: number, mStart: number, hEnd: number, mEnd: number) => {
    let h = hStart
    let m = mStart
    while (h < hEnd || (h === hEnd && m <= mEnd)) {
      times.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
      m += 1
      if (m >= 60) {
        m = 0
        h += 1
      }
    }
  }
  pushRange(9, 30, 11, 30)
  pushRange(13, 1, 15, 0)
  return times
}

function findPrevTradingDate(
  date: string,
  dailySeries: DailyTurnover[],
  availableDates: string[],
): string | null {
  const idx = dailySeries.findIndex((p) => p.date === date)
  if (idx > 0) return dailySeries[idx - 1].date
  const i = availableDates.indexOf(date)
  return i > 0 ? availableDates[i - 1] : null
}

/** 取某日累计成交额（亿元）；优先本地归档/已同步缓存 */
export async function getDayCumulativeTotal(date: string): Promise<number | null> {
  const days = await syncIntradayArchive()
  const minuteMap = days.get(date)
  if (!minuteMap?.size) return null
  return dayTotal(minuteMap)
}

/**
 * 拉取指定交易日的沪深两市分时累计成交额，并对比前一交易日。
 * 数据优先本地归档；打开页面时会把东财近 5 日同步进 data/intraday。
 */
export async function fetchIntradayTurnover(
  date: string,
  dailySeries: DailyTurnover[],
): Promise<IntradayTurnoverResult> {
  const days = await syncIntradayArchive()
  const availableDates = [...days.keys()].sort()

  if (!availableDates.includes(date)) {
    throw new Error(
      `暂无 ${date} 的分时数据。请在有网时打开页面同步近 5 日；更早日期依赖本地归档（data/intraday）。当前归档：${
        availableDates.length
          ? `${availableDates[0]} ~ ${availableDates.at(-1)}（${availableDates.length} 日）`
          : '空'
      }`,
    )
  }

  const prevDate = findPrevTradingDate(date, dailySeries, availableDates)
  if (!prevDate || !days.has(prevDate)) {
    throw new Error('缺少前一交易日分时数据，无法对比（可先同步相邻交易日）')
  }

  const todayCum = toCumulative(days.get(date)!)
  const prevCum = toCumulative(days.get(prevDate)!)

  const timeline = buildTradingTimeline()
  const points: IntradayPoint[] = timeline.map((time) => {
    const todayYi = todayCum.has(time) ? (todayCum.get(time) as number) : null
    const prevYi = prevCum.has(time) ? (prevCum.get(time) as number) : null
    const deltaYi =
      todayYi != null && prevYi != null ? Math.round((todayYi - prevYi) * 100) / 100 : null
    return { time, todayYi, prevYi, deltaYi }
  })

  const lastToday = [...todayCum.entries()].at(-1)
  const lastPrev = [...prevCum.entries()].at(-1)
  const latestTodayYi = lastToday?.[1] ?? 0
  const prevFullYi = lastPrev?.[1] ?? 0
  const sameTimePrev = lastToday ? (prevCum.get(lastToday[0]) ?? null) : null
  const deltaVsPrevSameTimeYi =
    sameTimePrev == null ? null : Math.round((latestTodayYi - sameTimePrev) * 100) / 100

  return {
    date,
    prevDate,
    points,
    latestTodayYi,
    prevFullYi,
    deltaVsPrevSameTimeYi,
  }
}
