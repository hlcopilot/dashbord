import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

type ChartPixelApi = {
  containPixel?: (finder: string, value: number[]) => boolean
  convertFromPixel?: (finder: object, value: number[]) => number[]
  getDom?: () => HTMLElement
}

export type ChartDayMenuState = {
  visible: boolean
  x: number
  y: number
  date: string
  sheet: boolean
}

type DayPoint = { date: string }

const LONG_PRESS_MS = 480
const LONG_PRESS_MOVE_PX = 12

/**
 * 日频主图：桌面右键 / 窄屏长按 → 选中交易日菜单（成交额分时、ETF 分钟 K 共用）
 */
export function useChartDayMenu(opts: {
  narrow: Ref<boolean>
  rangedSeries: Ref<DayPoint[]>
  /** vue-echarts 实例（含 getDom / containPixel） */
  chartRef: Ref<unknown>
  hoverIndex: Ref<number>
}) {
  const ctxMenu = ref<ChartDayMenuState>({
    visible: false,
    x: 0,
    y: 0,
    date: '',
    sheet: false,
  })

  let suppressCtxCloseUntil = 0
  let longPressTimer: ReturnType<typeof setTimeout> | null = null
  let longPressStart = { x: 0, y: 0 }

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

  function resolveDateAtClientPoint(clientX: number, clientY: number): string | null {
    const list = opts.rangedSeries.value
    if (!list.length) return null

    let idx = opts.hoverIndex.value
    const chart = opts.chartRef.value as ChartPixelApi | null
    const dom = chart?.getDom?.()
    if (chart?.containPixel && chart.convertFromPixel && dom) {
      const rect = dom.getBoundingClientRect()
      const point = [clientX - rect.left, clientY - rect.top]
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
    openCtxMenuAt(e.clientX, e.clientY, opts.narrow.value)
  }

  function onChartTouchStart(e: TouchEvent) {
    if (!opts.narrow.value) return
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

  function hideMenu() {
    suppressCtxCloseUntil = 0
    ctxMenu.value.visible = false
  }

  onMounted(() => {
    window.addEventListener('click', closeCtxMenu)
    window.addEventListener('scroll', closeCtxMenu, true)
    window.addEventListener('touchstart', closeCtxMenu, { passive: true })
  })

  onBeforeUnmount(() => {
    clearLongPressTimer()
    window.removeEventListener('click', closeCtxMenu)
    window.removeEventListener('scroll', closeCtxMenu, true)
    window.removeEventListener('touchstart', closeCtxMenu)
  })

  return {
    ctxMenu,
    closeCtxMenu,
    hideMenu,
    onChartContextMenu,
    onChartTouchStart,
    onChartTouchMove,
    onChartTouchEnd,
  }
}
