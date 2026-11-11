import { apiUrl } from '@/api/base'
import { getDayCumulativeTotal, syncIntradayArchive } from '@/api/intraday'
import type { DailyTurnover, RangeKey, TurnoverSeriesResult } from '@/types/market'
import { monthsAgo, yearsAgo } from '@/utils/date'
import { calcPercentile } from '@/utils/percentile'
import dayjs from 'dayjs'

function todayYmd(): string {
  return dayjs().format('YYYY-MM-DD')
}

/**
 * 若日线尚未包含「今天」，用分时累计补一个盘中临时点（虚线点）。
 * 同时把东财近 5 日分时写入本地归档。
 */
async function appendProvisionalToday(series: DailyTurnover[]): Promise<DailyTurnover[]> {
  await syncIntradayArchive()
  const today = todayYmd()
  const liveTotal = await getDayCumulativeTotal(today)
  if (liveTotal == null || liveTotal <= 0) return series

  const last = series[series.length - 1]
  if (!last) {
    return [{ date: today, amountYi: liveTotal, provisional: true }]
  }

  if (last.date === today) {
    return series
  }

  if (last.date > today) return series

  return [...series, { date: today, amountYi: liveTotal, provisional: true }]
}

type TurnoverApiResult = {
  series: Array<{ date: string; amountYi: number }>
  asOf: string
}

/**
 * 成交额主图：服务端缓存优先 + 搜狐增量窗口；前端仅补盘中虚线点与百分位。
 */
export async function fetchHsTurnoverSeries(): Promise<TurnoverSeriesResult> {
  const res = await fetch(apiUrl('/api/turnover/series'))
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(body?.message || `成交额请求失败: ${res.status}`)
  }
  const payload = (await res.json()) as TurnoverApiResult
  let series: DailyTurnover[] = (payload.series ?? []).map((p) => ({
    date: p.date,
    amountYi: p.amountYi,
  }))
  if (!series.length) throw new Error('成交额无数据')

  series = await appendProvisionalToday(series)

  const closed = series.filter((p) => !p.provisional)
  const latestClosed = closed[closed.length - 1] ?? series[series.length - 1]
  const latest = series[series.length - 1]
  const from3y = yearsAgo(latestClosed.date, 3)
  const window3y = closed.filter((p) => p.date >= from3y)
  const percentile3y = calcPercentile(
    window3y.map((p) => p.amountYi),
    latest.amountYi,
  )

  return {
    series,
    asOf: latest.date,
    latestAmountYi: latest.amountYi,
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

export function sliceByRange(series: DailyTurnover[], range: RangeKey): DailyTurnover[] {
  if (!series.length || range === 'all') return series
  const latest = series[series.length - 1].date
  const conf = RANGE_OFFSET[range]
  const from =
    conf.unit === 'month' ? monthsAgo(latest, conf.value) : yearsAgo(latest, conf.value)
  return series.filter((p) => p.date >= from)
}
