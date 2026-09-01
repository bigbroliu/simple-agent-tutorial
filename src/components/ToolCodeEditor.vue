<script setup lang="ts">
/**
 * ToolCodeEditor —— 在页面上查看并编辑工具的真实代码
 * 每个工具展示:schema(只读,给模型看的说明书)+ run 源码(可编辑)。
 * 编辑保存后写入 localStorage,runTool 会即时使用新版本 —— 改完即生效。
 */
import { ref, computed, watch } from 'vue';
import CodeBlock from './CodeBlock.vue';
import {
  ALL_TOOLS,
  getToolSource,
  setToolSource,
  resetToolSource,
  isToolModified,
  validateToolSource,
} from '../core/tools';

const props = defineProps<{
  /** 只显示这些工具;不传则显示全部 */
  names?: string[];
}>();

const toolNames = computed(() => props.names ?? Object.keys(ALL_TOOLS));

const openName = ref<string | null>(null);
const draft = ref('');
const validationError = ref<string | null>(null);
const savedFlash = ref(false);
// 用一个自增数触发"已修改"标记等的重新计算
const version = ref(0);

function schemaOf(name: string) {
  return JSON.stringify(ALL_TOOLS[name].schema, null, 2);
}
function modified(name: string) {
  void version.value;
  return isToolModified(name);
}

function open(name: string) {
  if (openName.value === name) {
    openName.value = null;
    return;
  }
  openName.value = name;
  draft.value = getToolSource(name);
  validationError.value = null;
  savedFlash.value = false;
}

watch(draft, (src) => {
  validationError.value = validateToolSource(src);
});

function save(name: string) {
  const err = validateToolSource(draft.value);
  if (err) {
    validationError.value = err;
    return;
  }
  setToolSource(name, draft.value);
  version.value++;
  savedFlash.value = true;
  setTimeout(() => (savedFlash.value = false), 1600);
}

function reset(name: string) {
  resetToolSource(name);
  draft.value = getToolSource(name);
  validationError.value = null;
  version.value++;
}

// Tab 键插入两个空格,而不是切换焦点(代码编辑体验)
function handleTab(e: KeyboardEvent) {
  const t = e.target as HTMLTextAreaElement;
  const s = t.selectionStart;
  draft.value = draft.value.slice(0, s) + '  ' + draft.value.slice(t.selectionEnd);
  requestAnimationFrame(() => {
    t.selectionStart = t.selectionEnd = s + 2;
  });
}
</script>

<template>
  <section class="editor">
    <div class="editor-head">
      <span class="editor-title">🔧 工具代码(可编辑)</span>
      <span class="editor-sub">这就是工具真正执行的 run 函数。改它,保存后立即在上面的运行中生效。</span>
    </div>

    <div v-for="name in toolNames" :key="name" class="tool" :class="{ open: openName === name }">
      <button class="tool-row" @click="open(name)">
        <span class="tool-caret">{{ openName === name ? '▾' : '▸' }}</span>
        <code class="tool-name">{{ name }}</code>
        <span class="tool-desc">{{ ALL_TOOLS[name].schema.function.description }}</span>
        <span v-if="modified(name)" class="tool-badge">已修改</span>
      </button>

      <div v-if="openName === name" class="tool-body">
        <div class="block-label">给模型看的 schema(只读)</div>
        <CodeBlock lang="json" :code="schemaOf(name)" />

        <div class="block-label" style="margin-top: 12px">
          run 函数源码(可编辑)—— 必须是一个函数表达式
        </div>
        <textarea
          v-model="draft"
          class="code-edit"
          spellcheck="false"
          rows="12"
          @keydown.tab.prevent="handleTab"
        />

        <div v-if="validationError" class="val-err">⚠️ 语法错误:{{ validationError }}</div>

        <div class="tool-actions">
          <button
            class="btn btn-primary btn-sm"
            :disabled="!!validationError"
            @click="save(name)"
          >
            {{ savedFlash ? '✓ 已保存,已生效' : '保存并生效' }}
          </button>
          <button class="btn btn-sm" :disabled="!modified(name)" @click="reset(name)">
            还原默认
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.editor {
  margin-top: 20px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  background: var(--c-surface);
  overflow: hidden;
}
.editor-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 14px;
  background: var(--c-bg);
  border-bottom: 1px solid var(--c-border);
}
.editor-title {
  font-size: 13px;
  font-weight: 700;
}
.editor-sub {
  font-size: 11.5px;
  color: var(--c-text-faint);
}
.tool {
  border-bottom: 1px solid var(--c-border);
}
.tool:last-child {
  border-bottom: none;
}
.tool-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.tool-row:hover {
  background: var(--c-bg);
}
.tool.open .tool-row {
  background: var(--c-primary-soft);
}
.tool-caret {
  color: var(--c-text-faint);
  flex-shrink: 0;
}
.tool-name {
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 13px;
  color: var(--c-primary-hover);
  flex-shrink: 0;
}
.tool-desc {
  font-size: 12px;
  color: var(--c-text-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.tool-badge {
  flex-shrink: 0;
  font-size: 10.5px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--c-warn-soft);
  color: #92400e;
  font-weight: 600;
}
.tool-body {
  padding: 12px 14px 14px;
  background: #fbfbfd;
  border-top: 1px solid var(--c-border);
}
.block-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--c-text-soft);
  margin-bottom: 6px;
}
.code-edit {
  width: 100%;
  box-sizing: border-box;
  padding: 12px;
  border: 1px solid var(--c-border-strong);
  border-radius: var(--radius-sm);
  background: #0f172a;
  color: #e2e8f0;
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.55;
  resize: vertical;
  tab-size: 2;
}
.code-edit:focus {
  outline: none;
  border-color: var(--c-primary);
}
.val-err {
  margin-top: 8px;
  padding: 8px 10px;
  background: var(--c-danger-soft);
  border: 1px solid #fecaca;
  border-radius: var(--radius-sm);
  color: var(--c-danger);
  font-size: 12px;
  font-family: var(--font-mono);
  white-space: pre-wrap;
  word-break: break-word;
}
.tool-actions {
  margin-top: 10px;
  display: flex;
  gap: 8px;
}
</style>
