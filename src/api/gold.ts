import { apiUrl } from '@/api/base'
import type { GoldDaily, GoldSeriesResult, RangeKey } from '@/types/market'
import { monthsAgo, yearsAgo } from '@/utils/date'

type GoldApiResult = {
  series: GoldDaily[]
  asOf: string
  latestGoldClose: number | null
  latestShauClose?: number | null
  latestAu9999Close?: number | null
  latestXauClose?: number | null
  latestUsdIndex: number | null
  warnings?: string[]
  note?: string
}

/** 黄金主图：服务端缓存优先 + 东财近端增量（518880 / SHAU / Au9999 / XAU / UDI） */
export async function fetchGoldSeries(): Promise<GoldSeriesResult> {
  const res = await fetch(apiUrl('/api/gold/series'))
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    throw new Error(body?.message || `黄金序列请求失败: ${res.status}`)
  }
  const payload = (await res.json()) as GoldApiResult
  const series = [...(payload.series ?? [])]
    .map((d) => ({
      date: d.date,
      goldClose: d.goldClose ?? null,
      shauClose: d.shauClose ?? null,
      au9999Close: d.au9999Close ?? null,
      xauClose: d.xauClose ?? null,
      usdIndex: d.usdIndex ?? null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
  if (!series.length) throw new Error('未能构建黄金序列')

  const latestGold = [...series].reverse().find((d) => d.goldClose != null)
  const latestShau = [...series].reverse().find((d) => d.shauClose != null)
  const latestAu = [...series].reverse().find((d) => d.au9999Close != null)
  const latestXau = [...series].reverse().find((d) => d.xauClose != null)
  const latestUsd = [...series].reverse().find((d) => d.usdIndex != null)

  return {
    series,
    asOf: payload.asOf || series[series.length - 1].date,
    latestGoldClose: payload.latestGoldClose ?? latestGold?.goldClose ?? null,
    latestShauClose: payload.latestShauClose ?? latestShau?.shauClose ?? null,
    latestAu9999Close: payload.latestAu9999Close ?? latestAu?.au9999Close ?? null,
    latestXauClose: payload.latestXauClose ?? latestXau?.xauClose ?? null,
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

export function sliceGoldByRange(series: GoldDaily[], range: RangeKey): GoldDaily[] {
  if (!series.length || range === 'all') return series
  const latest = series[series.length - 1].date
  const conf = RANGE_OFFSET[range]
  const from =
    conf.unit === 'month' ? monthsAgo(latest, conf.value) : yearsAgo(latest, conf.value)
  return series.filter((p) => p.date >= from)
}

/** 仅保留有 518880 收盘的交易日 */
export function filterGoldEtfDays(series: GoldDaily[]): GoldDaily[] {
  return series.filter((d) => d.goldClose != null)
}

/** 仅保留有上海金基准价的交易日 */
export function filterShauDays(series: GoldDaily[]): GoldDaily[] {
  return series.filter((d) => d.shauClose != null)
}

/** 上海金或 Au9999 现货任一有值的交易日（同轴元/克叠图） */
export function filterSpotGoldDays(series: GoldDaily[]): GoldDaily[] {
  return series.filter((d) => d.shauClose != null || d.au9999Close != null)
}

/** 仅保留有伦敦金 XAU 的交易日 */
export function filterXauDays(series: GoldDaily[]): GoldDaily[] {
  return series.filter((d) => d.xauClose != null)
}
