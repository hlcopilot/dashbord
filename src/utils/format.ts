/** 成交额展示：≥10000 亿用「万亿」，否则「亿」 */
export function formatAmountYi(amountYi: number, digits = 2): string {
  const abs = Math.abs(amountYi)
  if (abs >= 10000) {
    const v = amountYi / 10000
    return `${trimNum(v, digits)}万亿`
  }
  return `${trimNum(amountYi, digits)}亿`
}

function trimNum(n: number, digits: number): string {
  const fixed = n.toFixed(digits)
  return fixed.replace(/\.?0+$/, '')
}
