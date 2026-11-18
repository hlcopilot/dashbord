/**
 * ETF 申赎净流入核心逻辑（Vite 中间件 / Worker 共用）
 * 口径：净流入(亿) ≈ Δ总份额(份) × 当日收盘价 / 1e8
 *
 * 缓存策略：
 * - 本地优先使用已缓存的份额 / 收盘价
 * - 历史一次回填后，日常只拉「缺日 + 近几日 pending 重试」
 * - 未收盘不把「今天」当收盘价完整日；份额增量永不包含「今天」（T+1）
 */

import {
  filterDailyCloseReadyDates,
  isEtfShareReady,
  todayYmdShanghai,
} from './market-session.ts'
import { DEFAULT_ETF_CODE, getEtfByCode } from './etf-universe.ts'

export { DEFAULT_ETF_CODE }
export const DEFAULT_ETF_NAME = '沪深300ETF华泰柏瑞'
export const DEFAULT_ETF_SECID = '1.510300'

/** 东财可一次返回上市以来全部日 K；510300 约 3500+ 根 */
export const ETF_KLINE_FULL_LIMIT = 100000

export type EtfFlowDay = {
  date: string
  /** 收盘价（元），作净值近似 */
  close: number
  /** 总份额（万份），交易所披露口径 */
  shareWan: number
  /** 当日净流入（亿元）；缺前值时为 null */
  netInflowYi: number | null
}

export type EtfFlowCache = {
  updatedAt?: string
  code?: string
  /** 日期 → 收盘价 */
  closes: Record<string, number>
  /** 日期 → 总份额（万份） */
  shares: Record<string, number>
}

export type EtfFlowResult = {
  code: string
  name: string
  /** 所属宽基指数 */
  indexName: string
  /** 份额披露交易所 */
  exchange: 'SH' | 'SZ'
  asOf: string
  latestNetInflowYi: number | null
  latestShareWan: number | null
  series: EtfFlowDay[]
  /** 份额尚未披露 / 上游拉取失败的交易日（常见 T+1 或网络失败） */
  pendingDates: string[]
  /** 仍缺份额、尚未拉到的历史交易日数量 */
  missingShareCount: number
  /** 本次从上游新拉到的份额天数 */
  fetchedShareCount: number
  /** 命中本地份额缓存的天数 */
  cacheHitShareCount: number
  /** 日 K：remote=东财；cache=上游失败后用本地 closes */
  klineSource: 'remote' | 'cache'
  /** 非致命告警（增量失败等），有 series 时仍应出图 */
  warnings: string[]
  note: string
}

export type EtfFlowDeps = {
  /** 拉取日 K（建议全量）；返回升序 */
  fetchKlines: (secid: string, limit: number) => Promise<Array<{ date: string; close: number }>>
  /** 拉取某日该 ETF 总份额（万份）；无数据返回 null */
  fetchShareWan: (code: string, date: string) => Promise<number | null>
  loadCache: (code: string) => Promise<EtfFlowCache>
  saveCache: (code: string, cache: EtfFlowCache) => Promise<void>
  concurrency?: number
  /**
   * 单次请求最多向上游补多少个「历史缺日」份额（不含增量尾部与近端重试）。
   * 日常增量通常很少；全量请用 seed 脚本。
   */
  backfillLimit?: number
  /** 对最近若干交易日即使曾失败也重试（等待 T+1 披露） */
  retryRecent?: number
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  async function run() {
    while (i < items.length) {
      const idx = i++
      out[idx] = await worker(items[idx])
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length))
  await Promise.all(Array.from({ length: n }, () => run()))
  return out
}

function emptyCache(): EtfFlowCache {
  return { closes: {}, shares: {} }
}

/** 选出本次需要向上游请求份额的日期（增量优先 + 近端重试 + 可选历史回填） */
export function selectShareFetchDates(
  klineDates: string[],
  cachedShares: Record<string, number>,
  opts?: { backfillLimit?: number; retryRecent?: number },
): string[] {
  const backfillLimit = opts?.backfillLimit ?? 40
  const retryRecent = opts?.retryRecent ?? 8

  const missing = klineDates.filter((d) => {
    const v = cachedShares[d]
    return !(typeof v === 'number' && Number.isFinite(v))
  })
  if (!missing.length) return []

  const cachedKeys = Object.keys(cachedShares)
    .filter((d) => typeof cachedShares[d] === 'number' && Number.isFinite(cachedShares[d]))
    .sort()
  const lastCached = cachedKeys.length ? cachedKeys[cachedKeys.length - 1] : null

  // 份额 T+1：永不拉取「今天」
  const shareMissing = missing.filter((d) => isEtfShareReady(d))

  const recentSet = new Set(klineDates.filter((d) => isEtfShareReady(d)).slice(-retryRecent))
  const incremental = lastCached
    ? shareMissing.filter((d) => d > lastCached)
    : []
  const recentRetry = shareMissing.filter((d) => recentSet.has(d))

  // 历史空洞：从最老缺日开始补一批（seed / 渐进回填）
  const historical = shareMissing.filter(
    (d) => !recentSet.has(d) && !(lastCached && d > lastCached),
  )
  const backfill = historical.slice(0, Math.max(0, backfillLimit))

  return [...new Set([...incremental, ...recentRetry, ...backfill])].sort()
}

export async function buildEtfFlowSeries(
  opts: {
    code?: string
    name?: string
    secid?: string
    indexName?: string
    exchange?: 'SH' | 'SZ'
  },
  deps: EtfFlowDeps,
): Promise<EtfFlowResult> {
  const meta = getEtfByCode(opts.code || DEFAULT_ETF_CODE)
  const code = opts.code || meta.code
  const name = opts.name || meta.name
  const secid = opts.secid || meta.secid
  const indexName = opts.indexName || meta.indexName
  const exchange = opts.exchange || meta.exchange
  const concurrency = deps.concurrency ?? 8
  const backfillLimit = deps.backfillLimit ?? 40
  const retryRecent = deps.retryRecent ?? 8

  const cache = await deps.loadCache(code)
  cache.closes = cache.closes ?? {}
  cache.shares = cache.shares ?? {}
  const warnings: string[] = []

  // 日 K：上游失败则回退本地 closes，不阻断出图
  let klines: Array<{ date: string; close: number }> = []
  let klineSource: 'remote' | 'cache' = 'remote'
  let closesDirty = false
  try {
    klines = await deps.fetchKlines(secid, ETF_KLINE_FULL_LIMIT)
    if (klines.length >= 2) {
      for (const row of klines) {
        if (cache.closes[row.date] !== row.close) {
          cache.closes[row.date] = row.close
          closesDirty = true
        }
      }
    } else {
      throw new Error('ETF 日线不足')
    }
  } catch (e) {
    klineSource = 'cache'
    const msg = e instanceof Error ? e.message : String(e)
    warnings.push(
      `东财日 K 接口网络失败（非 T+1 缺日），已用本地收盘价缓存出图。原因：${msg}`,
    )
    klines = Object.entries(cache.closes)
      .map(([date, close]) => ({ date, close }))
      .filter((r) => Number.isFinite(r.close))
      .sort((a, b) => a.date.localeCompare(b.date))
    if (klines.length < 2) {
      throw new Error(
        `ETF 日 K 上游失败且本地 closes 不足。请网络恢复后重试，或先 npm run etf:seed。原因：${msg}`,
      )
    }
  }

  // 未收盘：去掉「今天」不完整日 K，避免当成完整交易日写入/增量
  const readyDates = new Set(filterDailyCloseReadyDates(klines.map((k) => k.date)))
  const droppedToday = klines.some((k) => k.date === todayYmdShanghai() && !readyDates.has(k.date))
  klines = klines.filter((k) => readyDates.has(k.date))
  if (droppedToday) {
    warnings.push(
      `当前未到 A 股收盘（15:00），今日 ${todayYmdShanghai()} 不纳入日频增量；份额为 T+1，今日份额亦不拉取。`,
    )
  }

  const klineDates = klines.map((k) => k.date)
  // 日 K 已走缓存时，仍尝试补近端份额；历史大回填留给 seed
  const toFetch = selectShareFetchDates(klineDates, cache.shares, {
    backfillLimit: klineSource === 'cache' ? 0 : backfillLimit,
    retryRecent,
  })

  let fetchedShareCount = 0
  const pendingDates: string[] = []

  if (toFetch.length) {
    await mapPool(toFetch, concurrency, async (date) => {
      try {
        const wan = await deps.fetchShareWan(code, date)
        if (wan == null || !Number.isFinite(wan)) {
          pendingDates.push(date)
          return
        }
        cache.shares[date] = wan
        fetchedShareCount += 1
      } catch {
        pendingDates.push(date)
      }
    })
  }

  if (!Object.keys(cache.shares).length) {
    throw new Error(
      'ETF 份额缓存为空且上游拉取失败。请先 npm run etf:seed（云端再 npm run cf:series:seed）。',
    )
  }

  const stillMissing = klineDates.filter((d) => {
    const v = cache.shares[d]
    return !(typeof v === 'number' && Number.isFinite(v))
  })

  if (pendingDates.length) {
    const sample = [...new Set(pendingDates)].sort().slice(-5)
    warnings.push(
      `份额增量未齐（${pendingDates.length} 日），近端示例：${sample.join('、')}。图为已缓存区间，缺日不画断点。`,
    )
  }

  if (closesDirty || fetchedShareCount > 0) {
    cache.updatedAt = new Date().toISOString()
    cache.code = code
    await deps.saveCache(code, cache)
  }

  let cacheHitShareCount = 0
  const series: EtfFlowDay[] = []
  for (let i = 0; i < klines.length; i++) {
    const { date, close } = klines[i]
    const shareWan = cache.shares[date]
    if (!(typeof shareWan === 'number' && Number.isFinite(shareWan))) continue
    if (!toFetch.includes(date)) cacheHitShareCount += 1

    let netInflowYi: number | null = null
    if (i > 0) {
      const prev = klines[i - 1]
      const prevShare = cache.shares[prev.date]
      if (typeof prevShare === 'number' && Number.isFinite(prevShare)) {
        netInflowYi = Math.round(((shareWan - prevShare) * 10000 * close) / 1e8 * 100) / 100
      }
    }
    series.push({ date, close, shareWan, netInflowYi })
  }

  if (series.length < 2) {
    throw new Error('ETF 缓存中可对齐的「份额+收盘价」不足两日，无法出图')
  }

  const last = series[series.length - 1]
  return {
    code,
    name,
    indexName,
    exchange,
    asOf: last.date,
    latestNetInflowYi: last.netInflowYi ?? null,
    latestShareWan: last.shareWan ?? null,
    series,
    pendingDates: [...new Set(pendingDates)].sort(),
    missingShareCount: stillMissing.length,
    fetchedShareCount,
    cacheHitShareCount,
    klineSource,
    warnings,
    note:
      '净流入 ≈ 日份额变动 × 收盘价。份额/收盘价优先读本地缓存；上游增量失败时仍用缓存出图，并在 warnings/pendingDates 标注缺日。',
  }
}

export function parseEmKlines(payload: {
  data?: { klines?: string[] } | null
}): Array<{ date: string; close: number }> {
  const lines = payload.data?.klines ?? []
  const out: Array<{ date: string; close: number }> = []
  for (const line of lines) {
    const parts = line.split(',')
    if (parts.length < 3) continue
    const date = parts[0]
    const close = Number(parts[2])
    if (!date || !Number.isFinite(close)) continue
    out.push({ date, close })
  }
  return out
}

export function parseSseShareWan(
  payload: { result?: Array<Record<string, string>> | null },
  code: string,
): number | null {
  const rows = payload.result ?? []
  const hit = rows.find((r) => r.SEC_CODE === code)
  if (!hit?.TOT_VOL) return null
  const wan = Number(hit.TOT_VOL)
  return Number.isFinite(wan) ? wan : null
}

export function normalizeCache(raw: unknown): EtfFlowCache {
  if (!raw || typeof raw !== 'object') return emptyCache()
  const obj = raw as Record<string, unknown>
  const closes =
    obj.closes && typeof obj.closes === 'object' ? (obj.closes as Record<string, number>) : {}
  const shares =
    obj.shares && typeof obj.shares === 'object' ? (obj.shares as Record<string, number>) : {}
  return {
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : undefined,
    code: typeof obj.code === 'string' ? obj.code : undefined,
    closes,
    shares,
  }
}
