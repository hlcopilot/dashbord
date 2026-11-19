<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Top } from '@element-plus/icons-vue'

const visible = ref(false)
const SHOW_AFTER = 360

function onScroll() {
  visible.value = window.scrollY > SHOW_AFTER
}

function scrollTop() {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
}

onMounted(() => {
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
})
</script>

<template>
  <Transition name="back-top">
    <button
      v-if="visible"
      type="button"
      class="back-top"
      aria-label="回到顶部"
      title="回到顶部"
      @click="scrollTop"
    >
      <el-icon :size="20"><Top /></el-icon>
      <span class="back-top__label">顶部</span>
    </button>
  </Transition>
</template>

<style scoped>
.back-top {
  position: fixed;
  z-index: 40;
  right: max(16px, env(safe-area-inset-right, 0px));
  bottom: max(20px, env(safe-area-inset-bottom, 0px));
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 48px;
  min-height: 48px;
  padding: 8px 10px;
  border: 0;
  border-radius: 14px;
  background: rgba(31, 35, 41, 0.88);
  color: #fff;
  box-shadow: 0 8px 24px rgba(31, 35, 41, 0.22);
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

.back-top:active {
  transform: scale(0.96);
  background: rgba(31, 35, 41, 0.96);
}

.back-top__label {
  font-size: 10px;
  line-height: 1;
  letter-spacing: 0.04em;
}

.back-top-enter-active,
.back-top-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}

.back-top-enter-from,
.back-top-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

@media (min-width: 641px) {
  .back-top {
    right: max(24px, env(safe-area-inset-right, 0px));
    bottom: max(28px, env(safe-area-inset-bottom, 0px));
  }
}

@media (hover: hover) and (pointer: fine) {
  .back-top:hover {
    background: rgba(31, 35, 41, 0.96);
  }
}
</style>
