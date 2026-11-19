import { INDEX_DISPLAY_ORDER, type EtfUniverseItem } from '@/etfUniverse'
import type { EtfFlowSeriesResult } from '@/types/market'

export type IndexFlowSlice = {
  indexName: string
  /** 当日该指数合计净流入（亿元）；无有效样本为 null */
  dailyYi: number | null
  /** 自区间起点累计（亿元） */
  cumulativeYi: number
  /** 当日计入的 ETF 只数 */
  sampleCount: number
}

export type BasketCumulativeDay = {
  date: string
  /** 当日篮子合计净流入（亿元） */
  dailyTotalYi: number | null
  /** 自区间起点累计净流入（亿元） */
  cumulativeYi: number
  /** 按 INDEX_DISPLAY_ORDER 的 9 类分解 */
  byIndex: IndexFlowSlice[]
  /** 当日有净流入样本的 ETF 只数 */
  sampleCount: number
}

/** 指数色（tooltip 点） */
export const INDEX_TIP_COLORS: Record<string, string> = {
  沪深300: '#ef4444',
  上证综指: '#f97316',
  上证50: '#eab308',
  中证500: '#84cc16',
  中证1000: '#22c55e',
  科创50: '#14b8a6',
  创业板指: '#3b82f6',
  创业板50: '#8b5cf6',
  中证A500: '#ec4899',
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * 将多只 ETF 日净流入按交易日对齐，汇总篮子当日合计、区间累计，以及 9 个指数分类。
 * 缺样本的 ETF/日不计入（不当 0），累计只加当日有值的合计。
 */
export function buildBasketCumulativeSeries(
  results: EtfFlowSeriesResult[],
  universe: EtfUniverseItem[],
): BasketCumulativeDay[] {
  if (!results.length) return []

  const codeToIndex = new Map(universe.map((e) => [e.code, e.indexName]))
  const indexNames = INDEX_DISPLAY_ORDER.filter((name) =>
    universe.some((e) => e.indexName === name),
  )

  const dateSet = new Set<string>()
  const byCodeDate = new Map<string, Map<string, number | null>>()

  for (const r of results) {
    const m = new Map<string, number | null>()
    for (const d of r.series) {
      dateSet.add(d.date)
      m.set(d.date, d.netInflowYi)
    }
    byCodeDate.set(r.code, m)
  }

  const dates = [...dateSet].sort()
  let runTotal = 0
  const runByIndex = new Map<string, number>(indexNames.map((n) => [n, 0]))

  const out: BasketCumulativeDay[] = []

  for (const date of dates) {
    const indexAcc = new Map<string, { sum: number; count: number }>()
    for (const name of indexNames) indexAcc.set(name, { sum: 0, count: 0 })

    let daySum = 0
    let dayCount = 0

    for (const [code, series] of byCodeDate) {
      const v = series.get(date)
      if (v == null) continue
      const indexName = codeToIndex.get(code) ?? '未分类'
      const bucket = indexAcc.get(indexName)
      if (bucket) {
        bucket.sum += v
        bucket.count += 1
      }
      daySum += v
      dayCount += 1
    }

    const dailyTotalYi = dayCount > 0 ? round2(daySum) : null
    if (dailyTotalYi != null) runTotal = round2(runTotal + dailyTotalYi)

    const byIndex: IndexFlowSlice[] = indexNames.map((indexName) => {
      const bucket = indexAcc.get(indexName)!
      const dailyYi = bucket.count > 0 ? round2(bucket.sum) : null
      if (dailyYi != null) {
        runByIndex.set(indexName, round2((runByIndex.get(indexName) ?? 0) + dailyYi))
      }
      return {
        indexName,
        dailyYi,
        cumulativeYi: runByIndex.get(indexName) ?? 0,
        sampleCount: bucket.count,
      }
    })

    out.push({
      date,
      dailyTotalYi,
      cumulativeYi: runTotal,
      byIndex,
      sampleCount: dayCount,
    })
  }

  return out
}
