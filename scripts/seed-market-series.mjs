/**
 * 全量/补齐成交额、两融、黄金本地缓存
 * 用法：npm run series:seed
 *
 * 通过本地 Vite 中间件同款上游逻辑直接写入 data/series/*.json
 */
import { execFile } from 'node:child_process'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const CURL = process.platform === 'win32' ? 'curl.exe' : 'curl'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = path.join(root, 'data', 'series')
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function readCache(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return { days: {} }
  }
}

async function writeCache(file, data) {
  await mkdir(DIR, { recursive: true })
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

async function sohuAmount(code, start, end) {
  const url = `https://q.stock.sohu.com/hisHq?code=${code}&start=${start}&end=${end}&stat=1&order=A&period=d`
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, {
        headers: { Referer: 'https://q.stock.sohu.com/', 'User-Agent': UA },
      })
      if (!res.ok) throw new Error(String(res.status))
      const data = await res.json()
      const item = data?.[0]
      if (!item || item.status !== 0 || !item.hq?.length) throw new Error('empty')
      const map = new Map()
      for (const row of item.hq) map.set(row[0], Number(row[8]) / 10000)
      return map
    } catch (e) {
      if (i === 3) throw e
      await sleep(400 * (i + 1))
    }
  }
  return new Map()
}

async function sohuClose(start, end) {
  const url = `https://q.stock.sohu.com/hisHq?code=zs_000001&start=${start}&end=${end}&stat=1&order=A&period=d`
  const res = await fetch(url, {
    headers: { Referer: 'https://q.stock.sohu.com/', 'User-Agent': UA },
  })
  if (!res.ok) throw new Error(`sse ${res.status}`)
  const data = await res.json()
  const map = new Map()
  const item = data?.[0]
  if (!item || item.status !== 0 || !item.hq?.length) return map
  for (const row of item.hq) map.set(row[0], Number(row[2]))
  return map
}

async function seedTurnover() {
  const file = path.join(DIR, 'turnover.json')
  const cache = await readCache(file)
  cache.days = cache.days || {}
  console.log('[turnover] fetching full sohu window 20150101 → today')
  const end = new Date()
  const endC = `${end.getFullYear()}${String(end.getMonth() + 1).padStart(2, '0')}${String(end.getDate()).padStart(2, '0')}`
  const sh = await sohuAmount('zs_000001', '20150101', endC)
  await sleep(200)
  const sz = await sohuAmount('zs_399001', '20150101', endC)
  let n = 0
  for (const date of [...sh.keys()].filter((d) => sz.has(d))) {
    cache.days[date] = {
      amountYi: Math.round(((sh.get(date) ?? 0) + (sz.get(date) ?? 0)) * 10) / 10,
    }
    n += 1
  }
  cache.updatedAt = new Date().toISOString()
  await writeCache(file, cache)
  console.log(`[turnover] saved ${n} days → ${file}`)
}

async function seedMargin() {
  const file = path.join(DIR, 'margin.json')
  const cache = await readCache(file)
  cache.days = cache.days || {}
  console.log('[margin] paging eastmoney RPTA_RZRQ_LSHJ …')
  let page = 1
  let pages = 1
  let rowsTotal = 0
  while (page <= pages) {
    const url =
      `https://datacenter-web.eastmoney.com/api/data/v1/get` +
      `?reportName=RPTA_RZRQ_LSHJ&columns=DIM_DATE,RZRQYE,RZYE,RQYE` +
      `&pageNumber=${page}&pageSize=800&sortTypes=-1&sortColumns=DIM_DATE&source=WEB&client=WEB`
    const res = await fetch(url, {
      headers: { Referer: 'https://data.eastmoney.com/rzrq/', 'User-Agent': UA },
    })
    if (!res.ok) throw new Error(`margin page ${page}: ${res.status}`)
    const json = await res.json()
    pages = json.result?.pages ?? 1
    const rows = json.result?.data ?? []
    for (const row of rows) {
      const date = String(row.DIM_DATE).slice(0, 10)
      if (!date) continue
      cache.days[date] = {
        marginYi: Math.round((Number(row.RZRQYE) / 1e8) * 100) / 100,
        financingYi: Math.round((Number(row.RZYE) / 1e8) * 100) / 100,
        securitiesYi: Math.round((Number(row.RQYE) / 1e8) * 100) / 100,
        sseClose: cache.days[date]?.sseClose ?? null,
      }
      rowsTotal += 1
    }
    console.log(`[margin] page ${page}/${pages} (+${rows.length})`)
    page += 1
    if (page <= pages) await sleep(180)
  }

  const dates = Object.keys(cache.days).sort()
  if (dates.length) {
    console.log('[margin] fetching sse closes …')
    const sse = await sohuClose(dates[0].replace(/-/g, ''), dates[dates.length - 1].replace(/-/g, ''))
    for (const [date, close] of sse) {
      if (cache.days[date]) cache.days[date].sseClose = close
    }
  }

  cache.updatedAt = new Date().toISOString()
  await writeCache(file, cache)
  console.log(`[margin] saved ${Object.keys(cache.days).length} days (raw rows ${rowsTotal}) → ${file}`)
}

async function curlJson(url) {
  const { stdout } = await execFileAsync(
    CURL,
    ['-sS', '--connect-timeout', '20', '--max-time', '90', '-L', '-H', `User-Agent: ${UA}`, '-H', 'Referer: https://quote.eastmoney.com/', url],
    { maxBuffer: 32 * 1024 * 1024 },
  )
  return JSON.parse(stdout)
}

async function emCloseMap(secid, beg, end) {
  const url =
    `https://push2his.eastmoney.com/api/qt/stock/kline/get` +
    `?secid=${encodeURIComponent(secid)}` +
    `&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57` +
    `&klt=101&fqt=1&beg=${beg}&end=${end}&lmt=100000`
  for (let i = 0; i < 4; i++) {
    try {
      const json = await curlJson(url)
      const klines = json?.data?.klines ?? []
      if (!klines.length) throw new Error('empty')
      const map = new Map()
      for (const row of klines) {
        const parts = String(row).split(',')
        const date = parts[0]
        const close = Number(parts[2])
        if (date && Number.isFinite(close)) map.set(date, close)
      }
      return map
    } catch (e) {
      if (i === 3) throw e
      await sleep(400 * (i + 1))
    }
  }
  return new Map()
}

async function seedGold() {
  const file = path.join(DIR, 'gold.json')
  const cache = await readCache(file)
  cache.days = cache.days || {}
  const end = new Date()
  const endC = `${end.getFullYear()}${String(end.getMonth() + 1).padStart(2, '0')}${String(end.getDate()).padStart(2, '0')}`
  const beg = '20130718'
  const shauBeg = '20160419'
  const auBeg = '20100104'
  const xauBeg = '20100104'
  console.log(`[gold] fetching 518880 + SHAU + Au9999 + XAU + UDI → ${endC}`)
  const gold = await emCloseMap('1.518880', beg, endC)
  await sleep(200)
  const shau = await emCloseMap('118.SHAU', shauBeg, endC)
  await sleep(200)
  const au9999 = await emCloseMap('118.AU9999', auBeg, endC)
  await sleep(200)
  const xau = await emCloseMap('122.XAU', xauBeg, endC)
  await sleep(200)
  const usd = await emCloseMap('100.UDI', beg, endC)

  const touch = (date) => {
    if (!cache.days[date]) {
      cache.days[date] = {
        goldClose: null,
        shauClose: null,
        au9999Close: null,
        xauClose: null,
        usdIndex: null,
      }
    } else {
      if (cache.days[date].goldClose === undefined) {
        cache.days[date].goldClose = cache.days[date].goldClose ?? null
      }
      if (cache.days[date].shauClose === undefined) cache.days[date].shauClose = null
      if (cache.days[date].au9999Close === undefined) cache.days[date].au9999Close = null
      if (cache.days[date].xauClose === undefined) cache.days[date].xauClose = null
    }
    return cache.days[date]
  }

  for (const [date, close] of gold) {
    const day = touch(date)
    day.goldClose = Math.round(close * 1000) / 1000
  }
  for (const [date, close] of shau) {
    const day = touch(date)
    day.shauClose = Math.round(close * 100) / 100
  }
  for (const [date, close] of au9999) {
    const day = touch(date)
    day.au9999Close = Math.round(close * 100) / 100
  }
  for (const [date, close] of xau) {
    const day = cache.days[date]
    if (!day) continue
    day.xauClose = Math.round(close * 100) / 100
  }
  for (const [date, close] of usd) {
    const day = cache.days[date]
    if (!day) continue
    day.usdIndex = Math.round(close * 100) / 100
  }
  cache.updatedAt = new Date().toISOString()
  await writeCache(file, cache)
  const n = Object.keys(cache.days).length
  const nShau = Object.values(cache.days).filter((d) => d.shauClose != null).length
  const nAu = Object.values(cache.days).filter((d) => d.au9999Close != null).length
  const nXau = Object.values(cache.days).filter((d) => d.xauClose != null).length
  console.log(`[gold] saved ${n} days (SHAU ${nShau}, Au9999 ${nAu}, XAU ${nXau}) → ${file}`)
}

async function seedOil() {
  const file = path.join(DIR, 'oil.json')
  const cache = await readCache(file)
  cache.days = cache.days || {}
  const end = new Date()
  const endC = `${end.getFullYear()}${String(end.getMonth() + 1).padStart(2, '0')}${String(end.getDate()).padStart(2, '0')}`
  const beg = '20100104'
  console.log(`[oil] fetching Brent + WTI + UDI → ${endC}`)
  const brent = await emCloseMap('112.B00Y', beg, endC)
  await sleep(200)
  const wti = await emCloseMap('102.CL00Y', beg, endC)
  await sleep(200)
  const usd = await emCloseMap('100.UDI', beg, endC)

  const touch = (date) => {
    if (!cache.days[date]) {
      cache.days[date] = { brentClose: null, wtiClose: null, usdIndex: null }
    } else {
      if (cache.days[date].brentClose === undefined) cache.days[date].brentClose = null
      if (cache.days[date].wtiClose === undefined) cache.days[date].wtiClose = null
    }
    return cache.days[date]
  }

  for (const [date, close] of brent) {
    const day = touch(date)
    day.brentClose = Math.round(close * 100) / 100
  }
  for (const [date, close] of wti) {
    const day = touch(date)
    day.wtiClose = Math.round(close * 100) / 100
  }
  for (const [date, close] of usd) {
    const day = cache.days[date]
    if (!day) continue
    day.usdIndex = Math.round(close * 100) / 100
  }
  cache.updatedAt = new Date().toISOString()
  await writeCache(file, cache)
  const n = Object.keys(cache.days).length
  const nBrent = Object.values(cache.days).filter((d) => d.brentClose != null).length
  const nWti = Object.values(cache.days).filter((d) => d.wtiClose != null).length
  console.log(`[oil] saved ${n} days (Brent ${nBrent}, WTI ${nWti}) → ${file}`)
}

const only = (process.argv[2] || '').toLowerCase()
if (!only || only === 'all') {
  await seedTurnover()
  await seedMargin()
  await seedGold()
  await seedOil()
} else if (only === 'gold') {
  await seedGold()
} else if (only === 'oil') {
  await seedOil()
} else if (only === 'turnover') {
  await seedTurnover()
} else if (only === 'margin') {
  await seedMargin()
} else {
  console.error(`unknown target: ${only} (use gold | oil | turnover | margin | all)`)
  process.exit(1)
}
console.log('done')
