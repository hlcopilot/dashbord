/**
 * 全量回填单只 ETF 的份额 + 收盘价缓存（本地 data/etf-share）
 * 用法：
 *   npm run etf:seed
 *   npm run etf:seed -- 510300
 *
 * 可重复执行：已有日期跳过，只补缺失。全量约 3500 个交易日，视网络约数分钟～十几分钟。
 */
import { writeFile, readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const code = process.argv[2] || '510300'
const CACHE_PATH = path.join(root, 'data', 'etf-share', `${code}.json`)

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

async function fetchKlines(secid) {
  const dest =
    `https://push2his.eastmoney.com/api/qt/stock/kline/get` +
    `?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6` +
    `&fields2=f51,f52,f53,f54,f55,f56,f57` +
    `&klt=101&fqt=1&beg=0&end=20500101&lmt=100000`
  const r = await fetch(dest, {
    headers: { Referer: 'https://quote.eastmoney.com/', 'User-Agent': UA },
  })
  if (!r.ok) throw new Error(`kline ${r.status}`)
  const j = await r.json()
  const out = []
  for (const line of j.data?.klines ?? []) {
    const [date, , closeStr] = line.split(',')
    const close = Number(closeStr)
    if (date && Number.isFinite(close)) out.push({ date, close })
  }
  return out
}

async function fetchShareWan(etfCode, date) {
  const qs = new URLSearchParams({
    isPagination: 'true',
    'pageHelp.pageSize': '10000',
    'pageHelp.pageNo': '1',
    'pageHelp.beginPage': '1',
    'pageHelp.cacheSize': '1',
    'pageHelp.endPage': '1',
    sqlId: 'COMMON_SSE_ZQPZ_ETFZL_XXPL_ETFGM_SEARCH_L',
    STAT_DATE: date,
  })
  const r = await fetch(`https://query.sse.com.cn/commonQuery.do?${qs}`, {
    headers: { Referer: 'https://www.sse.com.cn/', 'User-Agent': UA },
  })
  if (!r.ok) return null
  const j = await r.json()
  const hit = (j.result || []).find((row) => row.SEC_CODE === etfCode)
  if (!hit?.TOT_VOL) return null
  const wan = Number(hit.TOT_VOL)
  return Number.isFinite(wan) ? wan : null
}

async function loadCache() {
  try {
    const raw = JSON.parse(await readFile(CACHE_PATH, 'utf8'))
    return {
      closes: raw.closes && typeof raw.closes === 'object' ? raw.closes : {},
      shares: raw.shares && typeof raw.shares === 'object' ? raw.shares : {},
    }
  } catch {
    return { closes: {}, shares: {} }
  }
}

async function saveCache(cache) {
  await mkdir(path.dirname(CACHE_PATH), { recursive: true })
  await writeFile(
    CACHE_PATH,
    `${JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        code,
        closes: cache.closes,
        shares: cache.shares,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}

async function mapPool(items, concurrency, worker) {
  let i = 0
  async function run() {
    while (i < items.length) {
      const idx = i++
      await worker(items[idx], idx)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, () => run()))
}

const secid = code.startsWith('5') || code.startsWith('6') ? `1.${code}` : `0.${code}`
console.log(`seeding ETF ${code} → ${CACHE_PATH}`)

const cache = await loadCache()
const klines = await fetchKlines(secid)
if (!klines.length) throw new Error('no klines')
console.log(`klines: ${klines.length} (${klines[0].date} → ${klines[klines.length - 1].date})`)

for (const row of klines) cache.closes[row.date] = row.close

const missing = klines
  .map((k) => k.date)
  .filter((d) => !(typeof cache.shares[d] === 'number' && Number.isFinite(cache.shares[d])))

console.log(`shares cached: ${Object.keys(cache.shares).length}, missing: ${missing.length}`)

if (!missing.length) {
  await saveCache(cache)
  console.log('nothing to fetch; cache already complete')
  process.exit(0)
}

let done = 0
let ok = 0
let fail = 0
const started = Date.now()

await mapPool(missing, 8, async (date) => {
  const wan = await fetchShareWan(code, date)
  done += 1
  if (wan == null) fail += 1
  else {
    cache.shares[date] = wan
    ok += 1
  }
  if (done % 50 === 0 || done === missing.length) {
    const sec = ((Date.now() - started) / 1000).toFixed(1)
    console.log(`progress ${done}/${missing.length} ok=${ok} fail=${fail} ${sec}s`)
    await saveCache(cache)
  }
})

await saveCache(cache)
console.log(
  `done. shares=${Object.keys(cache.shares).length} closes=${Object.keys(cache.closes).length} fail=${fail}`,
)
