<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  ToolboxComponent,
  TooltipComponent,
} from 'echarts/components'
import type { CallbackDataParams } from 'echarts/types/dist/shared'
import VChart from 'vue-echarts'
import { ArrowDown, ArrowUp, RefreshRight } from '@element-plus/icons-vue'
import { fetchMarginSeries, sliceMarginByRange } from '@/api/margin'
import type { MarginDaily, MarginSeriesResult, RangeKey } from '@/types/market'
import { formatDisplayDate } from '@/utils/date'
import { formatAmountYi, formatNumber } from '@/utils/format'

use([
  CanvasRenderer,
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  ToolboxComponent,
  MarkPointComponent,
  MarkLineComponent,
])

const COLOR_MARGIN = '#3b82f6'
const COLOR_SSE = '#ff7a1a'
const COLOR_UP = '#ef4444'
const COLOR_DOWN = '#22c55e'
const COLOR_AVG = '#8b5cf6'

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
const result = ref<MarginSeriesResult | null>(null)
const range = ref<RangeKey>('1y')
const guideOpen = ref(true)
const zoomStart = ref(0)
const zoomEnd = ref(100)
const chartRef = useTemplateRef<InstanceType<typeof VChart>>('chartRef')

const rangedSeries = computed(() =>
  result.value ? sliceMarginByRange(result.value.series, range.value) : [],
)

const isZoomed = computed(() => zoomStart.value > 0.05 || zoomEnd.value < 99.95)

function resetZoom() {
  zoomStart.value = 0
  zoomEnd.value = 100
  const chart = chartRef.value as unknown as {
    dispatchAction?: (payload: Record<string, unknown>) => void
  } | null
  chart?.dispatchAction?.({ type: 'dataZoom', start: 0, end: 100 })
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
  queueMicrotask(resetZoom)
})

function tipRow(color: string, text: string) {
  return `<div class="chart-tip__row"><span class="chart-tip__dot" style="background:${color}"></span><span>${text}</span></div>`
}

function buildTooltipHtml(dataIndex: number): string {
  const list = rangedSeries.value
  const point = list[dataIndex]
  if (!point) return ''
  const prev = dataIndex > 0 ? list[dataIndex - 1] : null
  const delta = prev ? point.marginYi - prev.marginYi : null
  const deltaColor = delta == null ? COLOR_MARGIN : delta >= 0 ? COLOR_UP : COLOR_DOWN
  const deltaText =
    delta == null
      ? '—'
      : `${delta >= 0 ? '' : '-'}${formatAmountYi(Math.abs(delta))}`

  return `<div class="chart-tip">
    <div class="chart-tip__title">${formatDisplayDate(point.date)}</div>
    ${tipRow(COLOR_MARGIN, `两融余额：${formatAmountYi(point.marginYi)}`)}
    ${tipRow(COLOR_SSE, `上证指数：${point.sseClose == null ? '—' : formatNumber(point.sseClose)}`)}
    ${tipRow(deltaColor, `较前一日增减：${deltaText}`)}
  </div>`
}

function findVisibleStats(list: MarginDaily[], startPct: number, endPct: number) {
  const n = list.length
  if (!n) return null
  const startIdx = Math.max(0, Math.floor((startPct / 100) * (n - 1)))
  const endIdx = Math.max(startIdx, Math.min(n - 1, Math.ceil((endPct / 100) * (n - 1))))

  let minIdx = startIdx
  let maxIdx = startIdx
  let sum = 0
  for (let i = startIdx; i <= endIdx; i++) {
    const v = list[i].marginYi
    sum += v
    if (v < list[minIdx].marginYi) minIdx = i
    if (v > list[maxIdx].marginYi) maxIdx = i
  }
  return {
    min: list[minIdx],
    max: list[maxIdx],
    minIdx,
    maxIdx,
    avg: sum / (endIdx - startIdx + 1),
  }
}

const chartOption = computed(() => {
  const list = rangedSeries.value
  if (!list.length) return {}

  const dates = list.map((p) => p.date)
  const margin = list.map((p) => p.marginYi)
  const sse = list.map((p) => p.sseClose)
  const stats = findVisibleStats(list, zoomStart.value, zoomEnd.value)
  const avgValue = stats ? Math.round(stats.avg * 100) / 100 : null

  const markPointData = []
  if (stats) {
    markPointData.push({
      name: '最高',
      coord: [dates[stats.maxIdx], stats.max.marginYi],
      value: stats.max.marginYi,
      itemStyle: { color: COLOR_UP },
      label: {
        position: 'top',
        distance: 6,
        color: COLOR_UP,
        fontSize: 11,
        fontWeight: 600,
        formatter: () =>
          `${formatAmountYi(stats.max.marginYi)}\n${formatDisplayDate(stats.max.date)}`,
      },
    })
    if (stats.minIdx !== stats.maxIdx) {
      markPointData.push({
        name: '最低',
        coord: [dates[stats.minIdx], stats.min.marginYi],
        value: stats.min.marginYi,
        itemStyle: { color: COLOR_DOWN },
        label: {
          position: 'bottom',
          distance: 6,
          color: COLOR_DOWN,
          fontSize: 11,
          fontWeight: 600,
          formatter: () =>
            `${formatAmountYi(stats.min.marginYi)}\n${formatDisplayDate(stats.min.date)}`,
        },
      })
    }
  }

  return {
    animationDuration: 450,
    legend: { show: false },
    grid: { left: 8, right: 16, top: 36, bottom: 72, containLabel: true },
    toolbox: {
      right: 4,
      top: 0,
      itemSize: 13,
      iconStyle: { borderColor: '#6b7280' },
      emphasis: { iconStyle: { borderColor: COLOR_MARGIN } },
      feature: {
        dataZoom: {
          yAxisIndex: 'none',
          brushStyle: { color: 'rgba(59, 130, 246, 0.12)', borderWidth: 0 },
          title: { zoom: '框选时段', back: '回退缩放' },
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
      axisPointer: {
        type: 'line',
        snap: true,
        lineStyle: { color: '#9ca3af', width: 1, type: 'solid' },
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
        brushSelect: true,
      },
      {
        type: 'slider',
        xAxisIndex: 0,
        start: zoomStart.value,
        end: zoomEnd.value,
        height: 36,
        bottom: 8,
        left: 56,
        right: 56,
        borderColor: '#e5e7eb',
        backgroundColor: '#f8fafc',
        fillerColor: 'rgba(59, 130, 246, 0.18)',
        handleIcon: 'path://M6,0 A6,6 0 1,1 6,12 A6,6 0 1,1 6,0 Z',
        handleSize: 12,
        handleStyle: {
          color: '#fff',
          borderColor: COLOR_MARGIN,
          borderWidth: 1.5,
        },
        moveHandleSize: 0,
        showDetail: false,
        showDataShadow: true,
        dataBackground: {
          lineStyle: { color: COLOR_MARGIN, width: 1, opacity: 0.55 },
          areaStyle: { color: COLOR_MARGIN, opacity: 0.12 },
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
    yAxis: [
      {
        type: 'value',
        name: '两融余额',
        nameTextStyle: { color: COLOR_MARGIN, fontSize: 11, padding: [0, 0, 0, 8] },
        scale: true,
        splitNumber: 4,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: '#a8b0bd',
          fontSize: 12,
          formatter: (v: number) => formatAmountYi(v, 0),
        },
        splitLine: { lineStyle: { color: '#eef0f4' } },
      },
      {
        type: 'value',
        name: '上证指数',
        nameTextStyle: { color: COLOR_SSE, fontSize: 11, padding: [0, 8, 0, 0] },
        scale: true,
        splitNumber: 4,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#a8b0bd', fontSize: 12 },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: '两融余额',
        type: 'line',
        yAxisIndex: 0,
        data: margin,
        showSymbol: false,
        symbol: 'emptyCircle',
        symbolSize: 8,
        sampling: 'lttb',
        lineStyle: { color: COLOR_MARGIN, width: 2 },
        itemStyle: { color: COLOR_MARGIN },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(59,130,246,0.16)' },
              { offset: 1, color: 'rgba(59,130,246,0.01)' },
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
      {
        name: '上证指数',
        type: 'line',
        yAxisIndex: 1,
        data: sse,
        showSymbol: false,
        symbol: 'emptyCircle',
        symbolSize: 8,
        sampling: 'lttb',
        connectNulls: false,
        lineStyle: { color: COLOR_SSE, width: 2 },
        itemStyle: { color: COLOR_SSE },
      },
    ],
  }
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    // 稍晚于成交额卡，错开搜狐日线并发
    await new Promise((r) => setTimeout(r, 800))
    result.value = await fetchMarginSeries()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '数据加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <el-card class="margin-card" shadow="hover" v-loading="loading">
    <template #header>
      <div class="card-header">
        <h2 class="title">两融余额与上证指数</h2>
        <div class="meta">
          <span class="badge">交易日更新</span>
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
          <div class="label">两融余额</div>
          <div class="value blue">
            {{ formatAmountYi(result.latestMarginYi) }}
          </div>
          <div
            v-if="result.deltaYi != null"
            class="delta"
            :class="result.deltaYi >= 0 ? 'up' : 'down'"
          >
            较前一日
            {{ result.deltaYi >= 0 ? '+' : '' }}{{ formatAmountYi(result.deltaYi) }}
          </div>
        </div>
        <div class="divider" />
        <div class="summary-item">
          <div class="label">近3年百分位</div>
          <div class="value orange">{{ formatNumber(result.percentile3y) }}%</div>
          <div class="delta muted">
            上证
            {{ result.latestSseClose == null ? '—' : formatNumber(result.latestSseClose) }}
          </div>
        </div>
      </div>

      <div class="chart-toolbar">
        <div class="legend">
          <span class="legend-item">
            <i class="legend-line blue" />
            两融余额(亿元)
          </span>
          <span class="legend-item">
            <i class="legend-line orange" />
            上证指数
          </span>
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

      <p class="zoom-hint">框选/拖动/滚轮缩放，或拖动底部时间轴；高低点与均值按可视区间计算</p>

      <div class="chart-wrap">
        <v-chart
          ref="chartRef"
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
          「两融余额」为沪深市场融资余额与融券余额之和，衡量杠杆资金存量。余额抬升通常对应风险偏好升温；与上证指数对照，可观察杠杆资金与大盘节奏是否同步。百分位反映当前余额在近 3 年中的相对位置，需结合估值与政策综合判断。
        </p>
      </div>
    </template>
  </el-card>
</template>

<style scoped>
.margin-card {
  --el-card-border-color: transparent;
  --el-card-padding: 20px 22px 16px;
  width: min(860px, 100%);
  border-radius: 16px;
  box-shadow: 0 8px 28px rgba(31, 35, 41, 0.06);
}

.margin-card :deep(.el-card__header) {
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
  color: var(--text-primary);
}

.meta {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-secondary);
  font-size: 12px;
}

.badge {
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--chip-bg);
  color: #6b7280;
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
  font-size: 30px;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.02em;
}

.summary-item .blue {
  color: var(--accent-blue);
}

.summary-item .orange {
  color: var(--accent-orange);
}

.delta {
  margin-top: 6px;
  font-size: 12px;
}

.delta.up {
  color: #ef4444;
}

.delta.down {
  color: #22c55e;
}

.delta.muted {
  color: #8a919f;
}

.divider {
  width: 1px;
  height: 56px;
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
  flex-wrap: wrap;
  gap: 14px;
  color: var(--text-secondary);
  font-size: 13px;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.legend-line {
  width: 16px;
  height: 2px;
  border-radius: 2px;
}

.legend-line.blue {
  background: #3b82f6;
}

.legend-line.orange {
  background: #ff7a1a;
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
  .card-header,
  .chart-toolbar {
    flex-direction: column;
    align-items: flex-start;
  }

  .summary-item .value {
    font-size: 24px;
  }

  .chart-wrap {
    height: 280px;
  }
}
</style>
