<script setup lang="ts">
/**
 * Demo 0 —— 模型配置中心
 * 教学目标:让前端工程师意识到"接入大模型"的三要素:baseURL、鉴权、model。
 * 支持配置多个模型(为 Demo8 的多模型兼容做铺垫),全部存 localStorage。
 */
import { ref, computed } from 'vue';
import DemoLayout from '../components/DemoLayout.vue';
import CodeBlock from '../components/CodeBlock.vue';
import {
  loadConfigs,
  saveConfigs,
  loadActiveId,
  saveActiveId,
  genId,
  buildLocalFileJson,
  writeLocalFile,
  canWriteLocalFile,
  PRESETS,
  type ModelConfig,
  type ProtocolStyle,
} from '../core/config';
import { useActiveModel } from '../components/useActiveModel';

const { refresh } = useActiveModel();

const configs = ref<ModelConfig[]>(loadConfigs());
const activeId = ref<string | null>(loadActiveId());

// 有没有配置是从 models.local.json 来的 —— 决定是否显示那条说明
const hasLocalFile = computed(() => configs.value.some((c) => c.fromLocalFile));

// 表单;editingId 为空时是"新增",非空时是"编辑该 id 的配置"
const editingId = ref<string | null>(null);
const form = ref<Omit<ModelConfig, 'id'>>({
  label: '',
  protocol: 'openai',
  baseURL: '',
  apiKey: '',
  model: '',
});

function applyPreset(name: string) {
  const p = PRESETS.find((x) => x.label === name);
  if (!p) return;
  form.value.label = p.label;
  form.value.protocol = p.protocol;
  form.value.baseURL = p.baseURL;
  form.value.model = p.model;
}

function resetForm() {
  editingId.value = null;
  form.value = { label: '', protocol: form.value.protocol, baseURL: '', apiKey: '', model: '' };
}

/** 点"编辑":把该配置载入表单,并滚动到表单区 */
function startEdit(c: ModelConfig) {
  editingId.value = c.id;
  form.value = {
    label: c.label,
    protocol: c.protocol,
    baseURL: c.baseURL,
    apiKey: c.apiKey,
    model: c.model,
  };
}

/** 提交表单:新增或保存编辑 */
function submitForm() {
  if (!form.value.label || !form.value.baseURL || !form.value.model) {
    alert('请至少填写 名称 / baseURL / 模型名');
    return;
  }
  if (editingId.value) {
    // 编辑:原地更新对应配置
    const idx = configs.value.findIndex((c) => c.id === editingId.value);
    if (idx >= 0) {
      // 保留 fromLocalFile 标记:它说明这条的"源头"是本地文件,
      // 在页面上改只是临时生效 —— 下次刷新会被文件内容覆盖回去。
      const wasFromFile = configs.value[idx].fromLocalFile;
      configs.value[idx] = { id: editingId.value, ...form.value, fromLocalFile: wasFromFile };
      saveConfigs(configs.value);
      // 若正在编辑的是当前生效模型,刷新全局状态
      if (activeId.value === editingId.value) refresh();
    }
  } else {
    // 新增
    const cfg: ModelConfig = { id: genId(), ...form.value };
    configs.value.push(cfg);
    saveConfigs(configs.value);
    // 第一个添加的自动设为当前
    if (!activeId.value) setActive(cfg.id);
  }
  resetForm();
}

function removeConfig(id: string) {
  configs.value = configs.value.filter((c) => c.id !== id);
  saveConfigs(configs.value);
  if (editingId.value === id) resetForm();
  if (activeId.value === id) {
    const next = configs.value[0]?.id ?? null;
    if (next) setActive(next);
    else {
      activeId.value = null;
      refresh();
    }
  }
}

function setActive(id: string) {
  activeId.value = id;
  saveActiveId(id);
  refresh();
}

const protocols: { value: ProtocolStyle; label: string }[] = [
  { value: 'openai', label: 'OpenAI 兼容(DeepSeek/Kimi/通义/OpenAI…)' },
  { value: 'anthropic', label: 'Anthropic(Claude)' },
];

/* ---- 导出到 models.local.json ---- */
// 非本机(局域网 IP)访问时写入端点会拒绝,直接藏掉按钮,只留"复制 JSON"
const canWrite = canWriteLocalFile();
const exportState = ref<'idle' | 'busy' | 'ok' | 'err'>('idle');
const exportMsg = ref('');
// 失败时(比如不是 dev 环境)把 JSON 摊开,让用户自己复制
const exportJson = ref('');

async function exportToFile() {
  exportState.value = 'busy';
  exportMsg.value = '';
  exportJson.value = '';
  try {
    const { overwritten } = await writeLocalFile();
    exportState.value = 'ok';
    exportMsg.value = `已${overwritten ? '覆盖' : '写入'} models.local.json(${configs.value.length} 个模型)`;
  } catch (e: any) {
    exportState.value = 'err';
    exportMsg.value = e?.message ?? String(e);
    // 兜底:给出文件内容,手动粘贴也能完成
    exportJson.value = JSON.stringify(buildLocalFileJson(), null, 2);
  }
}

async function copyExportJson() {
  const text = exportJson.value || JSON.stringify(buildLocalFileJson(), null, 2);
  try {
    await navigator.clipboard.writeText(text);
    exportMsg.value = '已复制到剪贴板,粘贴进 models.local.json 即可';
  } catch {
    exportMsg.value = '复制失败,请手动选中下面的内容';
    exportJson.value = text;
  }
}

const requestExample = `// 一次最简单的调用,本质就是带鉴权头的 fetch POST
await fetch('\${baseURL}/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    // OpenAI 兼容:Authorization: Bearer <key>
    // Anthropic:    x-api-key: <key>
    Authorization: 'Bearer ' + apiKey,
  },
  body: JSON.stringify({
    // model 就是你在这里选的模型名
    model,
    messages: [{ role: 'user', content: '你好' }],
  }),
});`;
</script>

<template>
  <DemoLayout demo-id="config">
    <template #playground>
      <h3 class="sec-title">已配置的模型</h3>
      <p class="sec-desc">选中一个作为"当前模型",后续所有 Demo 都会用它。可配置多个。</p>

      <div v-if="configs.length === 0" class="empty">
        还没有模型,用右边的表单添加一个吧 👉(可先点预置模板)
      </div>

      <div v-if="hasLocalFile" class="file-note">
        📄 其中带标记的配置来自根目录 <code class="inline">models.local.json</code> ——
        改那个文件、刷新页面即可更新(该文件已被 git 忽略,不会提交)。
      </div>

      <div v-for="c in configs" :key="c.id" class="model-card" :class="{ on: c.id === activeId, editing: c.id === editingId }">
        <div class="model-main">
          <label class="radio">
            <input
              type="radio"
              :checked="c.id === activeId"
              @change="setActive(c.id)"
            />
            <span class="model-label">{{ c.label }}</span>
          </label>
          <span class="tag" :class="c.protocol === 'anthropic' ? 'tag-info' : 'tag-success'">
            {{ c.protocol }}
          </span>
          <span v-if="c.fromLocalFile" class="tag tag-file" title="来自根目录 models.local.json,改那个文件即可更新">
            📄 models.local.json
          </span>
        </div>
        <div class="model-meta">
          <div><span class="k">baseURL</span>{{ c.baseURL }}</div>
          <div><span class="k">model</span>{{ c.model }}</div>
          <div><span class="k">key</span>{{ c.apiKey ? '••••••' + c.apiKey.slice(-4) : '(未填)' }}</div>
        </div>
        <div class="card-actions">
          <button class="btn btn-sm" @click="startEdit(c)">编辑</button>
          <button class="btn btn-sm del" @click="removeConfig(c.id)">删除</button>
        </div>
      </div>

      <!-- 把 localStorage 里的配置落盘,免得换浏览器/清缓存后重填 -->
      <div v-if="configs.length" class="export-box">
        <div class="export-row">
          <button
            v-if="canWrite"
            class="btn btn-sm"
            :disabled="exportState === 'busy'"
            @click="exportToFile"
          >
            {{ exportState === 'busy' ? '写入中…' : '💾 保存到 models.local.json' }}
          </button>
          <button class="btn btn-sm" @click="copyExportJson">📋 复制 JSON</button>
        </div>
        <div class="export-hint">
          <template v-if="canWrite">
            把当前配置写进项目根目录的 <code class="inline">models.local.json</code>(已被 git 忽略)——
            以后换浏览器或清了缓存也不用重填。仅 <code class="inline">npm run dev</code> 下可写入。
          </template>
          <template v-else>
            当前是通过<b>局域网地址</b>访问的,写文件功能只在本机
            <code class="inline">localhost</code> 可用。你可以点「复制 JSON」,再手动粘贴进项目根目录的
            <code class="inline">models.local.json</code>。
          </template>
        </div>
        <div v-if="exportMsg" class="export-msg" :class="exportState">{{ exportMsg }}</div>
        <textarea
          v-if="exportJson"
          class="textarea export-json"
          rows="8"
          readonly
          :value="exportJson"
        />
      </div>

      <h3 class="sec-title" style="margin-top: 24px">
        {{ editingId ? '编辑模型' : '添加模型' }}
      </h3>
      <div v-if="!editingId" class="presets">
        <span class="presets-label">快速填入:</span>
        <button
          v-for="p in PRESETS"
          :key="p.label"
          class="btn btn-sm"
          @click="applyPreset(p.label)"
        >
          {{ p.label }}
        </button>
      </div>

      <div class="form">
        <label class="field">
          <span class="field-label">协议风格</span>
          <select v-model="form.protocol" class="select">
            <option v-for="p in protocols" :key="p.value" :value="p.value">{{ p.label }}</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">名称(自定义,便于识别)</span>
          <input v-model="form.label" class="input" placeholder="如 DeepSeek-V3" />
        </label>
        <label class="field">
          <span class="field-label">Base URL</span>
          <input v-model="form.baseURL" class="input" placeholder="https://api.deepseek.com/v1" />
        </label>
        <label class="field">
          <span class="field-label">API Key(仅存本地浏览器)</span>
          <input v-model="form.apiKey" class="input" type="password" placeholder="sk-..." />
        </label>
        <label class="field">
          <span class="field-label">模型名</span>
          <input v-model="form.model" class="input" placeholder="deepseek-chat" />
        </label>
        <div class="form-actions">
          <button class="btn btn-primary" @click="submitForm">
            {{ editingId ? '保存修改' : '+ 添加到列表' }}
          </button>
          <button v-if="editingId" class="btn" @click="resetForm">取消</button>
        </div>
      </div>
    </template>

    <template #explain>
      <h3 class="sec-title">为什么第一课是"配置"?</h3>
      <p class="para">
        对前端工程师来说,做 Agent 的第一道坎不是算法,而是最朴素的三个问题:
        <b>请求发去哪、怎么证明我有权限、用哪个模型</b>。把它们想清楚,后面全是水到渠成。
      </p>

      <ul class="points">
        <li><b>Base URL</b>:接口基地址。国产模型大多提供 <code class="inline">/v1</code> 结尾的 OpenAI 兼容地址。</li>
        <li><b>鉴权</b>:OpenAI 系用 <code class="inline">Authorization: Bearer &lt;key&gt;</code>;Claude 用 <code class="inline">x-api-key</code>。差异我们在 Demo 8 用适配层统一。</li>
        <li><b>Model</b>:同一个厂商往往有多个模型名,决定能力与价格。</li>
      </ul>

      <CodeBlock title="调用的本质" lang="ts" :code="requestExample" />

      <div class="warn-box">
        <b>⚠️ 工程提醒:</b>
        这里让浏览器直接带着 Key 请求模型厂商,只是为了把原理演示清楚。
        <b>真实生产中绝不能把 API Key 放前端</b> —— 应由自己的后端代理转发,Key 留在服务端。
      </div>

      <div class="info-box">
        <b>多模型的意义:</b>这里可以配置多个模型,是为了最后一课
        <RouterLink to="/multi-model">「多模型兼容」</RouterLink>
        —— 让同一个 Agent 无缝切换不同厂商的模型。
      </div>
    </template>
  </DemoLayout>
</template>

<style scoped>
.sec-title {
  font-size: 15px;
  font-weight: 700;
  margin: 0 0 4px;
}
.sec-desc {
  margin: 0 0 14px;
  color: var(--c-text-soft);
  font-size: 13px;
}
.empty {
  padding: 20px;
  text-align: center;
  color: var(--c-text-faint);
  background: var(--c-bg);
  border-radius: var(--radius-sm);
  font-size: 13px;
}
.file-note {
  margin-bottom: 12px;
  padding: 8px 12px;
  background: var(--c-bg);
  border-left: 3px solid var(--c-border-strong);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  font-size: 12px;
  color: var(--c-text-soft);
  line-height: 1.6;
}
.tag-file {
  background: var(--c-bg);
  color: var(--c-text-soft);
  border: 1px solid var(--c-border-strong);
  font-family: var(--font-mono);
  font-size: 10.5px;
}
/* ---- 导出到本地文件 ---- */
.export-box {
  margin-top: 14px;
  padding: 10px 12px;
  background: var(--c-bg);
  border: 1px dashed var(--c-border-strong);
  border-radius: var(--radius-sm);
}
.export-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.export-hint {
  margin-top: 7px;
  font-size: 11.5px;
  color: var(--c-text-soft);
  line-height: 1.6;
}
.export-msg {
  margin-top: 7px;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  line-height: 1.5;
}
.export-msg.ok {
  background: var(--c-success-soft);
  color: var(--c-success);
}
.export-msg.err {
  background: var(--c-warn-soft);
  color: #92400e;
}
.export-json {
  margin-top: 7px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.55;
}
.model-card {
  position: relative;
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  margin-bottom: 10px;
  background: var(--c-surface);
}
.model-card.on {
  border-color: var(--c-primary);
  background: var(--c-primary-soft);
}
.model-main {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.radio {
  display: flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
}
.model-label {
  font-weight: 600;
  font-size: 14px;
}
.model-meta {
  font-size: 12px;
  color: var(--c-text-soft);
  font-family: var(--font-mono);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.model-meta .k {
  display: inline-block;
  width: 62px;
  color: var(--c-text-faint);
}
.model-card.editing {
  border-color: var(--c-primary);
  box-shadow: 0 0 0 3px var(--c-primary-soft);
}
.card-actions {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  gap: 6px;
}
.del {
  color: var(--c-danger);
  border-color: transparent;
}
.del:hover {
  border-color: var(--c-danger);
  color: var(--c-danger);
}
.form-actions {
  display: flex;
  gap: 8px;
}
.presets {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
}
.presets-label {
  font-size: 12px;
  color: var(--c-text-soft);
}
.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.field-label {
  font-size: 12.5px;
  color: var(--c-text-soft);
  font-weight: 500;
}
.para {
  font-size: 13.5px;
  color: var(--c-text);
  margin: 0 0 12px;
}
.points {
  margin: 0 0 16px;
  padding-left: 18px;
  font-size: 13.5px;
}
.points li {
  margin-bottom: 6px;
}
.warn-box {
  margin-top: 16px;
  padding: 12px 14px;
  background: var(--c-warn-soft);
  border: 1px solid #fde68a;
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: #92400e;
  line-height: 1.6;
}
.info-box {
  margin-top: 12px;
  padding: 12px 14px;
  background: var(--c-info-soft);
  border: 1px solid #a5f3fc;
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: #155e75;
}
</style>
