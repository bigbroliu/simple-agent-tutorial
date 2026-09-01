<script setup lang="ts">
/**
 * RequestInspector —— 内联请求查看器(放在各 Demo 运行区下方)
 * 展示【本 Demo】每一次发给大模型的请求核心数据:
 * 模型、目标地址、method、脱敏后的头、请求体、流式与否、HTTP 状态、耗时。
 * 让"我到底发了什么"就在操作旁边、肉眼可见。
 */
import { ref, computed, watch } from 'vue';
import { useRequestLogs } from './useRequestLogs';
import { clearRequestLogs, type RequestLog } from '../core/inspector';
import CodeBlock from './CodeBlock.vue';

const props = defineProps<{ tag: string }>();

const { logs } = useRequestLogs(props.tag);
const openId = ref<string | null>(null);

// 有新请求时自动展开最新一条,方便边发边看
watch(
  () => logs.value[0]?.id,
  (id) => {
    if (id) openId.value = id;
  },
);

const hasLogs = computed(() => logs.value.length > 0);

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
}
function statusText(l: RequestLog) {
  if (l.status === 'pending') return '进行中…';
  if (l.status === 'error') return `失败${l.httpStatus ? ' ' + l.httpStatus : ''}`;
  return `成功 ${l.httpStatus ?? ''}`;
}
function toggle(id: string) {
  openId.value = openId.value === id ? null : id;
}
function headersPreview(l: RequestLog) {
  return Object.entries(l.headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}
</script>

<template>
  <section class="inspector">
    <div class="insp-head">
      <span class="insp-title">🛰️ 本次请求的核心数据</span>
      <span class="insp-sub">每次发送都会记录在这里(鉴权已脱敏)</span>
      <button v-if="hasLogs" class="btn btn-sm insp-clear" @click="clearRequestLogs(props.tag)">
        清空
      </button>
    </div>

    <div v-if="!hasLogs" class="insp-empty">
      还没有请求。在上方发送一次,这里会实时显示发出去的 URL、请求头和请求体。
    </div>

    <ul v-else class="log-list">
      <li v-for="l in logs" :key="l.id" class="log" :class="{ open: openId === l.id }">
        <button class="log-row" @click="toggle(l.id)">
          <span class="log-dot" :class="'d-' + l.status" />
          <span class="log-method">{{ l.method }}</span>
          <span v-if="l.stream" class="mini-tag">流式</span>
          <span class="log-model">{{ l.modelLabel }}</span>
          <span class="log-status" :class="'t-' + l.status">{{ statusText(l) }}</span>
          <span class="log-meta">
            {{ fmtTime(l.startedAt) }}<template v-if="l.durationMs != null"> · {{ l.durationMs }}ms</template>
          </span>
          <span class="log-caret">{{ openId === l.id ? '▾' : '▸' }}</span>
        </button>

        <div v-if="openId === l.id" class="log-detail">
          <div class="kv">
            <span class="kv-k">目标</span>
            <span class="mono">{{ l.method }} {{ l.targetUrl }}</span>
          </div>
          <div v-if="l.viaProxy" class="kv">
            <span class="kv-k">链路</span>
            <span class="proxy-note">浏览器 → 本地 /llm-proxy → 上游(开发期代理,绕过 CORS)</span>
          </div>

          <div class="detail-block">
            <div class="detail-label">请求头</div>
            <CodeBlock lang="ts" :code="headersPreview(l)" />
          </div>
          <div class="detail-block">
            <div class="detail-label">请求体</div>
            <CodeBlock lang="json" :code="JSON.stringify(l.body, null, 2)" />
          </div>
          <div v-if="l.error" class="detail-block">
            <div class="detail-label err-label">错误信息</div>
            <div class="err-text">{{ l.error }}</div>
          </div>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.inspector {
  margin-top: 20px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  background: var(--c-surface);
  overflow: hidden;
}
.insp-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--c-bg);
  border-bottom: 1px solid var(--c-border);
}
.insp-title {
  font-size: 13px;
  font-weight: 700;
}
.insp-sub {
  font-size: 11.5px;
  color: var(--c-text-faint);
}
.insp-clear {
  margin-left: auto;
}
.insp-empty {
  padding: 16px 14px;
  font-size: 12.5px;
  color: var(--c-text-faint);
}
.log-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.log {
  border-bottom: 1px solid var(--c-border);
}
.log:last-child {
  border-bottom: none;
}
.log-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  border: none;
  background: transparent;
  text-align: left;
  font-size: 12.5px;
}
.log-row:hover {
  background: var(--c-bg);
}
.log.open .log-row {
  background: var(--c-primary-soft);
}
.log-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.d-pending {
  background: var(--c-warn);
  animation: pulse 1s ease-in-out infinite;
}
.d-done {
  background: var(--c-success);
}
.d-error {
  background: var(--c-danger);
}
@keyframes pulse {
  50% {
    opacity: 0.3;
  }
}
.log-method {
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--c-text-soft);
}
.mini-tag {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--c-info-soft);
  color: var(--c-info);
}
.log-model {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.log-status {
  font-weight: 500;
}
.t-pending {
  color: var(--c-warn);
}
.t-done {
  color: var(--c-success);
}
.t-error {
  color: var(--c-danger);
}
.log-meta {
  margin-left: auto;
  font-size: 11px;
  color: var(--c-text-faint);
  font-family: var(--font-mono);
  white-space: nowrap;
}
.log-caret {
  color: var(--c-text-faint);
  flex-shrink: 0;
}
.log-detail {
  padding: 12px 14px 14px;
  background: #fbfbfd;
  border-top: 1px solid var(--c-border);
}
.kv {
  display: flex;
  gap: 10px;
  font-size: 12.5px;
  margin-bottom: 6px;
  line-height: 1.5;
}
.kv-k {
  flex-shrink: 0;
  width: 40px;
  color: var(--c-text-faint);
}
.mono {
  font-family: var(--font-mono);
  font-size: 12px;
  word-break: break-all;
}
.proxy-note {
  font-size: 12px;
  color: var(--c-text-soft);
}
.detail-block {
  margin-top: 12px;
}
.detail-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--c-text-soft);
  margin-bottom: 6px;
}
.err-label {
  color: var(--c-danger);
}
.err-text {
  padding: 10px 12px;
  background: var(--c-danger-soft);
  border: 1px solid #fecaca;
  border-radius: var(--radius-sm);
  color: var(--c-danger);
  font-size: 12.5px;
  font-family: var(--font-mono);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
