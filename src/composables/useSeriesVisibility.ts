import { reactive } from 'vue'

/**
 * 多曲线图例显隐：点击切换；至少保留一条可见，便于坐标轴按可见序列重标度。
 */
export function useSeriesVisibility(keys: readonly string[]) {
  const hidden = reactive(
    Object.fromEntries(keys.map((k) => [k, false])) as Record<string, boolean>,
  )

  function visible(key: string): boolean {
    return !hidden[key]
  }

  function toggle(key: string) {
    if (!hidden[key]) {
      const others = keys.filter((k) => k !== key && !hidden[k]).length
      if (others === 0) return
    }
    hidden[key] = !hidden[key]
  }

  return { hidden, visible, toggle }
}
