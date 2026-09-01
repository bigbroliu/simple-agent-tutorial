<script setup lang="ts">
/**
 * SourceViewer —— 展示某个 Demo 背后【纯 Agent 运行时】的真实源码
 *
 * 用 Vite 的 import.meta.glob('...?raw') 把 core/ 下 TS 源文件的原始文本在构建时打包进来,
 * 所以显示的永远是项目里真正在跑的代码,不是手抄片段,不会过时。
 * 只收录与 Agent 逻辑相关的 .ts(对话、工具、循环、适配器等),
 * 不含 Vue 交互层,也不含仅本地开发用的代理(net.ts)与页面检查器(inspector.ts)。
 */
import { ref, computed } from 'vue';
import CodeBlock from './CodeBlock.vue';

const props = defineProps<{
  /** 相对 src/ 的文件路径,如 ['core/llm.ts', 'core/adapters.ts'] */
  files: string[];
  /** 折叠标题,默认统一文案 */
  title?: string;
}>();

// 把 core 下的 ts 源码作为原始文本引入(eager:直接拿到字符串)
const RAW = import.meta.glob('../core/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// glob 的 key 形如 '../core/llm.ts';把用户给的 'core/llm.ts' 映射过去
function keyFor(rel: string): string {
  return `../${rel}`;
}

const open = ref(false);
const activeFile = ref(props.files[0] ?? '');

const activeCode = computed(() => {
  const code = RAW[keyFor(activeFile.value)];
  return code ?? `// 未找到源码文件:${activeFile.value}`;
});

function lineCount(path: string): number {
  const c = RAW[keyFor(path)];
  return c ? c.split('\n').length : 0;
}
function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}
</script>

<template>
  <section class="src">
    <button class="src-head" @click="open = !open">
      <span class="src-caret">{{ open ? '▾' : '▸' }}</span>
      <span class="src-title">{{ title ?? '📄 查看核心 Agent 源码(纯 TS)' }}</span>
      <span class="src-count">{{ files.length }} 个文件</span>
    </button>

    <div v-if="open" class="src-body">
      <div class="tabs">
        <button
          v-for="f in files"
          :key="f"
          class="tab"
          :class="{ on: activeFile === f }"
          @click="activeFile = f"
        >
          {{ baseName(f) }}
          <span class="tab-lines">{{ lineCount(f) }}行</span>
        </button>
      </div>
      <div class="path">src/{{ activeFile }}</div>
      <CodeBlock :code="activeCode" lang="ts" />
    </div>
  </section>
</template>

<style scoped>
.src {
  margin-top: 20px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  background: var(--c-surface);
  overflow: hidden;
}
.src-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 14px;
  border: none;
  background: var(--c-bg);
  text-align: left;
  cursor: pointer;
}
.src-head:hover {
  background: var(--c-border);
}
.src-caret {
  color: var(--c-text-faint);
}
.src-title {
  font-size: 13px;
  font-weight: 700;
  flex: 1;
}
.src-count {
  font-size: 11.5px;
  color: var(--c-text-faint);
}
.src-body {
  padding: 12px 14px 14px;
  border-top: 1px solid var(--c-border);
}
.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  border: 1px solid var(--c-border-strong);
  border-radius: 999px;
  background: var(--c-surface);
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--c-text-soft);
  cursor: pointer;
}
.tab:hover {
  border-color: var(--c-primary);
  color: var(--c-primary);
}
.tab.on {
  background: var(--c-primary);
  border-color: var(--c-primary);
  color: #fff;
}
.tab-lines {
  font-size: 10px;
  opacity: 0.7;
}
.path {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--c-text-faint);
  margin-bottom: 6px;
}
</style>
