<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart, CandlestickChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import type { CallbackDataParams } from 'echarts/types/dist/shared'
import VChart from 'vue-echarts'
import { fetchEtfIntradayKline } from '@/api/etfIntraday'
import { useNarrowScreen } from '@/composables/useNarrowScreen'
import type { EtfIntradayResult } from '@/types/market'
import { formatDisplayDate } from '@/utils/date'
import { formatAmountYi, formatNumber } from '@/utils/format'

use([CanvasRenderer, CandlestickChart, BarChart, GridComponent, TooltipComponent])

const narrow = useNarrowScreen(720)
const dialogWidth = computed(() => (narrow.value ? 'calc(100vw - 16px)' : '860px'))
const dialogTop = computed(() => (narrow.value ? '4vh' : '6vh'))

const props = defineProps<{
  modelValue: boolean
  date: string
  code: string
  name: string
  secid: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const COLOR_UP = '#ef4444'
const COLOR_DOWN = '#22c55e'

const loading = ref(false)
const error = ref('')
const data = ref<EtfIntradayResult | null>(null)

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v),
})

async function load() {
  if (!props.date || !props.secid) return
  loading.value = true
  error.value = ''
  data.value = null
  try {
    data.value = await fetchEtfIntradayKline({
      secid: props.secid,
      code: props.code,
      name: props.name,
      date: props.date,
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'ETF 分钟 K 加载失败'
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.modelValue, props.date, props.secid] as const,
  ([open]) => {
    if (open) void load()
  },
)

function formatVolume(v: number) {
  if (v >= 1e8) return `${formatNumber(v / 1e8)}亿股`
  if (v >= 1e4) return `${formatNumber(v / 1e4)}万股`
  return `${formatNumber(v, 0)}股`
}

const chartOption = computed(() => {
  const bars = data.value?.bars
  if (!bars?.length) return {}

  const times = bars.map((b) => b.time)
  const candle = bars.map((b) => [b.open, b.close, b.low, b.high])
  const volumes = bars.map((b) => ({
    value: b.volume,
    itemStyle: { color: b.close >= b.open ? COLOR_UP : COLOR_DOWN },
  }))

  const left = narrow.value ? 44 : 56
  const right = narrow.value ? 12 : 20

  return {
    animationDuration: 300,
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      backgroundColor: 'rgba(245, 246, 248, 0.96)',
      borderColor: 'rgba(0,0,0,0.06)',
      borderWidth: 1,
      padding: [10, 12],
      extraCssText:
        'border-radius:10px;box-shadow:0 8px 24px rgba(31,35,41,0.12);backdrop-filter:blur(4px);',
      formatter: (params: CallbackDataParams | CallbackDataParams[]) => {
        const items = Array.isArray(params) ? params : [params]
        const idx = items[0]?.dataIndex
        if (typeof idx !== 'number') return ''
        const b = bars[idx]
        if (!b) return ''
        const up = b.close >= b.open
        return `<div class="chart-tip">
          <div class="chart-tip__title">${b.time}</div>
          <div class="chart-tip__row">开 ${formatNumber(b.open)}</div>
          <div class="chart-tip__row">高 ${formatNumber(b.high)}</div>
          <div class="chart-tip__row">低 ${formatNumber(b.low)}</div>
          <div class="chart-tip__row" style="color:${up ? COLOR_UP : COLOR_DOWN}">收 ${formatNumber(b.close)}</div>
          <div class="chart-tip__row">量 ${formatVolume(b.volume)}</div>
          <div class="chart-tip__row">额 ${formatAmountYi(b.amountYi)}</div>
        </div>`
      },
    },
    grid: [
      { left, right, top: 16, height: narrow.value ? '50%' : '56%' },
      { left, right, top: narrow.value ? '68%' : '72%', height: narrow.value ? '18%' : '16%' },
    ],
    xAxis: [
      {
        type: 'category',
        data: times,
        boundaryGap: true,
        gridIndex: 0,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
        splitLine: { show: false },
      },
      {
        type: 'category',
        data: times,
        boundaryGap: true,
        gridIndex: 1,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: '#a8b0bd',
          fontSize: narrow.value ? 10 : 11,
          interval: (_: number, value: string) =>
            value === '09:30' ||
            value === '09:31' ||
            value === '11:30' ||
            value === '13:00' ||
            value === '13:01' ||
            value === '15:00',
        },
        splitLine: { show: false },
      },
    ],
    yAxis: [
      {
        type: 'value',
        gridIndex: 0,
        scale: true,
        splitNumber: narrow.value ? 3 : 4,
        axisLabel: {
          color: '#a8b0bd',
          fontSize: narrow.value ? 10 : 11,
          formatter: (v: number) => formatNumber(v),
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
          fontSize: narrow.value ? 10 : 11,
          formatter: (v: number) => (v >= 1e4 ? `${formatNumber(v / 1e4, 1)}万` : formatNumber(v, 0)),
        },
        splitLine: { lineStyle: { color: '#eef0f4' } },
        axisLine: { show: false },
        axisTick: { show: false },
      },
    ],
    series: [
      {
        name: '价格',
        type: 'candlestick',
        data: candle,
        xAxisIndex: 0,
        yAxisIndex: 0,
        itemStyle: {
          color: COLOR_UP,
          color0: COLOR_DOWN,
          borderColor: COLOR_UP,
          borderColor0: COLOR_DOWN,
        },
      },
      {
        name: '成交量',
        type: 'bar',
        data: volumes,
        xAxisIndex: 1,
        yAxisIndex: 1,
        barMaxWidth: 6,
      },
    ],
  }
})
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="`${name || code} · ${formatDisplayDate(date)} 分钟K`"
    :width="dialogWidth"
    :top="dialogTop"
    align-center
    destroy-on-close
    class="etf-intraday-dialog"
  >
    <div v-loading="loading" class="etf-intraday-body">
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
            <div class="summary-label">收盘 / 振幅</div>
            <div
              class="summary-value"
              :class="data.close >= data.open ? 'up' : 'down'"
            >
              {{ formatNumber(data.close) }}
            </div>
            <div class="summary-sub muted">
              开 {{ formatNumber(data.open) }} · 高 {{ formatNumber(data.high) }} · 低
              {{ formatNumber(data.low) }}
            </div>
          </div>
          <div class="summary-card">
            <div class="summary-label">成交额 / 量</div>
            <div class="summary-value amount">{{ formatAmountYi(data.amountYi) }}</div>
            <div class="summary-sub muted">{{ formatVolume(data.volume) }}</div>
          </div>
        </div>

        <p class="source-hint">
          仅展示当日分钟 K（非净流入）。{{
            data.source === 'cache'
              ? '来自本地/KV 归档（打开弹层会同步近约 5 日并持续积累）。'
              : data.source === 'kline'
                ? '本次已从东财 1 分钟 K 同步并写入归档。'
                : '本次已从东财 trends2 同步并写入归档。'
          }}
        </p>

        <v-chart class="etf-intraday-chart" :option="chartOption" autoresize />
      </template>
    </div>
  </el-dialog>
</template>

<style scoped>
.etf-intraday-body {
  min-height: 420px;
}

.summary {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 8px;
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
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.summary-value.up {
  color: #ef4444;
}

.summary-value.down {
  color: #22c55e;
}

.summary-value.amount {
  color: #3b82f6;
}

.summary-sub {
  margin-top: 4px;
  font-size: 12px;
}

.summary-sub.muted {
  color: #8a919f;
}

.source-hint {
  margin: 0 0 8px;
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.4;
}

.etf-intraday-chart {
  width: 100%;
  height: 380px;
}

@media (max-width: 720px) {
  .etf-intraday-body {
    min-height: 300px;
  }

  .summary {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .summary-value {
    font-size: 22px;
  }

  .etf-intraday-chart {
    height: min(320px, 52vh);
  }
}
</style>

<style>
@media (max-width: 720px) {
  .etf-intraday-dialog.el-dialog {
    margin: 8px auto !important;
    max-width: calc(100vw - 16px);
  }

  .etf-intraday-dialog .el-dialog__header {
    padding: 12px 14px 8px;
  }

  .etf-intraday-dialog .el-dialog__body {
    padding: 8px 12px 14px;
  }

  .etf-intraday-dialog .el-dialog__title {
    font-size: 15px;
    line-height: 1.4;
  }
}
</style>
