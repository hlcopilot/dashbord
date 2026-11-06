import dayjs from 'dayjs'

/** 显示用日期：2026.11.3 */
export function formatDisplayDate(date: string): string {
  const d = dayjs(date)
  return `${d.year()}.${d.month() + 1}.${d.date()}`
}

export function yearsAgo(from: string, years: number): string {
  return dayjs(from).subtract(years, 'year').format('YYYY-MM-DD')
}

export function monthsAgo(from: string, months: number): string {
  return dayjs(from).subtract(months, 'month').format('YYYY-MM-DD')
}

export function toCompactYmd(date: string | Date = new Date()): string {
  return dayjs(date).format('YYYYMMDD')
}
