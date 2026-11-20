/**
 * 石油观察日频：缓存优先 + 东财日 K 增量
 * - brentClose：布伦特原油当月连续 112.B00Y（美元/桶）
 * - wtiClose：NYMEX 原油连续 102.CL00Y（美元/桶，WTI 代理）
 * - usdIndex：美元指数 UDI
 */

import { dailySeriesEndCompact, isDailyCloseReady } from './market-session.ts'

export const BRENT_SECID = '112.B00Y'
export const WTI_SECID = '102.CL00Y'
export const USD_INDEX_SECID = '100.UDI'
export const OIL_SERIES_COLD_START = '20100104'

export type OilCacheDay = {
  brentClose: number | null
  wtiClose: number | null
  usdIndex: number | null
}

export type OilCache = {
  updatedAt?: string
  days: Record<string, OilCacheDay>
}

export type OilSeriesPoint = OilCacheDay & { date: string }

export type OilSeriesBuildResult = {
  series: OilSeriesPoint[]
  asOf: string
  latestBrentClose: number | null
  latestWtiClose: number | null
  latestUsdIndex: number | null
  fetchedBrentDays: number
  fetchedWtiDays: number
  fetchedUsdDays: number
  cacheHitDays: number
  warnings: string[]
  note: string
}

export type OilSeriesDeps = {
  fetchCloseMap: (secid: string, beg: string, end: string) => Promise<Map<string, number>>
  loadCache: () => Promise<OilCache>
  saveCache: (cache: OilCache) => Promise<void>
  refreshRecent?: number
}

function toCompact(date: string): string {
  return date.replace(/-/g, '')
}

function roundClose(n: number, digits = 2): number {
  const p = 10 ** digits
  return Math.round(n * p) / p
}

function ensureDay(cache: OilCache, date: string): OilCacheDay {
  const prev = cache.days[date]
  if (prev) {
    if (prev.brentClose === undefined) (prev as OilCacheDay).brentClose = null
    if (prev.wtiClose === undefined) (prev as OilCacheDay).wtiClose = null
    if (prev.usdIndex === undefined) (prev as OilCacheDay).usdIndex = null
    return prev
  }
  const next: OilCacheDay = { brentClose: null, wtiClose: null, usdIndex: null }
  cache.days[date] = next
  return next
}

export function normalizeOilCache(raw: unknown): OilCache {
  if (!raw || typeof raw !== 'object') return { days: {} }
  const obj = raw as Record<string, unknown>
  const rawDays =
    obj.days && typeof obj.days === 'object'
      ? (obj.days as Record<string, Partial<OilCacheDay>>)
      : {}
  const days: Record<string, OilCacheDay> = {}
  for (const [date, v] of Object.entries(rawDays)) {
    const brent =
      typeof v.brentClose === 'number' && Number.isFinite(v.brentClose) ? v.brentClose : null
    const wti =
      typeof v.wtiClose === 'number' && Number.isFinite(v.wtiClose) ? v.wtiClose : null
    const usd =
      typeof v.usdIndex === 'number' && Number.isFinite(v.usdIndex) ? v.usdIndex : null
    days[date] = { brentClose: brent, wtiClose: wti, usdIndex: usd }
  }
  return {
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : undefined,
    days,
  }
}

async function softFetch(
  deps: OilSeriesDeps,
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
  cache: OilCache,
  field: keyof OilCacheDay,
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

export async function buildOilSeries(deps: OilSeriesDeps): Promise<OilSeriesBuildResult> {
  const refreshRecent = deps.refreshRecent ?? 5
  const cache = await deps.loadCache()
  cache.days = cache.days ?? {}
  const warnings: string[] = []
  const cachedDates = Object.keys(cache.days).sort()
  const endCompact = dailySeriesEndCompact()
  const hasCache = cachedDates.length > 0

  const brentBeg = incrementalBeg(cache, 'brentClose', OIL_SERIES_COLD_START, refreshRecent)
  const withBrent = Object.keys(cache.days).some((d) => cache.days[d]?.brentClose != null)
  const brentMap = await softFetch(
    deps,
    BRENT_SECID,
    brentBeg,
    endCompact,
    '布伦特 B00Y',
    hasCache || withBrent,
    warnings,
  )

  let fetchedBrentDays = 0
  for (const [date, close] of brentMap) {
    if (!isDailyCloseReady(date)) continue
    const brentClose = roundClose(close, 2)
    const day = ensureDay(cache, date)
    if (day.brentClose !== brentClose) {
      day.brentClose = brentClose
      fetchedBrentDays += 1
    }
  }

  const wtiBeg = incrementalBeg(cache, 'wtiClose', OIL_SERIES_COLD_START, refreshRecent)
  const withWti = Object.keys(cache.days).some((d) => cache.days[d]?.wtiClose != null)
  const wtiMap = await softFetch(
    deps,
    WTI_SECID,
    wtiBeg,
    endCompact,
    'WTI CL00Y',
    hasCache || withWti,
    warnings,
  )

  let fetchedWtiDays = 0
  for (const [date, close] of wtiMap) {
    if (!isDailyCloseReady(date)) continue
    const wtiClose = roundClose(close, 2)
    const day = ensureDay(cache, date)
    if (day.wtiClose !== wtiClose) {
      day.wtiClose = wtiClose
      fetchedWtiDays += 1
    }
  }

  const allDates = Object.keys(cache.days).sort()
  let usdBeg = OIL_SERIES_COLD_START
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
    fetchedBrentDays > 0 || fetchedWtiDays > 0 || fetchedUsdDays > 0 || !cache.updatedAt
  if (dirty) {
    cache.updatedAt = new Date().toISOString()
    await deps.saveCache(cache)
  }

  const series: OilSeriesPoint[] = Object.entries(cache.days)
    .map(([date, v]) => ({
      date,
      brentClose: v.brentClose ?? null,
      wtiClose: v.wtiClose ?? null,
      usdIndex: v.usdIndex ?? null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  if (!series.length) throw new Error('石油缓存为空，请检查东财接口或先 npm run series:seed -- oil')

  const latestBrent = [...series].reverse().find((d) => d.brentClose != null) ?? null
  const latestWti = [...series].reverse().find((d) => d.wtiClose != null) ?? null
  const latestUsd = [...series].reverse().find((d) => d.usdIndex != null) ?? null
  const asOf = [latestBrent?.date, latestWti?.date, latestUsd?.date]
    .filter(Boolean)
    .sort()
    .at(-1) as string

  return {
    series,
    asOf,
    latestBrentClose: latestBrent?.brentClose ?? null,
    latestWtiClose: latestWti?.wtiClose ?? null,
    latestUsdIndex: latestUsd?.usdIndex ?? null,
    fetchedBrentDays,
    fetchedWtiDays,
    fetchedUsdDays,
    cacheHitDays: Math.max(0, series.length - fetchedBrentDays),
    warnings,
    note: '布伦特与 WTI 同为美元/桶；右轴美元指数。缓存优先，上游失败仍出图。',
  }
}
