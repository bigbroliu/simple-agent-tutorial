<script setup lang="ts">
/** 当未配置模型时的统一提示 */
import { useActiveModel } from './useActiveModel';
const { active } = useActiveModel();
</script>

<template>
  <div v-if="!active" class="no-model">
    ⚠️ 还没有可用的模型。请先到
    <RouterLink to="/config">「模型配置中心」</RouterLink>
    添加并选中一个模型。
  </div>
</template>

<style scoped>
.no-model {
  padding: 12px 16px;
  background: var(--c-warn-soft);
  border: 1px solid #fde68a;
  border-radius: var(--radius-sm);
  color: #92400e;
  font-size: 13.5px;
}
</style>
