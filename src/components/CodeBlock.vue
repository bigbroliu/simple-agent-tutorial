<script setup lang="ts">
/**
 * CodeBlock —— 带语法高亮的代码展示组件
 * 用 highlight.js(打包进产物,不依赖 CDN)做高亮;深色底、等宽字体。
 * 长行自动换行,不出现横向滚动条,保证不撑破容器。
 */
import { computed } from 'vue';
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';

hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('json', json);

const props = defineProps<{
  code: string;
  lang?: string;
  title?: string;
}>();

const highlighted = computed(() => {
  const lang = props.lang && hljs.getLanguage(props.lang) ? props.lang : 'ts';
  try {
    return hljs.highlight(props.code, { language: lang }).value;
  } catch {
    // 高亮失败时退回纯文本(转义,避免注入)
    return props.code.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  }
});
</script>

<template>
  <div class="code-block">
    <div v-if="title" class="code-title">
      <span class="dot" /><span class="dot" /><span class="dot" />
      <span class="code-title-text">{{ title }}</span>
    </div>
    <pre class="code"><code class="hljs" v-html="highlighted" /></pre>
  </div>
</template>

<style scoped>
.code-block {
  border-radius: var(--radius-sm);
  overflow: hidden;
  border: 1px solid #334155;
  max-width: 100%;
}
.code-title {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: #0f172a;
  border-bottom: 1px solid #334155;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #475569;
}
.code-title-text {
  margin-left: 8px;
  color: #94a3b8;
  font-family: var(--font-mono);
  font-size: 12px;
}
.code-block pre.code {
  margin: 0;
  padding: 16px;
  background: #1e293b;
  border-radius: 0;
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.65;
  /* 关键:长行自动换行,不出现横向滚动条 */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.code-block pre.code code {
  font-family: inherit;
  background: none;
  padding: 0;
}
</style>
