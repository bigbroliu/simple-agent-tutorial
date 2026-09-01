<script setup lang="ts">
import { RouterView, useRoute } from 'vue-router';
import { computed } from 'vue';
import { DEMOS } from './demos/registry';
import { useActiveModel } from './components/useActiveModel';

const route = useRoute();
const { active } = useActiveModel();

const currentId = computed(() => route.path.replace('/', '') || 'config');
</script>

<template>
  <div class="layout">
    <!-- 左侧阶段导航 -->
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-title">前端 · Agent 开发</div>
        <div class="brand-sub">从一行调用到会思考的 Agent</div>
      </div>

      <nav class="nav">
        <RouterLink
          v-for="d in DEMOS"
          :key="d.id"
          :to="'/' + d.id"
          class="nav-item"
          :class="{ active: currentId === d.id }"
        >
          <span class="nav-order">{{ d.order }}</span>
          <span class="nav-text">
            <span class="nav-title">{{ d.title }}</span>
            <span class="nav-concept">{{ d.concept }}</span>
          </span>
        </RouterLink>
      </nav>

      <!-- 当前模型指示 -->
      <div class="active-model">
        <div class="active-model-label">当前模型</div>
        <RouterLink to="/config" class="active-model-value">
          <template v-if="active">
            <span class="dot-live" />
            {{ active.label }}
            <span class="active-model-name">{{ active.model }}</span>
          </template>
          <template v-else>
            <span class="dot-off" />
            未配置,点此设置
          </template>
        </RouterLink>
      </div>
    </aside>

    <!-- 右侧内容 -->
    <main class="content">
      <!-- KeepAlive:缓存各 Demo 实例,切章节时保留已填内容与运行结果 -->
      <RouterView v-slot="{ Component }">
        <KeepAlive>
          <component :is="Component" />
        </KeepAlive>
      </RouterView>
    </main>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  height: 100%;
}
.sidebar {
  width: 260px;
  flex-shrink: 0;
  background: var(--c-surface);
  border-right: 1px solid var(--c-border);
  display: flex;
  flex-direction: column;
}
.brand {
  padding: 20px 20px 16px;
  border-bottom: 1px solid var(--c-border);
}
.brand-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--c-text);
}
.brand-sub {
  margin-top: 2px;
  font-size: 12px;
  color: var(--c-text-faint);
}
.nav {
  flex: 1;
  overflow-y: auto;
  padding: 10px 10px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: var(--radius-sm);
  color: var(--c-text);
  margin-bottom: 2px;
  transition: background 0.12s;
}
.nav-item:hover {
  background: var(--c-bg);
}
.nav-item.active {
  background: var(--c-primary-soft);
}
.nav-item.active .nav-title {
  color: var(--c-primary-hover);
  font-weight: 600;
}
.nav-order {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  background: var(--c-bg);
  color: var(--c-text-soft);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
}
.nav-item.active .nav-order {
  background: var(--c-primary);
  color: #fff;
}
.nav-text {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}
.nav-title {
  font-size: 13.5px;
}
.nav-concept {
  font-size: 11px;
  color: var(--c-text-faint);
}
.active-model {
  padding: 14px 16px;
  border-top: 1px solid var(--c-border);
}
.active-model-label {
  font-size: 11px;
  color: var(--c-text-faint);
  margin-bottom: 6px;
}
.active-model-value {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 600;
  color: var(--c-text);
}
.active-model-name {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 400;
  color: var(--c-text-faint);
}
.dot-live {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--c-success);
  box-shadow: 0 0 0 3px var(--c-success-soft);
}
.dot-off {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--c-text-faint);
}
.content {
  flex: 1;
  overflow: hidden;
}
</style>
