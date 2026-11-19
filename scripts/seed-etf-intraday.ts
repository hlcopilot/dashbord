/**
 * 回填篮子内 ETF 近约 5 日分钟 K → data/etf-intraday/{code}/
 * 用法：
 *   npm run etf:intraday:seed           # 全部 20 只
 *   npm run etf:intraday:seed -- 510300 # 单只
 *
 * 可重复执行：远端近 5 日覆盖写回，更早本地文件保留。
 */
import { execFile } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import {
  buildRemoteDaysFromEm,
  emMinuteKlineUrl,
  emTrends2Url,
  type LocalEtfIntradayDay,
} from '../etf-intraday-core.ts'

const execFileAsync = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outRoot = path.join(root, 'data', 'etf-intraday')
const CURL = process.platform === 'win32' ? 'curl.exe' : 'curl'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

type UniverseItem = {
  code: string
  name: string
  secid: string
}

const universe = JSON.parse(
  await readFile(path.join(root, 'etf-universe.json'), 'utf8'),
) as UniverseItem[]

const argCode = process.argv[2]
const targets: UniverseItem[] = argCode
  ? [
      universe.find((e) => e.code === argCode) || {
        code: argCode,
        name: argCode,
        secid: `${argCode.startsWith('15') ? '0' : '1'}.${argCode}`,
      },
    ]
  : universe

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/** 系统 curl，避开本机 Node fetch 对东财间歇性失败 */
async function curlJson<T>(url: string): Promise<T> {
  const args = [
    '-sS',
    '--connect-timeout',
    '20',
    '--max-time',
    '60',
    '-L',
    '-H',
    `User-Agent: ${UA}`,
    '-H',
    'Referer: https://quote.eastmoney.com/',
    url,
  ]
  const { stdout } = await execFileAsync(CURL, args, {
    maxBuffer: 16 * 1024 * 1024,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (!stdout?.trim()) throw new Error('empty curl body')
  return JSON.parse(stdout) as T
}

async function fetchJson<T>(url: string, retries = 3): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i <= retries; i++) {
    try {
      return await curlJson<T>(url)
    } catch (e) {
      lastErr = e
      await sleep(400 * (i + 1))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

async function saveDay(day: LocalEtfIntradayDay) {
  const dir = path.join(outRoot, day.code)
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, `${day.date}.json`)
  await writeFile(file, `${JSON.stringify(day, null, 2)}\n`, 'utf8')
}

async function seedOne(item: UniverseItem) {
  const { code, name, secid } = item
  console.log(`→ ${code} ${name}`)

  let trends: string[] | null = null
  let trendsName: string | null = null
  let trendsError: string | null = null
  try {
    const json = await fetchJson<{ data?: { name?: string; trends?: string[] } }>(
      emTrends2Url(secid),
    )
    trends = json.data?.trends ?? []
    trendsName = json.data?.name ?? null
  } catch (e) {
    trendsError = e instanceof Error ? e.message : String(e)
  }

  await sleep(200)

  let klines: string[] | null = null
  let klineName: string | null = null
  let klineError: string | null = null
  try {
    const json = await fetchJson<{ data?: { name?: string; klines?: string[] } }>(
      emMinuteKlineUrl(secid),
    )
    klines = json.data?.klines ?? []
    klineName = json.data?.name ?? null
  } catch (e) {
    klineError = e instanceof Error ? e.message : String(e)
  }

  const { days, warnings } = buildRemoteDaysFromEm({
    code,
    name,
    trends,
    trendsName,
    trendsError,
    klines,
    klineName,
    klineError,
  })

  for (const w of warnings) console.warn(`  ! ${w}`)

  const dates = [...days.keys()].sort()
  for (const date of dates) {
    await saveDay(days.get(date)!)
  }
  console.log(
    dates.length
      ? `  ok ${dates[0]} ~ ${dates.at(-1)}（${dates.length} 日）`
      : '  ok（无远端日写入）',
  )
}

console.log(`ETF intraday seed: ${targets.length} code(s) → ${outRoot}`)

const failed: UniverseItem[] = []
for (let i = 0; i < targets.length; i++) {
  const item = targets[i]!
  await seedOne(item)
  try {
    const files = await readdir(path.join(outRoot, item.code))
    if (!files.some((f) => f.endsWith('.json'))) failed.push(item)
  } catch {
    failed.push(item)
  }
  if (i < targets.length - 1) await sleep(600)
}

if (failed.length) {
  console.log(`\nretry ${failed.length} code(s) after cooldown…`)
  await sleep(2500)
  for (let i = 0; i < failed.length; i++) {
    await seedOne(failed[i]!)
    if (i < failed.length - 1) await sleep(900)
  }
}

console.log('done')
