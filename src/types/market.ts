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
