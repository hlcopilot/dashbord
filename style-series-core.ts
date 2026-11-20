/**
 * 风格观察日频：
 * - 点位比：创业板指(0.399006) / 中证红利(1.000922)
 * - 估值比：创业板指 TTM PE / 中证红利 TTM PE（乐咕乐股月频）
 */

import { dailySeriesEndCompact, isDailyCloseReady } from './market-session.ts'

export const CYB_SECID = '0.399006'
export const DIV_SECID = '1.000922'
export const STYLE_CLOSE_COLD_START = '20100601'
export const CYB_PE_CODE = '399006.SZ'
export const DIV_PE_CODE = '000922.CSI'

export type StyleCacheDay = {
  cybClose: number | null
  divClose: number | null
  /** 创业板指 TTM PE（乐咕，多为月频月末） */
  cybPe: number | null
  /** 中证红利 TTM PE */
  divPe: number | null
}

export type StyleCache = {
  updatedAt?: string
  days: Record<string, StyleCacheDay>
}

export type StyleSeriesPoint = StyleCacheDay & {
  date: string
  closeRatio: number | null
  peRatio: number | null
}

export type StyleSeriesBuildResult = {
  series: StyleSeriesPoint[]
  asOf: string
  latestCloseRatio: number | null
  latestPeRatio: number | null
  latestCybClose: number | null
  latestDivClose: number | null
  latestCybPe: number | null
  latestDivPe: number | null
  fetchedCloseDays: number
  fetchedPeDays: number
  cacheHitDays: number
  warnings: string[]
  note: string
}

export type StyleSeriesDeps = {
  fetchCloseMap: (secid: string, beg: string, end: string) => Promise<Map<string, number>>
  /** date → ttmPe */
  fetchPeMap: (indexCode: string) => Promise<Map<string, number>>
  loadCache: () => Promise<StyleCache>
  saveCache: (cache: StyleCache) => Promise<void>
  refreshRecent?: number
}

function toCompact(date: string): string {
  return date.replace(/-/g, '')
}

function round(n: number, digits: number): number {
  const p = 10 ** digits
  return Math.round(n * p) / p
}

function ensureDay(cache: StyleCache, date: string): StyleCacheDay {
  const prev = cache.days[date]
  if (prev) {
    if (prev.cybClose === undefined) (prev as StyleCacheDay).cybClose = null
    if (prev.divClose === undefined) (prev as StyleCacheDay).divClose = null
    if (prev.cybPe === undefined) (prev as StyleCacheDay).cybPe = null
    if (prev.divPe === undefined) (prev as StyleCacheDay).divPe = null
    return prev
  }
  const next: StyleCacheDay = { cybClose: null, divClose: null, cybPe: null, divPe: null }
  cache.days[date] = next
  return next
}

export function normalizeStyleCache(raw: unknown): StyleCache {
  if (!raw || typeof raw !== 'object') return { days: {} }
  const obj = raw as Record<string, unknown>
  const rawDays =
    obj.days && typeof obj.days === 'object'
      ? (obj.days as Record<string, Partial<StyleCacheDay>>)
      : {}
  const days: Record<string, StyleCacheDay> = {}
  for (const [date, v] of Object.entries(rawDays)) {
    const num = (x: unknown) =>
      typeof x === 'number' && Number.isFinite(x) ? x : null
    days[date] = {
      cybClose: num(v.cybClose),
      divClose: num(v.divClose),
      cybPe: num(v.cybPe),
      divPe: num(v.divPe),
    }
  }
  return {
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : undefined,
    days,
  }
}

function ratio(a: number | null, b: number | null): number | null {
  if (a == null || b == null || b === 0) return null
  return round(a / b, 4)
}

async function softFetchClose(
  deps: StyleSeriesDeps,
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

function incrementalCloseBeg(
  cache: StyleCache,
  field: 'cybClose' | 'divClose',
  cold: string,
  refreshRecent: number,
): string {
  const withField = Object.keys(cache.days)
    .filter((d) => cache.days[d]?.[field] != null)
    .sort()
  if (withField.length) {
    return toCompact(withField[Math.max(0, withField.length - refreshRecent)])
  }
  return cold
}

export async function buildStyleSeries(deps: StyleSeriesDeps): Promise<StyleSeriesBuildResult> {
  const refreshRecent = deps.refreshRecent ?? 5
  const cache = await deps.loadCache()
  cache.days = cache.days ?? {}
  const warnings: string[] = []
  const hasCache = Object.keys(cache.days).length > 0
  const endCompact = dailySeriesEndCompact()

  const cybBeg = incrementalCloseBeg(cache, 'cybClose', STYLE_CLOSE_COLD_START, refreshRecent)
  const divBeg = incrementalCloseBeg(cache, 'divClose', STYLE_CLOSE_COLD_START, refreshRecent)

  const cybMap = await softFetchClose(
    deps,
    CYB_SECID,
    cybBeg,
    endCompact,
    '创业板指',
    hasCache,
    warnings,
  )
  const divMap = await softFetchClose(
    deps,
    DIV_SECID,
    divBeg,
    endCompact,
    '中证红利',
    hasCache,
    warnings,
  )

  let fetchedCloseDays = 0
  for (const [date, close] of cybMap) {
    if (!isDailyCloseReady(date)) continue
    const day = ensureDay(cache, date)
    const v = round(close, 2)
    if (day.cybClose !== v) {
      day.cybClose = v
      fetchedCloseDays += 1
    }
  }
  for (const [date, close] of divMap) {
    if (!isDailyCloseReady(date)) continue
    const day = ensureDay(cache, date)
    const v = round(close, 2)
    if (day.divClose !== v) {
      day.divClose = v
      fetchedCloseDays += 1
    }
  }

  let fetchedPeDays = 0
  const needPe =
    !Object.values(cache.days).some((d) => d.cybPe != null) ||
    !Object.values(cache.days).some((d) => d.divPe != null)
  try {
    const [cybPeMap, divPeMap] = await Promise.all([
      deps.fetchPeMap(CYB_PE_CODE),
      deps.fetchPeMap(DIV_PE_CODE),
    ])
    for (const [date, pe] of cybPeMap) {
      if (!isDailyCloseReady(date)) continue
      const day = ensureDay(cache, date)
      const v = round(pe, 2)
      if (day.cybPe !== v) {
        day.cybPe = v
        fetchedPeDays += 1
      }
    }
    for (const [date, pe] of divPeMap) {
      if (!isDailyCloseReady(date)) continue
      const day = ensureDay(cache, date)
      const v = round(pe, 2)
      if (day.divPe !== v) {
        day.divPe = v
        fetchedPeDays += 1
      }
    }
  } catch (e) {
    if (needPe && !hasCache) throw e
    warnings.push(
      `估值 PE 增量未更新（${e instanceof Error ? e.message : String(e)}），沿用缓存`,
    )
  }

  if (fetchedCloseDays > 0 || fetchedPeDays > 0 || !cache.updatedAt) {
    cache.updatedAt = new Date().toISOString()
    await deps.saveCache(cache)
  }

  const series: StyleSeriesPoint[] = Object.entries(cache.days)
    .map(([date, v]) => ({
      date,
      cybClose: v.cybClose ?? null,
      divClose: v.divClose ?? null,
      cybPe: v.cybPe ?? null,
      divPe: v.divPe ?? null,
      closeRatio: ratio(v.cybClose ?? null, v.divClose ?? null),
      peRatio: ratio(v.cybPe ?? null, v.divPe ?? null),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  if (!series.length) throw new Error('风格缓存为空，请先 npm run series:seed -- style')

  const latestClose = [...series].reverse().find((d) => d.closeRatio != null) ?? null
  const latestPe = [...series].reverse().find((d) => d.peRatio != null) ?? null
  const latestCyb = [...series].reverse().find((d) => d.cybClose != null) ?? null
  const latestDiv = [...series].reverse().find((d) => d.divClose != null) ?? null
  const latestCybPe = [...series].reverse().find((d) => d.cybPe != null) ?? null
  const latestDivPe = [...series].reverse().find((d) => d.divPe != null) ?? null
  const asOf = [latestClose?.date, latestPe?.date].filter(Boolean).sort().at(-1) as string

  return {
    series,
    asOf,
    latestCloseRatio: latestClose?.closeRatio ?? null,
    latestPeRatio: latestPe?.peRatio ?? null,
    latestCybClose: latestCyb?.cybClose ?? null,
    latestDivClose: latestDiv?.divClose ?? null,
    latestCybPe: latestCybPe?.cybPe ?? null,
    latestDivPe: latestDivPe?.divPe ?? null,
    fetchedCloseDays,
    fetchedPeDays,
    cacheHitDays: Math.max(0, series.length - fetchedCloseDays),
    warnings,
    note: '点位比=创业板指/中证红利（日频）；估值比=两者 TTM PE 之比（乐咕月频）。',
  }
}
