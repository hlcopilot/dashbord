/**
 * A 股日频交易时段门闩（Asia/Shanghai）
 * - 收盘价日 K：未到 15:00 不把「今天」当完整交易日
 * - ETF 份额：披露常见 T+1，永不把「今天」当份额增量目标
 */

const SH_TZ = 'Asia/Shanghai'

function shanghaiParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SH_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return {
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  }
}

/** 上海日历今日 YYYY-MM-DD */
export function todayYmdShanghai(now = new Date()): string {
  return shanghaiParts(now).ymd
}

/** 是否已过 A 股常规收盘（15:00，含） */
export function isAfterAshareClose(now = new Date()): boolean {
  const { hour, minute } = shanghaiParts(now)
  return hour > 15 || (hour === 15 && minute >= 0)
}

/** 该日收盘价日 K 是否已可当作完整日（未收盘则排除今天） */
export function isDailyCloseReady(date: string, now = new Date()): boolean {
  const today = todayYmdShanghai(now)
  if (date < today) return true
  if (date > today) return false
  return isAfterAshareClose(now)
}

/**
 * ETF 份额是否可能已披露：严格早于「今天」
 * （即便今日已收盘，份额也常要等到下一自然日）
 */
export function isEtfShareReady(date: string, now = new Date()): boolean {
  return date < todayYmdShanghai(now)
}

/** 过滤出可用于日频收盘序列的日期 */
export function filterDailyCloseReadyDates(dates: string[], now = new Date()): string[] {
  return dates.filter((d) => isDailyCloseReady(d, now))
}

/** 搜狐/增量窗口的 end（YYYYMMDD）：未收盘则用上海日历昨天 */
export function dailySeriesEndCompact(now = new Date()): string {
  const { ymd } = shanghaiParts(now)
  if (isAfterAshareClose(now)) return ymd.replace(/-/g, '')
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() - 1)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}${mm}${dd}`
}
