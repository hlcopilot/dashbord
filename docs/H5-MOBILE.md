# H5 / 移动端适配

本看板同时服务**桌面浏览器**与**手机 H5**（含 Cloudflare Pages 公网访问）。后续加卡片、改图表、改交互时，默认按双端交付，不要只在桌面宽度验收。

Agent 约束见仓库 `.cursor/rules/h5-mobile.mdc`（与本文同步维护）。

## 目标与原则

1. **同一套代码**：不维护独立「手机站」；用断点 + `useNarrowScreen()` 分支。
2. **触控优先于键鼠**：窄屏不要依赖悬停、右键、滚轮。
3. **不与整页滚动抢手势**：图内拖移在窄屏弱化，缩放交给底部时间轴。
4. **不横向撑破**：375～430 宽下无意外横滑整页；局部横滑只允许区间 tab 等明确容器。

## 断点与工具

| 用途 | 值 | 代码 |
| --- | --- | --- |
| 布局 / 卡片 / 主图 | `max-width: 640px` | CSS media + `useNarrowScreen()` |
| 分时等弹层 | `max-width: 720px` | `useNarrowScreen(720)` + Dialog 样式 |
| 逻辑开关 | 同上 | `src/composables/useNarrowScreen.ts` |

图表缩放共用：`src/utils/chartTimeZoom.ts`（`narrow: true` 时改 inside / slider / toolbox）。说明见 `.cursor/rules/chart-time-zoom.mdc`。

## 布局与组件

- 页面：`App.vue` 边距含 `env(safe-area-inset-*)`；`index.html` viewport 含 `viewport-fit=cover`。
- 卡片：`width: min(860px, 100%)`；窄屏减小 padding、标题字号、图高（约 260px 量级）。
- **区间 segmented（成交 / 两融 / ETF 必须一致）**
  - 外层 `.range-scroll`：`flex: 1; min-width: 0; overflow-x: auto`
  - `.el-segmented`：窄屏 `width/min-width: max-content`
  - `.el-segmented__item`：`flex: 0 0 auto`，避免「全部」被裁成「全」
  - 窄屏 `chart-toolbar` 纵向：`legend` 一行，`重置` + 区间一行
- Dialog：宽度 `calc(100vw - 16px)` 一类；分时弹层 class `intraday-dialog` 有全局窄屏标题/内边距覆盖。

## 图表手势（日频主图）

| | 桌面 | 窄屏 H5 |
| --- | --- | --- |
| inside 拖移 / 滚轮 | 开 | 关（避免抢页面滚动） |
| 底部 slider | 开 | 开（主缩放手段） |
| toolbox 框选 | 可开 | 默认隐藏 |
| grid.bottom | `chartTimeZoomGridBottom(false)` | `chartTimeZoomGridBottom(true)` |

新增带交易日横轴的主图必须走 `buildTimeAxisDataZoom` / `buildTimeAxisToolbox`，并传入 `narrow`。

## 交互：桌面专属 → H5 等价

| 能力 | 桌面 | H5 |
| --- | --- | --- |
| 成交额「当日分时」 | 图表区域右键 → 菜单 | **长按 ≈480ms** → 底部操作条「当日分时」 |
| ETF「当日分钟 K」 | 图表区域右键 → 菜单 | **长按 ≈480ms** → 底部操作条「当日分钟K」 |
| 缩放 | 滚轮 / 拖移 / 框选 / 滑条 | 底部滑条 + 快捷区间 |
| 提示文案 | 写「右键…」 | 窄屏改为「长按…」 |

实现参考：共用 `useChartDayMenu`（`TurnoverPercentileCard` / `EtfNetFlowCard`）、`src/styles/global.css`。

**规则**：凡是桌面用右键 / hover / 滚轮才能触发的能力，上线前必须有触控等价路径。

## 分时 / 分钟 K 弹层

- **成交额分时**：`IntradayTurnoverDialog`（对比前一日累计成交额）。
- **ETF 分钟 K**：`EtfIntradayDialog`（仅当日 OHLC + 量/额，非净流入；打开时同步近约 5 日并写入 `data/etf-intraday` / KV，更早靠归档）。
- 宽度 / top：随 `useNarrowScreen(720)`。
- 窄屏：summary 单列、图左右留白减小、图高约 `min(320px, 52vh)`。
- 图表 option 内读取 `narrow`，勿写死仅桌面 `grid.left: 52`。

## 新增卡片检查清单

- [ ] `@media (max-width: 640px)`：header / toolbar / summary / 图高
- [ ] 逻辑侧 `const narrow = useNarrowScreen()`，并传入 dataZoom / toolbox / grid
- [ ] 区间 tab 使用 `.range-scroll` + item 不压缩
- [ ] 无整页横向溢出（真机或 DevTools 375 宽看一眼）
- [ ] 若有右键 / hover 入口，已补长按或底部按钮
- [ ] 弹层宽度适配窄屏
- [ ] 提示文案桌面 / H5 区分（如需要）
- [ ] 更新本文与 `.cursor/rules/h5-mobile.mdc`（若引入新约定）

## 相关路径

| 用途 | 路径 |
| --- | --- |
| 窄屏 composable | `src/composables/useNarrowScreen.ts` |
| 统一缩放 | `src/utils/chartTimeZoom.ts` |
| 分时入口 + 长按 | `src/components/TurnoverPercentileCard.vue` |
| 分时弹层 | `src/components/IntradayTurnoverDialog.vue` |
| 全局菜单 / sheet | `src/styles/global.css`（`.ctx-menu` / `--sheet`） |
| Agent 规则 | `.cursor/rules/h5-mobile.mdc` |
