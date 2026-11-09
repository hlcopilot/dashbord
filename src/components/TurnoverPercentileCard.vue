<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  MarkLineComponent,
  MarkPointComponent,
  ToolboxComponent,
  TooltipComponent,
} from 'echarts/components'
import type { CallbackDataParams } from 'echarts/types/dist/shared'
import VChart from 'vue-echarts'
import { ArrowDown, ArrowUp, RefreshRight } from '@element-plus/icons-vue'
import { fetchHsTurnoverSeries, sliceByRange } from '@/api/market'
import type { DailyTurnover, RangeKey, TurnoverSeriesResult } from '@/types/market'
import { formatDisplayDate } from '@/utils/date'
import { formatAmountYi, formatNumber } from '@/utils/format'
import IntradayTurnoverDialog from '@/components/IntradayTurnoverDialog.vue'

use([
  CanvasRenderer,
  LineChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  ToolboxComponent,
  MarkPointComponent,
  MarkLineComponent,
])

const COLOR_TODAY = '#3b82f6'
const COLOR_PREV = '#ff7a1a'
const COLOR_UP = '#ef4444'
const COLOR_DOWN = '#22c55e'
const COLOR_AVG = '#8b5cf6'
const COLOR_AMOUNT = COLOR_PREV

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
const result = ref<TurnoverSeriesResult | null>(null)
const range = ref<RangeKey>('all')
const guideOpen = ref(true)
const zoomStart = ref(0)
const zoomEnd = ref(100)
const chartRef = useTemplateRef<InstanceType<typeof VChart>>('chartRef')
const hoverIndex = ref(-1)

const ctxMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  date: '',
})
const intradayOpen = ref(false)
const intradayDate = ref('')

const rangedSeries = computed(() =>
  result.value ? sliceByRange(result.value.series, range.value) : [],
)

const isZoomed = computed(
  () => zoomStart.value > 0.05 || zoomEnd.value < 99.95,
)

function resetZoom() {
  zoomStart.value = 0
  zoomEnd.value = 100
  const chart = chartRef.value as unknown as {
    dispatchAction?: (payload: Record<string, unknown>) => void
  } | null
  chart?.dispatchAction?.({
    type: 'dataZoom',
    start: 0,
    end: 100,
  })
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
  // 切换快捷区间后回到完整可视区间
  queueMicrotask(resetZoom)
})

function onAxisPointer(params: {
  dataIndex?: number
  batch?: Array<{ dataIndex?: number }>
}) {
  const idx = params.dataIndex ?? params.batch?.[0]?.dataIndex
  if (typeof idx === 'number') hoverIndex.value = idx
}

function closeCtxMenu() {
  ctxMenu.value.visible = false
}

function onChartContextMenu(e: MouseEvent) {
  e.preventDefault()
  const list = rangedSeries.value
  if (!list.length) return

  let idx = hoverIndex.value
  const chart = chartRef.value as unknown as {
    containPixel?: (finder: string, value: number[]) => boolean
    convertFromPixel?: (finder: object, value: number[]) => number[]
  } | null

  if (chart?.containPixel && chart.convertFromPixel) {
    const point = [e.offsetX, e.offsetY]
    if (chart.containPixel('grid', point)) {
      const data = chart.convertFromPixel({ seriesIndex: 0 }, point)
      if (typeof data?.[0] === 'number') idx = Math.round(data[0])
    }
  }

  if (idx < 0 || idx >= list.length) idx = list.length - 1
  const point = list[idx]
  if (!point) return

  ctxMenu.value = {
    visible: true,
    x: e.clientX,
    y: e.clientY,
    date: point.date,
  }
}

function openIntraday() {
  if (!ctxMenu.value.date) return
  intradayDate.value = ctxMenu.value.date
  intradayOpen.value = true
  closeCtxMenu()
}

function buildTooltipHtml(dataIndex: number): string {
  const list = rangedSeries.value
  const point = list[dataIndex]
  if (!point) return ''

  // 从前完整序列取前一交易日，避免区间切边时缺数
  const full = result.value?.series ?? list
  const fullIdx = full.findIndex((p) => p.date === point.date)
  const prev = fullIdx > 0 ? full[fullIdx - 1] : null

  const delta = prev ? point.amountYi - prev.amountYi : null
  const deltaColor = delta == null ? COLOR_PREV : delta >= 0 ? COLOR_UP : COLOR_DOWN
  const deltaText =
    delta == null
      ? '—'
      : `${delta >= 0 ? '' : '-'}${formatAmountYi(Math.abs(delta))}`

  const rows = [
    tooltipRow(
      COLOR_TODAY,
      `${point.provisional ? '今日两市成交(盘中)' : '今日两市成交'}：${formatAmountYi(point.amountYi)}`,
    ),
    tooltipRow(
      COLOR_PREV,
      `前一日两市成交：${prev ? formatAmountYi(prev.amountYi) : '—'}`,
    ),
    tooltipRow(deltaColor, `较前一日增减：${deltaText}`),
  ]

  return `<div class="chart-tip">
    <div class="chart-tip__title">${formatDisplayDate(point.date)}${point.provisional ? ' · 盘中' : ''}</div>
    ${rows.join('')}
  </div>`
}

function tooltipRow(color: string, text: string): string {
  return `<div class="chart-tip__row">
    <span class="chart-tip__dot" style="background:${color}"></span>
    <span>${text}</span>
  </div>`
}

/** 按 dataZoom 百分比取当前可视段的最小/最大/均值（类 K 线） */
function findVisibleStats(list: DailyTurnover[], startPct: number, endPct: number) {
  const n = list.length
  if (!n) return null

  const startIdx = Math.max(0, Math.floor((startPct / 100) * (n - 1)))
  const endIdx = Math.max(startIdx, Math.min(n - 1, Math.ceil((endPct / 100) * (n - 1))))

  let minIdx = -1
  let maxIdx = -1
  let sum = 0
  let count = 0
  for (let i = startIdx; i <= endIdx; i++) {
    if (list[i].provisional) continue
    const v = list[i].amountYi
    sum += v
    count += 1
    if (minIdx < 0 || v < list[minIdx].amountYi) minIdx = i
    if (maxIdx < 0 || v > list[maxIdx].amountYi) maxIdx = i
  }
  if (minIdx < 0 || maxIdx < 0 || count === 0) return null

  return {
    min: list[minIdx],
    max: list[maxIdx],
    minIdx,
    maxIdx,
    avg: sum / count,
  }
}

const chartOption = computed(() => {
  const list = rangedSeries.value
  if (!list.length) return {}

  const dates = list.map((p) => p.date)
  const values = list.map((p) => p.amountYi)
  const hasProvisional = Boolean(list.at(-1)?.provisional)
  const solidValues = hasProvisional
    ? values.map((v, i) => (i === values.length - 1 ? null : v))
    : values
  const dashedValues = hasProvisional
    ? values.map((v, i) => (i < values.length - 2 ? null : v))
    : []
  const stats = findVisibleStats(list, zoomStart.value, zoomEnd.value)

  const markPointData = []
  if (stats) {
    markPointData.push({
      name: '最高',
      coord: [dates[stats.maxIdx], stats.max.amountYi],
      value: stats.max.amountYi,
      itemStyle: { color: COLOR_UP },
      label: {
        position: 'top',
        distance: 6,
        color: COLOR_UP,
        fontSize: 11,
        fontWeight: 600,
        formatter: () =>
          `${formatAmountYi(stats.max.amountYi)}\n${formatDisplayDate(stats.max.date)}`,
      },
    })
    if (stats.minIdx !== stats.maxIdx) {
      markPointData.push({
        name: '最低',
        coord: [dates[stats.minIdx], stats.min.amountYi],
        value: stats.min.amountYi,
        itemStyle: { color: COLOR_DOWN },
        label: {
          position: 'bottom',
          distance: 6,
          color: COLOR_DOWN,
          fontSize: 11,
          fontWeight: 600,
          formatter: () =>
            `${formatAmountYi(stats.min.amountYi)}\n${formatDisplayDate(stats.min.date)}`,
        },
      })
    }
  }

  const avgValue = stats ? Math.round(stats.avg * 10) / 10 : null

  return {
    animationDuration: 450,
    grid: { left: 8, right: 16, top: 36, bottom: 72, containLabel: true },
    toolbox: {
      right: 4,
      top: 0,
      itemSize: 13,
      iconStyle: { borderColor: '#6b7280' },
      emphasis: { iconStyle: { borderColor: '#3b82f6' } },
      feature: {
        dataZoom: {
          yAxisIndex: 'none',
          brushStyle: {
            color: 'rgba(59, 130, 246, 0.12)',
            borderWidth: 0,
          },
          title: {
            zoom: '框选时段',
            back: '回退缩放',
          },
        },
      },
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(245, 246, 248, 0.96)',
      borderColor: 'rgba(0,0,0,0.06)',
      borderWidth: 1,
      padding: [10, 12],
      extraCssText:
        'border-radius:10px;box-shadow:0 8px 24px rgba(31,35,41,0.12);backdrop-filter:blur(4px);',
      textStyle: {
        color: '#4b5563',
        fontSize: 12,
        lineHeight: 20,
      },
      axisPointer: {
        type: 'line',
        snap: true,
        lineStyle: {
          color: '#9ca3af',
          width: 1,
          type: 'solid',
        },
      },
      formatter: (params: CallbackDataParams | CallbackDataParams[]) => {
        const items = Array.isArray(params) ? params : [params]
        const idx = items[0]?.dataIndex
        return typeof idx === 'number' ? buildTooltipHtml(idx) : ''
      },
    },
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: 0,
        start: zoomStart.value,
        end: zoomEnd.value,
        zoomOnMouseWheel: true,
        moveOnMouseMove: true,
        moveOnMouseWheel: false,
        preventDefaultMouseMove: true,
        brushSelect: true,
      },
      {
        type: 'slider',
        xAxisIndex: 0,
        start: zoomStart.value,
        end: zoomEnd.value,
        height: 36,
        bottom: 8,
        left: 48,
        right: 24,
        borderColor: '#e5e7eb',
        backgroundColor: '#f8fafc',
        fillerColor: 'rgba(59, 130, 246, 0.18)',
        handleIcon:
          'path://M6,0 A6,6 0 1,1 6,12 A6,6 0 1,1 6,0 Z',
        handleSize: 12,
        handleStyle: {
          color: '#fff',
          borderColor: '#3b82f6',
          borderWidth: 1.5,
          shadowBlur: 2,
          shadowColor: 'rgba(59, 130, 246, 0.2)',
        },
        moveHandleSize: 0,
        showDetail: false,
        showDataShadow: true,
        dataBackground: {
          lineStyle: { color: COLOR_AMOUNT, width: 1, opacity: 0.55 },
          areaStyle: { color: COLOR_AMOUNT, opacity: 0.12 },
        },
        selectedDataBackground: {
          lineStyle: { color: COLOR_AMOUNT, width: 1.2 },
          areaStyle: { color: COLOR_AMOUNT, opacity: 0.2 },
        },
        brushSelect: false,
        filterMode: 'filter',
      },
    ],
    xAxis: {
      type: 'category',
      data: dates,
      boundaryGap: false,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: '#a8b0bd',
        fontSize: 12,
        hideOverlap: true,
        formatter: (value: string) => formatDisplayDate(value),
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      splitNumber: 4,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: '#a8b0bd', fontSize: 12 },
      splitLine: {
        lineStyle: { color: '#eef0f4', type: 'solid' },
      },
    },
    series: [
      {
        name: '成交额',
        type: 'line',
        data: solidValues,
        showSymbol: false,
        symbol: 'emptyCircle',
        symbolSize: 8,
        sampling: 'lttb',
        emphasis: {
          scale: false,
          itemStyle: {
            color: '#fff',
            borderColor: COLOR_AMOUNT,
            borderWidth: 2,
          },
        },
        lineStyle: { color: COLOR_AMOUNT, width: 2 },
        itemStyle: {
          color: COLOR_AMOUNT,
          borderColor: '#fff',
          borderWidth: 2,
        },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(255,122,26,0.18)' },
              { offset: 1, color: 'rgba(255,122,26,0.01)' },
            ],
          },
        },
        markPoint: {
          symbol: 'circle',
          symbolSize: 7,
          animation: false,
          data: markPointData,
        },
        markLine:
          avgValue == null
            ? undefined
            : {
                symbol: 'none',
                animation: false,
                silent: true,
                label: {
                  position: 'insideEndTop',
                  color: COLOR_AVG,
                  fontSize: 11,
                  formatter: () => `均 ${formatAmountYi(avgValue)}`,
                },
                lineStyle: {
                  color: COLOR_AVG,
                  type: 'dashed',
                  width: 1.5,
                  opacity: 0.9,
                },
                data: [{ yAxis: avgValue, name: '均值' }],
              },
      },
      ...(hasProvisional
        ? [
            {
              name: '今日盘中',
              type: 'line' as const,
              data: dashedValues,
              showSymbol: true,
              symbol: 'emptyCircle',
              symbolSize: 10,
              connectNulls: false,
              lineStyle: {
                color: COLOR_TODAY,
                width: 2,
                type: 'dashed' as const,
              },
              itemStyle: {
                color: '#fff',
                borderColor: COLOR_TODAY,
                borderWidth: 2,
              },
              emphasis: { scale: false },
            },
          ]
        : []),
    ],
  }
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    result.value = await fetchHsTurnoverSeries()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '数据加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
  window.addEventListener('click', closeCtxMenu)
  window.addEventListener('scroll', closeCtxMenu, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('click', closeCtxMenu)
  window.removeEventListener('scroll', closeCtxMenu, true)
})
</script>

<template>
  <el-card class="turnover-card" shadow="hover" v-loading="loading">
    <template #header>
      <div class="card-header">
        <h2 class="title">A股沪深两市成交额与百分位</h2>
        <div class="meta">
          <span class="badge">交易日更新</span>
          <span
            v-if="result?.series.at(-1)?.provisional"
            class="badge badge-live"
          >盘中</span>
          <span v-if="result" class="asof">截至 {{ formatDisplayDate(result.asOf) }}</span>
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
    />

    <template v-if="result">
      <div class="summary">
        <div class="summary-item">
          <div class="label">成交额</div>
          <div class="value orange">
            {{ formatAmountYi(result.latestAmountYi) }}
          </div>
        </div>
        <div class="divider" />
        <div class="summary-item">
          <div class="label">近3年百分位</div>
          <div class="value blue">{{ formatNumber(result.percentile3y) }}%</div>
        </div>
      </div>

      <div class="chart-toolbar">
        <div class="legend">
          <span class="legend-line" />
          <span>成交额</span>
        </div>
        <div class="toolbar-right">
          <el-button
            size="small"
            :disabled="!isZoomed"
            :icon="RefreshRight"
            @click="resetZoom"
          >
            重置
          </el-button>
          <el-segmented v-model="range" :options="RANGE_OPTIONS" size="small" />
        </div>
      </div>

      <p class="zoom-hint">
        右键某日可打开「当日分时」（含今日虚线点）；分时会写入 data/intraday 本地积累。也可框选/拖动/滚轮缩放
      </p>

      <div class="chart-wrap" @contextmenu="onChartContextMenu">
        <v-chart
          ref="chartRef"
          class="chart"
          :option="chartOption"
          autoresize
          @datazoom="onDataZoom"
          @updateaxispointer="onAxisPointer"
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
          「成交额百分位」衡量当前两市成交额在近 3 年历史中的相对位置。百分位越低，说明资金活跃度越偏冷；越高则交投越热。该指标需结合估值、政策与情绪综合判断，不宜单独作为买卖依据。右键交易日可查看当日分钟级两市成交额分时。
          <span class="guide-emphasis">日成交额不到万亿很可能是熊市底部。</span>
        </p>
      </div>
    </template>
  </el-card>

  <teleport to="body">
    <div
      v-if="ctxMenu.visible"
      class="ctx-menu"
      :style="{ left: `${ctxMenu.x}px`, top: `${ctxMenu.y}px` }"
      @click.stop
    >
      <button type="button" class="ctx-menu__item" @click="openIntraday">
        当日分时
        <span class="ctx-menu__date">{{ formatDisplayDate(ctxMenu.date) }}</span>
      </button>
    </div>
  </teleport>

  <IntradayTurnoverDialog
    v-model="intradayOpen"
    :date="intradayDate"
    :daily-series="result?.series ?? []"
  />
</template>

<style scoped>
.turnover-card {
  --el-card-border-color: transparent;
  --el-card-padding: 20px 22px 16px;
  width: min(860px, 100%);
  border-radius: 16px;
  box-shadow: 0 8px 28px rgba(31, 35, 41, 0.06);
}

.turnover-card :deep(.el-card__header) {
  border-bottom: none;
  padding-bottom: 4px;
}

.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.title {
  margin: 0;
  font-size: 18px;
  font-weight: 650;
  letter-spacing: 0.01em;
  color: var(--text-primary);
}

.meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  color: var(--text-secondary);
  font-size: 12px;
}

.badge {
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--chip-bg);
  color: #6b7280;
}

.badge-live {
  background: rgba(59, 130, 246, 0.12);
  color: #3b82f6;
}

.asof {
  color: var(--text-muted);
  white-space: nowrap;
}

.error-alert {
  margin-bottom: 12px;
}

.summary {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  margin: 8px 0 18px;
}

.summary-item .label {
  color: var(--text-secondary);
  font-size: 13px;
  margin-bottom: 6px;
}

.summary-item .value {
  font-size: 34px;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.02em;
}

.summary-item .unit {
  margin-left: 2px;
  font-size: 18px;
  font-weight: 650;
}

.summary-item .orange {
  color: var(--accent-orange);
}

.summary-item .blue {
  color: var(--accent-blue);
}

.divider {
  width: 1px;
  height: 48px;
  background: var(--border-soft);
  margin: 0 8px;
}

.chart-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
}

.toolbar-right {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.legend {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 13px;
}

.legend-line {
  width: 16px;
  height: 2px;
  border-radius: 2px;
  background: var(--accent-orange);
}

.zoom-hint {
  margin: 0 0 6px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.4;
}

.chart-wrap {
  height: 320px;
}

.chart {
  width: 100%;
  height: 100%;
}

.guide {
  margin-top: 18px;
  padding-top: 12px;
  border-top: 1px solid var(--border-soft);
}

.guide-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.guide-body {
  margin: 10px 0 4px;
  color: #6b7280;
  font-size: 13px;
  line-height: 1.7;
}

.guide-emphasis {
  font-weight: 700;
  color: #dc2626;
}

:deep(.el-segmented) {
  --el-segmented-item-selected-bg-color: #fff;
  --el-segmented-item-selected-color: var(--text-primary);
  background: #f2f4f7;
  padding: 2px;
}

:deep(.el-segmented__item) {
  min-height: 26px;
  padding: 0 12px;
  font-size: 12px;
}

@media (max-width: 640px) {
  .card-header {
    flex-direction: column;
  }

  .summary-item .value {
    font-size: 28px;
  }

  .chart-toolbar {
    flex-wrap: wrap;
  }

  .chart-wrap {
    height: 280px;
  }
}
</style>
