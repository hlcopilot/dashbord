import { apiUrl } from '@/api/base'
import type { MarginDaily, MarginSeriesResult, RangeKey } from '@/types/market'
import { monthsAgo, yearsAgo } from '@/utils/date'
import { calcPercentile } from '@/utils/percentile'

type MarginApiResult = {
  series: MarginDaily[]
  asOf: string
}

/**
 * 两融主图：服务端缓存优先 + 东财分页早停 / 搜狐上证增量。
 */
export async function fetchMarginSeries(): Promise<MarginSeriesResult> {
  const res = await fetch(apiUrl('/api/margin/series'))
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(body?.message || `两融余额请求失败: ${res.status}`)
  }
  const payload = (await res.json()) as MarginApiResult
  const series = [...(payload.series ?? [])].sort((a, b) => a.date.localeCompare(b.date))
  if (!series.length) throw new Error('未能构建两融余额序列')

  const latest = series[series.length - 1]
  const prev = series.length > 1 ? series[series.length - 2] : null
  const from3y = yearsAgo(latest.date, 3)
  const window3y = series.filter((p) => p.date >= from3y)
  const percentile3y = calcPercentile(
    window3y.map((p) => p.marginYi),
    latest.marginYi,
  )

  return {
    series,
    asOf: latest.date,
    latestMarginYi: latest.marginYi,
    latestSseClose: latest.sseClose,
    deltaYi: prev ? Math.round((latest.marginYi - prev.marginYi) * 100) / 100 : null,
    percentile3y,
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

export function sliceMarginByRange(series: MarginDaily[], range: RangeKey): MarginDaily[] {
  if (!series.length || range === 'all') return series
  const latest = series[series.length - 1].date
  const conf = RANGE_OFFSET[range]
  const from =
    conf.unit === 'month' ? monthsAgo(latest, conf.value) : yearsAgo(latest, conf.value)
  return series.filter((p) => p.date >= from)
}
