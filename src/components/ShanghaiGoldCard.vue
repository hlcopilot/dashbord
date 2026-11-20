<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  ToolboxComponent,
  TooltipComponent,
} from 'echarts/components'
import type { CallbackDataParams } from 'echarts/types/dist/shared'
import VChart from 'vue-echarts'
import { ArrowDown, ArrowUp, Refresh, RefreshRight } from '@element-plus/icons-vue'
import { fetchGoldSeries, filterSpotGoldDays, sliceGoldByRange } from '@/api/gold'
import type { GoldSeriesResult, RangeKey } from '@/types/market'
import { useNarrowScreen } from '@/composables/useNarrowScreen'
import { useSeriesVisibility } from '@/composables/useSeriesVisibility'
import {
  buildTimeAxisDataZoom,
  buildTimeAxisToolbox,
  chartTimeZoomGridBottom,
} from '@/utils/chartTimeZoom'
import { formatDisplayDate } from '@/utils/date'
import { formatNumber } from '@/utils/format'

const narrow = useNarrowScreen()

use([
  CanvasRenderer,
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  ToolboxComponent,
])

const COLOR_SHAU = '#2563eb'
const COLOR_AU = '#0f766e'
const COLOR_USD = '#f97316'

const { visible, toggle } = useSeriesVisibility(['shau', 'au', 'usd'] as const)

const RANGE_OPTIONS: Array<{ label: string; value: RangeKey }> = [
  { label: '1个月', value: '1m' },
  { label: '3个月', value: '3m' },
  { label: '6个月', value: '6m' },
  { label: '1年', value: '1y' },
  { label: '3年', value: '3y' },
  { label: '全部', value: 'all' },
]

const loading = ref(true)
const error = ref('')
const result = ref<GoldSeriesResult | null>(null)
const range = ref<RangeKey>('all')
const guideOpen = ref(false)
const zoomStart = ref(0)
const zoomEnd = ref(100)
const chartEpoch = ref(0)

const rangedSeries = computed(() => {
  if (!result.value) return []
  return sliceGoldByRange(filterSpotGoldDays(result.value.series), range.value)
})

const chartInstanceKey = computed(() => `spot-${range.value}-${chartEpoch.value}`)

const dayDeltaShau = computed(() => {
  const list = rangedSeries.value.filter((d) => d.shauClose != null)
  if (list.length < 2) return null
  const cur = list[list.length - 1].shauClose
  const prev = list[list.length - 2].shauClose
  if (cur == null || prev == null) return null
  return Math.round((cur - prev) * 100) / 100
})

const dayDeltaAu = computed(() => {
  const list = rangedSeries.value.filter((d) => d.au9999Close != null)
  if (list.length < 2) return null
  const cur = list[list.length - 1].au9999Close
  const prev = list[list.length - 2].au9999Close
  if (cur == null || prev == null) return null
  return Math.round((cur - prev) * 100) / 100
})

const isZoomed = computed(() => zoomStart.value > 0.05 || zoomEnd.value < 99.95)

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

const chartOption = computed(() => {
  const list = rangedSeries.value
  if (!list.length) return {}
  const dates = list.map((p) => p.date)
  const showShau = visible('shau')
  const showAu = visible('au')
  const showUsd = visible('usd')
  const showLeft = showShau || showAu
  const showRight = showUsd
  const leftPad = showLeft ? (narrow.value ? 36 : 52) : narrow.value ? 12 : 24
  const rightPad = showRight ? (narrow.value ? 36 : 52) : narrow.value ? 12 : 24

  const series: Array<Record<string, unknown>> = []
  if (showShau) {
    series.push({
      name: '上海金',
      type: 'line',
      yAxisIndex: 0,
      data: list.map((p) => p.shauClose),
      showSymbol: false,
      connectNulls: false,
      lineStyle: { color: COLOR_SHAU, width: 2 },
      itemStyle: { color: COLOR_SHAU },
    })
  }
  if (showAu) {
    series.push({
      name: 'Au9999',
      type: 'line',
      yAxisIndex: 0,
      data: list.map((p) => p.au9999Close),
      showSymbol: false,
      connectNulls: false,
      lineStyle: { color: COLOR_AU, width: 2 },
      itemStyle: { color: COLOR_AU },
    })
  }
  if (showUsd) {
    series.push({
      name: '美元指数',
      type: 'line',
      yAxisIndex: 1,
      data: list.map((p) => p.usdIndex),
      showSymbol: false,
      connectNulls: false,
      lineStyle: { color: COLOR_USD, width: 1.5 },
      itemStyle: { color: COLOR_USD },
    })
  }

  return {
    animation: false,
    legend: { show: false },
    grid: {
      left: leftPad,
      right: rightPad,
      top: narrow.value ? 28 : 36,
      bottom: chartTimeZoomGridBottom(narrow.value),
    },
    toolbox: buildTimeAxisToolbox({ accentColor: COLOR_SHAU, narrow: narrow.value }),
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      confine: true,
      formatter: (params: CallbackDataParams | CallbackDataParams[]) => {
        const items = Array.isArray(params) ? params : [params]
        const idx = items[0]?.dataIndex
        if (typeof idx !== 'number') return ''
        const point = list[idx]
        if (!point) return ''
        const rows: string[] = []
        if (showShau) {
          rows.push(
            tipRow(
              COLOR_SHAU,
              `上海金：${point.shauClose == null ? '—' : formatNumber(point.shauClose, 2)} 元/克`,
            ),
          )
        }
        if (showAu) {
          rows.push(
            tipRow(
              COLOR_AU,
              `Au9999：${point.au9999Close == null ? '—' : formatNumber(point.au9999Close, 2)} 元/克`,
            ),
          )
        }
        if (showUsd) {
          rows.push(
            tipRow(
              COLOR_USD,
              `美元指数：${point.usdIndex == null ? '—' : formatNumber(point.usdIndex, 2)}`,
            ),
          )
        }
        return `<div class="chart-tip">
          <div class="chart-tip__title">${formatDisplayDate(point.date)}</div>
          ${rows.join('')}
        </div>`
      },
    },
    dataZoom: buildTimeAxisDataZoom({
      start: zoomStart.value,
      end: zoomEnd.value,
      accentColor: COLOR_SHAU,
      left: narrow.value ? 8 : leftPad,
      right: narrow.value ? 8 : rightPad,
      narrow: narrow.value,
    }),
    xAxis: {
      type: 'category',
      data: dates,
      boundaryGap: false,
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
        name: showLeft ? '元/克' : '',
        show: showLeft,
        scale: true,
        nameTextStyle: { color: '#64748b', fontSize: 11 },
        splitLine: { show: showLeft, lineStyle: { color: '#f1f5f9' } },
        axisLabel: { color: '#94a3b8', fontSize: 11 },
      },
      {
        type: 'value',
        name: showRight ? '美元指数' : '',
        show: showRight,
        scale: true,
        nameTextStyle: { color: COLOR_USD, fontSize: 11 },
        splitLine: { show: !showLeft && showRight, lineStyle: { color: '#f1f5f9' } },
        axisLabel: { color: '#94a3b8', fontSize: 11 },
      },
    ],
    series,
  }
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    result.value = await fetchGoldSeries()
    if (!filterSpotGoldDays(result.value.series).length) {
      error.value = '暂无上海金 / Au9999 缓存，请运行 npm run series:seed -- gold'
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '上海金数据加载失败'
  } finally {
    loading.value = false
  }
}

function reload() {
  void load()
}

onMounted(() => {
  void load()
})
</script>

<template>
  <el-card class="shau-card" shadow="hover" v-loading="loading">
    <template #header>
      <div class="card-header">
        <div class="title-block">
          <h2 class="title">上海金 / Au9999</h2>
          <p class="sub">同轴元/克 · SHAU + Au9999 现货 · 叠美元指数</p>
        </div>
        <div class="meta">
          <span class="badge">交易日更新</span>
          <span v-if="result" class="asof">截至 {{ formatDisplayDate(result.asOf) }}</span>
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

    <template v-if="result && !error">
      <el-alert
        v-for="(w, i) in result.warnings ?? []"
        :key="`warn-${i}`"
        :title="w"
        type="warning"
        show-icon
        :closable="false"
        class="error-alert"
      />

      <div class="summary">
        <div class="summary-item">
          <div class="label">上海金</div>
          <div class="value blue">
            {{ result.latestShauClose == null ? '—' : formatNumber(result.latestShauClose, 2) }}
            <span v-if="result.latestShauClose != null" class="unit">元/克</span>
          </div>
          <div
            v-if="dayDeltaShau != null"
            class="delta"
            :class="dayDeltaShau >= 0 ? 'up' : 'down'"
          >
            较前一日 {{ dayDeltaShau >= 0 ? '+' : '' }}{{ formatNumber(dayDeltaShau, 2) }}
          </div>
        </div>
        <div class="divider" />
        <div class="summary-item">
          <div class="label">Au9999</div>
          <div class="value teal">
            {{
              result.latestAu9999Close == null ? '—' : formatNumber(result.latestAu9999Close, 2)
            }}
            <span v-if="result.latestAu9999Close != null" class="unit">元/克</span>
          </div>
          <div
            v-if="dayDeltaAu != null"
            class="delta"
            :class="dayDeltaAu >= 0 ? 'up' : 'down'"
          >
            较前一日 {{ dayDeltaAu >= 0 ? '+' : '' }}{{ formatNumber(dayDeltaAu, 2) }}
          </div>
        </div>
        <div class="divider" />
        <div class="summary-item">
          <div class="label">美元指数</div>
          <div class="value orange">
            {{ result.latestUsdIndex == null ? '—' : formatNumber(result.latestUsdIndex, 2) }}
          </div>
          <div class="delta muted">右轴对照</div>
        </div>
      </div>

      <div class="chart-toolbar">
        <div class="legend">
          <button
            type="button"
            class="legend-item"
            :class="{ off: !visible('shau') }"
            title="点击显隐"
            @click="toggle('shau')"
          >
            <i class="legend-line blue" />
            上海金
          </button>
          <button
            type="button"
            class="legend-item"
            :class="{ off: !visible('au') }"
            title="点击显隐"
            @click="toggle('au')"
          >
            <i class="legend-line teal" />
            Au9999
          </button>
          <button
            type="button"
            class="legend-item"
            :class="{ off: !visible('usd') }"
            title="点击显隐"
            @click="toggle('usd')"
          >
            <i class="legend-line orange" />
            美元指数
          </button>
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
        蓝线 SHAU、青绿 Au9999 同为元/克；橙线美元指数。伦敦金见下方独立图（美元/盎司）。
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
          上海金（SHAU）是上金所集中定价基准价；Au9999 是上金所黄金 9999
          连续竞价现货收盘，单位均为元/克。伦敦金（美元/盎司）单独一张图展示。下方 518880 为跟踪
          Au9999 的 ETF 份额价。数据源：东财 118.SHAU / 118.AU9999。
        </p>
      </div>
    </template>
  </el-card>
</template>

<style scoped>
.shau-card {
  --el-card-border-color: transparent;
  --el-card-padding: 20px 22px 16px;
  width: 100%;
  border-radius: 16px;
  box-shadow: 0 8px 28px rgba(31, 35, 41, 0.06);
}

.shau-card :deep(.el-card__header) {
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

.sub {
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
  border-radius: 4px;
  background: var(--chip-bg);
  color: #6b7280;
  font-size: 12px;
}

.asof {
  color: var(--text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.reload-btn {
  color: #64748b;
}

.error-alert {
  margin-bottom: 12px;
}

.summary {
  display: flex;
  align-items: stretch;
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
}

.value.blue {
  color: #2563eb;
}

.value.teal {
  color: #0f766e;
}

.value.orange {
  color: #f97316;
}

.unit {
  margin-left: 4px;
  font-size: 13px;
  font-weight: 500;
  color: #94a3b8;
}

.delta {
  margin-top: 4px;
  font-size: 12px;
}

.delta.up {
  color: #ef4444;
}

.delta.down {
  color: #22c55e;
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
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: #64748b;
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}

.legend-item.off {
  opacity: 0.38;
  text-decoration: line-through;
  text-decoration-color: #94a3b8;
}

.legend-line {
  width: 14px;
  height: 2px;
}

.legend-line.blue {
  background: #2563eb;
}

.legend-line.teal {
  background: #0f766e;
}

.legend-line.orange {
  background: #f97316;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.zoom-hint {
  margin: 0 0 8px;
  color: #94a3b8;
  font-size: 12px;
}

.chart-wrap {
  height: var(--chart-h);
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

:deep(.chart-tip__title) {
  margin-bottom: 6px;
  font-weight: 600;
}

:deep(.chart-tip__row) {
  display: flex;
  align-items: center;
  gap: 6px;
  line-height: 1.7;
}

:deep(.chart-tip__dot) {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.range-scroll {
  max-width: 100%;
  min-width: 0;
}

@media (max-width: 640px) {
  .shau-card {
    --el-card-padding: 14px 12px 12px;
    border-radius: 12px;
  }

  .card-header {
    flex-direction: column;
    align-items: stretch;
  }

  .meta {
    justify-content: flex-start;
  }

  .title {
    font-size: 16px;
  }

  .summary {
    flex-direction: column;
    gap: 10px;
  }

  .divider {
    width: 100%;
    height: 1px;
    margin: 0;
  }

  .chart-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .toolbar-right {
    width: 100%;
    justify-content: space-between;
  }

  .range-scroll {
    flex: 1;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .range-scroll :deep(.el-segmented) {
    width: max-content;
    min-width: max-content;
  }

  .chart-wrap {
    height: 260px;
  }
}
</style>
