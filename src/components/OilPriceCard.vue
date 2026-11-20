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
import { fetchOilSeries, filterOilDays, sliceOilByRange } from '@/api/oil'
import type { OilSeriesResult, RangeKey } from '@/types/market'
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

const COLOR_BRENT = '#b45309'
const COLOR_WTI = '#0e7490'
const COLOR_USD = '#64748b'

const { visible, toggle } = useSeriesVisibility(['brent', 'wti', 'usd'] as const)

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
const result = ref<OilSeriesResult | null>(null)
const range = ref<RangeKey>('1y')
const guideOpen = ref(false)
const zoomStart = ref(0)
const zoomEnd = ref(100)
const chartEpoch = ref(0)

const rangedSeries = computed(() => {
  if (!result.value) return []
  return sliceOilByRange(filterOilDays(result.value.series), range.value)
})

const chartInstanceKey = computed(() => `oil-${range.value}-${chartEpoch.value}`)

const dayDeltaBrent = computed(() => {
  const list = rangedSeries.value.filter((d) => d.brentClose != null)
  if (list.length < 2) return null
  const cur = list[list.length - 1].brentClose
  const prev = list[list.length - 2].brentClose
  if (cur == null || prev == null) return null
  return Math.round((cur - prev) * 100) / 100
})

const dayDeltaWti = computed(() => {
  const list = rangedSeries.value.filter((d) => d.wtiClose != null)
  if (list.length < 2) return null
  const cur = list[list.length - 1].wtiClose
  const prev = list[list.length - 2].wtiClose
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
  const showBrent = visible('brent')
  const showWti = visible('wti')
  const showUsd = visible('usd')
  const showLeft = showBrent || showWti
  const showRight = showUsd
  const leftPad = showLeft ? (narrow.value ? 36 : 52) : narrow.value ? 12 : 24
  const rightPad = showRight ? (narrow.value ? 36 : 52) : narrow.value ? 12 : 24

  const series: Array<Record<string, unknown>> = []
  if (showBrent) {
    series.push({
      name: '布伦特',
      type: 'line',
      yAxisIndex: 0,
      data: list.map((p) => p.brentClose),
      showSymbol: false,
      connectNulls: false,
      lineStyle: { color: COLOR_BRENT, width: 2 },
      itemStyle: { color: COLOR_BRENT },
    })
  }
  if (showWti) {
    series.push({
      name: 'WTI',
      type: 'line',
      yAxisIndex: 0,
      data: list.map((p) => p.wtiClose),
      showSymbol: false,
      connectNulls: false,
      lineStyle: { color: COLOR_WTI, width: 2 },
      itemStyle: { color: COLOR_WTI },
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
    toolbox: buildTimeAxisToolbox({ accentColor: COLOR_BRENT, narrow: narrow.value }),
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
        if (showBrent) {
          rows.push(
            tipRow(
              COLOR_BRENT,
              `布伦特：${point.brentClose == null ? '—' : formatNumber(point.brentClose, 2)} 美元/桶`,
            ),
          )
        }
        if (showWti) {
          rows.push(
            tipRow(
              COLOR_WTI,
              `WTI：${point.wtiClose == null ? '—' : formatNumber(point.wtiClose, 2)} 美元/桶`,
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
      accentColor: COLOR_BRENT,
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
        name: showLeft ? '美元/桶' : '',
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
    result.value = await fetchOilSeries()
    if (!filterOilDays(result.value.series).length) {
      error.value = '暂无石油缓存，请运行 npm run series:seed -- oil'
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '石油数据加载失败'
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
  <el-card class="oil-card" shadow="hover" v-loading="loading">
    <template #header>
      <div class="card-header">
        <div class="title-block">
          <h2 class="title">布伦特 / WTI</h2>
          <p class="sub">同轴美元/桶 · 国际原油基准 · 叠美元指数</p>
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
          <div class="label">布伦特</div>
          <div class="value brent">
            {{ result.latestBrentClose == null ? '—' : formatNumber(result.latestBrentClose, 2) }}
            <span v-if="result.latestBrentClose != null" class="unit">美元/桶</span>
          </div>
          <div
            v-if="dayDeltaBrent != null"
            class="delta"
            :class="dayDeltaBrent >= 0 ? 'up' : 'down'"
          >
            较前一日 {{ dayDeltaBrent >= 0 ? '+' : '' }}{{ formatNumber(dayDeltaBrent, 2) }}
          </div>
        </div>
        <div class="divider" />
        <div class="summary-item">
          <div class="label">WTI</div>
          <div class="value wti">
            {{ result.latestWtiClose == null ? '—' : formatNumber(result.latestWtiClose, 2) }}
            <span v-if="result.latestWtiClose != null" class="unit">美元/桶</span>
          </div>
          <div
            v-if="dayDeltaWti != null"
            class="delta"
            :class="dayDeltaWti >= 0 ? 'up' : 'down'"
          >
            较前一日 {{ dayDeltaWti >= 0 ? '+' : '' }}{{ formatNumber(dayDeltaWti, 2) }}
          </div>
        </div>
        <div class="divider" />
        <div class="summary-item">
          <div class="label">美元指数</div>
          <div class="value muted">
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
            :class="{ off: !visible('brent') }"
            title="点击显隐"
            @click="toggle('brent')"
          >
            <i class="legend-line brent" />
            布伦特
          </button>
          <button
            type="button"
            class="legend-item"
            :class="{ off: !visible('wti') }"
            title="点击显隐"
            @click="toggle('wti')"
          >
            <i class="legend-line wti" />
            WTI
          </button>
          <button
            type="button"
            class="legend-item"
            :class="{ off: !visible('usd') }"
            title="点击显隐"
            @click="toggle('usd')"
          >
            <i class="legend-line usd" />
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
        棕线布伦特（全球锚）、青线 WTI（美国基准），同为美元/桶；灰线美元指数。
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
          布伦特（东财 112.B00Y 当月连续）是全球原油定价锚；WTI（102.CL00Y / NYMEX
          原油连续）是美国基准。两者长期高度相关，价差反映区域供需与运输成本。强美元常压制以美元计价的油价。本图不做人民币换算，亦未接入国内 SC
          原油期货。
        </p>
      </div>
    </template>
  </el-card>
</template>

<style scoped>
.oil-card {
  --el-card-border-color: transparent;
  --el-card-padding: 20px 22px 16px;
  width: 100%;
  border-radius: 16px;
  box-shadow: 0 8px 28px rgba(31, 35, 41, 0.06);
}

.oil-card :deep(.el-card__header) {
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

.value.brent {
  color: #b45309;
}

.value.wti {
  color: #0e7490;
}

.value.muted {
  color: #64748b;
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

.legend-line.brent {
  background: #b45309;
}

.legend-line.wti {
  background: #0e7490;
}

.legend-line.usd {
  background: #64748b;
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
  .oil-card {
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
