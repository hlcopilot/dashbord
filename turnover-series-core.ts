/**
 * 沪深成交额日频：缓存优先 + 搜狐 hisHq 按日期窗口增量
 */

export type TurnoverCacheDay = {
  amountYi: number
}

export type TurnoverCache = {
  updatedAt?: string
  /** YYYY-MM-DD → 两市合计成交额（亿元） */
  days: Record<string, TurnoverCacheDay>
}

export type TurnoverSeriesPoint = {
  date: string
  amountYi: number
}

export type TurnoverSeriesBuildResult = {
  series: TurnoverSeriesPoint[]
  asOf: string
  fetchedDays: number
  cacheHitDays: number
  note: string
}

export type TurnoverSeriesDeps = {
  /** start/end 为 YYYYMMDD */
  fetchIndexAmount: (
    code: 'zs_000001' | 'zs_399001',
    start: string,
    end: string,
  ) => Promise<Map<string, number>>
  loadCache: () => Promise<TurnoverCache>
  saveCache: (cache: TurnoverCache) => Promise<void>
  /** 冷启动全量起点 */
  fullStart?: string
  /** 覆盖刷新最近若干已缓存交易日，避免尾部修正 */
  refreshRecent?: number
}

function toCompact(date: string): string {
  return date.replace(/-/g, '')
}

function fromCompact(ymd: string): string {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export function normalizeTurnoverCache(raw: unknown): TurnoverCache {
  if (!raw || typeof raw !== 'object') return { days: {} }
  const obj = raw as Record<string, unknown>
  const days =
    obj.days && typeof obj.days === 'object'
      ? (obj.days as Record<string, TurnoverCacheDay>)
      : {}
  return {
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : undefined,
    days,
  }
}

export async function buildTurnoverSeries(
  deps: TurnoverSeriesDeps,
): Promise<TurnoverSeriesBuildResult> {
  const fullStart = deps.fullStart || '20150101'
  const refreshRecent = deps.refreshRecent ?? 5
  const cache = await deps.loadCache()
  cache.days = cache.days ?? {}

  const cachedDates = Object.keys(cache.days).sort()
  const end = new Date()
  const endCompact = `${end.getFullYear()}${String(end.getMonth() + 1).padStart(2, '0')}${String(end.getDate()).padStart(2, '0')}`

  let startCompact = fullStart
  if (cachedDates.length) {
    const last = cachedDates[cachedDates.length - 1]
    const refreshFromIdx = Math.max(0, cachedDates.length - refreshRecent)
    const refreshFrom = cachedDates[refreshFromIdx]
    startCompact = toCompact(refreshFrom <= last ? refreshFrom : last)
  }

  const shMap = await deps.fetchIndexAmount('zs_000001', startCompact, endCompact)
  await sleep(200)
  const szMap = await deps.fetchIndexAmount('zs_399001', startCompact, endCompact)

  let fetchedDays = 0
  const dates = [...shMap.keys()].filter((d) => szMap.has(d)).sort()
  for (const date of dates) {
    const amountYi = Math.round(((shMap.get(date) ?? 0) + (szMap.get(date) ?? 0)) * 10) / 10
    const prev = cache.days[date]?.amountYi
    if (prev !== amountYi) {
      cache.days[date] = { amountYi }
      fetchedDays += 1
    }
  }

  if (fetchedDays > 0 || !cache.updatedAt) {
    cache.updatedAt = new Date().toISOString()
    await deps.saveCache(cache)
  }

  const series = Object.entries(cache.days)
    .map(([date, v]) => ({ date, amountYi: v.amountYi }))
    .sort((a, b) => a.date.localeCompare(b.date))

  if (series.length < 2) throw new Error('成交额缓存为空，请检查搜狐接口或先 seed')

  const cacheHitDays = Math.max(0, series.length - fetchedDays)
  return {
    series,
    asOf: series[series.length - 1].date,
    fetchedDays,
    cacheHitDays,
    note: '成交额优先读本地/KV；日常仅用搜狐 hisHq 按 start/end 增量窗口拉取并合并。',
  }
}

export { toCompact, fromCompact }
