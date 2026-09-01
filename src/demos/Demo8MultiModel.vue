<script setup lang="ts">
/**
 * Demo 8 —— 多模型兼容
 * 教学目标:同一段业务代码,在不同厂商模型间无缝切换。
 * 秘密全在适配层(core/adapters.ts):把差异关进 Adapter,上层只面向统一接口。
 */
import { ref } from 'vue';
import DemoLayout from '../components/DemoLayout.vue';
import CodeBlock from '../components/CodeBlock.vue';
import RequestInspector from '../components/RequestInspector.vue';
import SourceViewer from '../components/SourceViewer.vue';
import { loadConfigs, type ModelConfig } from '../core/config';
import { chatCompletion } from '../core/llm';
import { setActiveTag } from '../core/inspector';

const prompt = ref('用一句话解释什么是"适配器模式",并说出你是哪个模型。');
const configs = ref<ModelConfig[]>(loadConfigs());

interface RunResult {
  id: string;
  label: string;
  protocol: string;
  loading: boolean;
  content: string;
  error: string;
  ms: number;
}
const results = ref<RunResult[]>([]);

async function runAll() {
  setActiveTag('demo8');
  results.value = configs.value.map((c) => ({
    id: c.id,
    label: c.label,
    protocol: c.protocol,
    loading: true,
    content: '',
    error: '',
    ms: 0,
  }));

  // 关键演示:对每个模型,业务调用代码完全一样 —— chatCompletion(cfg, messages)
  await Promise.all(
    configs.value.map(async (cfg) => {
      const r = results.value.find((x) => x.id === cfg.id)!;
      const t0 = performance.now();
      try {
        const msg = await chatCompletion(cfg, [{ role: 'user', content: prompt.value }]);
        r.content = msg.content ?? '';
      } catch (e: any) {
        r.error = e?.message ?? String(e);
      } finally {
        r.ms = Math.round(performance.now() - t0);
        r.loading = false;
      }
    }),
  );
}

const adapterCode = `// core/adapters.ts —— 把差异关进各自的 Adapter
const openaiAdapter = {
  buildRequest(cfg, req) {
    return {
      url: cfg.baseURL + '/chat/completions',
      init: { method: 'POST',
        // ← 鉴权方式
        headers: { Authorization: 'Bearer ' + cfg.apiKey },
        body: JSON.stringify({ model: cfg.model, messages: req.messages }) },
    };
  },
  // ← 响应结构
  parseResponse: (json) => ({ message: json.choices[0].message }),
};

const anthropicAdapter = {
  buildRequest(cfg, req) {
    // ← system 要单独拎出来
    const system = req.messages.find(m => m.role === 'system')?.content;
    return {
      url: cfg.baseURL + '/messages',
      init: { method: 'POST',
        // ← 不同的鉴权头
        headers: { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: cfg.model, system, messages, max_tokens: 1024 }) },
    };
  },
  parseResponse: (json) => ({ message: { role: 'assistant', content: json.content[0].text } }),
};`;

const usageCode = `// 上层业务代码:完全不关心厂商差异
// 按配置选适配器
const adapter = getAdapter(cfg);
const { url, init } = adapter.buildRequest(cfg, req);
const json = await fetch(url, init).then(r => r.json());
return adapter.parseResponse(json).message;
// 换模型 = 换一份 cfg,业务代码一行不改`;
</script>

<template>
  <DemoLayout demo-id="multi-model">
    <template #whatsnew>
      前面所有 Demo 都<b>不关心</b>用的是哪个厂商的模型 —— 因为差异早已被
      <code class="inline">core/adapters.ts</code> 吸收了。这里把它揭开:用你配置的多个模型,
      同一个问题<b>并排</b>比一比。
    </template>

    <template #playground>
      <div v-if="configs.length < 2" class="hint">
        建议先到
        <RouterLink to="/config">「模型配置中心」</RouterLink>
        配置 <b>2 个及以上</b>不同的模型(最好协议不同,如 DeepSeek + Claude),这个对比才精彩。
        当前已配置 {{ configs.length }} 个。
      </div>

      <label class="field-label">同一个问题,发给所有已配置模型</label>
      <textarea v-model="prompt" class="textarea" rows="2" />
      <button class="btn btn-primary" style="margin-top: 10px" :disabled="configs.length === 0" @click="runAll">
        并排对比({{ configs.length }} 个模型)
      </button>

      <div class="grid">
        <div v-for="r in results" :key="r.id" class="col">
          <div class="col-head">
            <span class="col-label">{{ r.label }}</span>
            <span class="tag" :class="r.protocol === 'anthropic' ? 'tag-info' : 'tag-success'">
              {{ r.protocol }}
            </span>
            <span v-if="!r.loading && !r.error" class="ms">{{ r.ms }}ms</span>
          </div>
          <div class="col-body">
            <span v-if="r.loading" class="loading">请求中…</span>
            <span v-else-if="r.error" class="col-err">{{ r.error }}</span>
            <span v-else>{{ r.content }}</span>
          </div>
        </div>
      </div>

      <RequestInspector tag="demo8" />

      <SourceViewer :files="['core/adapters.ts', 'core/llm.ts', 'core/config.ts', 'core/types.ts']" />
    </template>

    <template #explain>
      <h3 class="sec-title">为什么要适配层?</h3>
      <p class="para">
        不同厂商的接口"方言"不同:鉴权头不一样(<code class="inline">Authorization</code> vs
        <code class="inline">x-api-key</code>)、请求体不一样(Claude 要把
        <code class="inline">system</code> 单拎出来)、响应结构也不一样。如果业务代码里到处
        <code class="inline">if (是 Claude) … else …</code>,很快就无法维护。
      </p>
      <p class="para">
        解法是经典的<b>适配器模式</b>:定义统一接口 <code class="inline">Adapter</code>,
        每个厂商一个实现,把差异<b>封装在内部</b>。上层永远只调
        <code class="inline">buildRequest / parseResponse</code>。
      </p>
      <CodeBlock title="① 差异关进 Adapter" lang="ts" :code="adapterCode" />
      <div style="height: 12px" />
      <CodeBlock title="② 上层调用零感知" lang="ts" :code="usageCode" />
      <ul class="points">
        <li>这就是为什么前面每个 Demo 的代码,换任何模型都能跑 —— 它们从没直接碰过厂商细节。</li>
        <li>新增一个厂商,只需再写一个 Adapter,其余代码<b>零改动</b>。这就是抽象的价值。</li>
        <li>流式也一样:<code class="inline">parseStreamChunk</code> 各厂商各自实现(OpenAI 是 <code class="inline">delta.content</code>,Claude 是 <code class="inline">content_block_delta</code>)。</li>
      </ul>
    </template>
  </DemoLayout>
</template>

<style scoped>
.hint {
  padding: 12px 14px;
  background: var(--c-warn-soft);
  border: 1px solid #fde68a;
  border-radius: var(--radius-sm);
  color: #92400e;
  font-size: 13px;
  margin-bottom: 14px;
}
.field-label {
  display: block;
  font-size: 12.5px;
  color: var(--c-text-soft);
  font-weight: 500;
  margin: 6px 0 5px;
}
.grid {
  margin-top: 18px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}
.col {
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--c-surface);
}
.col-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--c-bg);
  border-bottom: 1px solid var(--c-border);
}
.col-label {
  font-weight: 600;
  font-size: 13px;
}
.ms {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--c-text-faint);
}
.col-body {
  padding: 12px;
  font-size: 13px;
  white-space: pre-wrap;
  min-height: 80px;
}
.loading {
  color: var(--c-text-faint);
}
.col-err {
  color: var(--c-danger);
  font-size: 12px;
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
