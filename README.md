# A股投资看板（dashbord）

Vue 3 + Vite + TypeScript + Element Plus + ECharts 的投资看板前端。打开页面会自动拉取最新可获取的沪深两市成交额。

## 技术栈

- **Vue 3 + Vite + TypeScript**
- **Element Plus**：卡片、分段控制器、Loading、Alert、Dialog
- **ECharts / vue-echarts**：日线 / 分时成交额图
- **搜狐财经**：沪深日线成交额
- **东方财富**：近约 5 个交易日分时成交额
- **本地归档**：`data/intraday/*.json`（开发服务自动读写，持续积累分时）

## 快速开始

```bash
npm install
npm run dev
```

浏览器打开终端提示的本地地址（默认 `http://localhost:5173`）。

> 本地归档依赖 Vite 开发中间件，请用 `npm run dev`（或 `npm run preview`）访问，不要只用静态 `dist` 打开。

## 功能

- **日线卡片**：成交额、近 3 年百分位、区间切换、缩放、高低点/均值
- **今日盘中点**：搜狐日线尚未入库时，用分时累计在曲线末端补蓝色虚线点，右键同样可进「当日分时」
- **当日分时**：右键某日 → 今日/前一日累计成交额对比 + 增减柱状
- **本地积累**：每次同步东财近 5 日分时，会写入 `data/intraday/YYYY-MM-DD.json`；超过 5 日的历史靠本地文件保留

## 数据说明

- 日线成交额 = 上证 + 深成指（搜狐 `hisHq`）
- 分时成交额 = 上证 + 深成指分钟成交额累计（东财 trends2）
- 百分位默认按已收盘样本计算；盘中点参与展示与对比
