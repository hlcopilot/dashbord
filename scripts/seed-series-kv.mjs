/**
 * 把本地 data/series + data/etf-share 导入 Worker 绑定的 INTRADAY_KV
 * 用法：npm run cf:series:seed
 *
 * Cloudflare 出口访问交易所常失败，云端 ETF 图依赖这份 KV 缓存。
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { access, readdir } from 'node:fs/promises'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function wranglerPut(key, filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'npx',
      [
        'wrangler',
        'kv',
        'key',
        'put',
        '--config',
        'worker/wrangler.toml',
        '--binding=INTRADAY_KV',
        '--preview',
        'false',
        '--remote',
        key,
        `--path=${filePath}`,
      ],
      { cwd: root, stdio: 'inherit', shell: true },
    )
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`wrangler exit ${code}`))))
  })
}

const jobs = [
  { key: 'series:turnover', file: path.join(root, 'data/series/turnover.json') },
  { key: 'series:margin', file: path.join(root, 'data/series/margin.json') },
  { key: 'series:gold', file: path.join(root, 'data/series/gold.json') },
  { key: 'series:oil', file: path.join(root, 'data/series/oil.json') },
]

const etfDir = path.join(root, 'data/etf-share')
try {
  const files = (await readdir(etfDir)).filter((f) => /^\d{6}\.json$/.test(f))
  for (const file of files) {
    const code = file.replace(/\.json$/, '')
    jobs.push({ key: `etfcache:${code}`, file: path.join(etfDir, file) })
  }
} catch {
  console.warn('no data/etf-share directory')
}

for (const job of jobs) {
  try {
    await access(job.file)
  } catch {
    console.warn(`skip missing ${job.file}`)
    continue
  }
  console.log(`put ${job.key} ← ${job.file}`)
  await wranglerPut(job.key, job.file)
}

console.log(`done (${jobs.length} job(s) attempted)`)
