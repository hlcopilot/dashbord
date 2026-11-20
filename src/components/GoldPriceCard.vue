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
import { fetchGoldSeries, filterGoldEtfDays, sliceGoldByRange } from '@/api/gold'
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

const COLOR_GOLD = '#d97706'
const COLOR_USD = '#3b82f6'

const { visible, toggle } = useSeriesVisibility(['gold', 'usd'] as const)

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
const range = ref<RangeKey>('1y')
const guideOpen = ref(false)
const zoomStart = ref(0)
const zoomEnd = ref(100)
const chartEpoch = ref(0)

const rangedSeries = computed(() => {
  if (!result.value) return []
  return sliceGoldByRange(filterGoldEtfDays(result.value.series), range.value)
})

const chartInstanceKey = computed(() => `gold-etf-${range.value}-${chartEpoch.value}`)

const dayDelta = computed(() => {
  const list = rangedSeries.value
  if (list.length < 2) return null
  const cur = list[list.length - 1].goldClose
  const prev = list[list.length - 2].goldClose
  if (cur == null || prev == null) return null
  return Math.round((cur - prev) * 1000) / 1000
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
  const showGold = visible('gold')
  const showUsd = visible('usd')
  const leftPad = showGold ? (narrow.value ? 36 : 52) : narrow.value ? 12 : 24
  const rightPad = showUsd ? (narrow.value ? 36 : 52) : narrow.value ? 12 : 24

  const series: Array<Record<string, unknown>> = []
  if (showGold) {
    series.push({
      name: '黄金ETF',
      type: 'line',
      yAxisIndex: 0,
      data: list.map((p) => p.goldClose),
      showSymbol: false,
      lineStyle: { color: COLOR_GOLD, width: 2 },
      itemStyle: { color: COLOR_GOLD },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(217,119,6,0.16)' },
            { offset: 1, color: 'rgba(217,119,6,0.02)' },
          ],
        },
      },
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
      lineStyle: { color: COLOR_USD, width: 2 },
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
    toolbox: buildTimeAxisToolbox({ accentColor: COLOR_GOLD, narrow: narrow.value }),
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
        if (showGold) {
          rows.push(
            tipRow(
              COLOR_GOLD,
              `黄金ETF：${point.goldClose == null ? '—' : formatNumber(point.goldClose, 3)}`,
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
      accentColor: COLOR_GOLD,
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
        name: showGold ? '金价' : '',
        show: showGold,
        scale: true,
        nameTextStyle: { color: COLOR_GOLD, fontSize: 11 },
        splitLine: { show: showGold, lineStyle: { color: '#f1f5f9' } },
        axisLabel: { color: '#94a3b8', fontSize: 11 },
      },
      {
        type: 'value',
        name: showUsd ? '美元指数' : '',
        show: showUsd,
        scale: true,
        nameTextStyle: { color: COLOR_USD, fontSize: 11 },
        splitLine: { show: !showGold && showUsd, lineStyle: { color: '#f1f5f9' } },
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
  } catch (e) {
    error.value = e instanceof Error ? e.message : '黄金数据加载失败'
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
  <el-card class="gold-card" shadow="hover" v-loading="loading">
    <template #header>
      <div class="card-header">
        <div class="title-block">
          <h2 class="title">黄金 ETF 与美元指数</h2>
          <p class="sub">518880 跟踪 Au9999 · 国内金价代理</p>
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

    <template v-if="result">
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
          <div class="label">黄金 ETF</div>
          <div class="value gold">
            {{ result.latestGoldClose == null ? '—' : formatNumber(result.latestGoldClose, 3) }}
          </div>
          <div
            v-if="dayDelta != null"
            class="delta"
            :class="dayDelta >= 0 ? 'up' : 'down'"
          >
            较前一日 {{ dayDelta >= 0 ? '+' : '' }}{{ formatNumber(dayDelta, 3) }}
          </div>
        </div>
        <div class="divider" />
        <div class="summary-item">
          <div class="label">美元指数</div>
          <div class="value blue">
            {{ result.latestUsdIndex == null ? '—' : formatNumber(result.latestUsdIndex, 2) }}
          </div>
          <div class="delta muted">强美元通常压制金价</div>
        </div>
      </div>

      <div class="chart-toolbar">
        <div class="legend">
          <button
            type="button"
            class="legend-item"
            :class="{ off: !visible('gold') }"
            title="点击显隐"
            @click="toggle('gold')"
          >
            <i class="legend-line gold" />
            黄金ETF
          </button>
          <button
            type="button"
            class="legend-item"
            :class="{ off: !visible('usd') }"
            title="点击显隐"
            @click="toggle('usd')"
          >
            <i class="legend-line blue" />
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

      <p class="zoom-hint">蓝线为美元指数对照；框选 / 底部时间轴缩放。缓存优先，日常只补近端。</p>

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
          华安黄金 ETF（518880）跟踪国内黄金 9999，用作可交易的金价代理，并非伦敦现货或 COMEX。美元指数走强时金价常承压；两者日历不完全一致，个别日期美元点位可能为空。申赎资金见下方净流入卡。
        </p>
      </div>
    </template>
  </el-card>
</template>

<style scoped>
.gold-card {
  --el-card-border-color: transparent;
  --el-card-padding: 20px 22px 16px;
  width: 100%;
  border-radius: 16px;
  box-shadow: 0 8px 28px rgba(31, 35, 41, 0.06);
}

.gold-card :deep(.el-card__header) {
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

.value.gold {
  color: #d97706;
}

.value.blue {
  color: #3b82f6;
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

.legend-line.gold {
  background: #d97706;
}

.legend-line.blue {
  background: #3b82f6;
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
  .gold-card {
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
