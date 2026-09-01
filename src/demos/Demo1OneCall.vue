<script setup lang="ts">
/**
 * Demo 1 —— 一行调用
 * 教学目标:剥开 SDK,一次非流式调用就是 fetch,看清请求体/响应体。
 */
import { ref } from 'vue';
import DemoLayout from '../components/DemoLayout.vue';
import CodeBlock from '../components/CodeBlock.vue';
import NoModelHint from '../components/NoModelHint.vue';
import RequestInspector from '../components/RequestInspector.vue';
import SourceViewer from '../components/SourceViewer.vue';
import { chatCompletion } from '../core/llm';
import { setActiveTag } from '../core/inspector';
import { useActiveModel } from '../components/useActiveModel';

const { active } = useActiveModel();

const prompt = ref('用一句话介绍你自己');
const answer = ref('');
const loading = ref(false);
const errmsg = ref('');
const rawResp = ref('');

async function run() {
  if (!active.value) return;
  setActiveTag('demo1');
  loading.value = true;
  answer.value = '';
  errmsg.value = '';
  rawResp.value = '';

  const messages = [{ role: 'user' as const, content: prompt.value }];

  try {
    const msg = await chatCompletion(active.value, messages);
    answer.value = msg.content ?? '';
    rawResp.value = JSON.stringify(msg, null, 2);
  } catch (e: any) {
    errmsg.value = e?.message ?? String(e);
  } finally {
    loading.value = false;
  }
}

const sourceCode = `// core/llm.ts —— 一次非流式调用的核心
export async function chatCompletion(cfg, messages) {
  const { url, init } = getAdapter(cfg).buildRequest(cfg, { messages });
  // ① 发请求
  const resp = await fetch(url, init);
  if (!resp.ok) throw new Error(await resp.text());
  // ② 拿 JSON
  const json = await resp.json();
  // ③ 取出 assistant 消息
  return getAdapter(cfg).parseResponse(json).message;
}`;
</script>

<template>
  <DemoLayout demo-id="one-call">
    <template #whatsnew>
      一切的起点:用一个 <code class="inline">fetch</code> 把消息发给模型,拿回一条回复。没有记忆、没有流式、没有工具。
    </template>

    <template #playground>
      <NoModelHint />
      <label class="field-label">你的问题</label>
      <textarea v-model="prompt" class="textarea" rows="2" />
      <button class="btn btn-primary" style="margin-top: 10px" :disabled="loading || !active" @click="run">
        {{ loading ? '请求中…' : '发送一次请求' }}
      </button>

      <div v-if="errmsg" class="err">{{ errmsg }}</div>

      <div v-if="answer" class="answer">
        <div class="answer-label">模型回复</div>
        <div class="answer-body">{{ answer }}</div>
      </div>

      <div v-if="rawResp" class="raw">
        <div class="raw-label">解析后的 assistant 消息(响应)</div>
        <CodeBlock lang="json" :code="rawResp" />
      </div>

      <RequestInspector tag="demo1" />

      <SourceViewer :files="['core/llm.ts', 'core/adapters.ts', 'core/types.ts']" />
    </template>

    <template #explain>
      <h3 class="sec-title">"调用大模型"没有魔法</h3>
      <p class="para">
        无论 LangChain 还是官方 SDK,底层都是这一个 HTTP 请求。看清它,你就不会被各种封装绕晕。
        请求里最关键的就是 <code class="inline">messages</code> 数组 —— 它是你和模型之间唯一的信息载体。
      </p>
      <CodeBlock title="core/llm.ts" lang="ts" :code="sourceCode" />
      <ul class="points">
        <li>请求是<b>无状态</b>的:模型不记得上一次问了什么,所以"记忆"需要我们自己来做。</li>
        <li>响应里的 <code class="inline">message</code> 就是模型这一轮的产出,后面会看到它还能带 <code class="inline">tool_calls</code>。</li>
      </ul>
    </template>
  </DemoLayout>
</template>

<style scoped>
.field-label {
  display: block;
  font-size: 12.5px;
  color: var(--c-text-soft);
  font-weight: 500;
  margin: 14px 0 5px;
}
.err {
  margin-top: 12px;
  padding: 10px 12px;
  background: var(--c-danger-soft);
  border: 1px solid #fecaca;
  border-radius: var(--radius-sm);
  color: var(--c-danger);
  font-size: 13px;
  white-space: pre-wrap;
}
.answer {
  margin-top: 16px;
  padding: 14px;
  background: var(--c-primary-soft);
  border-radius: var(--radius-sm);
}
.answer-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--c-primary);
  margin-bottom: 6px;
}
.answer-body {
  font-size: 14px;
  white-space: pre-wrap;
}
.raw {
  margin-top: 16px;
}
.raw-label {
  font-size: 12px;
  color: var(--c-text-soft);
  margin-bottom: 6px;
  font-weight: 500;
}
.sec-title {
  font-size: 15px;
  font-weight: 700;
  margin: 0 0 8px;
}
.para {
  font-size: 13.5px;
  margin: 0 0 12px;
}
.points {
  margin: 14px 0 0;
  padding-left: 18px;
  font-size: 13.5px;
}
.points li {
  margin-bottom: 6px;
}
</style>
