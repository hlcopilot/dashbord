export interface DailyTurnover {
  /** YYYY-MM-DD */
  date: string
  /** 沪深两市成交额，单位：亿元 */
  amountYi: number
  /** 盘中临时点（搜狐日线尚未收盘入库，用分时累计近似） */
  provisional?: boolean
}

/** 本地归档的单日分时（写入 data/intraday/YYYY-MM-DD.json） */
export interface LocalIntradayDay {
  date: string
  updatedAt: string
  /** HH:mm → 当分钟两市成交额（亿元） */
  minutes: Record<string, number>
  /** 当日累计成交额（亿元） */
  totalYi: number
}

export type RangeKey = '1m' | '3m' | '6m' | '1y' | '3y' | 'all'

export interface TurnoverSeriesResult {
  series: DailyTurnover[]
  asOf: string
  latestAmountYi: number
  /** 近 3 年百分位，0–100 */
  percentile3y: number
}

/** 单日分时累计成交额（分钟） */
export interface IntradayPoint {
  /** HH:mm */
  time: string
  /** 当日累计成交额，亿元 */
  todayYi: number | null
  /** 前一交易日同时刻累计成交额，亿元 */
  prevYi: number | null
  /** 较前一日增减，亿元 */
  deltaYi: number | null
}

export interface IntradayTurnoverResult {
  date: string
  prevDate: string
  points: IntradayPoint[]
  /** 当日最新累计 */
  latestTodayYi: number
  /** 前一日全日累计 */
  prevFullYi: number
  /** 较前一日同时刻增减 */
  deltaVsPrevSameTimeYi: number | null
}

/** 两融余额日频 */
export interface MarginDaily {
  date: string
  /** 融资融券余额，亿元 */
  marginYi: number
  /** 融资余额，亿元 */
  financingYi: number
  /** 融券余额，亿元 */
  securitiesYi: number
  /** 上证指数收盘价 */
  sseClose: number | null
}

export interface MarginSeriesResult {
  series: MarginDaily[]
  asOf: string
  latestMarginYi: number
  latestSseClose: number | null
  /** 较前一日增减（亿元） */
  deltaYi: number | null
  /** 近 3 年百分位 */
  percentile3y: number
}

/** 黄金观察日频：518880 + SHAU + Au9999 + 伦敦金 XAU + 美元指数 */
export interface GoldDaily {
  date: string
  /** 黄金 ETF 收盘价（元/份）；非 ETF 交易日可为 null */
  goldClose: number | null
  /** 上海金基准价（元/克）；无数据日可为 null */
  shauClose: number | null
  /** Au9999 现货收盘（元/克）；无数据日可为 null */
  au9999Close: number | null
  /** 伦敦金现货代理（美元/盎司）；日历错位可为 null */
  xauClose: number | null
  /** 美元指数；节假日错位可能为 null */
  usdIndex: number | null
}

export interface GoldSeriesResult {
  series: GoldDaily[]
  asOf: string
  latestGoldClose: number | null
  latestShauClose: number | null
  latestAu9999Close: number | null
  latestXauClose: number | null
  latestUsdIndex: number | null
  warnings?: string[]
  note?: string
}

/** 石油观察日频：布伦特 + WTI + 美元指数 */
export interface OilDaily {
  date: string
  /** 布伦特原油当月连续（美元/桶） */
  brentClose: number | null
  /** NYMEX 原油连续 / WTI 代理（美元/桶） */
  wtiClose: number | null
  /** 美元指数；日历错位可为 null */
  usdIndex: number | null
}

export interface OilSeriesResult {
  series: OilDaily[]
  asOf: string
  latestBrentClose: number | null
  latestWtiClose: number | null
  latestUsdIndex: number | null
  warnings?: string[]
  note?: string
}

/** 风格观察：创业板指 / 中证红利点位比 + TTM PE 比 */
export interface StyleDaily {
  date: string
  cybClose: number | null
  divClose: number | null
  cybPe: number | null
  divPe: number | null
  /** 创业板指 / 中证红利（日频） */
  closeRatio: number | null
  /** 创业板 TTM PE / 中证红利 TTM PE（乐咕月频） */
  peRatio: number | null
}

export interface StyleSeriesResult {
  series: StyleDaily[]
  asOf: string
  latestCloseRatio: number | null
  latestPeRatio: number | null
  latestCybClose: number | null
  latestDivClose: number | null
  latestCybPe: number | null
  latestDivPe: number | null
  /** 近 3 年点位比百分位 */
  closePercentile3y: number
  /** 近 3 年估值比百分位 */
  pePercentile3y: number
  warnings?: string[]
  note?: string
}

/** 单只 ETF 日净流入（申赎代理） */
export interface EtfFlowDaily {
  date: string
  close: number
  /** 总份额（万份） */
  shareWan: number
  /** 净流入（亿元）；序列首日可能为 null */
  netInflowYi: number | null
}

export interface EtfFlowSeriesResult {
  code: string
  name: string
  indexName?: string
  exchange?: 'SH' | 'SZ'
  asOf: string
  latestNetInflowYi: number | null
  latestShareWan: number | null
  series: EtfFlowDaily[]
  pendingDates: string[]
  missingShareCount?: number
  fetchedShareCount?: number
  cacheHitShareCount?: number
  klineSource?: 'remote' | 'cache'
  warnings?: string[]
  note: string
}

/** ETF 分钟 K 类型与解析见根目录 etf-intraday-core（前后端/seed 共用） */
export type {
  EtfIntradayBar,
  LocalEtfIntradayDay,
} from '../../etf-intraday-core.ts'

export interface EtfIntradayResult {
  code: string
  name: string
  date: string
  /** kline / trends2 来自远端；cache 表示仅命中本地/KV 归档 */
  source: 'kline' | 'trends2' | 'cache'
  bars: import('../../etf-intraday-core.ts').EtfIntradayBar[]
  open: number
  close: number
  high: number
  low: number
  volume: number
  amountYi: number
}
