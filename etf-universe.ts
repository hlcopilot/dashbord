/**
 * chinazkk 风格 20 只宽基 ETF 篮子（2026-10-15 换仓对齐）
 * Vite / Worker / 前端共用；JSON 镜像见 etf-universe.json（供 seed 脚本读取）
 */

export type EtfExchange = 'SH' | 'SZ'

export type EtfUniverseItem = {
  code: string
  name: string
  /** 所属宽基指数 */
  indexName: string
  exchange: EtfExchange
  /** 东财 secid */
  secid: string
}

export const DEFAULT_ETF_CODE = '510300'

/**
 * 筛选下拉 /「全部」卡片展示顺序
 * 沪深300 → 上证综指 → 上证50 → 中证500 → 中证1000 → 科创50 → 创业板指 → 创业板50 → 中证A500
 */
export const INDEX_DISPLAY_ORDER: string[] = [
  '沪深300',
  '上证综指',
  '上证50',
  '中证500',
  '中证1000',
  '科创50',
  '创业板指',
  '创业板50',
  '中证A500',
]

/** 宽基指数大致定位（卡片 / 筛选下拉共用） */
export const INDEX_POSITION: Record<string, string> = {
  沪深300: '两市大盘核心',
  上证综指: '沪市全市场',
  上证50: '沪市超大盘',
  中证500: '中盘',
  中证1000: '小盘',
  科创50: '科创板大盘',
  创业板指: '创业板龙头',
  创业板50: '创业板龙头子集',
  中证A500: '新一代均衡宽基',
  未分类: '',
}

export function getIndexPosition(indexName: string): string {
  return INDEX_POSITION[indexName] ?? ''
}

/** 展示用：沪深300（两市大盘核心） */
export function formatIndexWithPosition(indexName: string): string {
  const pos = getIndexPosition(indexName)
  return pos ? `${indexName}（${pos}）` : indexName
}

function indexRank(indexName: string): number {
  const i = INDEX_DISPLAY_ORDER.indexOf(indexName)
  return i === -1 ? INDEX_DISPLAY_ORDER.length : i
}

/** 按 INDEX_DISPLAY_ORDER 排序；同指数保持原相对顺序 */
export function sortEtfsByIndexOrder(list: EtfUniverseItem[]): EtfUniverseItem[] {
  return [...list].sort((a, b) => {
    const d = indexRank(a.indexName) - indexRank(b.indexName)
    if (d !== 0) return d
    return 0
  })
}

export const ETF_UNIVERSE: EtfUniverseItem[] = sortEtfsByIndexOrder([
  {
    code: '510300',
    name: '沪深300ETF华泰柏瑞',
    indexName: '沪深300',
    exchange: 'SH',
    secid: '1.510300',
  },
  {
    code: '510310',
    name: '沪深300ETF易方达',
    indexName: '沪深300',
    exchange: 'SH',
    secid: '1.510310',
  },
  {
    code: '159919',
    name: '沪深300ETF嘉实',
    indexName: '沪深300',
    exchange: 'SZ',
    secid: '0.159919',
  },
  {
    code: '510210',
    name: '上证指数ETF富国',
    indexName: '上证综指',
    exchange: 'SH',
    secid: '1.510210',
  },
  {
    code: '510050',
    name: '上证50ETF华夏',
    indexName: '上证50',
    exchange: 'SH',
    secid: '1.510050',
  },
  {
    code: '510500',
    name: '中证500ETF南方',
    indexName: '中证500',
    exchange: 'SH',
    secid: '1.510500',
  },
  {
    code: '512100',
    name: '中证1000ETF南方',
    indexName: '中证1000',
    exchange: 'SH',
    secid: '1.512100',
  },
  {
    code: '560010',
    name: '中证1000ETF广发',
    indexName: '中证1000',
    exchange: 'SH',
    secid: '1.560010',
  },
  {
    code: '159845',
    name: '中证1000ETF华夏',
    indexName: '中证1000',
    exchange: 'SZ',
    secid: '0.159845',
  },
  {
    code: '159633',
    name: '中证1000ETF易方达',
    indexName: '中证1000',
    exchange: 'SZ',
    secid: '0.159633',
  },
  {
    code: '588000',
    name: '科创50ETF华夏',
    indexName: '科创50',
    exchange: 'SH',
    secid: '1.588000',
  },
  {
    code: '588080',
    name: '科创50ETF易方达',
    indexName: '科创50',
    exchange: 'SH',
    secid: '1.588080',
  },
  {
    code: '159915',
    name: '创业板ETF易方达',
    indexName: '创业板指',
    exchange: 'SZ',
    secid: '0.159915',
  },
  {
    code: '159952',
    name: '创业板ETF广发',
    indexName: '创业板指',
    exchange: 'SZ',
    secid: '0.159952',
  },
  {
    code: '159949',
    name: '创业板50ETF华安',
    indexName: '创业板50',
    exchange: 'SZ',
    secid: '0.159949',
  },
  {
    code: '563360',
    name: 'A500ETF华泰柏瑞',
    indexName: '中证A500',
    exchange: 'SH',
    secid: '1.563360',
  },
  {
    code: '159338',
    name: '中证A500ETF国泰',
    indexName: '中证A500',
    exchange: 'SZ',
    secid: '0.159338',
  },
  {
    code: '159352',
    name: 'A500ETF南方',
    indexName: '中证A500',
    exchange: 'SZ',
    secid: '0.159352',
  },
  {
    code: '159361',
    name: 'A500ETF易方达',
    indexName: '中证A500',
    exchange: 'SZ',
    secid: '0.159361',
  },
  {
    code: '512050',
    name: 'A500ETF华夏',
    indexName: '中证A500',
    exchange: 'SH',
    secid: '1.512050',
  },
])

const byCode = new Map(ETF_UNIVERSE.map((e) => [e.code, e]))

export function getEtfByCode(code: string): EtfUniverseItem {
  const hit = byCode.get(code)
  if (hit) return hit
  const exchange: EtfExchange = code.startsWith('15') ? 'SZ' : 'SH'
  return {
    code,
    name: code,
    indexName: '未分类',
    exchange,
    secid: `${exchange === 'SZ' ? '0' : '1'}.${code}`,
  }
}

export function getEtfIndexPosition(code: string): string {
  return getIndexPosition(getEtfByCode(code).indexName)
}

/** 筛选下拉指数名，按 INDEX_DISPLAY_ORDER */
export function listEtfIndexNames(): string[] {
  const present = new Set(ETF_UNIVERSE.map((e) => e.indexName))
  const ordered = INDEX_DISPLAY_ORDER.filter((name) => present.has(name))
  for (const name of present) {
    if (!INDEX_DISPLAY_ORDER.includes(name)) ordered.push(name)
  }
  return ordered
}

export function listEtfsByIndex(indexName: string | 'all'): EtfUniverseItem[] {
  if (indexName === 'all') return [...ETF_UNIVERSE]
  return ETF_UNIVERSE.filter((e) => e.indexName === indexName)
}
