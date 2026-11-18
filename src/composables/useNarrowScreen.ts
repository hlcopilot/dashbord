import { onBeforeUnmount, onMounted, ref } from 'vue'

/** 与样式断点 640px 对齐，供图表 option 做 H5 适配 */
export function useNarrowScreen(maxWidth = 640) {
  const narrow = ref(false)
  let mq: MediaQueryList | null = null

  function sync() {
    narrow.value = Boolean(mq?.matches)
  }

  onMounted(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    mq = window.matchMedia(`(max-width: ${maxWidth}px)`)
    sync()
    mq.addEventListener('change', sync)
  })

  onBeforeUnmount(() => {
    mq?.removeEventListener('change', sync)
    mq = null
  })

  return narrow
}
