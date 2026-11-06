/**
 * 把 data/intraday/*.json 批量写入 Worker 绑定的 INTRADAY_KV
 * 用法：npm run cf:kv:seed
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = path.join(root, 'data', 'intraday')

const files = (await readdir(dataDir)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
if (!files.length) {
  console.log('no local intraday JSON under data/intraday')
  process.exit(0)
}

console.log(`seeding ${files.length} day(s) → INTRADAY_KV`)

for (const file of files) {
  const date = file.replace(/\.json$/, '')
  const key = `day:${date}`
  const filePath = path.join(dataDir, file)
  // 校验可读
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
        key,
        `--path=${filePath}`,
      ],
      { cwd: root, stdio: 'inherit', shell: true },
    )
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`wrangler exit ${code}`))))
  })
}

console.log('done')
