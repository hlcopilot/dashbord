<script setup lang="ts">
import StylePeRatioCard from '@/components/StylePeRatioCard.vue'
import StylePriceRatioCard from '@/components/StylePriceRatioCard.vue'
</script>

<template>
  <section class="style-section">
    <header class="section-header">
      <div>
        <h2 class="section-title">风格观察</h2>
        <p class="section-desc">
          成长 vs 红利：创业板指 / 中证红利点位比（日频）与 TTM PE 估值比（月频）。
        </p>
      </div>
    </header>

    <StylePriceRatioCard />
    <StylePeRatioCard />
  </section>
</template>

<style scoped>
.style-section {
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
  .style-section {
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
