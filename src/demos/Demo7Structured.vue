<script setup lang="ts">
/**
 * Demo 7 —— 结构化输出与可靠性
 * 教学目标:用一个【只接受结构化入参】的工具(save_profile_card:把信息画成名片图片下载),
 * 让"为什么必须结构化"变成物理刚需 —— 模型不吐出规范字段,工具根本没法调。
 * 再引出:模型是概率的,如何靠解析容错/重试/超时保证每一步都稳。
 */
import { ref } from 'vue';
import DemoLayout from '../components/DemoLayout.vue';
import CodeBlock from '../components/CodeBlock.vue';
import NoModelHint from '../components/NoModelHint.vue';
import AgentTrace from '../components/AgentTrace.vue';
import RequestInspector from '../components/RequestInspector.vue';
import ToolCodeEditor from '../components/ToolCodeEditor.vue';
import SourceViewer from '../components/SourceViewer.vue';
import { runAgentLoop, type AgentEvent } from '../core/agent';
import { setActiveTag } from '../core/inspector';
import { toolSchemas } from '../core/tools';
import type { ChatMessage } from '../core/types';
import { useActiveModel } from '../components/useActiveModel';

const { active } = useActiveModel();

const prompt = ref('张三,28 岁,是一名来自杭州的后端工程师,擅长 Go 和 Rust。帮我做成一张名片。');
const events = ref<AgentEvent[]>([]);
const running = ref(false);
// 记录模型这次调用工具时,实际传入的结构化参数(用于把"结构化"可视化)
const calledArgs = ref<any>(null);

const tools = toolSchemas(['save_profile_card']);

async function run() {
  if (!active.value) return;
  setActiveTag('demo7');
  running.value = true;
  events.value = [];
  calledArgs.value = null;
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        '你是一个助手。当用户提供一个人的信息时,请从自然语言里抽取出规范字段,' +
        '并调用 save_profile_card 工具生成名片。字段要严格符合工具要求(age 是数字,skills 是字符串数组)。',
    },
    { role: 'user', content: prompt.value },
  ];
  try {
    await runAgentLoop({
      cfg: active.value,
      tools,
      messages,
      maxSteps: 4,
      onEvent: (e) => {
        events.value.push(e);
        if (e.type === 'tool_call' && e.name === 'save_profile_card') {
          calledArgs.value = e.args;
        }
      },
    });
  } finally {
    running.value = false;
  }
}

const toolSchemaCode = `// core/tools.ts —— 一个【只接受结构化入参】的工具
{
  name: 'save_profile_card',
  description: '把一个人的结构化信息生成名片图片(PNG)并下载',
  parameters: {
    type: 'object',
    properties: {
      name:   { type: 'string' },
      age:    { type: 'number' },              // ← 必须是数字
      city:   { type: 'string' },
      role:   { type: 'string' },
      skills: { type: 'array', items: { type: 'string' } }, // ← 必须是数组
    },
    required: ['name', 'age', 'city', 'role', 'skills'],
  },
}`;

const runReadsFieldsCode = `// run 里【每一行都在按字段取值】—— 这就是入参必须结构化的根本原因
run: ({ name, age, city, role, skills }) => {
  ctx.fillText(name, 56, 104);                 // 读 name
  ctx.fillText(role + ' · ' + age + ' 岁', ...) // 读 role、age
  for (const s of skills) drawTag(s);          // 遍历 skills 数组
  // ...画到 canvas → toDataURL → 触发下载
}
// 如果模型回的是一句话"张三是杭州的后端工程师",这里全部取不到值 → 工具废掉`;

const parseCode = `// core/reliability.ts —— 稳健解析:容忍 \`\`\`json 包裹和前后废话
export function extractJson(text) {
  const fenced = text.match(/\`\`\`(?:json)?\\s*([\\s\\S]*?)\`\`\`/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  return JSON.parse(candidate.slice(start, end + 1));
}`;

const retryCode = `// 重试 + 超时:模型是概率的,一次不成就再来
for (let i = 0; i <= maxRetries; i++) {
  try {
    const msg = await withTimeout(chat(messages, { temperature: 0 }), timeoutMs);
    return extractJson(msg.content);   // 成功就返回
  } catch (e) {
    attempts.push({ index: i, ok: false, error: e.message }); // 失败记录后重试
  }
}
return null; // 全部失败`;

// 我们循环里【真实生效】的校验(core/agent.ts)—— 不盲信模型的输出
const validateInLoopCode = `// core/agent.ts —— 执行工具【前】,先自己校验参数
const args = JSON.parse(call.function.arguments);  // ① 解析(失败→回填错误让模型重发)

const errors = validateArgs(schema, args);          // ② 对照 schema 校验必填/类型
if (errors.length > 0) {
  // 不硬塞给工具、也不默默吞掉 —— 把错误当作工具结果回填,
  // 模型下一轮就能看到"哪里错了",自己改正重发。这才是"重试"闭环。
  messages.push({ role: 'tool', tool_call_id: call.id,
    content: '参数校验未通过:' + errors.join(';') });
  continue;
}

const result = await runTool(call.function.name, args); // ③ 校验通过才真正执行`;
</script>

<template>
  <DemoLayout demo-id="structured">
    <template #whatsnew>
      上一课模型自己排出了 now→calculator→toggle_lamp。可它凭什么<b>每一步</b>都能吐出
      <code class="inline">{ tool, args }</code> 这种能被循环代码接住的形状?模型是<b>概率</b>的,会失手。
      这一课就讲:靠<b>解析容错 + 重试 + 超时</b>,保证 Agent 每一步都不掉链子。
    </template>

    <template #playground>
      <NoModelHint />
      <div class="mini-hint">
        我们给模型一个工具 <code class="inline">save_profile_card</code>:它<b>只接受结构化字段</b>
        (name/age/city/role/skills),会把信息画成一张名片图片下载。
        于是模型<b>必须</b>先把下面这句大白话抽成规范字段,否则工具根本没法调 —— 这就是"结构化"的刚需。
      </div>
      <label class="field-label">一句自然语言(含要提取的信息)</label>
      <textarea v-model="prompt" class="textarea" rows="3" />
      <div class="tools-avail">
        工具:<span class="tag tag-info">save_profile_card</span>
        <span class="cfg-note">生成 PNG 名片并自动下载</span>
      </div>
      <button class="btn btn-primary" style="margin-top: 10px" :disabled="running || !active" @click="run">
        {{ running ? '运行中…' : '▶ 让模型提取并生成名片' }}
      </button>

      <div v-if="calledArgs" class="result">
        <div class="result-label">模型实际传给工具的<b>结构化参数</b>(它把大白话变成了字段)</div>
        <CodeBlock lang="json" :code="JSON.stringify(calledArgs, null, 2)" />
        <div class="result-fields">
          <span v-for="(v, k) in calledArgs" :key="k" class="pill">
            {{ k }}: {{ Array.isArray(v) ? v.join(' / ') : v }}
          </span>
        </div>
        <div class="dl-note">🖼️ 名片图片已触发下载(浏览器可能会提示保存)。</div>
      </div>

      <h3 class="sec-title" style="margin-top: 20px">执行轨迹</h3>
      <AgentTrace :events="events" :running="running" />

      <RequestInspector tag="demo7" />

      <ToolCodeEditor :names="['save_profile_card']" />

      <SourceViewer :files="['core/tools.ts', 'core/agent.ts', 'core/reliability.ts', 'core/llm.ts', 'core/types.ts']" />
    </template>

    <template #explain>
      <h3 class="sec-title">这个工具为什么"逼"模型必须结构化?</h3>
      <p class="para">
        看这个工具的定义 —— 它的入参是一组<b>明确的字段</b>,<code class="inline">age</code> 必须是数字、
        <code class="inline">skills</code> 必须是数组:
      </p>
      <CodeBlock title="save_profile_card 的 schema" lang="ts" :code="toolSchemaCode" />
      <p class="para">
        而它的 <code class="inline">run</code> 里,<b>每一行都在"按字段取值"</b>去画图。接收方是<b>代码,不是人</b>:
      </p>
      <CodeBlock title="run 按字段取值 —— 这就是刚需的来源" lang="ts" :code="runReadsFieldsCode" />
      <p class="para">
        所以模型面对"张三,28 岁,杭州后端工程师……"这句大白话,<b>没有选择</b> ——
        它必须先把这句话抽成 <code class="inline">{ name, age, city, role, skills }</code> 才能调用工具。
        <b>判断标准就一条:模型的输出下一步进人的眼睛,还是进代码的 <code class="inline">.parse()</code>?进代码,就必须结构化。</b>
      </p>

      <h3 class="sec-title" style="margin-top: 20px">这也正是 Agent 能自主干活的地基</h3>
      <p class="para">
        第 5、6 课的循环,每一轮都在做同一件事:把模型返回的 <code class="inline">{ tool, args }</code> 解析出来、
        按字段执行、把结果喂给下一步。但那里我们<b>默认</b>模型每次都吐对。现在正视这个前提 ——
        <b>模型是概率生成的,它未必每次都给合法结构</b>。看清这条因果链,这一课就通了:
      </p>
      <div class="chain">
        <span class="chain-node">下游是代码,不是人</span>
        <span class="chain-arr">→</span>
        <span class="chain-node">所以要求模型输出结构化字段</span>
        <span class="chain-arr">→</span>
        <span class="chain-node warn">但模型概率生成,不保证给对</span>
        <span class="chain-arr">→</span>
        <span class="chain-node ok">所以要可靠性兜底</span>
      </div>

      <h3 class="sec-title" style="margin-top: 20px">我们不盲信模型:循环里真的做了校验</h3>
      <p class="para">
        重点澄清一个常见误解:<b>格式对不对,不能完全交给大模型</b>。就算模型很可靠,我们的 Agent 循环
        (<code class="inline">core/agent.ts</code>)在<b>真正执行工具之前</b>,依然会自己校验一遍参数 ——
        解析 + 对照 schema 检查必填字段和类型:
      </p>
      <CodeBlock title="校验就在循环里(core/agent.ts,可在下方源码查看器核对)" lang="ts" :code="validateInLoopCode" />
      <ul class="points">
        <li><b>解析失败</b>(连合法 JSON 都不是)→ 把错误回填,让模型重发,而不是默默传个空对象继续。</li>
        <li><b>校验失败</b>(漏字段、<code class="inline">age</code> 给成字符串、<code class="inline">skills</code> 不是数组)→ 同样把"哪里错了"回填,模型下一轮自己改正。</li>
        <li>这就把"重试"接成了<b>闭环</b>:错误信息回到模型 → 模型修正 → 再校验。<b>模型可靠只是降低出错概率,校验才是兜底的最后一道闸。</b></li>
      </ul>

      <h3 class="sec-title" style="margin-top: 20px">兜底三招(通用做法)</h3>
      <p class="para">除了循环里的校验,处理"模型直接吐 JSON"时还有三招常用手段:</p>
      <CodeBlock title="① 解析容错:容忍 ```json 包裹和前后废话" lang="ts" :code="parseCode" />
      <div style="height: 12px" />
      <CodeBlock title="② 重试 + 超时:一次不成就再来,别卡死" lang="ts" :code="retryCode" />
      <ul class="points">
        <li><b>① 解析容错</b>:模型爱给 JSON 包一层 <code class="inline">```json</code> 或加句"好的,结果如下"。别直接 <code class="inline">JSON.parse</code> 原文,先把真正的 JSON 抠出来。</li>
        <li><b>② 重试</b>:这一步没吐对?带着同样的要求再问一次。概率事件,多试几次成功率大增。</li>
        <li><b>③ 超时</b>:某次请求卡住不能拖垮整个 Agent,到点就放弃这次、走重试。</li>
        <li><code class="inline">temperature: 0</code>:让输出尽量确定,减少"这次对下次错"的抖动。</li>
      </ul>

      <h3 class="sec-title" style="margin-top: 20px">生产里更进一步</h3>
      <ul class="points">
        <li>本 Demo 用的是<b>工具调用</b>方式:参数由 API 的 <code class="inline">tools</code> 机制约束,通常比"纯文本求 JSON"更规范。而 <code class="inline">core/reliability.ts</code> 里的 <code class="inline">extractJson</code> / 重试,用于模型<b>不走工具、直接吐 JSON</b> 的场景 —— 两条路都要会。</li>
        <li>厂商原生的 <b>JSON Mode / Structured Outputs</b>:用 JSON Schema 在 API 层<b>强约束</b>输出结构,比"用提示词求它"更可靠。</li>
        <li>可靠性是 Agent 能否上生产的分水岭:<b>能聊天很容易,每一步都稳定不掉链子很难</b> —— Agent 要连续跑很多步,一步崩全盘停,对稳定性的要求被成倍放大。</li>
      </ul>
      <div class="side-note">
        动手体会:点运行,看轨迹里模型如何把大白话抽成结构化参数、工具如何生成图片。
        再打开左侧<b>「工具代码(可编辑)」</b>改改画名片的 <code class="inline">run</code>(比如换个背景色),
        或展开<b>请求检查器</b>看模型返回的 <code class="inline">tool_calls</code> 原文。
      </div>
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
.cfg-note {
  margin-top: 8px;
  font-size: 12px;
  color: var(--c-text-faint);
}
.tools-avail {
  margin-top: 8px;
  font-size: 12.5px;
  color: var(--c-text-soft);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.dl-note {
  margin-top: 10px;
  font-size: 12.5px;
  color: var(--c-success);
}
.err {
  margin-top: 12px;
  padding: 10px 12px;
  background: var(--c-danger-soft);
  border: 1px solid #fecaca;
  border-radius: var(--radius-sm);
  color: var(--c-danger);
  font-size: 13px;
}
.attempts {
  margin-top: 16px;
}
.attempts-label,
.result-label {
  font-size: 12px;
  color: var(--c-text-soft);
  font-weight: 600;
  margin-bottom: 6px;
}
.attempt {
  font-size: 13px;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  margin-bottom: 4px;
}
.attempt.ok {
  background: var(--c-success-soft);
  color: var(--c-success);
}
.attempt.fail {
  background: var(--c-danger-soft);
  color: var(--c-danger);
}
.result {
  margin-top: 16px;
}
.result-fields {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.pill {
  padding: 4px 10px;
  background: var(--c-primary-soft);
  color: var(--c-primary-hover);
  border-radius: 999px;
  font-size: 12.5px;
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
.mini-hint {
  padding: 10px 14px;
  background: var(--c-primary-soft);
  border: 1px solid #c7d2fe;
  border-radius: var(--radius-sm);
  font-size: 12.5px;
  color: var(--c-primary-hover);
  line-height: 1.6;
}
.chain {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 4px 0 4px;
}
.chain-node {
  font-size: 12px;
  padding: 5px 10px;
  border-radius: var(--radius-sm);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  line-height: 1.3;
}
.chain-node.warn {
  background: var(--c-warn-soft);
  border-color: #fde68a;
  color: #92400e;
}
.chain-node.ok {
  background: var(--c-success-soft);
  border-color: #a7f3d0;
  color: var(--c-success);
  font-weight: 600;
}
.chain-arr {
  color: var(--c-text-faint);
  font-size: 13px;
}
.side-note {
  margin-top: 16px;
  padding: 10px 14px;
  background: var(--c-bg);
  border-left: 3px solid var(--c-border-strong);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  font-size: 12.5px;
  color: var(--c-text-soft);
  line-height: 1.65;
}
</style>
