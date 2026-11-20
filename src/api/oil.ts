import { apiUrl } from '@/api/base'
import type { OilDaily, OilSeriesResult, RangeKey } from '@/types/market'
import { monthsAgo, yearsAgo } from '@/utils/date'

type OilApiResult = {
  series: OilDaily[]
  asOf: string
  latestBrentClose: number | null
  latestWtiClose: number | null
  latestUsdIndex: number | null
  warnings?: string[]
  note?: string
}

/** 石油主图：服务端缓存优先 + 东财近端增量（Brent / WTI / UDI） */
export async function fetchOilSeries(): Promise<OilSeriesResult> {
  const res = await fetch(apiUrl('/api/oil/series'))
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(body?.message || `石油序列请求失败: ${res.status}`)
  }
  const payload = (await res.json()) as OilApiResult
  const series = [...(payload.series ?? [])]
    .map((d) => ({
      date: d.date,
      brentClose: d.brentClose ?? null,
      wtiClose: d.wtiClose ?? null,
      usdIndex: d.usdIndex ?? null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
  if (!series.length) throw new Error('未能构建石油序列')

  const latestBrent = [...series].reverse().find((d) => d.brentClose != null)
  const latestWti = [...series].reverse().find((d) => d.wtiClose != null)
  const latestUsd = [...series].reverse().find((d) => d.usdIndex != null)

  return {
    series,
    asOf: payload.asOf || series[series.length - 1].date,
    latestBrentClose: payload.latestBrentClose ?? latestBrent?.brentClose ?? null,
    latestWtiClose: payload.latestWtiClose ?? latestWti?.wtiClose ?? null,
    latestUsdIndex: payload.latestUsdIndex ?? latestUsd?.usdIndex ?? null,
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

export function sliceOilByRange(series: OilDaily[], range: RangeKey): OilDaily[] {
  if (!series.length || range === 'all') return series
  const latest = series[series.length - 1].date
  const conf = RANGE_OFFSET[range]
  const from =
    conf.unit === 'month' ? monthsAgo(latest, conf.value) : yearsAgo(latest, conf.value)
  return series.filter((p) => p.date >= from)
}

/** 布伦特或 WTI 任一有值 */
export function filterOilDays(series: OilDaily[]): OilDaily[] {
  return series.filter((d) => d.brentClose != null || d.wtiClose != null)
}
