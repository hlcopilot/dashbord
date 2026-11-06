/** 最多保留 digits 位小数，去掉末尾多余的 0（如 41.4000 → 41.4） */
export function formatNumber(value: number, digits = 4): string {
  const fixed = value.toFixed(digits)
  return fixed.replace(/\.?0+$/, '')
}

/** 成交额展示：≥10000 亿用「万亿」，否则「亿」；最多 4 位小数并去尾零 */
export function formatAmountYi(amountYi: number, digits = 4): string {
  const abs = Math.abs(amountYi)
  if (abs >= 10000) {
    return `${formatNumber(amountYi / 10000, digits)}万亿`
  }
  return `${formatNumber(amountYi, digits)}亿`
}
