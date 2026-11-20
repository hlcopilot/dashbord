/**
 * 黄金观察日频：缓存优先 + 东财日 K 增量
 * - goldClose：华安黄金 ETF 518880（跟踪 Au9999，ETF 份额价）
 * - shauClose：上海金 SHAU（上金所集中定价基准价，元/克）
 * - au9999Close：上金所 Au9999 现货连续竞价收盘（元/克）
 * - xauClose：伦敦金 / 黄金美元（XAU，美元/盎司）
 * - usdIndex：美元指数 UDI
 * 未收盘时不把「今天」写入日频缓存
 */

import { dailySeriesEndCompact, isDailyCloseReady } from './market-session.ts'

export const GOLD_ETF_SECID = '1.518880'
export const SHAU_SECID = '118.SHAU'
export const AU9999_SECID = '118.AU9999'
export const XAU_SECID = '122.XAU'
export const USD_INDEX_SECID = '100.UDI'
/** 518880 上市附近，冷启动起点 */
export const GOLD_SERIES_COLD_START = '20130718'
/** 上海金集中定价业务上线附近 */
export const SHAU_SERIES_COLD_START = '20160419'
/** 东财 Au9999 日 K 约自 2010 */
export const AU9999_SERIES_COLD_START = '20100104'
/** 东财 XAU（黄金/美元）冷启动 */
export const XAU_SERIES_COLD_START = '20100104'

export type GoldCacheDay = {
  /** 518880 收盘；仅 ETF 交易日有值 */
  goldClose: number | null
  /** 上海金基准价（元/克）；SHAU 交易日有值 */
  shauClose: number | null
  /** Au9999 现货收盘（元/克） */
  au9999Close: number | null
  /** 伦敦金现货代理（美元/盎司） */
  xauClose: number | null
  usdIndex: number | null
}

export type GoldCache = {
  updatedAt?: string
  days: Record<string, GoldCacheDay>
}

export type GoldSeriesPoint = GoldCacheDay & { date: string }

export type GoldSeriesBuildResult = {
  series: GoldSeriesPoint[]
  asOf: string
  latestGoldClose: number | null
  latestShauClose: number | null
  latestAu9999Close: number | null
  latestXauClose: number | null
  latestUsdIndex: number | null
  fetchedGoldDays: number
  fetchedShauDays: number
  fetchedAu9999Days: number
  fetchedXauDays: number
  fetchedUsdDays: number
  cacheHitDays: number
  /** 上游增量失败等非致命告警；有缓存时仍应出图 */
  warnings: string[]
  note: string
}

export type GoldSeriesDeps = {
  /** 东财日 K 收盘价 map：date → close */
  fetchCloseMap: (secid: string, beg: string, end: string) => Promise<Map<string, number>>
  loadCache: () => Promise<GoldCache>
  saveCache: (cache: GoldCache) => Promise<void>
  refreshRecent?: number
}

function toCompact(date: string): string {
  return date.replace(/-/g, '')
}

function roundClose(n: number, digits = 3): number {
  const p = 10 ** digits
  return Math.round(n * p) / p
}

function ensureDay(cache: GoldCache, date: string): GoldCacheDay {
  const prev = cache.days[date]
  if (prev) {
    if (prev.goldClose === undefined) (prev as GoldCacheDay).goldClose = prev.goldClose ?? null
    if (prev.shauClose === undefined) (prev as GoldCacheDay).shauClose = null
    if (prev.au9999Close === undefined) (prev as GoldCacheDay).au9999Close = null
    if (prev.xauClose === undefined) (prev as GoldCacheDay).xauClose = null
    return prev
  }
  const next: GoldCacheDay = {
    goldClose: null,
    shauClose: null,
    au9999Close: null,
    xauClose: null,
    usdIndex: null,
  }
  cache.days[date] = next
  return next
}

export function normalizeGoldCache(raw: unknown): GoldCache {
  if (!raw || typeof raw !== 'object') return { days: {} }
  const obj = raw as Record<string, unknown>
  const rawDays =
    obj.days && typeof obj.days === 'object'
      ? (obj.days as Record<string, Partial<GoldCacheDay>>)
      : {}
  const days: Record<string, GoldCacheDay> = {}
  for (const [date, v] of Object.entries(rawDays)) {
    const gold =
      typeof v.goldClose === 'number' && Number.isFinite(v.goldClose) ? v.goldClose : null
    const shau =
      typeof v.shauClose === 'number' && Number.isFinite(v.shauClose) ? v.shauClose : null
    const au9999 =
      typeof v.au9999Close === 'number' && Number.isFinite(v.au9999Close) ? v.au9999Close : null
    const xau =
      typeof v.xauClose === 'number' && Number.isFinite(v.xauClose) ? v.xauClose : null
    const usd =
      typeof v.usdIndex === 'number' && Number.isFinite(v.usdIndex) ? v.usdIndex : null
    days[date] = {
      goldClose: gold,
      shauClose: shau,
      au9999Close: au9999,
      xauClose: xau,
      usdIndex: usd,
    }
  }
  return {
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : undefined,
    days,
  }
}

async function softFetch(
  deps: GoldSeriesDeps,
  secid: string,
  beg: string,
  end: string,
  label: string,
  hasCache: boolean,
  warnings: string[],
): Promise<Map<string, number>> {
  try {
    return await deps.fetchCloseMap(secid, beg, end)
  } catch (e) {
    if (hasCache) {
      warnings.push(`近端增量未更新（${label}，${beg}–${end}），沿用本地缓存`)
      return new Map()
    }
    throw e instanceof Error ? e : new Error(String(e))
  }
}

function incrementalBeg(
  cache: GoldCache,
  field: keyof GoldCacheDay,
  coldStart: string,
  refreshRecent: number,
): string {
  const withField = Object.keys(cache.days)
    .filter((d) => cache.days[d]?.[field] != null)
    .sort()
  if (withField.length) {
    return toCompact(withField[Math.max(0, withField.length - refreshRecent)])
  }
  return coldStart
}

export async function buildGoldSeries(deps: GoldSeriesDeps): Promise<GoldSeriesBuildResult> {
  const refreshRecent = deps.refreshRecent ?? 5
  const cache = await deps.loadCache()
  cache.days = cache.days ?? {}
  const warnings: string[] = []

  const cachedDates = Object.keys(cache.days).sort()
  const endCompact = dailySeriesEndCompact()
  const hasCache = cachedDates.length > 0

  let goldBeg = GOLD_SERIES_COLD_START
  if (hasCache) {
    const withGold = cachedDates.filter((d) => cache.days[d]?.goldClose != null)
    const base = withGold.length ? withGold : cachedDates
    goldBeg = toCompact(base[Math.max(0, base.length - refreshRecent)])
  }

  const goldMap = await softFetch(
    deps,
    GOLD_ETF_SECID,
    goldBeg,
    endCompact,
    '518880',
    hasCache,
    warnings,
  )

  let fetchedGoldDays = 0
  for (const [date, close] of goldMap) {
    if (!isDailyCloseReady(date)) continue
    const goldClose = roundClose(close, 3)
    const day = ensureDay(cache, date)
    if (day.goldClose !== goldClose) {
      day.goldClose = goldClose
      fetchedGoldDays += 1
    }
  }

  const shauBeg = incrementalBeg(cache, 'shauClose', SHAU_SERIES_COLD_START, refreshRecent)
  const withShau = Object.keys(cache.days).some((d) => cache.days[d]?.shauClose != null)
  const shauMap = await softFetch(
    deps,
    SHAU_SECID,
    shauBeg,
    endCompact,
    '上海金 SHAU',
    hasCache || withShau,
    warnings,
  )

  let fetchedShauDays = 0
  for (const [date, close] of shauMap) {
    if (!isDailyCloseReady(date)) continue
    const shauClose = roundClose(close, 2)
    const day = ensureDay(cache, date)
    if (day.shauClose !== shauClose) {
      day.shauClose = shauClose
      fetchedShauDays += 1
    }
  }

  const auBeg = incrementalBeg(cache, 'au9999Close', AU9999_SERIES_COLD_START, refreshRecent)
  const withAu = Object.keys(cache.days).some((d) => cache.days[d]?.au9999Close != null)
  const auMap = await softFetch(
    deps,
    AU9999_SECID,
    auBeg,
    endCompact,
    'Au9999 现货',
    hasCache || withAu,
    warnings,
  )

  let fetchedAu9999Days = 0
  for (const [date, close] of auMap) {
    if (!isDailyCloseReady(date)) continue
    const au9999Close = roundClose(close, 2)
    const day = ensureDay(cache, date)
    if (day.au9999Close !== au9999Close) {
      day.au9999Close = au9999Close
      fetchedAu9999Days += 1
    }
  }

  const xauBeg = incrementalBeg(cache, 'xauClose', XAU_SERIES_COLD_START, refreshRecent)
  const withXau = Object.keys(cache.days).some((d) => cache.days[d]?.xauClose != null)
  const xauMap = await softFetch(
    deps,
    XAU_SECID,
    xauBeg,
    endCompact,
    '伦敦金 XAU',
    hasCache || withXau,
    warnings,
  )

  let fetchedXauDays = 0
  for (const [date, close] of xauMap) {
    if (!isDailyCloseReady(date)) continue
    // 对齐国内交易日：已有国内金价日才写入，避免单独撑开日历
    const day = cache.days[date]
    if (!day) continue
    const xauClose = roundClose(close, 2)
    if (day.xauClose !== xauClose) {
      day.xauClose = xauClose
      fetchedXauDays += 1
    }
  }

  const allDates = Object.keys(cache.days).sort()
  let usdBeg = GOLD_SERIES_COLD_START
  if (allDates.length) {
    const withUsd = allDates.filter((d) => cache.days[d]?.usdIndex != null)
    if (withUsd.length) {
      usdBeg = toCompact(withUsd[Math.max(0, withUsd.length - refreshRecent)])
    } else {
      usdBeg = toCompact(allDates[0])
    }
  }

  const usdMap = await softFetch(
    deps,
    USD_INDEX_SECID,
    usdBeg,
    endCompact,
    '美元指数 UDI',
    allDates.length > 0,
    warnings,
  )

  let fetchedUsdDays = 0
  for (const [date, close] of usdMap) {
    const day = cache.days[date]
    if (!day) continue
    if (!isDailyCloseReady(date)) continue
    const usdIndex = roundClose(close, 2)
    if (day.usdIndex !== usdIndex) {
      day.usdIndex = usdIndex
      fetchedUsdDays += 1
    }
  }

  const dirty =
    fetchedGoldDays > 0 ||
    fetchedShauDays > 0 ||
    fetchedAu9999Days > 0 ||
    fetchedXauDays > 0 ||
    fetchedUsdDays > 0 ||
    !cache.updatedAt
  if (dirty) {
    cache.updatedAt = new Date().toISOString()
    await deps.saveCache(cache)
  }

  const series: GoldSeriesPoint[] = Object.entries(cache.days)
    .map(([date, v]) => ({
      date,
      goldClose: v.goldClose ?? null,
      shauClose: v.shauClose ?? null,
      au9999Close: v.au9999Close ?? null,
      xauClose: v.xauClose ?? null,
      usdIndex: v.usdIndex ?? null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  if (!series.length) throw new Error('黄金缓存为空，请检查东财接口或先 npm run series:seed')

  const latestGold = [...series].reverse().find((d) => d.goldClose != null) ?? null
  const latestShau = [...series].reverse().find((d) => d.shauClose != null) ?? null
  const latestAu = [...series].reverse().find((d) => d.au9999Close != null) ?? null
  const latestXau = [...series].reverse().find((d) => d.xauClose != null) ?? null
  const latestUsd = [...series].reverse().find((d) => d.usdIndex != null) ?? null
  const asOf = [
    latestGold?.date,
    latestShau?.date,
    latestAu?.date,
    latestXau?.date,
    latestUsd?.date,
  ]
    .filter(Boolean)
    .sort()
    .at(-1) as string

  return {
    series,
    asOf,
    latestGoldClose: latestGold?.goldClose ?? null,
    latestShauClose: latestShau?.shauClose ?? null,
    latestAu9999Close: latestAu?.au9999Close ?? null,
    latestXauClose: latestXau?.xauClose ?? null,
    latestUsdIndex: latestUsd?.usdIndex ?? null,
    fetchedGoldDays,
    fetchedShauDays,
    fetchedAu9999Days,
    fetchedXauDays,
    fetchedUsdDays,
    cacheHitDays: Math.max(0, series.length - fetchedGoldDays),
    warnings,
    note: 'SHAU/Au9999 元/克；XAU 伦敦金美元/盎司单独成图；518880 为 ETF 份额价；UDI 对照。缓存优先。',
  }
}
