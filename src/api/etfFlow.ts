import { apiUrl } from '@/api/base'
import type { EtfFlowDaily, EtfFlowSeriesResult, RangeKey } from '@/types/market'
import { monthsAgo, yearsAgo } from '@/utils/date'

const DEFAULT_CODE = '510300'

/** 全量序列：份额/收盘价优先本地缓存，仅增量与近端 T+1 重试打上游 */
export async function fetchEtfFlowSeries(code = DEFAULT_CODE): Promise<EtfFlowSeriesResult> {
  const res = await fetch(apiUrl(`/api/etf/flow?code=${encodeURIComponent(code)}`))
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(body?.message || `ETF 净流入请求失败: ${res.status}`)
  }
  return (await res.json()) as EtfFlowSeriesResult
}

export function sliceEtfFlowByRange(series: EtfFlowDaily[], range: RangeKey): EtfFlowDaily[] {
  if (!series.length || range === 'all') return series
  const asOf = series[series.length - 1].date
  const start =
    range === '1m'
      ? monthsAgo(asOf, 1)
      : range === '3m'
        ? monthsAgo(asOf, 3)
        : range === '6m'
          ? monthsAgo(asOf, 6)
          : range === '1y'
            ? yearsAgo(asOf, 1)
            : yearsAgo(asOf, 3)
  return series.filter((d) => d.date >= start)
}
