import { apiUrl } from '@/api/base'
import { getDayCumulativeTotal, syncIntradayArchive } from '@/api/intraday'
import type { DailyTurnover, RangeKey, TurnoverSeriesResult } from '@/types/market'
import { monthsAgo, toCompactYmd, yearsAgo } from '@/utils/date'
import { calcPercentile } from '@/utils/percentile'
import dayjs from 'dayjs'

interface SohuResponseItem {
  status: number
  hq?: Array<[string, string, string, string, string, string, string, string, string, string]>
}

const SOHU_LABEL: Record<'zs_000001' | 'zs_399001', string> = {
  zs_000001: '上证指数',
  zs_399001: '深证成指',
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchSohuIndexAmountOnce(
  code: 'zs_000001' | 'zs_399001',
  start: string,
  end: string,
): Promise<Map<string, number>> {
  const url = apiUrl(
    `/api/sohu/hisHq?code=${code}&start=${start}&end=${end}&stat=1&order=A&period=d`,
  )
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`${SOHU_LABEL[code]}行情请求失败: ${res.status}`)
  }
  const data = (await res.json()) as SohuResponseItem[]
  const item = data?.[0]
  if (!item || item.status !== 0 || !item.hq?.length) {
    throw new Error(`${SOHU_LABEL[code]}行情无数据`)
  }

  const map = new Map<string, number>()
  for (const row of item.hq) {
    // 成交额单位：万元 → 亿元
    map.set(row[0], Number(row[8]) / 10000)
  }
  return map
}

/** 搜狐偶发 503，带退避重试 */
async function fetchSohuIndexAmount(
  code: 'zs_000001' | 'zs_399001',
  start: string,
  end: string,
  retries = 3,
): Promise<Map<string, number>> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchSohuIndexAmountOnce(code, start, end)
    } catch (e) {
      lastError = e
      const msg = e instanceof Error ? e.message : ''
      const retriable = /:\s*(429|502|503|504)\b/.test(msg)
      if (!retriable || attempt === retries) break
      await sleep(400 * (attempt + 1))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

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
    // 搜狐已有今日收盘点则不再标 provisional；若只要盘中覆盖则保持官方点
    return series
  }

  if (last.date > today) return series

  return [...series, { date: today, amountYi: liveTotal, provisional: true }]
}

/**
 * 拉取沪深两市合计成交额历史，并计算近 3 年百分位。
 * 打开页面即请求最新可获取交易日数据；盘中会追加今日虚线点。
 */
export async function fetchHsTurnoverSeries(): Promise<TurnoverSeriesResult> {
  const end = toCompactYmd()
  // 搜狐单次可返回较长历史；从 2015 年起足够覆盖「全部」
  const start = '20150101'

  const shMap = await fetchSohuIndexAmount('zs_000001', start, end)
  await sleep(200)
  const szMap = await fetchSohuIndexAmount('zs_399001', start, end)

  const dates = [...shMap.keys()].filter((d) => szMap.has(d)).sort()
  if (!dates.length) throw new Error('未能合并沪深成交额数据')

  let series: DailyTurnover[] = dates.map((date) => ({
    date,
    amountYi: Math.round(((shMap.get(date) ?? 0) + (szMap.get(date) ?? 0)) * 10) / 10,
  }))

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
