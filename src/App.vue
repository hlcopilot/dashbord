<script setup lang="ts">
import MarginBalanceCard from '@/components/MarginBalanceCard.vue'
import TurnoverPercentileCard from '@/components/TurnoverPercentileCard.vue'
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <p class="eyebrow">Investment Board</p>
        <h1>A股投资看板</h1>
      </div>
      <p class="subtitle">打开页面自动拉取最新可获取的交易日数据</p>
    </header>

    <main class="page-main">
      <TurnoverPercentileCard />
      <MarginBalanceCard />
    </main>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 40px 24px 64px;
}

.page-header {
  width: min(860px, 100%);
  margin: 0 auto 24px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}

.eyebrow {
  margin: 0 0 6px;
  color: #8a919f;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.page-header h1 {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.subtitle {
  margin: 0;
  color: #8a919f;
  font-size: 13px;
}

.page-main {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
}

@media (max-width: 640px) {
  .page {
    padding: 24px 14px 48px;
  }

  .page-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .page-header h1 {
    font-size: 24px;
  }
}
</style>
