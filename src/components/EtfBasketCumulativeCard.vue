<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart, LineChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  ToolboxComponent,
  TooltipComponent,
} from 'echarts/components'
import VChart from 'vue-echarts'
import { ArrowDown, ArrowUp, Refresh, RefreshRight } from '@element-plus/icons-vue'
import { fetchEtfFlowSeries, sliceEtfFlowByRange } from '@/api/etfFlow'
import { withEtfFetchSlot } from '@/api/etfFlowGate'
import { fetchMarginSeries } from '@/api/margin'
import { ETF_UNIVERSE, INDEX_DISPLAY_ORDER } from '@/etfUniverse'
import type { EtfFlowSeriesResult, RangeKey } from '@/types/market'
import { useNarrowScreen } from '@/composables/useNarrowScreen'
import {
  buildTimeAxisDataZoom,
  buildTimeAxisToolbox,
  chartTimeZoomGridBottom,
} from '@/utils/chartTimeZoom'
import { formatDisplayDate } from '@/utils/date'
import { formatAmountYi, formatNumber } from '@/utils/format'
import {
  INDEX_TIP_COLORS,
  buildBasketCumulativeSeries,
  type BasketCumulativeDay,
} from '@/utils/etfBasketCumulative'

const narrow = useNarrowScreen()

use([
  CanvasRenderer,
  BarChart,
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  ToolboxComponent,
])

const COLOR_UP = '#ef4444'
const COLOR_DOWN = '#22c55e'
const COLOR_CUM = '#2563eb'
const COLOR_SSE = '#ff7a1a'
const COLOR_MUTED = '#94a3b8'

const RANGE_OPTIONS: Array<{ label: string; value: RangeKey }> = [
  { label: '1个月', value: '1m' },
  { label: '3个月', value: '3m' },
  { label: '6个月', value: '6m' },
  { label: '1年', value: '1y' },
  { label: '3年', value: '3y' },
  { label: '全部', value: 'all' },
]

const rootRef = useTemplateRef<HTMLElement>('rootRef')
const loading = ref(false)
const waitingView = ref(true)
const error = ref('')
const results = ref<EtfFlowSeriesResult[]>([])
const loadErrors = ref<string[]>([])
/** 上证收盘：复用两融序列缓存里的 sseClose，按日期对齐 */
const sseByDate = ref<Map<string, number | null>>(new Map())
const range = ref<RangeKey>('3m')
const guideOpen = ref(false)
const zoomStart = ref(0)
const zoomEnd = ref(100)
const chartEpoch = ref(0)
let observer: IntersectionObserver | null = null
let loadedOnce = false

const asOf = computed(() => {
  let latest = ''
  for (const r of results.value) {
    if (r.asOf > latest) latest = r.asOf
  }
  return latest
})

const rangedSeries = computed((): BasketCumulativeDay[] => {
  if (!results.value.length) return []
  const sliced = results.value.map((r) => ({
    ...r,
    series: sliceEtfFlowByRange(r.series, range.value),
  }))
  return buildBasketCumulativeSeries(sliced, ETF_UNIVERSE)
})

const latest = computed(() => {
  const list = rangedSeries.value
  return list.length ? list[list.length - 1] : null
})

const latestSseClose = computed(() => {
  const day = latest.value
  if (!day) return null
  return sseByDate.value.get(day.date) ?? null
})

const loadedCount = computed(() => results.value.length)
const expectedCount = ETF_UNIVERSE.length

const isZoomed = computed(() => zoomStart.value > 0.05 || zoomEnd.value < 99.95)

const chartInstanceKey = computed(() => `basket-cum-${range.value}-${chartEpoch.value}`)

function resetZoom() {
  zoomStart.value = 0
  zoomEnd.value = 100
  chartEpoch.value += 1
}

function onDataZoom(params: {
  start?: number
  end?: number
  batch?: Array<{ start?: number; end?: number }>
}) {
  const payload = params.batch?.[0] ?? params
  if (typeof payload.start === 'number') zoomStart.value = payload.start
  if (typeof payload.end === 'number') zoomEnd.value = payload.end
}

watch(range, () => {
  zoomStart.value = 0
  zoomEnd.value = 100
  chartEpoch.value += 1
})

function tipRow(color: string, text: string) {
  return `<div class="chart-tip__row"><span class="chart-tip__dot" style="background:${color}"></span><span>${text}</span></div>`
}

function signedYi(v: number | null | undefined): string {
  if (v == null) return '—'
  return `${v >= 0 ? '+' : ''}${formatAmountYi(v)}`
}

function flowColor(v: number | null | undefined): string {
  if (v == null) return COLOR_MUTED
  return v >= 0 ? COLOR_UP : COLOR_DOWN
}

const chartOption = computed(() => {
  const list = rangedSeries.value
  const dates = list.map((d) => d.date)
  const daily = list.map((d) => d.dailyTotalYi)
  const cum = list.map((d) => d.cumulativeYi)
  const sse = list.map((d) => sseByDate.value.get(d.date) ?? null)
  const gridRight = narrow.value ? 40 : 96
  const gridLeft = narrow.value ? 36 : 52

  return {
    animation: false,
    grid: {
      left: gridLeft,
      right: gridRight,
      top: narrow.value ? 28 : 36,
      bottom: chartTimeZoomGridBottom(narrow.value),
    },
    legend: { show: false },
    toolbox: buildTimeAxisToolbox({ accentColor: COLOR_CUM, narrow: narrow.value }),
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      confine: true,
      formatter: (params: unknown) => {
        const arr = Array.isArray(params) ? params : [params]
        const idx = (arr[0] as { dataIndex?: number })?.dataIndex
        if (idx == null) return ''
        const point = list[idx]
        if (!point) return ''
        const sseClose = sse[idx]

        const indexRows = point.byIndex
          .map((s) => {
            const color = INDEX_TIP_COLORS[s.indexName] ?? COLOR_MUTED
            return tipRow(
              color,
              `${s.indexName}：当日 ${signedYi(s.dailyYi)} · 累计 ${signedYi(s.cumulativeYi)}`,
            )
          })
          .join('')

        return `<div class="chart-tip chart-tip--basket">
          <div class="chart-tip__title">${formatDisplayDate(point.date)}</div>
          ${tipRow(flowColor(point.dailyTotalYi), `当日合计：${signedYi(point.dailyTotalYi)}`)}
          ${tipRow(COLOR_CUM, `区间累计：${signedYi(point.cumulativeYi)}`)}
          ${tipRow(COLOR_SSE, `上证指数：${sseClose == null ? '—' : formatNumber(sseClose)}`)}
          <div class="chart-tip__sep">按指数（${INDEX_DISPLAY_ORDER.length} 类）</div>
          ${indexRows}
          <div class="chart-tip__meta">当日样本 ${point.sampleCount}/${expectedCount} 只</div>
        </div>`
      },
    },
    dataZoom: buildTimeAxisDataZoom({
      start: zoomStart.value,
      end: zoomEnd.value,
      accentColor: COLOR_CUM,
      left: narrow.value ? 8 : gridLeft,
      right: narrow.value ? 8 : gridRight,
      narrow: narrow.value,
    }),
    xAxis: {
      type: 'category',
      data: dates,
      axisLabel: {
        formatter: (v: string) => formatDisplayDate(v),
        color: '#94a3b8',
        fontSize: 11,
      },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#e5e7eb' } },
    },
    yAxis: [
      {
        type: 'value',
        name: '当日(亿)',
        nameTextStyle: { color: '#94a3b8', fontSize: 11 },
        splitLine: { lineStyle: { color: '#f1f5f9' } },
        axisLabel: { color: '#94a3b8', fontSize: 11 },
      },
      {
        type: 'value',
        name: '累计(亿)',
        nameTextStyle: { color: COLOR_CUM, fontSize: 11 },
        splitLine: { show: false },
        axisLabel: { color: '#94a3b8', fontSize: 11 },
      },
      {
        type: 'value',
        name: narrow.value ? '' : '上证',
        nameTextStyle: { color: COLOR_SSE, fontSize: 11 },
        position: 'right',
        offset: narrow.value ? 0 : 52,
        scale: true,
        splitLine: { show: false },
        axisLabel: {
          show: !narrow.value,
          color: '#94a3b8',
          fontSize: 11,
        },
      },
    ],
    series: [
      {
        name: '当日合计',
        type: 'bar',
        yAxisIndex: 0,
        data: daily.map((v) => ({
          value: v,
          itemStyle: {
            color: v == null ? COLOR_MUTED : v >= 0 ? COLOR_UP : COLOR_DOWN,
            opacity: 0.75,
          },
        })),
        barMaxWidth: 12,
      },
      {
        name: '区间累计',
        type: 'line',
        yAxisIndex: 1,
        data: cum,
        showSymbol: false,
        lineStyle: { color: COLOR_CUM, width: 2 },
        itemStyle: { color: COLOR_CUM },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(37,99,235,0.18)' },
              { offset: 1, color: 'rgba(37,99,235,0.02)' },
            ],
          },
        },
      },
      {
        name: '上证指数',
        type: 'line',
        yAxisIndex: 2,
        data: sse,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { color: COLOR_SSE, width: 2 },
        itemStyle: { color: COLOR_SSE },
      },
    ],
  }
})

async function load(force = false) {
  if (!force && loadedOnce && results.value.length) return
  loading.value = true
  waitingView.value = false
  error.value = ''
  loadErrors.value = []
  try {
    const [settled, marginOutcome] = await Promise.all([
      Promise.all(
        ETF_UNIVERSE.map((etf) =>
          withEtfFetchSlot(() => fetchEtfFlowSeries(etf.code))
            .then((r) => ({ ok: true as const, r }))
            .catch((e: unknown) => ({
              ok: false as const,
              code: etf.code,
              message: e instanceof Error ? e.message : '加载失败',
            })),
        ),
      ),
      fetchMarginSeries()
        .then((m) => ({ ok: true as const, m }))
        .catch(() => ({ ok: false as const })),
    ])

    const ok: EtfFlowSeriesResult[] = []
    const fails: string[] = []
    for (const item of settled) {
      if (item.ok) ok.push(item.r)
      else fails.push(`${item.code}: ${item.message}`)
    }
    results.value = ok
    loadErrors.value = fails

    if (marginOutcome.ok) {
      sseByDate.value = new Map(
        marginOutcome.m.series.map((p) => [p.date, p.sseClose]),
      )
    } else {
      sseByDate.value = new Map()
      loadErrors.value = [...loadErrors.value, '上证指数：加载失败']
    }

    if (!ok.length) {
      error.value = fails[0] || '篮子净流入加载失败'
    }
    loadedOnce = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : '篮子净流入加载失败'
  } finally {
    loading.value = false
  }
}

function reload() {
  void load(true)
}

onMounted(() => {
  const el = rootRef.value
  if (!el || typeof IntersectionObserver === 'undefined') {
    void load()
    return
  }
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        observer?.disconnect()
        observer = null
        void load()
      }
    },
    { rootMargin: '160px 0px' },
  )
  observer.observe(el)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})
</script>

<template>
  <div ref="rootRef" class="basket-root">
    <el-card class="basket-card" shadow="hover" v-loading="loading">
      <template #header>
        <div class="card-header">
          <div class="title-block">
            <h2 class="title">宽基篮子累计净流入</h2>
            <p class="index-tag">
              20 只合计 · 叠加上证指数 · 按 {{ INDEX_DISPLAY_ORDER.length }} 个指数分类
            </p>
          </div>
          <div class="meta">
            <span class="badge">区间内从 0 起累加</span>
            <span v-if="asOf" class="asof">截至 {{ formatDisplayDate(asOf) }}</span>
            <el-button
              size="small"
              text
              :icon="Refresh"
              :loading="loading"
              class="reload-btn"
              @click="reload"
            >
              刷新
            </el-button>
          </div>
        </div>
      </template>

      <p v-if="waitingView && !results.length && !error" class="idle-hint">滚动至此处后加载…</p>

      <el-alert
        v-if="error"
        :title="error"
        type="error"
        show-icon
        :closable="false"
        class="error-alert"
      >
        <template #action>
          <el-button size="small" type="primary" link :loading="loading" @click="reload">
            重试
          </el-button>
        </template>
      </el-alert>

      <el-alert
        v-if="loadErrors.length && results.length"
        :title="`部分 ETF 未载入（${loadErrors.length}）：${loadErrors.slice(0, 3).join('；')}${loadErrors.length > 3 ? '…' : ''}`"
        type="warning"
        show-icon
        :closable="false"
        class="error-alert"
      />

      <template v-if="latest">
        <div class="summary">
          <div class="summary-item">
            <div class="label">区间累计</div>
            <div
              class="value"
              :class="latest.cumulativeYi >= 0 ? 'up' : 'down'"
            >
              {{ latest.cumulativeYi >= 0 ? '+' : '' }}{{ formatAmountYi(latest.cumulativeYi) }}
            </div>
            <div class="delta muted">{{ loadedCount }}/{{ expectedCount }} 只已载入</div>
          </div>
          <div class="divider" />
          <div class="summary-item">
            <div class="label">最新日合计</div>
            <div
              class="value"
              :class="
                latest.dailyTotalYi == null
                  ? ''
                  : latest.dailyTotalYi >= 0
                    ? 'up'
                    : 'down'
              "
            >
              <template v-if="latest.dailyTotalYi == null">—</template>
              <template v-else>
                {{ latest.dailyTotalYi >= 0 ? '+' : '' }}{{ formatAmountYi(latest.dailyTotalYi) }}
              </template>
            </div>
            <div class="delta muted">
              {{ formatDisplayDate(latest.date) }} · 样本 {{ latest.sampleCount }} 只
            </div>
          </div>
          <div class="divider" />
          <div class="summary-item">
            <div class="label">上证指数</div>
            <div class="value orange">
              {{ latestSseClose == null ? '—' : formatNumber(latestSseClose) }}
            </div>
            <div class="delta muted">与累计对照</div>
          </div>
        </div>

        <div class="chart-toolbar">
          <div class="legend">
            <span class="legend-item">
              <i class="legend-bar up" />
              当日净申购
            </span>
            <span class="legend-item">
              <i class="legend-bar down" />
              当日净赎回
            </span>
            <span class="legend-item">
              <i class="legend-line" />
              区间累计
            </span>
            <span class="legend-item">
              <i class="legend-line sse" />
              上证指数
            </span>
          </div>
          <div class="toolbar-right">
            <el-button size="small" :disabled="!isZoomed" :icon="RefreshRight" @click="resetZoom">
              重置
            </el-button>
            <div class="range-scroll">
              <el-segmented v-model="range" :options="RANGE_OPTIONS" size="small" />
            </div>
          </div>
        </div>

        <p class="zoom-hint">
          柱为当日合计，蓝线为区间累计（切换区间从 0 重算），橙线为上证指数收盘。悬停可看 9
          个指数各自当日 / 累计。不受下方单卡指数筛选影响。
        </p>

        <div class="chart-wrap">
          <v-chart
            :key="chartInstanceKey"
            class="chart"
            :option="chartOption"
            autoresize
            @datazoom="onDataZoom"
          />
        </div>

        <div class="guide">
          <button class="guide-toggle" type="button" @click="guideOpen = !guideOpen">
            <span>如何解读</span>
            <el-icon>
              <ArrowUp v-if="guideOpen" />
              <ArrowDown v-else />
            </el-icon>
          </button>
          <p v-show="guideOpen" class="guide-body">
            将 chinazkk 风格 20 只宽基的日净申赎加总后做区间累计，用作「大资金／国家队」申购强度的代理观察，并非官方持仓标签。橙线为上证指数收盘，便于对照累计申购与大盘走势。Tooltip
            按 9 个指数（沪深300、上证综指、上证50、中证500、中证1000、科创50、创业板指、创业板50、中证A500）分别给出当日与累计；同指数多只
            ETF 已先加总。某日缺份额的品种不计入该日合计，可能略低估。
          </p>
        </div>
      </template>
    </el-card>
  </div>
</template>

<style scoped>
.basket-root {
  width: min(860px, 100%);
}

.basket-card {
  --el-card-border-color: transparent;
  --el-card-padding: 20px 22px 16px;
  width: 100%;
  border-radius: 16px;
  box-shadow: 0 8px 28px rgba(31, 35, 41, 0.06);
}

.basket-card :deep(.el-card__header) {
  border-bottom: none;
  padding-bottom: 4px;
}

.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.title-block {
  min-width: 0;
}

.title {
  margin: 0;
  font-size: 18px;
  font-weight: 650;
  color: var(--text-primary);
}

.index-tag {
  margin: 4px 0 0;
  color: #64748b;
  font-size: 13px;
}

.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
}

.badge {
  padding: 2px 8px;
  border-radius: 999px;
  background: #eff6ff;
  color: #2563eb;
  font-size: 12px;
}

.asof {
  color: #94a3b8;
  font-size: 12px;
}

.reload-btn {
  margin-left: 2px;
  color: #64748b;
}

.idle-hint {
  margin: 0 0 8px;
  color: #94a3b8;
  font-size: 13px;
}

.error-alert {
  margin-bottom: 12px;
}

.summary {
  display: flex;
  align-items: stretch;
  gap: 0;
  margin: 8px 0 16px;
  padding: 14px 16px;
  background: #f8fafc;
  border-radius: 12px;
}

.summary-item {
  flex: 1;
}

.divider {
  width: 1px;
  margin: 0 16px;
  background: #e2e8f0;
}

.label {
  color: #94a3b8;
  font-size: 12px;
}

.value {
  margin-top: 4px;
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
}

.value.up {
  color: #ef4444;
}

.value.down {
  color: #22c55e;
}

.value.orange {
  color: #ff7a1a;
}

.delta {
  margin-top: 4px;
  font-size: 12px;
}

.delta.muted {
  color: #94a3b8;
}

.chart-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #64748b;
  font-size: 12px;
}

.legend-bar {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.legend-bar.up {
  background: #ef4444;
}

.legend-bar.down {
  background: #22c55e;
}

.legend-line {
  width: 14px;
  height: 2px;
  background: #2563eb;
}

.legend-line.sse {
  background: #ff7a1a;
}

.toolbar-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
}

.zoom-hint {
  margin: 0 0 8px;
  color: #94a3b8;
  font-size: 12px;
}

.chart-wrap {
  height: 360px;
}

.chart {
  width: 100%;
  height: 100%;
}

.guide {
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px solid #f1f5f9;
}

.guide-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #64748b;
  font-size: 13px;
  cursor: pointer;
}

.guide-body {
  margin: 10px 0 4px;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.7;
}

:deep(.el-segmented) {
  --el-segmented-item-selected-bg-color: #fff;
  --el-segmented-item-selected-color: var(--text-primary);
  background: #f2f4f7;
  padding: 2px;
}

:deep(.el-segmented__item) {
  flex: 0 0 auto;
  min-height: 26px;
  padding: 0 10px;
  font-size: 12px;
}

:deep(.chart-tip) {
  min-width: 200px;
  max-width: 320px;
}

:deep(.chart-tip--basket) {
  max-width: min(360px, 86vw);
}

:deep(.chart-tip__title) {
  margin-bottom: 6px;
  font-weight: 600;
}

:deep(.chart-tip__row) {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  line-height: 1.55;
  margin-bottom: 2px;
}

:deep(.chart-tip__dot) {
  width: 8px;
  height: 8px;
  margin-top: 5px;
  border-radius: 50%;
  flex-shrink: 0;
}

:deep(.chart-tip__sep) {
  margin: 8px 0 4px;
  padding-top: 6px;
  border-top: 1px solid rgba(148, 163, 184, 0.35);
  color: #64748b;
  font-size: 11px;
  font-weight: 600;
}

:deep(.chart-tip__meta) {
  margin-top: 6px;
  color: #94a3b8;
  font-size: 11px;
}

.range-scroll {
  max-width: 100%;
  min-width: 0;
}

@media (max-width: 640px) {
  .basket-card {
    --el-card-padding: 14px 12px 12px;
    border-radius: 12px;
  }

  .card-header {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }

  .meta {
    justify-content: flex-start;
  }

  .title {
    font-size: 16px;
  }

  .index-tag {
    font-size: 12px;
  }

  .summary {
    flex-direction: column;
    gap: 10px;
    padding: 12px;
  }

  .divider {
    width: 100%;
    height: 1px;
    margin: 0;
  }

  .value {
    font-size: 20px;
  }

  .chart-toolbar {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }

  .toolbar-right {
    width: 100%;
    justify-content: space-between;
  }

  .range-scroll {
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-x: contain;
  }

  .range-scroll :deep(.el-segmented) {
    width: max-content;
    min-width: max-content;
  }

  .chart-wrap {
    height: 280px;
  }

  .zoom-hint {
    font-size: 11px;
  }
}
</style>
