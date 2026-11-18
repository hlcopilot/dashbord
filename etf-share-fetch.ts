/**
 * ETF 日频总份额（万份）：上交所 JSON / 深交所基金规模 JSON
 * Vite 中间件与 Worker 共用
 */

import { parseSseShareWan } from './etf-flow-core.ts'
import { getEtfByCode } from './etf-universe.ts'

export const ETF_SHARE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

type SzseScaleRow = {
  size_date?: string
  fund_code?: string
  security_short_name?: string
  current_size?: string | number
}

type SzseScalePayload = Array<{
  data?: SzseScaleRow[] | null
  metadata?: { pagecount?: number; recordcount?: number; pagesize?: number }
}>

export async function fetchSseShareWan(etfCode: string, date: string): Promise<number | null> {
  try {
    const qs = new URLSearchParams({
      isPagination: 'true',
      'pageHelp.pageSize': '10000',
      'pageHelp.pageNo': '1',
      'pageHelp.beginPage': '1',
      'pageHelp.cacheSize': '1',
      'pageHelp.endPage': '1',
      sqlId: 'COMMON_SSE_ZQPZ_ETFZL_XXPL_ETFGM_SEARCH_L',
      STAT_DATE: date,
    })
    const r = await fetch(`https://query.sse.com.cn/commonQuery.do?${qs}`, {
      headers: { Referer: 'https://www.sse.com.cn/', 'User-Agent': ETF_SHARE_UA },
    })
    if (!r.ok) return null
    return parseSseShareWan(
      (await r.json()) as { result?: Array<Record<string, string>> },
      etfCode,
    )
  } catch {
    return null
  }
}

function parseSzseSizeWan(raw: string | number | undefined): number | null {
  if (raw == null) return null
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

function normalizeFundCode(code: string | undefined): string {
  return String(code || '').replace(/\D/g, '').padStart(6, '0')
}

async function fetchSzseScalePage(
  date: string,
  page: number,
  etfCode?: string,
): Promise<{ rows: SzseScaleRow[]; pagecount: number }> {
  const qs = new URLSearchParams({
    SHOWTYPE: 'JSON',
    CATALOGID: 'scsj_fund_jjgm',
    TABKEY: 'tab1',
    txtStart: date,
    txtEnd: date,
    jjlb: 'ETF',
    tab1PAGENO: String(page),
    random: String(Math.random()),
  })
  if (etfCode) qs.set('txtDm', etfCode)

  const r = await fetch(`https://www.szse.cn/api/report/ShowReport/data?${qs}`, {
    headers: {
      Referer: 'https://www.szse.cn/market/fund/volume/etf/index.html',
      'User-Agent': ETF_SHARE_UA,
    },
  })
  if (!r.ok) return { rows: [], pagecount: 0 }
  const payload = (await r.json()) as SzseScalePayload
  const block = Array.isArray(payload) ? payload[0] : null
  return {
    rows: block?.data ?? [],
    pagecount: Number(block?.metadata?.pagecount) || 0,
  }
}

/**
 * 深交所日频基金规模：current_size 单位为万份（与上交所 TOT_VOL 对齐）
 * https://www.szse.cn/market/fund/volume/etf/index.html
 */
export async function fetchSzseShareWan(etfCode: string, date: string): Promise<number | null> {
  try {
    const filtered = await fetchSzseScalePage(date, 1, etfCode)
    const direct = filtered.rows.find((r) => normalizeFundCode(r.fund_code) === etfCode)
    if (direct) return parseSzseSizeWan(direct.current_size)

    const first = await fetchSzseScalePage(date, 1)
    const hit1 = first.rows.find((r) => normalizeFundCode(r.fund_code) === etfCode)
    if (hit1) return parseSzseSizeWan(hit1.current_size)

    const pages = Math.min(Math.max(first.pagecount, 1), 40)
    for (let page = 2; page <= pages; page++) {
      const { rows } = await fetchSzseScalePage(date, page)
      if (!rows.length) break
      const hit = rows.find((r) => normalizeFundCode(r.fund_code) === etfCode)
      if (hit) return parseSzseSizeWan(hit.current_size)
    }
    return null
  } catch {
    return null
  }
}

/** 按注册表交易所分发 */
export async function fetchEtfShareWan(etfCode: string, date: string): Promise<number | null> {
  const meta = getEtfByCode(etfCode)
  return meta.exchange === 'SZ'
    ? fetchSzseShareWan(etfCode, date)
    : fetchSseShareWan(etfCode, date)
}
