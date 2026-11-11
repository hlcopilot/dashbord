# 数据拉取与画图取数策略

本文约定 `dashbord` 各卡片的数据来源、缓存位置、增量方式，以及画图时如何取数。后续新增指标默认遵循同一套策略。

## 总原则

1. **双环境兼顾**：本地 `npm run dev`（Vite 插件 + `data/**`）与云端 Pages + Worker（KV）逻辑对齐；改 `/api/*` 必须两边一起改（优先抽 `*-core.ts` 共用）。
2. **持久缓存优先**：历史序列落盘（本地 `data/`）或 Cloudflare KV；打开页面先读缓存再画图。
3. **日常只打增量**：同一上游接口用日期窗口 / 倒序早停补齐缺日与近端修正，禁止每次全历史重拉。
4. **冷启动可 seed**：首次或空缓存用 `npm run *:seed` 全量回填；页面请求也可渐进补齐，但不应阻塞成「每次全量」。
5. **画图不直连上游**：Vue 卡片只请求本项目聚合 API（或本地归档），区间切换在前端 `slice*ByRange`，不重复打外部源。
6. **分时与日线分开**：日频主图一套缓存；分钟分时另一套归档（东财近 5 日刷新 + 本地保留更早）。

## 模块对照

| 模块 | 聚合 API | 本地缓存 | 云端 KV | 上游 | 增量方式 | 画图取数 |
| --- | --- | --- | --- | --- | --- | --- |
| 成交额主图 | `GET /api/turnover/series` | `data/series/turnover.json` | `series:turnover` | 搜狐 `hisHq` 上证+深成 | `start/end` 从近端重叠日起 | 前端读 API → 可选补今日虚线点 → `sliceByRange` |
| 两融主图 | `GET /api/margin/series` | `data/series/margin.json` | `series:margin` | 东财 `RPTA_RZRQ_LSHJ` + 搜狐上证 | 倒序分页至缓存重叠早停；上证按日期窗口 | 前端读 API → `sliceMarginByRange` |
| ETF 净流入 | `GET /api/etf/flow` | `data/etf-share/{code}.json` | `etfcache:{code}` | 上交所份额 + 东财日 K | 缺日份额 + 近端 T+1 重试；K 线一次对齐 closes | 前端读 API → `sliceEtfFlowByRange` |
| 成交额分时 | `/api/local/intraday*` | `data/intraday/*.json` | `day:YYYY-MM-DD` | 东财 trends2 近约 5 日 | 远端近 5 日覆盖写回，更早保留本地 | `syncIntradayArchive` 合并后再画 |

## 成交额主图

- **缓存字段**：`days[YYYY-MM-DD].amountYi`（两市合计，亿元）。
- **增量**：有缓存时，以「最近约 5 个已缓存交易日」为 `start` 再拉到今日，合并写回（覆盖尾部修正）。
- **画图**：`fetchHsTurnoverSeries` → 服务端序列 → `appendProvisionalToday`（分时归档）→ 百分位 → 卡片 `sliceByRange`。
- **Seed**：`npm run series:seed`。

## 两融主图

- **缓存字段**：`days[date].{ marginYi, financingYi, securitiesYi, sseClose }`。
- **增量**：东财按 `DIM_DATE` 倒序翻页，一旦日期早于「缓存尾部重叠窗口」即停；上证收盘用搜狐 `start/end` 增量填 `sseClose`。
- **画图**：`fetchMarginSeries` → 服务端全序列 → 百分位 / 增减 → `sliceMarginByRange`。
- **Seed**：`npm run series:seed`。

## ETF 净流入

- **缓存字段**：`shares`（万份）、`closes`（收盘价作净值近似）。
- **公式**：`净流入 ≈ Δ份额(份) × 当日收盘价 / 1e8`（全日，非分时切片）。
- **增量**：日 K 全量对齐 closes；份额只拉缺日 + 近端 pending 重试；历史空洞可用 `backfill` 或 `npm run etf:seed`。
- **画图**：`fetchEtfFlowSeries` → `sliceEtfFlowByRange`。

## 成交额分时（右键当日分时）

- **不是**两融缓存；两融无分时。
- 打开/同步时：读 `/api/local/intraday/all`，再拉东财近 5 日写回；主图盘中虚线点依赖同一归档。
- 画图：`fetchIntradayTurnover` → 已合并的本地+近 5 日分钟数据。

## 部署注意

- 本地：Vite 插件写 `data/series`、`data/etf-share`、`data/intraday`。
- 云端：Worker 同源路径读 KV；无自定义域时前端 `VITE_API_BASE` 指向 Worker。
- 改策略或新增序列后：更新本文 + 本仓库 `.cursor/rules/data-cache-strategy.mdc`，并评估是否需要 seed / 重新 deploy Worker。

## 相关命令

```bash
npm run series:seed   # 成交额 + 两融本地全量/补齐
npm run etf:seed      # 单只 ETF 份额+收盘价全量/补齐
npm run cf:kv:seed    # 分时 JSON 导入 KV（可选）
npm run deploy:cf     # Pages + Worker
```
