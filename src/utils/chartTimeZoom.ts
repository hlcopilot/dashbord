/**
 * 日频图统一的时间轴缩放（成交额 / 两融为基准体验）
 * 后续所有带时间轴的主图必须用这里的 dataZoom / toolbox，禁止各自再写一套瘦 slider。
 */

export const CHART_TIME_ZOOM_GRID_BOTTOM = 72

const HANDLE_ICON = 'path://M6,0 A6,6 0 1,1 6,12 A6,6 0 1,1 6,0 Z'

export type TimeZoomOpts = {
  start: number
  end: number
  /** 滑块阴影/手柄强调色，默认交互蓝 */
  accentColor?: string
  left?: number
  right?: number
  /** toolbox 强调色，默认与 accent 一致 */
  toolboxAccent?: string
}

/** inside + 底部圆柄 slider（高 36、可滚轮/拖移、数据阴影） */
export function buildTimeAxisDataZoom(opts: TimeZoomOpts) {
  const accent = opts.accentColor ?? '#3b82f6'
  const left = opts.left ?? 48
  const right = opts.right ?? 48
  return [
    {
      type: 'inside' as const,
      xAxisIndex: 0,
      start: opts.start,
      end: opts.end,
      zoomOnMouseWheel: true,
      moveOnMouseMove: true,
      moveOnMouseWheel: false,
      preventDefaultMouseMove: true,
      brushSelect: true,
    },
    {
      type: 'slider' as const,
      xAxisIndex: 0,
      start: opts.start,
      end: opts.end,
      height: 36,
      bottom: 8,
      left,
      right,
      borderColor: '#e5e7eb',
      backgroundColor: '#f8fafc',
      fillerColor: 'rgba(59, 130, 246, 0.18)',
      handleIcon: HANDLE_ICON,
      handleSize: 12,
      handleStyle: {
        color: '#fff',
        borderColor: accent,
        borderWidth: 1.5,
        shadowBlur: 2,
        shadowColor: 'rgba(59, 130, 246, 0.2)',
      },
      moveHandleSize: 0,
      showDetail: false,
      showDataShadow: true,
      dataBackground: {
        lineStyle: { color: accent, width: 1, opacity: 0.55 },
        areaStyle: { color: accent, opacity: 0.12 },
      },
      selectedDataBackground: {
        lineStyle: { color: accent, width: 1.2 },
        areaStyle: { color: accent, opacity: 0.2 },
      },
      brushSelect: false,
      filterMode: 'filter' as const,
    },
  ]
}

/** 右上角「框选时段 / 回退缩放」 */
export function buildTimeAxisToolbox(opts?: { accentColor?: string }) {
  const accent = opts?.accentColor ?? '#3b82f6'
  return {
    right: 4,
    top: 0,
    itemSize: 13,
    iconStyle: { borderColor: '#6b7280' },
    emphasis: { iconStyle: { borderColor: accent } },
    feature: {
      dataZoom: {
        yAxisIndex: 'none' as const,
        brushStyle: { color: 'rgba(59, 130, 246, 0.12)', borderWidth: 0 },
        title: { zoom: '框选时段', back: '回退缩放' },
      },
    },
  }
}
