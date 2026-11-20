/**
 * 全量回填 ETF 的份额 + 收盘价缓存（本地 data/etf-share）
 * 用法：
 *   npm run etf:seed              # 篮子内全部 20 只
 *   npm run etf:seed -- 510300    # 单只
 *   npm run etf:seed -- 159915
 *
 * 可重复执行：已有日期跳过，只补缺失。
 *
 * 注意：本机 Node fetch/https 访问深交所常被 RST（ECONNRESET），
 * 交易所请求统一走系统 curl（Windows: curl.exe），更稳。
 * 深市公开规模接口约保留近 10 年，更早交易日会跳过。
 */
import { execFile } from 'node:child_process'
import { writeFile, readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const CURL = process.platform === 'win32' ? 'curl.exe' : 'curl'
/** 深交所基金规模公开接口大约滚动保留年限 */
const SZSE_HISTORY_YEARS = 10

const universe = JSON.parse(await readFile(path.join(root, 'etf-universe.json'), 'utf8'))
const GOLD_EXTRA = {
  code: '518880',
  name: '黄金ETF华安',
  indexName: '黄金9999',
  exchange: 'SH',
  secid: '1.518880',
}

const argCode = process.argv[2]
const targets = argCode
  ? [
      universe.find((e) => e.code === argCode) ||
        (argCode === GOLD_EXTRA.code ? GOLD_EXTRA : null) || {
          code: argCode,
          name: argCode,
          indexName: '未分类',
          exchange: argCode.startsWith('15') ? 'SZ' : 'SH',
          secid: `${argCode.startsWith('15') ? '0' : '1'}.${argCode}`,
        },
    ]
  : universe

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function ymdAddYears(ymd, years) {
  const d = new Date(`${ymd}T00:00:00+08:00`)
  d.setFullYear(d.getFullYear() + years)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function todayYmdShanghai() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

async function withRetry(fn, { retries = 4, baseMs = 500, label = 'fetch' } = {}) {
  let lastErr
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      const wait = baseMs * 2 ** i + Math.floor(Math.random() * 250)
      console.warn(`  ${label} retry ${i + 1}/${retries + 1}: ${e instanceof Error ? e.message : e}`)
      await sleep(wait)
    }
  }
  throw lastErr
}

/** 用系统 curl 拉文本，避开 Node TLS 被深交所掐断的问题 */
async function curlText(url, { referer, maxTime = 60 } = {}) {
  const args = [
    '-sS',
    '--connect-timeout',
    '20',
    '--max-time',
    String(maxTime),
    '-L',
    '-H',
    `User-Agent: ${UA}`,
  ]
  if (referer) {
    args.push('-H', `Referer: ${referer}`)
  }
  args.push(url)
  const { stdout } = await execFileAsync(CURL, args, {
    maxBuffer: 32 * 1024 * 1024,
    encoding: 'utf8',
    windowsHide: true,
  })
  return stdout
}

async function curlJson(url, opts) {
  const text = await curlText(url, opts)
  if (!text || !text.trim()) throw new Error('empty curl body')
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`bad json: ${text.slice(0, 120)}`)
  }
}

async function fetchKlines(secid) {
  return withRetry(
    async () => {
      const dest =
        `https://push2his.eastmoney.com/api/qt/stock/kline/get` +
        `?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6` +
        `&fields2=f51,f52,f53,f54,f55,f56,f57` +
        `&klt=101&fqt=1&beg=0&end=20500101&lmt=100000`
      const j = await curlJson(dest, {
        referer: 'https://quote.eastmoney.com/',
        maxTime: 90,
      })
      const out = []
      for (const line of j.data?.klines ?? []) {
        const [date, , closeStr] = line.split(',')
        const close = Number(closeStr)
        if (date && Number.isFinite(close)) out.push({ date, close })
      }
      return out
    },
    { label: 'kline' },
  )
}

async function fetchSseShareWan(etfCode, date) {
  try {
    return await withRetry(
      async () => {
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
        const j = await curlJson(`https://query.sse.com.cn/commonQuery.do?${qs}`, {
          referer: 'https://www.sse.com.cn/',
        })
        const hit = (j.result || []).find((row) => row.SEC_CODE === etfCode)
        if (!hit?.TOT_VOL) return null
        const wan = Number(hit.TOT_VOL)
        return Number.isFinite(wan) ? wan : null
      },
      { retries: 3, baseMs: 300, label: `sse ${date}` },
    )
  } catch {
    return null
  }
}

function parseSzseSizeWan(raw) {
  if (raw == null) return null
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

function normalizeFundCode(code) {
  return String(code || '')
    .replace(/\D/g, '')
    .padStart(6, '0')
}

async function fetchSzseScalePage(etfCode, start, end, page) {
  const qs = new URLSearchParams({
    SHOWTYPE: 'JSON',
    CATALOGID: 'scsj_fund_jjgm',
    TABKEY: 'tab1',
    txtStart: start,
    txtEnd: end,
    jjlb: 'ETF',
    txtDm: etfCode,
    tab1PAGENO: String(page),
    random: String(Math.random()),
  })
  const payload = await curlJson(`https://www.szse.cn/api/report/ShowReport/data?${qs}`, {
    referer: 'https://www.szse.cn/market/fund/volume/etf/index.html',
  })
  const block = Array.isArray(payload) ? payload[0] : null
  return {
    rows: block?.data ?? [],
    pagecount: Number(block?.metadata?.pagecount) || 1,
  }
}

/**
 * 深市：按约 90 天窗口批量拉取；跳过公开接口保留期之外的日期
 */
async function fillSzseSharesByRange(etfCode, missingDates, shares) {
  if (!missingDates.length) return { ok: 0, failWindows: 0, skippedOld: 0 }

  const minKeep = ymdAddYears(todayYmdShanghai(), -SZSE_HISTORY_YEARS)
  const usable = missingDates.filter((d) => d >= minKeep).sort()
  const skippedOld = missingDates.length - usable.length
  if (skippedOld) {
    console.log(
      `szse skip ${skippedOld} day(s) before ${minKeep} (exchange public history ~${SZSE_HISTORY_YEARS}y)`,
    )
  }
  if (!usable.length) return { ok: 0, failWindows: 0, skippedOld }

  const need = new Set(usable)
  let ok = 0
  let failWindows = 0

  const windows = []
  let wStart = usable[0]
  let wEnd = usable[0]
  const maxSpanMs = 90 * 24 * 3600 * 1000
  for (let i = 1; i < usable.length; i++) {
    const d = usable[i]
    if (new Date(d) - new Date(wStart) > maxSpanMs) {
      windows.push([wStart, wEnd])
      wStart = d
      wEnd = d
    } else {
      wEnd = d
    }
  }
  windows.push([wStart, wEnd])
  console.log(`szse windows: ${windows.length} via ${CURL}`)

  for (let wi = 0; wi < windows.length; wi++) {
    const [start, end] = windows[wi]
    try {
      const first = await withRetry(() => fetchSzseScalePage(etfCode, start, end, 1), {
        retries: 4,
        baseMs: 600,
        label: `szse ${start}~${end} p1`,
      })
      const pages = Math.min(Math.max(first.pagecount, 1), 80)
      const allRows = [...first.rows]
      for (let page = 2; page <= pages; page++) {
        await sleep(250)
        const { rows } = await withRetry(() => fetchSzseScalePage(etfCode, start, end, page), {
          retries: 4,
          baseMs: 600,
          label: `szse ${start}~${end} p${page}`,
        })
        allRows.push(...rows)
        if (!rows.length) break
      }

      for (const row of allRows) {
        if (normalizeFundCode(row.fund_code) !== etfCode) continue
        const date = String(row.size_date || '').slice(0, 10)
        const wan = parseSzseSizeWan(row.current_size)
        if (!date || wan == null || !need.has(date)) continue
        shares[date] = wan
        need.delete(date)
        ok += 1
      }
      console.log(
        `  window ${wi + 1}/${windows.length} ${start}→${end}: rows=${allRows.length}, filled=${ok}, still=${need.size}`,
      )
      await saveProgressHint()
      await sleep(350)
    } catch (e) {
      failWindows += 1
      console.warn(
        `  window ${wi + 1}/${windows.length} ${start}→${end} failed: ${e instanceof Error ? e.message : e}`,
      )
      await sleep(1000)
    }
  }

  return { ok, failWindows, skippedOld }
}

let pendingSave = null
function attachSave(fn) {
  pendingSave = fn
}
async function saveProgressHint() {
  if (pendingSave) await pendingSave()
}

async function loadCache(cachePath) {
  try {
    const raw = JSON.parse(await readFile(cachePath, 'utf8'))
    return {
      closes: raw.closes && typeof raw.closes === 'object' ? raw.closes : {},
      shares: raw.shares && typeof raw.shares === 'object' ? raw.shares : {},
    }
  } catch {
    return { closes: {}, shares: {} }
  }
}

async function saveCache(cachePath, code, cache) {
  await mkdir(path.dirname(cachePath), { recursive: true })
  await writeFile(
    cachePath,
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

async function seedOne(meta) {
  const code = meta.code
  const cachePath = path.join(root, 'data', 'etf-share', `${code}.json`)
  console.log(`\n=== seeding ${code} ${meta.name} [${meta.indexName}/${meta.exchange}] ===`)

  const cache = await loadCache(cachePath)
  let klines = []
  try {
    klines = await fetchKlines(meta.secid)
  } catch (e) {
    console.warn(
      `kline upstream failed, fallback to cached closes: ${e instanceof Error ? e.message : e}`,
    )
  }
  if (klines.length) {
    console.log(`klines: ${klines.length} (${klines[0].date} → ${klines[klines.length - 1].date})`)
    for (const row of klines) cache.closes[row.date] = row.close
  } else if (!Object.keys(cache.closes).length) {
    throw new Error(`${code}: no klines and no cached closes`)
  } else {
    console.log(`using cached closes: ${Object.keys(cache.closes).length}`)
  }

  const closeDates = Object.keys(cache.closes).sort()
  const missing = closeDates.filter(
    (d) => !(typeof cache.shares[d] === 'number' && Number.isFinite(cache.shares[d])),
  )

  console.log(`shares cached: ${Object.keys(cache.shares).length}, missing: ${missing.length}`)

  if (!missing.length) {
    await saveCache(cachePath, code, cache)
    console.log('nothing to fetch; cache already complete')
    return
  }

  const started = Date.now()
  attachSave(() => saveCache(cachePath, code, cache))

  if (meta.exchange === 'SZ') {
    const { ok, failWindows, skippedOld } = await fillSzseSharesByRange(
      code,
      missing,
      cache.shares,
    )
    await saveCache(cachePath, code, cache)
    const still = missing.filter(
      (d) => !(typeof cache.shares[d] === 'number' && Number.isFinite(cache.shares[d])),
    ).length
    console.log(
      `done ${code}. shares=${Object.keys(cache.shares).length} closes=${Object.keys(cache.closes).length} filled=${ok} skippedOld=${skippedOld} stillMissing=${still} failWindows=${failWindows} ${((Date.now() - started) / 1000).toFixed(1)}s`,
    )
    return
  }

  let done = 0
  let ok = 0
  let fail = 0
  await mapPool(missing, 2, async (date) => {
    const wan = await fetchSseShareWan(code, date)
    done += 1
    if (wan == null) fail += 1
    else {
      cache.shares[date] = wan
      ok += 1
    }
    if (done % 40 === 0 || done === missing.length) {
      const sec = ((Date.now() - started) / 1000).toFixed(1)
      console.log(`progress ${done}/${missing.length} ok=${ok} fail=${fail} ${sec}s`)
      await saveCache(cachePath, code, cache)
    }
    await sleep(100)
  })

  await saveCache(cachePath, code, cache)
  console.log(
    `done ${code}. shares=${Object.keys(cache.shares).length} closes=${Object.keys(cache.closes).length} fail=${fail}`,
  )
}

console.log(`ETF seed via ${CURL}; targets: ${targets.map((t) => t.code).join(', ')}`)
for (const meta of targets) {
  try {
    await seedOne(meta)
  } catch (e) {
    console.error(`seed failed for ${meta.code}:`, e instanceof Error ? e.message : e)
  }
}
console.log('\nall done')
