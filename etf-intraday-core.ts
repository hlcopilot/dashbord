/**
 * ETF 分钟 K 解析 / 日归档构建（前端 sync、Node seed 共用）
 * 口径：当日 OHLC + 量/额；非净流入。东财 trends2 ≈ 近 5 日，klt=1 通常仅最新交易日。
 */

export type EtfIntradayBar = {
  time: string
  open: number
  close: number
  high: number
  low: number
  volume: number
  amountYi: number
}

export type EtfIntradaySource = 'kline' | 'trends2'

export type LocalEtfIntradayDay = {
  date: string
  code: string
  name?: string
  updatedAt: string
  source: EtfIntradaySource
  bars: EtfIntradayBar[]
  open: number
  close: number
  high: number
  low: number
  volume: number
  amountYi: number
}

export function emTrends2Url(secid: string): string {
  return (
    `https://push2his.eastmoney.com/api/qt/stock/trends2/get` +
    `?secid=${encodeURIComponent(secid)}` +
    `&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13` +
    `&fields2=f51,f52,f53,f54,f55,f56,f57,f58` +
    `&ut=fa5fd1943c7b386f172d6893dbfba10b` +
    `&ndays=5&iscr=0&iscca=0`
  )
}

export function emMinuteKlineUrl(secid: string): string {
  return (
    `https://push2his.eastmoney.com/api/qt/stock/kline/get` +
    `?secid=${encodeURIComponent(secid)}` +
    `&fields1=f1,f2,f3,f4,f5,f6` +
    `&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61` +
    `&klt=1&fqt=1&beg=0&end=20500101&lmt=1000`
  )
}

/** 浏览器经 Vite/Worker 代理时用的 path（不含 origin） */
export function emTrends2ProxyPath(secid: string): string {
  return emTrends2Url(secid).replace('https://push2his.eastmoney.com', '/api/eastmoney')
}

export function emMinuteKlineProxyPath(secid: string): string {
  return emMinuteKlineUrl(secid).replace('https://push2his.eastmoney.com', '/api/eastmoney')
}

export function summarizeBars(
  bars: EtfIntradayBar[],
): Pick<LocalEtfIntradayDay, 'open' | 'close' | 'high' | 'low' | 'volume' | 'amountYi'> {
  const first = bars[0]!
  const last = bars[bars.length - 1]!
  let high = first.high
  let low = first.low
  let volume = 0
  let amountYi = 0
  for (const b of bars) {
    high = Math.max(high, b.high)
    low = Math.min(low, b.low)
    volume += b.volume
    amountYi += b.amountYi
  }
  return {
    open: first.open,
    close: last.close,
    high,
    low,
    volume,
    amountYi: Math.round(amountYi * 1e6) / 1e6,
  }
}

export function buildLocalDay(
  code: string,
  name: string,
  date: string,
  source: EtfIntradaySource,
  bars: EtfIntradayBar[],
): LocalEtfIntradayDay {
  return {
    date,
    code,
    name,
    updatedAt: new Date().toISOString(),
    source,
    bars,
    ...summarizeBars(bars),
  }
}

export function parseKlineAll(klines: string[]): Map<string, EtfIntradayBar[]> {
  const byDate = new Map<string, EtfIntradayBar[]>()
  for (const row of klines) {
    const parts = row.split(',')
    if (parts.length < 7) continue
    const stamp = parts[0]
    if (!stamp || stamp.length < 16) continue
    const date = stamp.slice(0, 10)
    const time = stamp.slice(11, 16)
    const open = Number(parts[1])
    const close = Number(parts[2])
    const high = Number(parts[3])
    const low = Number(parts[4])
    const volume = Number(parts[5])
    const amount = Number(parts[6])
    if (![open, close, high, low, volume, amount].every(Number.isFinite)) continue
    let list = byDate.get(date)
    if (!list) {
      list = []
      byDate.set(date, list)
    }
    list.push({
      time,
      open,
      close,
      high,
      low,
      volume,
      amountYi: amount / 1e8,
    })
  }
  return byDate
}

/** trends2：近约 5 日；字段 time,?,price,high,low,vol,amount,avg */
export function parseTrendsAll(trends: string[]): Map<string, EtfIntradayBar[]> {
  const byDate = new Map<string, EtfIntradayBar[]>()
  const prevCloseByDate = new Map<string, number>()
  for (const row of trends) {
    const parts = row.split(',')
    if (parts.length < 7) continue
    const stamp = parts[0]
    if (!stamp || stamp.length < 16) continue
    const date = stamp.slice(0, 10)
    const time = stamp.slice(11, 16)
    const price = Number(parts[2])
    const high = Number(parts[3])
    const low = Number(parts[4])
    const volume = Number(parts[5])
    const amount = Number(parts[6])
    if (![price, high, low, volume, amount].every(Number.isFinite)) continue
    const prev = prevCloseByDate.get(date)
    const open = prev == null ? price : prev
    let list = byDate.get(date)
    if (!list) {
      list = []
      byDate.set(date, list)
    }
    list.push({
      time,
      open,
      close: price,
      high: Math.max(high, open, price),
      low: Math.min(low, open, price),
      volume,
      amountYi: amount / 1e8,
    })
    prevCloseByDate.set(date, price)
  }
  return byDate
}

export type EmRemoteBundle = {
  days: Map<string, LocalEtfIntradayDay>
  warnings: string[]
}

/**
 * 把东财 trends2 + 可选 1 分钟 K 合并为按日归档（kline 覆盖同日 trends2）
 */
export function buildRemoteDaysFromEm(input: {
  code: string
  name: string
  trends?: string[] | null
  trendsName?: string | null
  trendsError?: string | null
  klines?: string[] | null
  klineName?: string | null
  klineError?: string | null
}): EmRemoteBundle {
  const { code, name } = input
  const days = new Map<string, LocalEtfIntradayDay>()
  const warnings: string[] = []

  if (input.trendsError) {
    warnings.push(`近 5 日 trends2 同步失败：${input.trendsError}`)
  } else if (!input.trends?.length) {
    warnings.push('东财 trends2 返回空（近约 5 日分钟线未写入）')
  } else {
    const remoteName = input.trendsName || name
    for (const [date, bars] of parseTrendsAll(input.trends)) {
      if (!bars.length) continue
      days.set(date, buildLocalDay(code, remoteName, date, 'trends2', bars))
    }
    if (!days.size) warnings.push('东财 trends2 有数据但解析后为空')
  }

  if (input.klineError) {
    warnings.push(`当日 1 分钟 K 同步失败：${input.klineError}`)
  } else {
    const remoteName = input.klineName || name
    let klineDays = 0
    for (const [date, bars] of parseKlineAll(input.klines ?? [])) {
      if (!bars.length) continue
      days.set(date, buildLocalDay(code, remoteName, date, 'kline', bars))
      klineDays += 1
    }
    if (!klineDays) warnings.push('东财 1 分钟 K 无数据')
  }

  return { days, warnings }
}
