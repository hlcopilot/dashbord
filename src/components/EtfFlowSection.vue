<script setup lang="ts">
import { computed, ref } from 'vue'
import EtfBasketCumulativeCard from '@/components/EtfBasketCumulativeCard.vue'
import EtfNetFlowCard from '@/components/EtfNetFlowCard.vue'
import {
  ETF_UNIVERSE,
  formatIndexWithPosition,
  listEtfIndexNames,
  listEtfsByIndex,
} from '@/etfUniverse'

const indexFilter = ref<'all' | string>('all')

const indexOptions = computed(() => [
  { label: `全部 ${ETF_UNIVERSE.length}`, value: 'all' },
  ...listEtfIndexNames().map((name) => {
    const count = listEtfsByIndex(name).length
    return {
      label: `${formatIndexWithPosition(name)} · ${count}`,
      value: name,
    }
  }),
])

const etfs = computed(() => listEtfsByIndex(indexFilter.value))
</script>

<template>
  <section class="etf-section">
    <header class="section-header">
      <div>
        <h2 class="section-title">20 只宽基 ETF 净流入</h2>
        <p class="section-desc">
          顶部为篮子区间累计（悬停看 9 个指数分解）；下方单卡为申赎柱 + 份额线。进入视口后加载，并发受限。
        </p>
      </div>
      <el-select
        v-model="indexFilter"
        size="small"
        class="index-filter"
        placeholder="按指数筛选单卡"
        fit-input-width
      >
        <el-option
          v-for="opt in indexOptions"
          :key="opt.value"
          :label="opt.label"
          :value="opt.value"
        />
      </el-select>
    </header>

    <EtfBasketCumulativeCard />

    <div class="etf-list">
      <EtfNetFlowCard
        v-for="(etf, i) in etfs"
        :key="etf.code"
        :code="etf.code"
        :show-guide="i === 0"
      />
    </div>
  </section>
</template>

<style scoped>
.etf-section {
  width: min(860px, 100%);
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

.index-filter {
  width: min(280px, 100%);
  flex-shrink: 0;
}

.etf-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

@media (max-width: 640px) {
  .etf-section {
    gap: 12px;
  }

  .section-header {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .section-title {
    font-size: 18px;
  }

  .section-desc {
    font-size: 12px;
  }

  .index-filter {
    width: 100%;
  }

  .etf-list {
    gap: 14px;
  }
}
</style>
