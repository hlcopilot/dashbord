/**
 * 两融余额日频：缓存优先 + 东财倒序分页早停 + 搜狐上证增量
 */

export type MarginCacheDay = {
  marginYi: number
  financingYi: number
  securitiesYi: number
  sseClose: number | null
}

export type MarginCache = {
  updatedAt?: string
  days: Record<string, MarginCacheDay>
}

export type MarginSeriesPoint = MarginCacheDay & { date: string }

export type MarginSeriesBuildResult = {
  series: MarginSeriesPoint[]
  asOf: string
  fetchedMarginDays: number
  fetchedSseDays: number
  cacheHitDays: number
  note: string
}

export type EmMarginRow = {
  DIM_DATE: string
  RZRQYE: number
  RZYE: number
  RQYE: number
}

export type MarginSeriesDeps = {
  fetchMarginPage: (pageNumber: number, pageSize?: number) => Promise<{
    rows: EmMarginRow[]
    pages: number
  }>
  fetchSseCloseMap: (start: string, end: string) => Promise<Map<string, number>>
  loadCache: () => Promise<MarginCache>
  saveCache: (cache: MarginCache) => Promise<void>
  refreshRecent?: number
  pageSize?: number
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function toCompact(date: string): string {
  return date.replace(/-/g, '')
}

export function normalizeMarginCache(raw: unknown): MarginCache {
  if (!raw || typeof raw !== 'object') return { days: {} }
  const obj = raw as Record<string, unknown>
  const days =
    obj.days && typeof obj.days === 'object' ? (obj.days as Record<string, MarginCacheDay>) : {}
  return {
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : undefined,
    days,
  }
}

export async function buildMarginSeries(deps: MarginSeriesDeps): Promise<MarginSeriesBuildResult> {
  const refreshRecent = deps.refreshRecent ?? 5
  const pageSize = deps.pageSize ?? 800
  const cache = await deps.loadCache()
  cache.days = cache.days ?? {}

  const cachedDates = Object.keys(cache.days).sort()
  const lastCached = cachedDates.length ? cachedDates[cachedDates.length - 1] : null
  const refreshFrom =
    cachedDates.length > 0
      ? cachedDates[Math.max(0, cachedDates.length - refreshRecent)]
      : null

  let fetchedMarginDays = 0
  let page = 1
  let pages = 1
  let stop = false

  while (!stop && page <= pages) {
    const batch = await deps.fetchMarginPage(page, pageSize)
    pages = Math.max(1, batch.pages || 1)
    if (!batch.rows.length) break

    for (const row of batch.rows) {
      const date = String(row.DIM_DATE).slice(0, 10)
      if (!date) continue

      const next: MarginCacheDay = {
        marginYi: Math.round((Number(row.RZRQYE) / 1e8) * 100) / 100,
        financingYi: Math.round((Number(row.RZYE) / 1e8) * 100) / 100,
        securitiesYi: Math.round((Number(row.RQYE) / 1e8) * 100) / 100,
        sseClose: cache.days[date]?.sseClose ?? null,
      }

      const prev = cache.days[date]
      const same =
        prev &&
        prev.marginYi === next.marginYi &&
        prev.financingYi === next.financingYi &&
        prev.securitiesYi === next.securitiesYi

      if (!same) {
        cache.days[date] = next
        fetchedMarginDays += 1
      }

      // 已有缓存：翻到早于 refreshFrom 的日期即可停（倒序）
      if (refreshFrom && date < refreshFrom && lastCached) {
        stop = true
      }
    }

    if (stop) break
    if (page >= pages) break
    // 冷启动无缓存时继续翻页；有缓存且本页最老日期已早于 refreshFrom 也会 stop
    if (lastCached && batch.rows.length) {
      const oldest = String(batch.rows[batch.rows.length - 1]?.DIM_DATE || '').slice(0, 10)
      if (refreshFrom && oldest && oldest < refreshFrom) stop = true
    }
    page += 1
    if (!stop) await sleep(180)
  }

  // 上证收盘增量
  const allDates = Object.keys(cache.days).sort()
  const end = new Date()
  const endCompact = `${end.getFullYear()}${String(end.getMonth() + 1).padStart(2, '0')}${String(end.getDate()).padStart(2, '0')}`
  let sseStart = '20100101'
  if (allDates.length) {
    const withClose = allDates.filter((d) => cache.days[d]?.sseClose != null)
    if (withClose.length) {
      const refreshIdx = Math.max(0, withClose.length - refreshRecent)
      sseStart = toCompact(withClose[refreshIdx])
    } else {
      sseStart = toCompact(allDates[0])
    }
  }

  const sseMap = await deps.fetchSseCloseMap(sseStart, endCompact)
  let fetchedSseDays = 0
  for (const [date, close] of sseMap) {
    const day = cache.days[date]
    if (!day) continue
    if (day.sseClose !== close) {
      day.sseClose = close
      fetchedSseDays += 1
    }
  }

  if (fetchedMarginDays > 0 || fetchedSseDays > 0 || !cache.updatedAt) {
    cache.updatedAt = new Date().toISOString()
    await deps.saveCache(cache)
  }

  const series: MarginSeriesPoint[] = Object.entries(cache.days)
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date))

  if (!series.length) throw new Error('两融缓存为空，请检查东财接口或先 seed')

  return {
    series,
    asOf: series[series.length - 1].date,
    fetchedMarginDays,
    fetchedSseDays,
    cacheHitDays: Math.max(0, series.length - fetchedMarginDays),
    note: '两融优先读本地/KV；日常东财倒序分页至缓存重叠处早停，上证用搜狐日期窗口增量。',
  }
}
