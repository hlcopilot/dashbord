# A股投资看板（dashbord）

Vue 3 + Vite + TypeScript + Element Plus + ECharts 的投资看板前端。打开页面会自动拉取最新可获取的沪深两市成交额。

## 技术栈

- **Vue 3 + Vite + TypeScript**
- **Element Plus**：卡片、分段控制器、Loading、Alert、Dialog
- **ECharts / vue-echarts**：日线 / 分时成交额图
- **搜狐财经**：沪深日线成交额
- **东方财富**：近约 5 个交易日分时成交额
- **本地归档**：`data/intraday/*.json`、`data/series/*.json`、`data/etf-share/*.json`（缓存优先，日常增量）

数据拉取 / 画图取数策略详见 **[docs/DATA-CACHE-STRATEGY.md](./docs/DATA-CACHE-STRATEGY.md)**。

## 快速开始

```bash
npm install
npm run series:seed   # 可选：成交额+两融本地全量缓存（首次建议）
npm run etf:seed      # 可选：ETF 份额全量
npm run dev
```

浏览器打开终端提示的本地地址（默认 `http://localhost:5173`）。  
同 Wi‑Fi 下手机可访问终端里的 Network 地址（已开启 `server.host`）。

> 本地归档依赖 Vite 开发中间件，请用 `npm run dev`（或 `npm run preview`）访问，不要只用静态 `dist` 打开。
## 云端部署（Cloudflare Pages + Worker）

手机离电脑也能用：静态站上 **Pages**，`/api/*` 走独立 **Worker**；分时积累改存 KV。

详见 **[DEPLOY-CLOUDFLARE.md](./DEPLOY-CLOUDFLARE.md)**。

```bash
npm install
npx wrangler login
npm run cf:kv:create          # 把 id 填进 worker/wrangler.toml
npm run deploy:cf             # Pages + Worker
# 无自定义域名：确认 .env.production 的 VITE_API_BASE = Worker 地址，再 deploy:pages
```

## 功能

- **成交额卡片**：沪深两市成交额、近 3 年百分位、区间切换、缩放、高低点/均值
- **今日盘中点**：搜狐日线尚未入库时，用分时累计在曲线末端补蓝色虚线点，右键同样可进「当日分时」
- **当日分时**：右键某日 → 今日/前一日累计成交额对比 + 增减柱状
- **两融余额卡片**：两融余额（左轴）+ 上证指数（右轴），同样支持区间/缩放/高低点/均值
- **ETF 净流入卡片**：默认 510300，按「份额变动 × 收盘价」估算日净申赎（大资金代理口径）；份额/收盘价优先本地缓存，日常只补增量。首次全量：`npm run etf:seed`
- **本地积累**：分时写入 `data/intraday/`；成交额/两融写入 `data/series/`（与 ETF 同一套缓存优先策略）

## 数据说明

- 日线成交额 / 两融 / ETF：服务端缓存 + 增量（见 `docs/DATA-CACHE-STRATEGY.md`）
- 分时成交额 = 东财近 5 日 trends2 + 本地更早归档
- 百分位默认按已收盘样本计算；盘中点参与展示与对比