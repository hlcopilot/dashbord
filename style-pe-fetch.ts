/**
 * 乐咕乐股指数估值：先暖 Cookie，再以 MD5(上海日 YYYY-MM-DD) 为 token 拉 TTM PE。
 * 免费接口多为月末/月频采样。纯 JS MD5，Vite / Node seed / Worker 共用。
 */

import { todayYmdShanghai } from './market-session.ts'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/** 紧凑 MD5（UTF-8 文本 → hex），不依赖 node:crypto / SubtleCrypto */
export function md5Hex(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const n = (((bytes.length + 8) >>> 6) + 1) * 16
  const words = new Int32Array(n)
  for (let i = 0; i < bytes.length; i++) {
    words[i >> 2] |= bytes[i] << ((i % 4) * 8)
  }
  words[bytes.length >> 2] |= 0x80 << ((bytes.length % 4) * 8)
  words[n - 2] = bytes.length * 8

  let a = 1732584193
  let b = -271733879
  let c = -1732584194
  let d = 271733878

  const rot = (x: number, s: number) => (x << s) | (x >>> (32 - s))
  const cmn = (q: number, aa: number, bb: number, x: number, s: number, t: number) =>
    (rot(((aa + q + x + t) | 0), s) + bb) | 0
  const ff = (aa: number, bb: number, cc: number, dd: number, x: number, s: number, t: number) =>
    cmn((bb & cc) | (~bb & dd), aa, bb, x, s, t)
  const gg = (aa: number, bb: number, cc: number, dd: number, x: number, s: number, t: number) =>
    cmn((bb & dd) | (cc & ~dd), aa, bb, x, s, t)
  const hh = (aa: number, bb: number, cc: number, dd: number, x: number, s: number, t: number) =>
    cmn(bb ^ cc ^ dd, aa, bb, x, s, t)
  const ii = (aa: number, bb: number, cc: number, dd: number, x: number, s: number, t: number) =>
    cmn(cc ^ (bb | ~dd), aa, bb, x, s, t)

  for (let i = 0; i < n; i += 16) {
    const oa = a
    const ob = b
    const oc = c
    const od = d
    a = ff(a, b, c, d, words[i], 7, -680876936)
    d = ff(d, a, b, c, words[i + 1], 12, -389564586)
    c = ff(c, d, a, b, words[i + 2], 17, 606105819)
    b = ff(b, c, d, a, words[i + 3], 22, -1044525330)
    a = ff(a, b, c, d, words[i + 4], 7, -176418897)
    d = ff(d, a, b, c, words[i + 5], 12, 1200080426)
    c = ff(c, d, a, b, words[i + 6], 17, -1473231341)
    b = ff(b, c, d, a, words[i + 7], 22, -45705983)
    a = ff(a, b, c, d, words[i + 8], 7, 1770035416)
    d = ff(d, a, b, c, words[i + 9], 12, -1958414417)
    c = ff(c, d, a, b, words[i + 10], 17, -42063)
    b = ff(b, c, d, a, words[i + 11], 22, -1990404162)
    a = ff(a, b, c, d, words[i + 12], 7, 1804603682)
    d = ff(d, a, b, c, words[i + 13], 12, -40341101)
    c = ff(c, d, a, b, words[i + 14], 17, -1502002290)
    b = ff(b, c, d, a, words[i + 15], 22, 1236535329)
    a = gg(a, b, c, d, words[i + 1], 5, -165796510)
    d = gg(d, a, b, c, words[i + 6], 9, -1069501632)
    c = gg(c, d, a, b, words[i + 11], 14, 643717713)
    b = gg(b, c, d, a, words[i], 20, -373897302)
    a = gg(a, b, c, d, words[i + 5], 5, -701558691)
    d = gg(d, a, b, c, words[i + 10], 9, 38016083)
    c = gg(c, d, a, b, words[i + 15], 14, -660478335)
    b = gg(b, c, d, a, words[i + 4], 20, -405537848)
    a = gg(a, b, c, d, words[i + 9], 5, 568446438)
    d = gg(d, a, b, c, words[i + 14], 9, -1019803690)
    c = gg(c, d, a, b, words[i + 3], 14, -187363961)
    b = gg(b, c, d, a, words[i + 8], 20, 1163531501)
    a = gg(a, b, c, d, words[i + 13], 5, -1444681467)
    d = gg(d, a, b, c, words[i + 2], 9, -51403784)
    c = gg(c, d, a, b, words[i + 7], 14, 1735328473)
    b = gg(b, c, d, a, words[i + 12], 20, -1926607734)
    a = hh(a, b, c, d, words[i + 5], 4, -378558)
    d = hh(d, a, b, c, words[i + 8], 11, -2022574463)
    c = hh(c, d, a, b, words[i + 11], 16, 1839030562)
    b = hh(b, c, d, a, words[i + 14], 23, -35309556)
    a = hh(a, b, c, d, words[i + 1], 4, -1530992060)
    d = hh(d, a, b, c, words[i + 4], 11, 1272893353)
    c = hh(c, d, a, b, words[i + 7], 16, -155497632)
    b = hh(b, c, d, a, words[i + 10], 23, -1094730640)
    a = hh(a, b, c, d, words[i + 13], 4, 681279174)
    d = hh(d, a, b, c, words[i], 11, -358537222)
    c = hh(c, d, a, b, words[i + 3], 16, -722521979)
    b = hh(b, c, d, a, words[i + 6], 23, 76029189)
    a = hh(a, b, c, d, words[i + 9], 4, -640364487)
    d = hh(d, a, b, c, words[i + 12], 11, -421815835)
    c = hh(c, d, a, b, words[i + 15], 16, 530742520)
    b = hh(b, c, d, a, words[i + 2], 23, -995338651)
    a = ii(a, b, c, d, words[i], 6, -198630844)
    d = ii(d, a, b, c, words[i + 7], 10, 1126891415)
    c = ii(c, d, a, b, words[i + 14], 15, -1416354905)
    b = ii(b, c, d, a, words[i + 5], 21, -57434055)
    a = ii(a, b, c, d, words[i + 12], 6, 1700485571)
    d = ii(d, a, b, c, words[i + 3], 10, -1894986606)
    c = ii(c, d, a, b, words[i + 10], 15, -1051523)
    b = ii(b, c, d, a, words[i + 1], 21, -2054922799)
    a = ii(a, b, c, d, words[i + 8], 6, 1873313359)
    d = ii(d, a, b, c, words[i + 15], 10, -30611744)
    c = ii(c, d, a, b, words[i + 6], 15, -1560198380)
    b = ii(b, c, d, a, words[i + 13], 21, 1309151649)
    a = ii(a, b, c, d, words[i + 4], 6, -145523070)
    d = ii(d, a, b, c, words[i + 11], 10, -1120210379)
    c = ii(c, d, a, b, words[i + 2], 15, 718787259)
    b = ii(b, c, d, a, words[i + 9], 21, -343485551)
    a = (a + oa) | 0
    b = (b + ob) | 0
    c = (c + oc) | 0
    d = (d + od) | 0
  }

  const hex = (n: number) => {
    let s = ''
    for (let i = 0; i < 4; i++) {
      s += ((n >> (i * 8)) & 0xff).toString(16).padStart(2, '0')
    }
    return s
  }
  return hex(a) + hex(b) + hex(c) + hex(d)
}

export function leguleguToken(now = new Date()): string {
  return md5Hex(todayYmdShanghai(now))
}

function parseSetCookie(headers: Headers): string {
  const anyHeaders = headers as Headers & { getSetCookie?: () => string[] }
  const list =
    typeof anyHeaders.getSetCookie === 'function'
      ? anyHeaders.getSetCookie()
      : [headers.get('set-cookie') ?? '']
  const pairs: string[] = []
  for (const line of list) {
    if (!line) continue
    const first = line.split(';')[0]?.trim()
    if (first) pairs.push(first)
  }
  return pairs.join('; ')
}

export async function fetchLeguleguPeMap(indexCode: string): Promise<Map<string, number>> {
  const warm = await fetch(
    `https://www.legulegu.com/stockdata/index-basic?indexCode=${encodeURIComponent(indexCode)}`,
    {
      headers: { 'User-Agent': UA, Referer: 'https://www.legulegu.com/' },
    },
  )
  const cookie = parseSetCookie(warm.headers)
  const token = leguleguToken()
  const url =
    `https://www.legulegu.com/api/stockdata/index-basic` +
    `?indexCode=${encodeURIComponent(indexCode)}&freq=day&token=${token}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Referer: `https://www.legulegu.com/stockdata/index-basic?indexCode=${encodeURIComponent(indexCode)}`,
      ...(cookie ? { Cookie: cookie } : {}),
    },
  })
  if (!res.ok) throw new Error(`legulegu PE ${indexCode}: HTTP ${res.status}`)
  const json = (await res.json()) as {
    data?: Array<{ date?: string; ttmPe?: number }>
    error?: string
    message?: string
  }
  if (json.error) throw new Error(`legulegu PE ${indexCode}: ${json.message || json.error}`)
  const map = new Map<string, number>()
  for (const row of json.data ?? []) {
    const date = row.date
    const pe = Number(row.ttmPe)
    if (date && Number.isFinite(pe) && pe > 0) map.set(date, pe)
  }
  if (!map.size) throw new Error(`legulegu PE ${indexCode}: empty`)
  return map
}
