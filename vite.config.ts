import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { localArchivePlugin } from './vite-plugin-local-archive.ts'

export default defineConfig({
  plugins: [vue(), localArchivePlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // 搜狐历史行情（浏览器直连无 CORS）
      '/api/sohu': {
        target: 'https://q.stock.sohu.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/sohu/, ''),
        headers: {
          Referer: 'https://q.stock.sohu.com/',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      },
      // 新浪实时行情（作最新成交额兜底）
      '/api/sina': {
        target: 'https://hq.sinajs.cn',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/sina/, ''),
        headers: {
          Referer: 'https://finance.sina.com.cn',
        },
      },
      // 东方财富数据中心（两融等）——必须写在 /api/eastmoney 之前，避免前缀误匹配
      '/api/emdc': {
        target: 'https://datacenter-web.eastmoney.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/emdc/, ''),
        headers: {
          Referer: 'https://data.eastmoney.com/rzrq/',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      },
      // 东方财富分时（近约 5 个交易日）
      '/api/eastmoney': {
        target: 'https://push2his.eastmoney.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/eastmoney/, ''),
        headers: {
          Referer: 'https://quote.eastmoney.com/',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      },
    },
  },
})
