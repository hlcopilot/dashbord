import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { emCurlProxyPlugin } from './vite-plugin-em-curl-proxy.ts'
import { etfFlowPlugin } from './vite-plugin-etf-flow.ts'
import { localArchivePlugin } from './vite-plugin-local-archive.ts'
import { marketSeriesPlugin } from './vite-plugin-market-series.ts'

export default defineConfig({
  // emCurlProxy 须靠前：先于内置 http-proxy 接管东财，避免 socket hang up
  plugins: [
    vue(),
    emCurlProxyPlugin(),
    localArchivePlugin(),
    etfFlowPlugin(),
    marketSeriesPlugin(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
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
      // 东财分时 trends2：走 push2（push2his 在本机 Node 代理上常 socket hang up）
      '/api/em-push2': {
        target: 'https://push2.eastmoney.com',
        changeOrigin: true,
        secure: true,
        timeout: 60_000,
        proxyTimeout: 60_000,
        rewrite: (path) => path.replace(/^\/api\/em-push2/, ''),
        headers: {
          Referer: 'https://quote.eastmoney.com/',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      },
      // 东财历史 K 等：push2his
      '/api/eastmoney': {
        target: 'https://push2his.eastmoney.com',
        changeOrigin: true,
        secure: true,
        timeout: 60_000,
        proxyTimeout: 60_000,
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
