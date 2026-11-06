/**
 * 经验百分位：当前值在样本中「小于等于自己」的占比。
 * 返回 0–100，保留 1 位小数。
 */
export function calcPercentile(values: number[], current: number): number {
  if (!values.length) return 0
  const le = values.filter((v) => v <= current).length
  return Math.round((le / values.length) * 1000) / 10
}
