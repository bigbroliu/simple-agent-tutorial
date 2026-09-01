<script setup lang="ts">
/**
 * AgentTrace —— 可视化 Agent 循环的每一步(think / tool_call / tool_result / final)
 * 这是 Demo5+ 的重点:让人"看见"Agent 在想什么、做什么。
 */
import type { AgentEvent } from '../core/agent';

defineProps<{ events: AgentEvent[]; running: boolean }>();
</script>

<template>
  <div class="trace">
    <div v-if="events.length === 0 && !running" class="trace-empty">
      运行后,这里会逐步显示 Agent 的思考与行动轨迹
    </div>

    <div v-for="(e, i) in events" :key="i" class="step" :class="'step-' + e.type">
      <div class="step-icon">
        <span v-if="e.type === 'think'">💭</span>
        <span v-else-if="e.type === 'tool_call'">🔧</span>
        <span v-else-if="e.type === 'tool_result'">📥</span>
        <span v-else-if="e.type === 'final'">✅</span>
        <span v-else>⚠️</span>
      </div>
      <div class="step-body">
        <div class="step-label">
          <template v-if="e.type === 'think'">思考 / 输出</template>
          <template v-else-if="e.type === 'tool_call'">请求调用工具 · {{ e.name }}</template>
          <template v-else-if="e.type === 'tool_result'">工具返回 · {{ e.name }}</template>
          <template v-else-if="e.type === 'final'">最终回答</template>
          <template v-else>出错了</template>
        </div>
        <div class="step-content">
          <template v-if="e.type === 'think' || e.type === 'final'">{{ e.content }}</template>
          <template v-else-if="e.type === 'tool_call'">
            <code class="inline">{{ JSON.stringify(e.args) }}</code>
          </template>
          <template v-else-if="e.type === 'tool_result'">{{ e.result }}</template>
          <template v-else>{{ e.message }}</template>
        </div>
      </div>
    </div>

    <div v-if="running" class="step step-running">
      <div class="step-icon"><span class="spinner" /></div>
      <div class="step-body"><div class="step-content">思考中…</div></div>
    </div>
  </div>
</template>

<style scoped>
.trace {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.trace-empty {
  color: var(--c-text-faint);
  font-size: 13px;
  text-align: center;
  padding: 30px 0;
}
.step {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--c-border);
  background: var(--c-surface);
}
.step-tool_call {
  border-color: #bfdbfe;
  background: #eff6ff;
}
.step-tool_result {
  border-color: #a7f3d0;
  background: var(--c-success-soft);
}
.step-final {
  border-color: var(--c-primary);
  background: var(--c-primary-soft);
}
.step-error {
  border-color: #fecaca;
  background: var(--c-danger-soft);
}
.step-icon {
  flex-shrink: 0;
  font-size: 16px;
  line-height: 1.4;
}
.step-body {
  flex: 1;
  min-width: 0;
}
.step-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--c-text-soft);
  margin-bottom: 3px;
}
.step-content {
  font-size: 13.5px;
  white-space: pre-wrap;
  word-break: break-word;
}
.spinner {
  display: inline-block;
  width: 13px;
  height: 13px;
  border: 2px solid var(--c-border-strong);
  border-top-color: var(--c-primary);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
