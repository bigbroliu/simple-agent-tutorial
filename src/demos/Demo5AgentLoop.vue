<script setup lang="ts">
/**
 * Demo 5 —— 会思考(Agent 循环)
 * 教学目标:把 Demo4 的"手动一轮"变成自动 while 循环(ReAct),
 * 并用 AgentTrace 可视化每一步。加入"开关灯"工具,让副作用肉眼可见。
 */
import { ref, onMounted, onUnmounted } from 'vue';
import DemoLayout from '../components/DemoLayout.vue';
import CodeBlock from '../components/CodeBlock.vue';
import NoModelHint from '../components/NoModelHint.vue';
import AgentTrace from '../components/AgentTrace.vue';
import RequestInspector from '../components/RequestInspector.vue';
import ToolCodeEditor from '../components/ToolCodeEditor.vue';
import SourceViewer from '../components/SourceViewer.vue';
import { runAgentLoop, type AgentEvent } from '../core/agent';
import { setActiveTag } from '../core/inspector';
import { toolSchemas, setLampState } from '../core/tools';
import type { ChatMessage } from '../core/types';
import { useActiveModel } from '../components/useActiveModel';

const { active } = useActiveModel();

const prompt = ref('先帮我算一下 (18+7)*3,然后把灯打开,再告诉我现在几点');
const events = ref<AgentEvent[]>([]);
const running = ref(false);
const lampOn = ref(false);

const tools = toolSchemas(['calculator', 'now', 'toggle_lamp']);

function onLampChange(e: Event) {
  lampOn.value = (e as CustomEvent).detail.on;
}
onMounted(() => {
  setLampState(false); // 进入本课时,灯默认关闭
  window.addEventListener('lamp-change', onLampChange);
});
onUnmounted(() => window.removeEventListener('lamp-change', onLampChange));

async function run() {
  if (!active.value) return;
  setActiveTag('demo5');
  running.value = true;
  events.value = [];
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        '你是一个能干的助手。当需要计算、查时间或操作设备时,请使用提供的工具,一步步完成用户的所有要求。',
    },
    { role: 'user', content: prompt.value },
  ];
  try {
    await runAgentLoop({
      cfg: active.value,
      tools,
      messages,
      maxSteps: 6,
      onEvent: (e) => events.value.push(e),
    });
  } finally {
    running.value = false;
  }
}

const loopCode = `// core/agent.ts —— Agent 与 Chatbot 的分界线就是这个 while
for (let step = 0; step < maxSteps; step++) {
  // 问模型
  const assistant = await chat(messages, { tools });
  messages.push(assistant);

  const calls = assistant.tool_calls ?? [];
  // 模型不再要工具 → 它认为搞定了,收尾退出循环
  if (calls.length === 0) {
    return assistant.content;
  }
  // 否则:逐个执行工具,回填结果
  for (const call of calls) {
    const args = JSON.parse(call.function.arguments);
    const result = await runTool(call.function.name, args);
    messages.push({ role: 'tool', tool_call_id: call.id, content: result });
  }
  // 带着结果回到循环开头,再问一次 —— 这就是"思考→行动→观察→再思考"
}`;

// 更接近生产的循环:加了规划、错误反馈、预算控制等"工程护栏"
const betterLoopCode = `for (let step = 0; step < maxSteps; step++) {
  const assistant = await chat(messages, { tools, system });
  messages.push(assistant);

  const calls = assistant.tool_calls ?? [];
  if (calls.length === 0) return assistant.content;

  for (const call of calls) {
    let result;
    try {
      const args = JSON.parse(call.function.arguments);  // 可能不是合法 JSON
      result = await withTimeout(runTool(call.function.name, args), 15000);
    } catch (e) {
      // ★ 把错误当作"观察"喂回去,让模型自己纠正,而不是整个循环崩掉
      result = 'ERROR: ' + e.message;
    }
    messages.push({ role: 'tool', tool_call_id: call.id, content: result });
  }

  // ★ 预算护栏:token / 时间 / 步数任一超限就停,避免烧钱和死循环
  if (usedTokens > TOKEN_BUDGET) return await forceSummarize(messages);
}`;

// Hermes 等开源模型:没有原生 tool_calls 字段,用文本标签约定
const hermesCode = `<|im_start|>system
你是一个函数调用 AI,可用的函数在 <tools></tools> 里:
<tools>
[{"name": "calculator", "arguments": {"expression": "string"}}]
</tools>
调用时输出 <tool_call>{"name":..., "arguments":...}</tool_call><|im_end|>

<|im_start|>assistant
<tool_call>{"name": "calculator", "arguments": {"expression": "18*3"}}</tool_call><|im_end|>

<|im_start|>tool
<tool_response>54</tool_response><|im_end|>`;
</script>

<template>
  <DemoLayout demo-id="agent-loop">
    <template #whatsnew>
      把"发起调用 → 执行 → 回填"包进一个 <b>while 循环</b>,直到模型不再请求工具。
      模型于是能<b>连续自主</b>地完成多步任务 —— 这就是 Agent。
    </template>

    <template #playground>
      <NoModelHint />
      <div class="lamp-row">
        <div class="lamp" :class="{ on: lampOn }">{{ lampOn ? '💡' : '🔌' }}</div>
        <span class="lamp-text">房间的灯:{{ lampOn ? '开' : '关' }}(Agent 会真的操作它)</span>
      </div>

      <label class="field-label">给 Agent 一个多步任务</label>
      <textarea v-model="prompt" class="textarea" rows="3" />
      <div class="tools-avail">
        可用工具:<span class="tag tag-info">calculator</span>
        <span class="tag tag-info">now</span>
        <span class="tag tag-info">toggle_lamp</span>
      </div>
      <button class="btn btn-primary" style="margin-top: 10px" :disabled="running || !active" @click="run">
        {{ running ? 'Agent 运行中…' : '▶ 运行 Agent' }}
      </button>

      <h3 class="sec-title" style="margin-top: 20px">思考与行动轨迹</h3>
      <AgentTrace :events="events" :running="running" />

      <RequestInspector tag="demo5" />

      <ToolCodeEditor :names="['calculator', 'now', 'toggle_lamp']" />

      <SourceViewer :files="['core/agent.ts', 'core/tools.ts', 'core/llm.ts', 'core/adapters.ts', 'core/types.ts']" />
    </template>

    <template #explain>
      <h3 class="sec-title">这才是"Agent"</h3>
      <p class="para">
        Chatbot 是一问一答;Agent 是<b>给个目标,自己想办法一步步做完</b>。
        差别不在模型,而在我们外面套的这个循环。模型每轮只做一个小决定:
        "我该说话了,还是该调工具?" 循环负责把这些小决定串成完整任务。
      </p>
      <CodeBlock title="core/agent.ts · runAgentLoop" lang="ts" :code="loopCode" />
      <ul class="points">
        <li><b>终止条件</b>:模型返回的消息里没有 <code class="inline">tool_calls</code>,说明它认为可以收尾了。</li>
        <li><b>maxSteps 上限</b>:必须有!否则模型若反复调工具就会死循环、烧 token。这是工程安全阀。</li>
        <li>左边灯泡会真的亮灭 —— 说明 Agent 的行动可以产生<b>真实世界的副作用</b>,这也是它强大与危险的来源。</li>
        <li>观察轨迹:💭思考 → 🔧调用 → 📥结果 → 💭再思考 …… 直到 ✅。这就是 ReAct 的名字由来。</li>
      </ul>

      <h3 class="sec-title" style="margin-top: 20px">这只是最简版 —— 想做得更好?</h3>
      <p class="para">
        上面的循环能跑通,但离"好用"还差很远。真实 Agent 的强弱,<b>八成不在模型,而在这层循环的工程质量</b>。
        几个最见效的方向:
      </p>
      <ul class="points">
        <li><b>让它先规划</b>:复杂任务先要模型产出一份步骤清单(TODO),再逐条执行、勾掉。有了显式计划,长任务不易跑偏。</li>
        <li><b>把错误当"观察"喂回去</b>:工具报错、参数非法、超时,别让循环崩溃 —— 把错误信息作为 tool 结果还给模型,让它自己纠正重试。</li>
        <li><b>预算与护栏</b>:除了 maxSteps,还要控 token 预算、单工具超时、危险操作需确认(如删文件、发请求)。</li>
        <li><b>上下文管理</b>:多步之后历史会爆窗口 —— 需要压缩旧步骤、只保留关键结果(呼应第 3 课的上下文管理)。</li>
        <li><b>子 Agent(分工)</b>:把大任务拆给专职子 Agent(如"只读代码的检索员"),各自独立上下文,结果汇总回主循环。</li>
        <li><b>更强的工具设计</b>:工具描述写清楚、报错信息可读、返回结构化 —— 模型用得对不对,很大程度取决于工具"说明书"的质量。</li>
      </ul>
      <CodeBlock title="加了护栏的循环(对比上面的最简版)" lang="ts" :code="betterLoopCode" />

      <details class="qa">
        <summary class="qa-summary">
          🧭 真实世界的 Agent 长什么样?(Hermes / Claude Code / DeepSeek Harness)
        </summary>
        <div class="qa-body">
          <p class="para">
            我们这个循环是"教学最小核"。业界成熟的 Agent 系统,都是在同一个内核上,把上面那些工程点做深。
            看三个有公开资料的例子:
          </p>

          <h4 class="qa-h">① Hermes:开源模型如何"没有 tool_calls 字段"也能调工具</h4>
          <p class="para">
            OpenAI/Claude 的接口有原生的 <code class="inline">tool_calls</code> 结构化字段。但很多开源模型没有 ——
            Nous 的 <b>Hermes</b> 系列用一套<b>纯文本标签约定</b>:工具定义放进 <code class="inline">&lt;tools&gt;</code>,
            模型输出 <code class="inline">&lt;tool_call&gt;{...}&lt;/tool_call&gt;</code>,你把结果用
            <code class="inline">&lt;tool_response&gt;</code> 包起来回填。这些标签甚至被训练成<b>单个 token</b>,方便流式解析。
          </p>
          <CodeBlock title="Hermes 的文本式工具调用(ChatML)" lang="ts" :code="hermesCode" />
          <p class="para">
            启示:<b>"工具调用"本质是一套模型与代码之间的文本协议</b>,原生字段只是把它标准化了。理解这点,
            你就能给任何模型接上工具。
          </p>

          <h4 class="qa-h">② Claude Code:把"工程护栏"做到极致的编码 Agent</h4>
          <p class="para">
            源码泄露后被大量分析。它的循环内核和我们一样,但外围极其厚重:内置约 27 个工具、
            用 <b>TodoWrite</b> 显式维护任务清单、可派发<b>子 Agent(fork)</b>在独立上下文里跑检索/规划、
            有细粒度<b>权限模型</b>(危险操作要确认)、还有上下文<b>压缩(compact)</b>机制应对长任务。
            这正是上面"想做得更好"那几条的完整落地。
          </p>

          <h4 class="qa-h">③ DeepSeek Harness:模型与"套子"协同设计</h4>
          <p class="para">
            DeepSeek 把这层循环叫 <b>Harness(套子)</b>,并开源了它。两个值得学的点:
            一是<b>轨迹(Trajectory)</b>—— 系统提示、推理、工具调用与结果全部记进一份 append-only 日志,
            可回放、可 fork、可搜索(和我们的"请求检查器"是同一种思路,只是更完整);
            二是提供<b>多种模式</b>(完整工具 / 代码编排 / 最小模式),甚至用最小模式(只有 shell + 文件编辑)去跑基准。
            它还强调<b>"模型—套子协同设计"</b>:把 Agent 运行中的失败反馈回去微调下一代模型。
          </p>

          <div class="side-note" style="margin-top: 4px">
            共同点:<b>内核都是这个 while 循环</b>(思考→行动→观察)。差异全在外围工程 ——
            规划、护栏、上下文管理、子 Agent、可观测性。你已经掌握了内核,剩下的是往上叠这些能力。
          </div>
          <p class="para" style="margin-bottom: 0; margin-top: 12px; font-size: 12px; color: var(--c-text-faint)">
            注:Claude Code 部分基于第三方泄露/逆向分析,非官方文档,细节以官方为准。
          </p>
        </div>
      </details>
    </template>
  </DemoLayout>
</template>

<style scoped>
.lamp-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--c-bg);
  border-radius: var(--radius-sm);
  margin-bottom: 6px;
}
.lamp {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 22px;
  background: #e5e7eb;
  transition: all 0.3s;
}
.lamp.on {
  background: #fef08a;
  box-shadow: 0 0 20px #fde047;
}
.lamp-text {
  font-size: 13px;
  color: var(--c-text-soft);
}
.field-label {
  display: block;
  font-size: 12.5px;
  color: var(--c-text-soft);
  font-weight: 500;
  margin: 14px 0 5px;
}
.tools-avail {
  margin-top: 8px;
  font-size: 12.5px;
  color: var(--c-text-soft);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
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
.qa {
  margin-top: 16px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  background: var(--c-surface);
  overflow: hidden;
}
.qa[open] {
  border-color: var(--c-primary);
  box-shadow: 0 0 0 3px var(--c-primary-soft);
}
.qa-summary {
  padding: 12px 14px;
  font-size: 13px;
  font-weight: 600;
  color: var(--c-primary-hover);
  cursor: pointer;
  list-style: none;
  user-select: none;
}
.qa-summary::-webkit-details-marker {
  display: none;
}
.qa-summary::before {
  content: '▸ ';
  color: var(--c-primary);
}
.qa[open] .qa-summary::before {
  content: '▾ ';
}
.qa[open] .qa-summary {
  border-bottom: 1px solid var(--c-border);
}
.qa-body {
  padding: 14px;
}
.qa-h {
  font-size: 13.5px;
  font-weight: 700;
  margin: 18px 0 6px;
}
.qa-h:first-of-type {
  margin-top: 4px;
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
