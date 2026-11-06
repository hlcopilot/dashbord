import { apiUrl } from '@/api/base'
import type { MarginDaily, MarginSeriesResult, RangeKey } from '@/types/market'
import { monthsAgo, yearsAgo } from '@/utils/date'
import { calcPercentile } from '@/utils/percentile'

interface EmMarginRow {
  DIM_DATE: string
  RZRQYE: number
  RZYE: number
  RQYE: number
}

interface EmPageResult {
  result?: {
    data?: EmMarginRow[]
    pages?: number
    count?: number
  }
  success?: boolean
  message?: string
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchMarginPage(pageNumber: number, pageSize = 800): Promise<EmPageResult> {
  const url = apiUrl(
    `/api/emdc/api/data/v1/get` +
      `?reportName=RPTA_RZRQ_LSHJ` +
      `&columns=DIM_DATE,RZRQYE,RZYE,RQYE` +
      `&pageNumber=${pageNumber}&pageSize=${pageSize}` +
      `&sortTypes=-1&sortColumns=DIM_DATE&source=WEB&client=WEB`,
  )
  const res = await fetch(url)
  if (!res.ok) throw new Error(`两融余额请求失败: ${res.status}`)
  return (await res.json()) as EmPageResult
}

/** 拉取沪深两融余额全历史（东财，分页） */
async function fetchAllMarginRows(): Promise<EmMarginRow[]> {
  const first = await fetchMarginPage(1)
  if (!first.result?.data?.length) {
    throw new Error(first.message || '两融余额无数据')
  }
  const pages = first.result.pages ?? 1
  const rows = [...first.result.data]
  for (let p = 2; p <= pages; p++) {
    await sleep(180)
    const page = await fetchMarginPage(p)
    if (page.result?.data?.length) rows.push(...page.result.data)
  }
  return rows
}

/**
 * 上证收盘：走搜狐，带重试；与成交额卡片错开，避免并发 500。
 * 失败时返回空 map，两融主曲线仍可展示。
 */
async function fetchSseCloseMap(retries = 3): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // 拉长起点与成交额卡错开参数，降低同时打同一 URL 的概率
      const url = apiUrl(
        `/api/sohu/hisHq?code=zs_000001&start=20100101&end=20500101&stat=1&order=A&period=d`,
      )
      const res = await fetch(url)
      if (!res.ok) throw new Error(`上证指数请求失败: ${res.status}`)
      const data = (await res.json()) as Array<{
        status: number
        hq?: Array<[string, string, string, string, string, string, string, string, string, string]>
      }>
      const item = data?.[0]
      if (!item || item.status !== 0 || !item.hq?.length) {
        throw new Error('上证指数无数据')
      }
      for (const row of item.hq) {
        map.set(row[0], Number(row[2]))
      }
      return map
    } catch (e) {
      lastError = e
      if (attempt < retries) await sleep(500 * (attempt + 1))
    }
  }

  console.warn('[margin] 上证指数拉取失败，仅展示两融余额', lastError)
  return map
}

/**
 * 两融余额 + 上证指数日频序列。
 * 先拉两融，再串行拉上证，避免与成交额卡并发打搜狐。
 */
export async function fetchMarginSeries(): Promise<MarginSeriesResult> {
  const marginRows = await fetchAllMarginRows()
  await sleep(250)
  const sseMap = await fetchSseCloseMap()

  const byDate = new Map<string, MarginDaily>()
  for (const row of marginRows) {
    const date = String(row.DIM_DATE).slice(0, 10)
    if (!date) continue
    byDate.set(date, {
      date,
      marginYi: Math.round((Number(row.RZRQYE) / 1e8) * 100) / 100,
      financingYi: Math.round((Number(row.RZYE) / 1e8) * 100) / 100,
      securitiesYi: Math.round((Number(row.RQYE) / 1e8) * 100) / 100,
      sseClose: sseMap.get(date) ?? null,
    })
  }

  const series = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
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
