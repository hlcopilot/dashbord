# Cloudflare Pages + Worker 部署

目标：手机/任意浏览器打开线上地址，效果接近本机 `npm run dev`。

数据缓存策略详见 **[docs/DATA-CACHE-STRATEGY.md](./docs/DATA-CACHE-STRATEGY.md)**。

| 能力 | 本机 Vite | Cloudflare |
| --- | --- | --- |
| 静态页面 | Vite | **Pages**（`dist`） |
| 成交额/两融/ETF 聚合 API | Vite 插件 + `data/series` 等 | **Worker** + **KV** |
| `/api/sohu` 等原始代理 | `vite.config.ts` proxy | **Worker**（聚合内部仍会用） |
| 分时积累 | 写 `data/intraday/*.json` | Worker → **KV** |

前端仍请求相对路径 `/api/...`，**业务代码不用改**。同域靠「Pages 主机名 + Worker Route `/api/*`」拼起来。

## 架构

```
手机/浏览器
   │  https://stock-loonghe.pages.dev/
   │
   ├─ /*          ──►  Cloudflare Pages（dist 静态）
   │
   └─ /api/*      ──►  Worker: stock-api
                         ├─ 代理搜狐 / 东财 / 新浪
                         └─ /api/local/intraday → KV（INTRADAY_KV）
```

与「Pages Functions」的区别：API 是独立 Worker，可单独发版、单独看日志/用量；Pages 只负责前端。

## 一次性准备

### 1. 安装并登录

```bash
npm install
npx wrangler login
```

### 2. 创建 KV（生产 + preview）

```bash
npm run cf:kv:create
```

把两条命令输出的 `id` 填进 `worker/wrangler.toml`：

```toml
[[kv_namespaces]]
binding = "INTRADAY_KV"
id = "xxxxxxxx"
preview_id = "yyyyyyyy"
```

### 3. （可选）Dashboard 里预建 Pages 项目名 `stock-loonghe`，与根目录 `wrangler.toml` 的 `name` 一致。

## 部署（两步）

```bash
# 前端 → Pages
npm run deploy:pages

# API → Worker
npm run deploy:worker
```

或一次跑完：

```bash
npm run deploy:cf
```

成功后终端会给出 Pages 的 `*.pages.dev` 地址，以及 Worker 的 `*.workers.dev` 地址。

## 关键：让前端打到 Worker（无自定义域名必看）

`*.pages.dev` **不能**像自有域名那样挂 Worker Route（没有你可控的 Zone）。  
因此默认方案是：**Pages 只出页面，API 走 `*.workers.dev`**，用环境变量拼接。

### 只用默认域名（你现在的情况）

1. 部署 Worker 后记下地址，例如：

   `https://stock-api.dragonhe7458.workers.dev`

2. 写入 `.env.production`（仓库里已按你当前账号写好）：

```env
VITE_API_BASE=https://stock-api.dragonhe7458.workers.dev
```

3. **重新部署 Pages**（必须重新 build，变量才会打进前端包）：

```bash
npm run deploy:pages
```

4. 手机打开 Pages 地址即可（例如 `https://stock-loonghe.pages.dev` 或部署日志里的预览链接）。  
   请求会发到 Worker；Worker 已开 CORS，写 KV 照常。

验证 API：

`https://stock-api.dragonhe7458.workers.dev/api/local/intraday`

应返回 JSON（如 `{ "dates": [] }`）。

本地 `npm run dev` **不要**设 `VITE_API_BASE`，继续走 Vite 同源代理。

### 以后有自定义域名（可选，可同域）

1. 域名接到 Pages。
2. 在 `worker/wrangler.toml` 写：

```toml
[[routes]]
pattern = "dashbord.example.com/api/*"
zone_name = "example.com"
```

3. 清空或删掉 `.env.production` 里的 `VITE_API_BASE`，再 `deploy:pages` + `deploy:worker`。
## 本地模拟

| 场景 | 命令 |
| --- | --- |
| 日常开发（本地文件归档） | `npm run dev` |
| 只测 Worker API | `npm run cf:worker:dev` → 默认 `http://127.0.0.1:8787` |
| 静态预览（无 API） | `npm run preview` |

Worker 本地调试时，可用：

```bash
curl http://127.0.0.1:8787/api/local/intraday
```

## 与本机开发的关系

- **日常开发**：继续 `npm run dev`（Vite 中间件写本地 `data/`）。
- **上线**：Pages + Worker；归档进 KV，不依赖电脑开机。
- 两套存储**不自动同步**。导入本机 JSON：

```bash
# 单日
npx wrangler kv key put --config worker/wrangler.toml --binding=INTRADAY_KV "day:2026-11-05" --path=./data/intraday/2026-11-05.json

# 或批量
npm run cf:kv:seed
```

## 注意

1. **东财/搜狐**可能对 Cloudflare IP 限流或间歇失败，属上游策略；前端已有部分重试。
2. KV 免费额对日频小文件通常够用。
3. 未绑定 KV：行情代理仍可用，分时归档 503，日线主图不受影响。
4. Git 连 Pages 自动构建时：Build `npm run build`，Output `dist`；**Worker 仍需单独 `deploy:worker`（或 CI 再加一步）**。
5. 仓库里若还有旧的 `functions/`，可忽略或删除；本方案以 `worker/` 为准。

## 手机访问

部署并挂好 `/api` Route 后，Android Chrome 打开 `https://<项目>.pages.dev`（或自定义域）即可，无需电脑常开、无需同一 Wi‑Fi。
