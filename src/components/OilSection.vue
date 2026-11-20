<script setup lang="ts">
import OilPriceCard from '@/components/OilPriceCard.vue'
</script>

<template>
  <section class="oil-section">
    <header class="section-header">
      <div>
        <h2 class="section-title">石油观察</h2>
        <p class="section-desc">
          国际原油：布伦特与 WTI 同轴（美元/桶），叠美元指数。
        </p>
      </div>
    </header>

    <OilPriceCard />
  </section>
</template>

<style scoped>
.oil-section {
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
  .oil-section {
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
