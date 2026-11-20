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
import { fetchStyleSeries, filterPeRatioDays, sliceStyleByRange } from '@/api/style'
import type { RangeKey, StyleSeriesResult } from '@/types/market'
import { useNarrowScreen } from '@/composables/useNarrowScreen'
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

const COLOR_RATIO = '#0369a1'
const COLOR_CYB = '#0284c7'
const COLOR_DIV = '#0f766e'

const RANGE_OPTIONS: Array<{ label: string; value: RangeKey }> = [
  { label: '1年', value: '1y' },
  { label: '3年', value: '3y' },
  { label: '全部', value: 'all' },
]

const loading = ref(true)
const error = ref('')
const result = ref<StyleSeriesResult | null>(null)
const range = ref<RangeKey>('all')
const guideOpen = ref(false)
const zoomStart = ref(0)
const zoomEnd = ref(100)
const chartEpoch = ref(0)

const rangedSeries = computed(() => {
  if (!result.value) return []
  return sliceStyleByRange(filterPeRatioDays(result.value.series), range.value)
})

const chartInstanceKey = computed(() => `style-pe-${range.value}-${chartEpoch.value}`)

const periodDelta = computed(() => {
  const list = rangedSeries.value
  if (list.length < 2) return null
  const cur = list[list.length - 1].peRatio
  const prev = list[list.length - 2].peRatio
  if (cur == null || prev == null) return null
  return Math.round((cur - prev) * 10000) / 10000
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
  const ratios = list.map((p) => p.peRatio)
  const cybPe = list.map((p) => p.cybPe)
  const divPe = list.map((p) => p.divPe)

  return {
    animation: false,
    legend: { show: false },
    grid: {
      left: narrow.value ? 40 : 52,
      right: narrow.value ? 40 : 52,
      top: narrow.value ? 28 : 36,
      bottom: chartTimeZoomGridBottom(narrow.value),
    },
    toolbox: buildTimeAxisToolbox({ accentColor: COLOR_RATIO, narrow: narrow.value }),
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
        return `<div class="chart-tip">
          <div class="chart-tip__title">${formatDisplayDate(point.date)}</div>
          ${tipRow(COLOR_RATIO, `估值比：${point.peRatio == null ? '—' : formatNumber(point.peRatio, 4)}`)}
          ${tipRow(COLOR_CYB, `创业板 PE：${point.cybPe == null ? '—' : formatNumber(point.cybPe, 2)}`)}
          ${tipRow(COLOR_DIV, `红利 PE：${point.divPe == null ? '—' : formatNumber(point.divPe, 2)}`)}
        </div>`
      },
    },
    dataZoom: buildTimeAxisDataZoom({
      start: zoomStart.value,
      end: zoomEnd.value,
      accentColor: COLOR_RATIO,
      left: narrow.value ? 8 : 52,
      right: narrow.value ? 8 : 52,
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
        name: '估值比',
        scale: true,
        nameTextStyle: { color: COLOR_RATIO, fontSize: 11 },
        splitLine: { lineStyle: { color: '#f1f5f9' } },
        axisLabel: { color: '#94a3b8', fontSize: 11 },
      },
      {
        type: 'value',
        name: 'TTM PE',
        scale: true,
        nameTextStyle: { color: '#64748b', fontSize: 11 },
        splitLine: { show: false },
        axisLabel: { color: '#94a3b8', fontSize: 11 },
      },
    ],
    series: [
      {
        name: '估值比',
        type: 'line',
        yAxisIndex: 0,
        data: ratios,
        showSymbol: true,
        symbolSize: 5,
        connectNulls: true,
        z: 3,
        lineStyle: { color: COLOR_RATIO, width: 2.5 },
        itemStyle: { color: COLOR_RATIO },
      },
      {
        name: '创业板 PE',
        type: 'line',
        yAxisIndex: 1,
        data: cybPe,
        showSymbol: true,
        symbolSize: 4,
        connectNulls: true,
        z: 2,
        lineStyle: { color: COLOR_CYB, width: 1.5 },
        itemStyle: { color: COLOR_CYB },
      },
      {
        name: '红利 PE',
        type: 'line',
        yAxisIndex: 1,
        data: divPe,
        showSymbol: true,
        symbolSize: 4,
        connectNulls: true,
        z: 2,
        lineStyle: { color: COLOR_DIV, width: 1.5 },
        itemStyle: { color: COLOR_DIV },
      },
    ],
  }
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    result.value = await fetchStyleSeries()
    if (!filterPeRatioDays(result.value.series).length) {
      error.value = '暂无估值比缓存，请运行 npm run series:seed -- style'
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '风格估值比加载失败'
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
  <el-card class="style-card" shadow="hover" v-loading="loading">
    <template #header>
      <div class="card-header">
        <div class="title-block">
          <h2 class="title">创业板 / 红利估值比</h2>
          <p class="sub">TTM PE 之比 · 乐咕乐股月频</p>
        </div>
        <div class="meta">
          <span class="badge">月频更新</span>
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
          <div class="label">估值比</div>
          <div class="value accent">
            {{ result.latestPeRatio == null ? '—' : formatNumber(result.latestPeRatio, 4) }}
          </div>
          <div
            v-if="periodDelta != null"
            class="delta"
            :class="periodDelta >= 0 ? 'up' : 'down'"
          >
            较上期 {{ periodDelta >= 0 ? '+' : '' }}{{ formatNumber(periodDelta, 4) }}
          </div>
        </div>
        <div class="divider" />
        <div class="summary-item">
          <div class="label">近3年百分位</div>
          <div class="value muted">{{ formatNumber(result.pePercentile3y, 1) }}%</div>
          <div class="delta muted">越高成长相对越贵</div>
        </div>
        <div class="divider" />
        <div class="summary-item">
          <div class="label">创业板 PE / 红利 PE</div>
          <div class="value small">
            {{ result.latestCybPe == null ? '—' : formatNumber(result.latestCybPe, 2) }}
            /
            {{ result.latestDivPe == null ? '—' : formatNumber(result.latestDivPe, 2) }}
          </div>
          <div class="delta muted">TTM</div>
        </div>
      </div>

      <div class="chart-toolbar">
        <div class="legend">
          <span class="legend-item">
            <i class="legend-line accent" />
            估值比
          </span>
          <span class="legend-item">
            <i class="legend-line cyb" />
            创业板 PE
          </span>
          <span class="legend-item">
            <i class="legend-line div" />
            红利 PE
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

      <p class="zoom-hint">左轴估值比；右轴叠两侧 TTM PE（月频采样）。</p>

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
          估值比 = 创业板指 TTM PE ÷ 中证红利 TTM PE（乐咕乐股）。比值高表示成长相对红利更贵；低则成长相对更便宜。与点位比对照：点位比看「谁更强」，估值比看「谁更贵」。源为月频，短窗口噪声大，宜看 3
          年/全历史分位。
        </p>
      </div>
    </template>
  </el-card>
</template>

<style scoped>
.style-card {
  --el-card-border-color: transparent;
  --el-card-padding: 20px 22px 16px;
  width: 100%;
  border-radius: 16px;
  box-shadow: 0 8px 28px rgba(31, 35, 41, 0.06);
}

.style-card :deep(.el-card__header) {
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
  min-width: 0;
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

.value.accent {
  color: #0369a1;
}

.value.muted {
  color: #64748b;
}

.value.small {
  font-size: 16px;
  font-weight: 650;
  color: #475569;
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
  color: #64748b;
  font-size: 12px;
}

.legend-line {
  width: 14px;
  height: 2px;
}

.legend-line.accent {
  background: #0369a1;
}

.legend-line.cyb {
  background: #0284c7;
}

.legend-line.div {
  background: #0f766e;
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
  .style-card {
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
