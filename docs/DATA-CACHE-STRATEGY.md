# 数据拉取与画图取数策略

本文约定 `dashbord` 各卡片的数据来源、缓存位置、增量方式，以及画图时如何取数。后续新增指标默认遵循同一套策略。

## 总原则

1. **双环境兼顾**：本地 `npm run dev`（Vite 插件 + `data/**`）与云端 Pages + Worker（KV）逻辑对齐；改 `/api/*` 必须两边一起改（优先抽 `*-core.ts` 共用）。
2. **持久缓存优先**：历史序列落盘（本地 `data/`）或 Cloudflare KV；打开页面先读缓存再画图。
3. **日常只打增量**：同一上游接口用日期窗口 / 倒序早停补齐缺日与近端修正，禁止每次全历史重拉。
4. **收盘前门闩**（`market-session.ts`）：未到上海 15:00 不把「今天」写入日频收盘序列；ETF **份额**增量永不包含今天（T+1）。
5. **冷启动可 seed**：首次或空缓存用 `npm run *:seed` 全量回填；页面请求也可渐进补齐，但不应阻塞成「每次全量」。
6. **画图不直连上游**：Vue 卡片只请求本项目聚合 API（或本地归档），区间切换在前端 `slice*ByRange`，不重复打外部源。
7. **分时与日线分开**：日频主图一套缓存；分钟分时另一套归档（东财近 5 日刷新 + 本地保留更早）。

## 模块对照

| 模块 | 聚合 API | 本地缓存 | 云端 KV | 上游 | 增量方式 | 画图取数 |
| --- | --- | --- | --- | --- | --- | --- |
| 成交额主图 | `GET /api/turnover/series` | `data/series/turnover.json` | `series:turnover` | 搜狐 `hisHq` 上证+深成 | `start/end` 从近端重叠日起 | 前端读 API → 可选补今日虚线点 → `sliceByRange` |
| 两融主图 | `GET /api/margin/series` | `data/series/margin.json` | `series:margin` | 东财 `RPTA_RZRQ_LSHJ` + 搜狐上证 | 倒序分页至缓存重叠早停；上证按日期窗口 | 前端读 API → `sliceMarginByRange` |
| ETF 净流入（20 只宽基） | `GET /api/etf/flow?code=` | `data/etf-share/{code}.json` | `etfcache:{code}` | 沪：上交所份额；深：深交所 `scsj_fund_jjgm`；东财日 K | 缺日份额 + 近端 T+1 重试；K 线对齐 closes | `EtfFlowSection` 按需请求 → `sliceEtfFlowByRange` |
| ETF 当日分钟 K | `/api/local/etf-intraday/{code}*` + 东财代理 | `data/etf-intraday/{code}/*.json` | `etfintra:{code}:{date}` | 东财 1 分钟 K（最新日）+ trends2（近约 5 日） | 打开弹层同步近 5 日写回，更早靠归档积累 | 右键/长按日 → `EtfIntradayDialog` |
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

- **篮子**：`etf-universe.ts` / `etf-universe.json` 固定 20 只（沪深300 / A500 / 1000 / 创业板 / 科创50 / 500 / 上证50 / 上证综指等），卡片标注 `indexName`。
- **缓存字段**：`shares`（万份）、`closes`（收盘价作净值近似）；每只一只文件 / 一个 KV 键。
- **公式**：`净流入 ≈ Δ份额(份) × 当日收盘价 / 1e8`（全日，非分时切片）。
- **份额源**：沪市 `fetchSseShareWan`；深市 `fetchSzseShareWan`（`etf-share-fetch.ts`）。
- **增量**：日 K 对齐 closes；份额只拉缺日 + 近端 pending 重试；历史空洞用 `npm run etf:seed`（无参=20 只，可传单 code）。
- **画图**：`EtfFlowSection` 视口懒加载 + 并发门闩 → `fetchEtfFlowSeries(code)` → `sliceEtfFlowByRange`。

## 成交额分时（右键当日分时）

- **不是**两融缓存；两融无分时。
- 打开/同步时：读 `/api/local/intraday/all`，再拉东财近 5 日写回；主图盘中虚线点依赖同一归档。
- 画图：`fetchIntradayTurnover` → 已合并的本地+近 5 日分钟数据。

## ETF 当日分钟 K（右键 / 长按）

- **不是**净流入分时；份额仍是日频 T+1，分钟图只看价格 OHLC + 成交量/额。
- **缓存优先**：打开弹层时 `syncEtfIntradayArchive` 拉东财近约 5 日写回归档；更早日期只读本地/KV。
- 最新交易日优先 `klt=1` 覆盖；其余近日用 `trends2`。
- 本地：`data/etf-intraday/{code}/YYYY-MM-DD.json`；云端 KV：`etfintra:{code}:{date}`。
- API：`GET/PUT /api/local/etf-intraday/{code}/...`（Vite 插件与 Worker 对齐）。
- 解析/建日共用：`etf-intraday-core.ts`（前端 sync 与 `etf:intraday:seed`）。
- 本地全篮子近 5 日回填：`npm run etf:intraday:seed`（可加 code）；云端：`npm run cf:etf-intraday:seed`。
- 入口：每张 `EtfNetFlowCard`（按 props.code，非仅 510300）；右键/长按菜单复用 `useChartDayMenu`。

## 部署注意

- 本地：Vite 插件写 `data/series`、`data/etf-share`、`data/intraday`、`data/etf-intraday`。
- **`data/**` 一律提交 Git**（日频 + 分钟归档都是长期积累；勿再 gitignore）。云端仍可用 `cf:series:seed` / `cf:kv:seed` / `cf:etf-intraday:seed` 灌 KV。
- 云端：Worker 同源路径读 KV；无自定义域时前端 `VITE_API_BASE` 指向 Worker。
- 改策略或新增序列后：更新本文 + 本仓库 `.cursor/rules/data-cache-strategy.mdc`，并评估是否需要 seed / 重新 deploy Worker。
- 前端卡片改动需同时满足桌面 + H5（见 `docs/H5-MOBILE.md`）；云端 Pages 即手机常用入口。

## 相关命令

```bash
npm run series:seed      # 成交额 + 两融本地全量/补齐
npm run etf:seed         # 20 只宽基份额+收盘价全量/补齐（可加 code 参数单只）
npm run cf:kv:seed            # 成交额分时 JSON 导入 KV（可选）
npm run etf:intraday:seed     # 20 只近约 5 日分钟 K → data/etf-intraday（可加 code）
npm run cf:etf-intraday:seed  # ETF 分钟 K 归档导入 KV（可选，本地积累后）
npm run cf:series:seed        # 成交额/两融/全部 etf-share/*.json 导入 KV（云端必做）
npm run deploy:cf             # Pages + Worker
```

