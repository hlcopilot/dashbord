<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import type { CallbackDataParams } from 'echarts/types/dist/shared'
import VChart from 'vue-echarts'
import { fetchIntradayTurnover } from '@/api/intraday'
import type { DailyTurnover, IntradayTurnoverResult } from '@/types/market'
import { formatDisplayDate } from '@/utils/date'
import { formatAmountYi } from '@/utils/format'

use([CanvasRenderer, LineChart, BarChart, GridComponent, TooltipComponent])

const props = defineProps<{
  modelValue: boolean
  date: string
  dailySeries: DailyTurnover[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const COLOR_TODAY = '#3b82f6'
const COLOR_PREV = '#ff7a1a'
const COLOR_UP = '#ef4444'
const COLOR_DOWN = '#22c55e'

const loading = ref(false)
const error = ref('')
const data = ref<IntradayTurnoverResult | null>(null)

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

async function load() {
  if (!props.date) return
  loading.value = true
  error.value = ''
  data.value = null
  try {
    data.value = await fetchIntradayTurnover(props.date, props.dailySeries)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '分时数据加载失败'
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.modelValue, props.date] as const,
  ([open]) => {
    if (open) void load()
  },
)

function tipRow(color: string, text: string) {
  return `<div class="chart-tip__row"><span class="chart-tip__dot" style="background:${color}"></span><span>${text}</span></div>`
}

const chartOption = computed(() => {
  const points = data.value?.points
  if (!points?.length) return {}

  const times = points.map((p) => p.time)
  const today = points.map((p) => p.todayYi)
  const prev = points.map((p) => p.prevYi)
  const delta = points.map((p) => p.deltaYi)

  return {
    animationDuration: 400,
    legend: { show: false },
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
        lineStyle: { color: '#9ca3af', width: 1 },
      },
      formatter: (params: CallbackDataParams | CallbackDataParams[]) => {
        const items = Array.isArray(params) ? params : [params]
        const idx = items[0]?.dataIndex
        if (typeof idx !== 'number') return ''
        const p = points[idx]
        if (!p) return ''
        const deltaColor =
          p.deltaYi == null ? COLOR_PREV : p.deltaYi >= 0 ? COLOR_UP : COLOR_DOWN
        const deltaText =
          p.deltaYi == null
            ? '—'
            : `${p.deltaYi >= 0 ? '' : '-'}${formatAmountYi(Math.abs(p.deltaYi), 2)}`
        return `<div class="chart-tip">
          <div class="chart-tip__title">${p.time}</div>
          ${tipRow(COLOR_TODAY, `今日两市成交：${p.todayYi == null ? '—' : formatAmountYi(p.todayYi, 2)}`)}
          ${tipRow(COLOR_PREV, `前一日两市成交：${p.prevYi == null ? '—' : formatAmountYi(p.prevYi, 2)}`)}
          ${tipRow(deltaColor, `较前一日增减：${deltaText}`)}
        </div>`
      },
    },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    grid: [
      { left: 52, right: 20, top: 12, height: '56%' },
      { left: 52, right: 20, top: '74%', height: '16%' },
    ],
    xAxis: [
      {
        type: 'category',
        data: times,
        boundaryGap: false,
        gridIndex: 0,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
        splitLine: { show: false },
      },
      {
        type: 'category',
        data: times,
        boundaryGap: false,
        gridIndex: 1,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: '#a8b0bd',
          fontSize: 11,
          interval: (...args: [number, string]) => {
            const value = args[1]
            return value === '09:30' || value === '11:30' || value === '15:00'
          },
        },
        splitLine: { show: false },
      },
    ],
    yAxis: [
      {
        type: 'value',
        gridIndex: 0,
        splitNumber: 4,
        axisLabel: {
          color: '#a8b0bd',
          fontSize: 11,
          formatter: (v: number) => formatAmountYi(v, 2),
        },
        splitLine: { lineStyle: { color: '#eef0f4' } },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      {
        type: 'value',
        gridIndex: 1,
        splitNumber: 2,
        axisLabel: {
          color: '#a8b0bd',
          fontSize: 11,
          formatter: (v: number) => formatAmountYi(v, 1),
        },
        splitLine: { lineStyle: { color: '#eef0f4' } },
        axisLine: { show: false },
        axisTick: { show: false },
      },
    ],
    series: [
      {
        name: '今日两市成交',
        type: 'line',
        data: today,
        showSymbol: false,
        symbol: 'emptyCircle',
        symbolSize: 7,
        connectNulls: false,
        xAxisIndex: 0,
        yAxisIndex: 0,
        lineStyle: { color: COLOR_TODAY, width: 2 },
        itemStyle: { color: COLOR_TODAY },
      },
      {
        name: '前一日两市成交',
        type: 'line',
        data: prev,
        showSymbol: false,
        symbol: 'emptyCircle',
        symbolSize: 7,
        connectNulls: false,
        xAxisIndex: 0,
        yAxisIndex: 0,
        lineStyle: { color: COLOR_PREV, width: 2 },
        itemStyle: { color: COLOR_PREV },
      },
      {
        name: '较前一日增减',
        type: 'bar',
        data: delta.map((v) =>
          v == null
            ? null
            : {
                value: v,
                itemStyle: { color: v >= 0 ? COLOR_UP : COLOR_DOWN },
              },
        ),
        barWidth: 2,
        xAxisIndex: 1,
        yAxisIndex: 1,
      },
    ],
  }
})
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="`成交分析 · ${formatDisplayDate(date)} 分时`"
    width="860px"
    top="6vh"
    destroy-on-close
    class="intraday-dialog"
  >
    <div v-loading="loading" class="intraday-body">
      <el-alert
        v-if="error"
        :title="error"
        type="error"
        show-icon
        :closable="false"
      />

      <template v-if="data">
        <div class="summary">
          <div class="summary-card">
            <div class="summary-label">两市成交额</div>
            <div class="summary-value">{{ formatAmountYi(data.latestTodayYi, 2) }}</div>
            <div
              class="summary-sub"
              :class="(data.deltaVsPrevSameTimeYi ?? 0) >= 0 ? 'up' : 'down'"
            >
              较昨日同期
              {{
                data.deltaVsPrevSameTimeYi == null
                  ? '—'
                  : `${data.deltaVsPrevSameTimeYi >= 0 ? '放量' : '缩量'} ${formatAmountYi(Math.abs(data.deltaVsPrevSameTimeYi), 2)}`
              }}
            </div>
          </div>
          <div class="summary-card">
            <div class="summary-label">前一日全日成交</div>
            <div class="summary-value prev">{{ formatAmountYi(data.prevFullYi, 2) }}</div>
            <div class="summary-sub muted">对比日 {{ formatDisplayDate(data.prevDate) }}</div>
          </div>
        </div>

        <div class="chart-legend">
          <span class="chart-legend__item">
            <i class="chart-legend__line today" />
            今日两市成交
          </span>
          <span class="chart-legend__item">
            <i class="chart-legend__line prev" />
            前一日两市成交
          </span>
          <span class="chart-legend__item">
            <i class="chart-legend__bar" />
            较前一日增减
          </span>
        </div>

        <v-chart class="intraday-chart" :option="chartOption" autoresize />
      </template>
    </div>
  </el-dialog>
</template>

<style scoped>
.intraday-body {
  min-height: 420px;
}

.chart-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 16px 20px;
  margin-bottom: 8px;
  color: #6b7280;
  font-size: 12px;
}

.chart-legend__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.chart-legend__line {
  width: 16px;
  height: 2px;
  border-radius: 1px;
}

.chart-legend__line.today {
  background: #3b82f6;
}

.chart-legend__line.prev {
  background: #ff7a1a;
}

.chart-legend__bar {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: linear-gradient(180deg, #ef4444 50%, #22c55e 50%);
}

.summary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 12px;
}

.summary-card {
  padding: 12px 14px;
  border-radius: 12px;
  background: #f7f8fa;
}

.summary-label {
  color: #8a919f;
  font-size: 12px;
}

.summary-value {
  margin-top: 4px;
  color: #3b82f6;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.summary-value.prev {
  color: #ff7a1a;
}

.summary-sub {
  margin-top: 4px;
  font-size: 12px;
}

.summary-sub.up {
  color: #ef4444;
}

.summary-sub.down {
  color: #22c55e;
}

.summary-sub.muted {
  color: #8a919f;
}

.intraday-chart {
  width: 100%;
  height: 380px;
}

@media (max-width: 720px) {
  .summary {
    grid-template-columns: 1fr;
  }

  .intraday-chart {
    height: 320px;
  }
}
</style>
