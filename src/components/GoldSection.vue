<script setup lang="ts">
import EtfNetFlowCard from '@/components/EtfNetFlowCard.vue'
import GoldPriceCard from '@/components/GoldPriceCard.vue'
import LondonGoldCard from '@/components/LondonGoldCard.vue'
import ShanghaiGoldCard from '@/components/ShanghaiGoldCard.vue'
import { GOLD_ETF_CODE } from '@/etfUniverse'
</script>

<template>
  <section class="gold-section">
    <header class="section-header">
      <div>
        <h2 class="section-title">黄金观察</h2>
        <p class="section-desc">
          国内：上海金 / Au9999（元/克）；国际：伦敦金 XAU（美元/盎司）单独成图；另挂 518880 ETF
          与申赎净流入。
        </p>
      </div>
    </header>

    <ShanghaiGoldCard />
    <LondonGoldCard />
    <GoldPriceCard />
    <EtfNetFlowCard :code="GOLD_ETF_CODE" :show-guide="true" />
  </section>
</template>

<style scoped>
.gold-section {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
}

.section-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.section-desc {
  margin: 6px 0 0;
  color: #8a919f;
  font-size: 13px;
  line-height: 1.5;
}

@media (max-width: 640px) {
  .gold-section {
    gap: 12px;
  }

  .section-title {
    font-size: 18px;
  }

  .section-desc {
    font-size: 12px;
  }
}
</style>
