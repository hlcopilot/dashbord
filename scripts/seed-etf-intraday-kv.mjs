/**
 * 把 data/etf-intraday/{code}/*.json 批量写入 Worker 绑定的 INTRADAY_KV
 * 键：etfintra:{code}:{date}
 * 用法：npm run cf:etf-intraday:seed
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = path.join(root, 'data', 'etf-intraday')

let codeDirs = []
try {
  const entries = await readdir(dataDir)
  for (const name of entries) {
    const full = path.join(dataDir, name)
    if ((await stat(full)).isDirectory() && /^[0-9A-Za-z]+$/.test(name)) {
      codeDirs.push(name)
    }
  }
} catch {
  console.log('no local ETF intraday under data/etf-intraday')
  process.exit(0)
}

codeDirs = codeDirs.sort()
if (!codeDirs.length) {
  console.log('no ETF code folders under data/etf-intraday')
  process.exit(0)
}

let total = 0
for (const code of codeDirs) {
  const dir = path.join(dataDir, code)
  const files = (await readdir(dir)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
  console.log(`seeding ${code}: ${files.length} day(s)`)
  for (const file of files) {
    const date = file.replace(/\.json$/, '')
    const key = `etfintra:${code}:${date}`
    const filePath = path.join(dir, file)
    await readFile(filePath, 'utf8')

    await new Promise((resolve, reject) => {
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
      child.on('exit', (code) =>
        code === 0 ? resolve() : reject(new Error(`wrangler exit ${code}`)),
      )
    })
    total += 1
  }
}

console.log(`done, ${total} key(s)`)
