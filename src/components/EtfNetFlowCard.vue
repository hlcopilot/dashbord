<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
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
import { ArrowDown, ArrowUp, Refresh, RefreshRight } from '@element-plus/icons-vue'
import { fetchEtfFlowSeries, sliceEtfFlowByRange } from '@/api/etfFlow'
import { withEtfFetchSlot } from '@/api/etfFlowGate'
import { formatIndexWithPosition, getEtfByCode } from '@/etfUniverse'
import type { EtfFlowSeriesResult, RangeKey } from '@/types/market'
import { useNarrowScreen } from '@/composables/useNarrowScreen'
import {
  buildTimeAxisDataZoom,
  buildTimeAxisToolbox,
  chartTimeZoomGridBottom,
} from '@/utils/chartTimeZoom'
import { formatDisplayDate } from '@/utils/date'
import { formatAmountYi, formatNumber } from '@/utils/format'
import EtfIntradayDialog from '@/components/EtfIntradayDialog.vue'

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
  MarkLineComponent,
])

const props = defineProps<{
  code: string
  /** 是否展示「如何解读」；分区里仅首卡展开说明即可 */
  showGuide?: boolean
}>()

const meta = computed(() => getEtfByCode(props.code))

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

const rootRef = useTemplateRef<HTMLElement>('rootRef')
const chartRef = useTemplateRef<InstanceType<typeof VChart>>('chartRef')
const loading = ref(false)
const waitingView = ref(true)
const error = ref('')
const result = ref<EtfFlowSeriesResult | null>(null)
const range = ref<RangeKey>('3m')
const guideOpen = ref(false)
const zoomStart = ref(0)
const zoomEnd = ref(100)
/** 区间切换时递增，给 v-chart 换 key，清掉 ECharts 内部缩放状态 */
const chartEpoch = ref(0)
const hoverIndex = ref(-1)
const ctxMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  date: '',
  sheet: false,
})
const intradayOpen = ref(false)
const intradayDate = ref('')
let suppressCtxCloseUntil = 0
let longPressTimer: ReturnType<typeof setTimeout> | null = null
let longPressStart = { x: 0, y: 0 }
const LONG_PRESS_MS = 480
const LONG_PRESS_MOVE_PX = 12
let observer: IntersectionObserver | null = null
let loadedOnce = false

const rangedSeries = computed(() =>
  result.value ? sliceEtfFlowByRange(result.value.series, range.value) : [],
)

const chartInstanceKey = computed(
  () => `${props.code}-${range.value}-${chartEpoch.value}`,
)

const indexLabel = computed(
  () => result.value?.indexName || meta.value.indexName,
)

const indexLabelWithPos = computed(() => formatIndexWithPosition(indexLabel.value))

const exchangeLabel = computed(() => {
  const ex = result.value?.exchange || meta.value.exchange
  return ex === 'SZ' ? '深交所披露' : '上交所披露'
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

function onAxisPointer(params: {
  dataIndex?: number
  batch?: Array<{ dataIndex?: number }>
}) {
  const idx = params.dataIndex ?? params.batch?.[0]?.dataIndex
  if (typeof idx === 'number') hoverIndex.value = idx
}

function closeCtxMenu() {
  if (Date.now() < suppressCtxCloseUntil) return
  ctxMenu.value.visible = false
}

function clearLongPressTimer() {
  if (longPressTimer != null) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
}

type ChartPixelApi = {
  containPixel?: (finder: string, value: number[]) => boolean
  convertFromPixel?: (finder: object, value: number[]) => number[]
  getDom?: () => HTMLElement
}

function resolveDateAtClientPoint(clientX: number, clientY: number): string | null {
  const list = rangedSeries.value
  if (!list.length) return null

  let idx = hoverIndex.value
  const chart = chartRef.value as unknown as ChartPixelApi | null
  const dom = chart?.getDom?.()
  if (chart?.containPixel && chart.convertFromPixel && dom) {
    const point = [clientX - dom.getBoundingClientRect().left, clientY - dom.getBoundingClientRect().top]
    if (chart.containPixel('grid', point)) {
      const data = chart.convertFromPixel({ seriesIndex: 0 }, point)
      if (typeof data?.[0] === 'number') idx = Math.round(data[0])
    }
  }

  if (idx < 0 || idx >= list.length) idx = list.length - 1
  return list[idx]?.date ?? null
}

function openCtxMenuAt(clientX: number, clientY: number, asSheet: boolean) {
  const date = resolveDateAtClientPoint(clientX, clientY)
  if (!date) return

  const pad = 8
  const menuW = asSheet ? Math.min(320, window.innerWidth - 24) : 168
  const menuH = 44
  let x = clientX
  let y = clientY
  if (asSheet) {
    x = Math.max(pad, (window.innerWidth - menuW) / 2)
    y = Math.max(pad, window.innerHeight - menuH - 24)
  } else {
    x = Math.min(Math.max(pad, clientX), window.innerWidth - menuW - pad)
    y = Math.min(Math.max(pad, clientY), window.innerHeight - menuH - pad)
  }

  suppressCtxCloseUntil = Date.now() + 400
  ctxMenu.value = { visible: true, x, y, date, sheet: asSheet }
}

function onChartContextMenu(e: MouseEvent) {
  e.preventDefault()
  openCtxMenuAt(e.clientX, e.clientY, narrow.value)
}

function onChartTouchStart(e: TouchEvent) {
  if (!narrow.value) return
  const t = e.touches[0]
  if (!t) return
  longPressStart = { x: t.clientX, y: t.clientY }
  clearLongPressTimer()
  longPressTimer = setTimeout(() => {
    longPressTimer = null
    openCtxMenuAt(longPressStart.x, longPressStart.y, true)
    try {
      navigator.vibrate?.(10)
    } catch {
      /* ignore */
    }
  }, LONG_PRESS_MS)
}

function onChartTouchMove(e: TouchEvent) {
  if (longPressTimer == null) return
  const t = e.touches[0]
  if (!t) return
  if (
    Math.abs(t.clientX - longPressStart.x) > LONG_PRESS_MOVE_PX ||
    Math.abs(t.clientY - longPressStart.y) > LONG_PRESS_MOVE_PX
  ) {
    clearLongPressTimer()
  }
}

function onChartTouchEnd() {
  clearLongPressTimer()
}

function openIntraday() {
  if (!ctxMenu.value.date) return
  intradayDate.value = ctxMenu.value.date
  intradayOpen.value = true
  suppressCtxCloseUntil = 0
  ctxMenu.value.visible = false
}

function tipRow(color: string, text: string) {
  return `<div class="chart-tip__row"><span class="chart-tip__dot" style="background:${color}"></span><span>${text}</span></div>`
}

const chartOption = computed(() => {
  const list = rangedSeries.value
  const dates = list.map((d) => d.date)
  const flows = list.map((d) => d.netInflowYi)
  const sharesYi = list.map((d) => Math.round((d.shareWan / 10000) * 100) / 100)

  const visibleFlows = flows.filter((v): v is number => v != null)
  const avg =
    visibleFlows.length > 0
      ? Math.round((visibleFlows.reduce((a, b) => a + b, 0) / visibleFlows.length) * 100) / 100
      : null

  return {
    animation: false,
    grid: {
      left: narrow.value ? 36 : 52,
      right: narrow.value ? 36 : 52,
      top: narrow.value ? 28 : 36,
      bottom: chartTimeZoomGridBottom(narrow.value),
    },
    legend: { show: false },
    toolbox: buildTimeAxisToolbox({ accentColor: '#3b82f6', narrow: narrow.value }),
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
    dataZoom: buildTimeAxisDataZoom({
      start: zoomStart.value,
      end: zoomEnd.value,
      accentColor: '#3b82f6',
      left: narrow.value ? 8 : 52,
      right: narrow.value ? 8 : 52,
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

async function load(force = false) {
  if (!force && loadedOnce && result.value) return
  loading.value = true
  waitingView.value = false
  error.value = ''
  try {
    result.value = await withEtfFetchSlot(() => fetchEtfFlowSeries(props.code))
    loadedOnce = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : '数据加载失败'
  } finally {
    loading.value = false
  }
}

/** 单卡重拉，避免整页刷新 */
function reload() {
  void load(true)
}

onMounted(() => {
  if (props.showGuide) guideOpen.value = true
  window.addEventListener('click', closeCtxMenu)
  window.addEventListener('scroll', closeCtxMenu, true)
  window.addEventListener('touchstart', closeCtxMenu, { passive: true })
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
    { rootMargin: '120px 0px' },
  )
  observer.observe(el)
})

onBeforeUnmount(() => {
  clearLongPressTimer()
  window.removeEventListener('click', closeCtxMenu)
  window.removeEventListener('scroll', closeCtxMenu, true)
  window.removeEventListener('touchstart', closeCtxMenu)
  observer?.disconnect()
  observer = null
})
</script>

<template>
  <div ref="rootRef" class="etf-card-root">
  <el-card class="etf-card" shadow="hover" v-loading="loading">
    <template #header>
      <div class="card-header">
        <div class="title-block">
          <h2 class="title">{{ meta.name }}</h2>
          <p class="index-tag">所属指数 · {{ indexLabelWithPos }}</p>
        </div>
        <div class="meta">
          <span class="badge">{{ code }} · {{ indexLabelWithPos }} · 份额 T+1</span>
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

    <p v-if="waitingView && !result && !error" class="idle-hint">滚动至此处后加载…</p>

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
          <div class="delta muted">{{ exchangeLabel }}</div>
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
          <div class="range-scroll">
            <el-segmented v-model="range" :options="RANGE_OPTIONS" size="small" />
          </div>
        </div>
      </div>

      <p class="zoom-hint">
        红柱净申购、绿柱净赎回（亿元）；折线为总份额。
        <template v-if="narrow">长按某日可看当日分钟 K（量/额；近 5 日同步进归档可积累）。</template>
        <template v-else>右键某日可看当日分钟 K（量/额；近 5 日同步进归档可积累）。</template>
        优先读本地缓存，日常只补增量。
        <template v-if="result.missingShareCount">
          历史份额仍缺 {{ result.missingShareCount }} 日，可运行
          <code>npm run etf:seed</code> 全量回填。
        </template>
      </p>

      <div
        class="chart-wrap"
        @contextmenu="onChartContextMenu"
        @touchstart.passive="onChartTouchStart"
        @touchmove.passive="onChartTouchMove"
        @touchend="onChartTouchEnd"
        @touchcancel="onChartTouchEnd"
      >
        <v-chart
          ref="chartRef"
          :key="chartInstanceKey"
          class="chart"
          :option="chartOption"
          autoresize
          @datazoom="onDataZoom"
          @updateaxispointer="onAxisPointer"
        />
      </div>

      <div v-if="showGuide" class="guide">
        <button class="guide-toggle" type="button" @click="guideOpen = !guideOpen">
          <span>如何解读</span>
          <el-icon>
            <ArrowUp v-if="guideOpen" />
            <ArrowDown v-else />
          </el-icon>
        </button>
        <p v-show="guideOpen" class="guide-body">
          宽基 ETF 按全天口径估算：净流入 ≈（当日总份额 − 前一日总份额）×
          收盘价。民间常把异常大净申购当作「大资金／国家队」代理，但并非官方标签；也可能含套利、做市与普通机构。沪市份额来自上交所、深市来自深交所，通常
          T+1，当日可能暂缺。本页对齐 20 只热门宽基篮子，每张图标注所属指数。桌面右键 /
          手机长按交易日可查看该日分钟 K（价格 + 成交量/额），与净流入口径无关。
        </p>
      </div>
    </template>
  </el-card>

  <teleport to="body">
    <div
      v-if="ctxMenu.visible"
      class="ctx-menu"
      :class="{ 'ctx-menu--sheet': ctxMenu.sheet }"
      :style="
        ctxMenu.sheet ? undefined : { left: `${ctxMenu.x}px`, top: `${ctxMenu.y}px` }
      "
      @click.stop
      @touchstart.stop
    >
      <button type="button" class="ctx-menu__item" @click="openIntraday">
        当日分钟K
        <span class="ctx-menu__date">{{ formatDisplayDate(ctxMenu.date) }}</span>
      </button>
    </div>
  </teleport>

  <EtfIntradayDialog
    v-model="intradayOpen"
    :date="intradayDate"
    :code="code"
    :name="meta.name"
    :secid="meta.secid"
  />
  </div>
</template>

<style scoped>
.etf-card-root {
  width: min(860px, 100%);
}

.etf-card {
  --el-card-border-color: transparent;
  --el-card-padding: 20px 22px 16px;
  width: 100%;
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
  height: 340px;
  -webkit-touch-callout: none;
  user-select: none;
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

.range-scroll {
  max-width: 100%;
  min-width: 0;
}

@media (max-width: 640px) {
  .etf-card {
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

  .badge {
    font-size: 11px;
    max-width: 100%;
    white-space: normal;
    line-height: 1.4;
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
    height: 260px;
  }

  .zoom-hint {
    font-size: 11px;
  }
}
</style>
