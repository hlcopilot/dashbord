<script setup lang="ts">
import EtfFlowSection from '@/components/EtfFlowSection.vue'
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
      <EtfFlowSection />
    </main>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  min-height: 100dvh;
  padding: 40px 24px 64px;
  padding-top: max(40px, env(safe-area-inset-top, 0px));
  padding-right: max(24px, env(safe-area-inset-right, 0px));
  padding-bottom: max(64px, env(safe-area-inset-bottom, 0px));
  padding-left: max(24px, env(safe-area-inset-left, 0px));
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
  line-height: 1.5;
  max-width: 240px;
  text-align: right;
}

.page-main {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  width: 100%;
}

@media (max-width: 640px) {
  .page {
    padding: 20px 12px 40px;
    padding-top: max(20px, env(safe-area-inset-top, 0px));
    padding-right: max(12px, env(safe-area-inset-right, 0px));
    padding-bottom: max(40px, env(safe-area-inset-bottom, 0px));
    padding-left: max(12px, env(safe-area-inset-left, 0px));
  }

  .page-header {
    flex-direction: column;
    align-items: flex-start;
    margin-bottom: 16px;
    gap: 8px;
  }

  .page-header h1 {
    font-size: 22px;
  }

  .subtitle {
    max-width: none;
    text-align: left;
    font-size: 12px;
  }

  .page-main {
    gap: 14px;
  }
}
</style>
