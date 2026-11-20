/**
 * 黄金观察专用 ETF（不并入 20 只宽基篮子）
 */

import type { EtfUniverseItem } from './etf-universe.ts'

export const GOLD_ETF_CODE = '518880'

export const GOLD_ETF: EtfUniverseItem = {
  code: GOLD_ETF_CODE,
  name: '黄金ETF华安',
  indexName: '黄金9999',
  exchange: 'SH',
  secid: '1.518880',
}

export function isGoldEtfCode(code: string): boolean {
  return code === GOLD_ETF_CODE
}
