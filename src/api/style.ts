import { apiUrl } from '@/api/base'
import type { RangeKey, StyleDaily, StyleSeriesResult } from '@/types/market'
import { monthsAgo, yearsAgo } from '@/utils/date'
import { calcPercentile } from '@/utils/percentile'

type StyleApiResult = {
  series: StyleDaily[]
  asOf: string
  latestCloseRatio: number | null
  latestPeRatio: number | null
  latestCybClose: number | null
  latestDivClose: number | null
  latestCybPe: number | null
  latestDivPe: number | null
  warnings?: string[]
  note?: string
}

function percentile3y(series: StyleDaily[], field: 'closeRatio' | 'peRatio'): number {
  const latest = [...series].reverse().find((d) => d[field] != null)
  if (!latest || latest[field] == null) return 0
  const from = yearsAgo(latest.date, 3)
  const values = series
    .filter((d) => d.date >= from && d[field] != null)
    .map((d) => d[field] as number)
  return calcPercentile(values, latest[field] as number)
}

/** 风格主图：缓存优先 + 东财点位增量 + 乐咕 PE */
export async function fetchStyleSeries(): Promise<StyleSeriesResult> {
  const res = await fetch(apiUrl('/api/style/series'))
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(body?.message || `风格序列请求失败: ${res.status}`)
  }
  const payload = (await res.json()) as StyleApiResult
  const series = [...(payload.series ?? [])]
    .map((d) => ({
      date: d.date,
      cybClose: d.cybClose ?? null,
      divClose: d.divClose ?? null,
      cybPe: d.cybPe ?? null,
      divPe: d.divPe ?? null,
      closeRatio: d.closeRatio ?? null,
      peRatio: d.peRatio ?? null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
  if (!series.length) throw new Error('未能构建风格序列')

  const latestClose = [...series].reverse().find((d) => d.closeRatio != null)
  const latestPe = [...series].reverse().find((d) => d.peRatio != null)
  const latestCyb = [...series].reverse().find((d) => d.cybClose != null)
  const latestDiv = [...series].reverse().find((d) => d.divClose != null)
  const latestCybPe = [...series].reverse().find((d) => d.cybPe != null)
  const latestDivPe = [...series].reverse().find((d) => d.divPe != null)

  return {
    series,
    asOf: payload.asOf || series[series.length - 1].date,
    latestCloseRatio: payload.latestCloseRatio ?? latestClose?.closeRatio ?? null,
    latestPeRatio: payload.latestPeRatio ?? latestPe?.peRatio ?? null,
    latestCybClose: payload.latestCybClose ?? latestCyb?.cybClose ?? null,
    latestDivClose: payload.latestDivClose ?? latestDiv?.divClose ?? null,
    latestCybPe: payload.latestCybPe ?? latestCybPe?.cybPe ?? null,
    latestDivPe: payload.latestDivPe ?? latestDivPe?.divPe ?? null,
    closePercentile3y: percentile3y(series, 'closeRatio'),
    pePercentile3y: percentile3y(series, 'peRatio'),
    warnings: payload.warnings,
    note: payload.note,
  }
}

const RANGE_OFFSET: Record<Exclude<RangeKey, 'all'>, { unit: 'month' | 'year'; value: number }> =
  {
    '1m': { unit: 'month', value: 1 },
    '3m': { unit: 'month', value: 3 },
    '6m': { unit: 'month', value: 6 },
    '1y': { unit: 'year', value: 1 },
    '3y': { unit: 'year', value: 3 },
  }

export function sliceStyleByRange(series: StyleDaily[], range: RangeKey): StyleDaily[] {
  if (!series.length || range === 'all') return series
  const latest = series[series.length - 1].date
  const conf = RANGE_OFFSET[range]
  const from =
    conf.unit === 'month' ? monthsAgo(latest, conf.value) : yearsAgo(latest, conf.value)
  return series.filter((p) => p.date >= from)
}

export function filterCloseRatioDays(series: StyleDaily[]): StyleDaily[] {
  return series.filter((d) => d.closeRatio != null)
}

export function filterPeRatioDays(series: StyleDaily[]): StyleDaily[] {
  return series.filter((d) => d.peRatio != null)
}
