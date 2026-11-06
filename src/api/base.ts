/**
 * 生产（Pages）无自定义域名时，API 走独立 Worker；
 * 本地开发留空，继续用 Vite 同源代理 `/api/...`。
 */
export function apiUrl(path: string): string {
  const base = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, '') ?? ''
  const p = path.startsWith('/') ? path : `/${path}`
  return `${base}${p}`
}
