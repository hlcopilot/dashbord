<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart, LineChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  ToolboxComponent,
  TooltipComponent,
} from 'echarts/components'
import VChart from 'vue-echarts'
import { ArrowDown, ArrowUp, RefreshRight } from '@element-plus/icons-vue'
import { fetchEtfFlowSeries, sliceEtfFlowByRange } from '@/api/etfFlow'
import type { EtfFlowSeriesResult, RangeKey } from '@/types/market'
import { formatDisplayDate } from '@/utils/date'
import { formatAmountYi, formatNumber } from '@/utils/format'

use([
  CanvasRenderer,
  BarChart,
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  ToolboxComponent,
  MarkLineComponent,
])

const COLOR_UP = '#ef4444'
const COLOR_DOWN = '#22c55e'
const COLOR_SHARE = '#94a3b8'
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
const result = ref<EtfFlowSeriesResult | null>(null)
const range = ref<RangeKey>('3m')
const guideOpen = ref(true)
const zoomStart = ref(0)
const zoomEnd = ref(100)
const chartRef = useTemplateRef<InstanceType<typeof VChart>>('chartRef')

const rangedSeries = computed(() =>
  result.value ? sliceEtfFlowByRange(result.value.series, range.value) : [],
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

const chartOption = computed(() => {
  const list = rangedSeries.value
  const dates = list.map((d) => d.date)
  const flows = list.map((d) => d.netInflowYi)
  const sharesYi = list.map((d) => Math.round((d.shareWan / 10000) * 100) / 100) // 亿份

  const visibleFlows = flows.filter((v): v is number => v != null)
  const avg =
    visibleFlows.length > 0
      ? Math.round((visibleFlows.reduce((a, b) => a + b, 0) / visibleFlows.length) * 100) / 100
      : null

  return {
    animation: false,
    grid: { left: 52, right: 52, top: 28, bottom: 72 },
    legend: { show: false },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const arr = Array.isArray(params) ? params : [params]
        const idx = (arr[0] as { dataIndex?: number })?.dataIndex
        if (idx == null) return ''
        const point = list[idx]
        if (!point) return ''
        const flow = point.netInflowYi
        const flowColor = flow == null ? COLOR_SHARE : flow >= 0 ? COLOR_UP : COLOR_DOWN
        const flowText =
          flow == null ? '—' : `${flow >= 0 ? '+' : ''}${formatAmountYi(flow)}`
        return `<div class="chart-tip">
          <div class="chart-tip__title">${formatDisplayDate(point.date)}</div>
          ${tipRow(flowColor, `净流入：${flowText}`)}
          ${tipRow(COLOR_SHARE, `总份额：${formatNumber(point.shareWan / 10000)} 亿份`)}
          ${tipRow('#64748b', `收盘：${formatNumber(point.close)}`)}
        </div>`
      },
    },
    dataZoom: [
      { type: 'inside', start: zoomStart.value, end: zoomEnd.value },
      {
        type: 'slider',
        height: 18,
        bottom: 8,
        start: zoomStart.value,
        end: zoomEnd.value,
        borderColor: 'transparent',
        fillerColor: 'rgba(59,130,246,0.12)',
        handleSize: 16,
      },
    ],
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
        name: '净流入(亿)',
        nameTextStyle: { color: '#94a3b8', fontSize: 11 },
        splitLine: { lineStyle: { color: '#f1f5f9' } },
        axisLabel: { color: '#94a3b8', fontSize: 11 },
      },
      {
        type: 'value',
        name: '份额(亿份)',
        nameTextStyle: { color: '#94a3b8', fontSize: 11 },
        splitLine: { show: false },
        axisLabel: { color: '#94a3b8', fontSize: 11 },
      },
    ],
    series: [
      {
        name: '净流入',
        type: 'bar',
        yAxisIndex: 0,
        data: flows.map((v) => ({
          value: v,
          itemStyle: {
            color: v == null ? COLOR_SHARE : v >= 0 ? COLOR_UP : COLOR_DOWN,
            opacity: 0.85,
          },
        })),
        barMaxWidth: 14,
        markLine:
          avg == null
            ? undefined
            : {
                symbol: 'none',
                silent: true,
                label: {
                  position: 'insideEndTop',
                  color: COLOR_AVG,
                  fontSize: 11,
                  formatter: () => `均 ${formatAmountYi(avg)}`,
                },
                lineStyle: { color: COLOR_AVG, type: 'dashed', width: 1.5 },
                data: [{ yAxis: avg }],
              },
      },
      {
        name: '总份额',
        type: 'line',
        yAxisIndex: 1,
        data: sharesYi,
        showSymbol: false,
        lineStyle: { color: COLOR_SHARE, width: 1.5 },
        itemStyle: { color: COLOR_SHARE },
      },
    ],
  }
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    // 稍候于其他卡片；全量靠本地缓存，日常只打增量
    await new Promise((r) => setTimeout(r, 1200))
    result.value = await fetchEtfFlowSeries('510300')
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
  <el-card class="etf-card" shadow="hover" v-loading="loading">
    <template #header>
      <div class="card-header">
        <h2 class="title">ETF 净流入（大资金代理）</h2>
        <div class="meta">
          <span class="badge">510300 · 份额 T+1</span>
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
          <div class="label">最新日净流入</div>
          <div
            class="value"
            :class="
              result.latestNetInflowYi == null
                ? ''
                : result.latestNetInflowYi >= 0
                  ? 'up'
                  : 'down'
            "
          >
            <template v-if="result.latestNetInflowYi == null">—</template>
            <template v-else>
              {{ result.latestNetInflowYi >= 0 ? '+' : ''
              }}{{ formatAmountYi(result.latestNetInflowYi) }}
            </template>
          </div>
          <div class="delta muted">{{ result.name }}</div>
        </div>
        <div class="divider" />
        <div class="summary-item">
          <div class="label">总份额</div>
          <div class="value blue">
            {{
              result.latestShareWan == null
                ? '—'
                : `${formatNumber(result.latestShareWan / 10000)} 亿份`
            }}
          </div>
          <div class="delta muted">上交所披露</div>
        </div>
      </div>

      <div class="chart-toolbar">
        <div class="legend">
          <span class="legend-item">
            <i class="legend-bar up" />
            净申购
          </span>
          <span class="legend-item">
            <i class="legend-bar down" />
            净赎回
          </span>
          <span class="legend-item">
            <i class="legend-line" />
            总份额
          </span>
        </div>
        <div class="toolbar-right">
          <el-button size="small" :disabled="!isZoomed" :icon="RefreshRight" @click="resetZoom">
            重置
          </el-button>
          <el-segmented v-model="range" :options="RANGE_OPTIONS" size="small" />
        </div>
      </div>

      <p class="zoom-hint">
        红柱净申购、绿柱净赎回（亿元）；折线为总份额。优先读本地缓存，日常只补增量。
        <template v-if="result.missingShareCount">
          历史份额仍缺 {{ result.missingShareCount }} 日，可运行
          <code>npm run etf:seed</code> 全量回填。
        </template>
      </p>

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
          先选宽基 ETF（当前为华泰柏瑞沪深300
          510300），按全天口径估算：净流入 ≈（当日总份额 − 前一日总份额）×
          收盘价。民间常把宽基 ETF 异常大净申购当作「大资金／国家队」代理，但并非官方标签；也可能含套利、做市与普通机构。份额由上交所披露，通常
          T+1，当日可能暂缺。
        </p>
      </div>
    </template>
  </el-card>
</template>

<style scoped>
.etf-card {
  --el-card-border-color: transparent;
  --el-card-padding: 20px 22px 16px;
  width: min(860px, 100%);
  border-radius: 16px;
  box-shadow: 0 8px 28px rgba(31, 35, 41, 0.06);
}

.etf-card :deep(.el-card__header) {
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

.value.blue {
  color: #3b82f6;
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
  background: #94a3b8;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.zoom-hint {
  margin: 0 0 8px;
  color: #94a3b8;
  font-size: 12px;
}

.chart-wrap {
  height: 340px;
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

:deep(.chart-tip) {
  min-width: 160px;
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
</style>
