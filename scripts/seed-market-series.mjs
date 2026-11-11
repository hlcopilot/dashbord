/**
 * 全量/补齐成交额与两融本地缓存
 * 用法：npm run series:seed
 *
 * 通过本地 Vite 中间件同款上游逻辑直接写入 data/series/*.json
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

await seedTurnover()
await seedMargin()
console.log('done')
