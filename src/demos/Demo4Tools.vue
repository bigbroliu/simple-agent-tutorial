<script setup lang="ts">
/**
 * Demo 4 —— 会用工具(Tool Calling 协议)
 * 教学目标:看清 Tool Calling 的完整往返:
 *   发 tools 定义 → 模型返回 tool_calls → 我们执行 → 以 role:"tool" 回填 → 模型给最终答案
 * 这里手动展示每一步,先不套自动循环(那是下一步 Agent Loop 的事)。
 */
import { ref } from 'vue';
import DemoLayout from '../components/DemoLayout.vue';
import CodeBlock from '../components/CodeBlock.vue';
import NoModelHint from '../components/NoModelHint.vue';
import RequestInspector from '../components/RequestInspector.vue';
import ToolCodeEditor from '../components/ToolCodeEditor.vue';
import SourceViewer from '../components/SourceViewer.vue';
import SeqDiagram, { type SeqLane, type SeqStep, type SeqStat } from '../components/SeqDiagram.vue';
import { chatCompletion } from '../core/llm';
import { setActiveTag } from '../core/inspector';
import { toolSchemas, runTool } from '../core/tools';
import type { ChatMessage } from '../core/types';
import { useActiveModel } from '../components/useActiveModel';

const { active } = useActiveModel();

const prompt = ref('123456 乘以 789 等于多少?');
const loading = ref(false);
const errmsg = ref('');

// 分步展示的四个阶段
const step1 = ref<ChatMessage | null>(null); // 模型第一次回复(带 tool_calls)
const step2 = ref<{ name: string; args: any }[]>([]); // 解析出的调用
const step3 = ref<{ name: string; result: string }[]>([]); // 执行结果
const step4 = ref<string>(''); // 模型最终回答

const tools = toolSchemas(['calculator', 'now']);

async function run() {
  if (!active.value) return;
  setActiveTag('demo4');
  loading.value = true;
  errmsg.value = '';
  step1.value = null;
  step2.value = [];
  step3.value = [];
  step4.value = '';

  // system 提示:引导模型在需要计算/查询时使用工具,而不是自己心算
  // (模型常觉得"简单乘法我自己能算"就偷懒 —— 而且往往算错)
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        '当遇到数学计算、查询当前时间等需求时,你必须调用提供的工具来完成,不要自己心算或凭空回答。',
    },
    { role: 'user', content: prompt.value },
  ];

  try {
    // ① 带着 tools 定义问模型
    const first = await chatCompletion(active.value, messages, { tools });
    step1.value = first;
    messages.push(first);

    const calls = first.tool_calls ?? [];
    if (calls.length === 0) {
      step4.value = first.content ?? '(模型没有调用工具,直接回答了)';
      return;
    }

    // ② 解析 tool_calls(arguments 是字符串,要 parse)
    for (const call of calls) {
      const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      step2.value.push({ name: call.function.name, args });

      // ③ 我们执行工具
      const result = await runTool(call.function.name, args);
      step3.value.push({ name: call.function.name, result });

      // 以 role:"tool" 把结果回填
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.function.name,
        content: result,
      });
    }

    // ④ 带着工具结果再问一次,模型给出最终自然语言答案
    const final = await chatCompletion(active.value, messages, { tools });
    step4.value = final.content ?? '';
  } catch (e: any) {
    errmsg.value = e?.message ?? String(e);
  } finally {
    loading.value = false;
  }
}

const toolDefCode = `// 工具定义 = 给模型看的"说明书"(JSON Schema)
{
  type: 'function',
  function: {
    name: 'calculator',
    description: '计算一个数学表达式并返回结果',
    parameters: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: '如 "23 * (4 + 1)"' },
      },
      required: ['expression'],
    },
  },
}`;

const flowCode = `// 一次完整的 Tool Calling 往返
// ① 带 tools 问
const first = await chat(messages, { tools });
// ② 模型返回它想调的工具
for (const call of first.tool_calls) {
  // ⚠️ 参数是字符串,必须自己 parse
  const args = JSON.parse(call.function.arguments);
  // ③ 我们执行
  const result = await runTool(call.function.name, args);
  // 把结果回填
  messages.push({ role: 'tool', tool_call_id: call.id, content: result });
}
// ④ 模型据此给最终回答
const final = await chat(messages, { tools });`;

// 工具的【真实实现】—— 这才是模型永远碰不到、只能由我们执行的部分
const toolImplCode = `// core/tools.ts —— 一个工具 = 给模型的 schema + 我们自己的 run 函数
const calculator = {
  schema: { /* 上面那份给模型看的 JSON Schema */ },

  // 真正干活的代码。模型只会"请求"调用它,执行始终在我们这边:
  run: ({ expression }) => {
    // 教学项目:白名单校验,只允许数字与运算符,杜绝 eval 任意代码
    if (!/^[\\d\\s+\\-*/.()%]+$/.test(expression)) {
      return '错误:表达式含有不允许的字符';
    }
    try {
      const result = Function(\`"use strict"; return (\${expression})\`)();
      return String(result);   // 123456 * 789 → "97406784"(精确,不像模型心算会错)
    } catch {
      return '错误:无法计算该表达式';
    }
  },
};`;

// runTool:按名字把模型的调用请求,派发到对应工具的 run 函数
const dispatchCode = `// core/tools.ts —— 调度器:名字 → 找到工具 → 执行它的 run
const registry = { calculator, now, /* toggle_lamp, get_weather... */ };

export async function runTool(name, args) {
  const tool = registry[name];
  if (!tool) return \`错误:未知工具 \${name}\`;
  return await tool.run(args);   // 参数已由外层 JSON.parse 好
}`;

// 编码类 Agent(如 Claude Code)最常见的几个工具 —— 只看给模型的 schema
const commonToolsCode = `// 这些是"编码 Agent"的标配工具。注意:schema 长得都一样,
// 差别只在 run 里到底干了什么(读文件 / 跑命令 / 搜索…)。

// ① 执行 shell 命令 —— 能力最强也最危险
{ name: 'bash',
  description: '在工作目录里执行一条 shell 命令,返回 stdout/stderr',
  parameters: { type: 'object',
    properties: { command: { type: 'string', description: '如 "npm test"' } },
    required: ['command'] } }

// ② 读文件(通常支持按行区间,避免一次塞爆上下文)
{ name: 'read_file',
  description: '读取一个文件的内容',
  parameters: { type: 'object',
    properties: {
      path:   { type: 'string' },
      offset: { type: 'number', description: '起始行(可选)' },
      limit:  { type: 'number', description: '读取行数(可选)' } },
    required: ['path'] } }

// ③ 搜索代码(grep / ripgrep)
{ name: 'grep',
  description: '在代码库里按正则搜索,返回匹配的文件与行',
  parameters: { type: 'object',
    properties: {
      pattern: { type: 'string' },
      path:    { type: 'string', description: '搜索目录(可选)' } },
    required: ['pattern'] } }

// ④ 找文件(按 glob 模式)
{ name: 'glob',
  description: '按通配符查找文件路径,如 "src/**/*.ts"',
  parameters: { type: 'object',
    properties: { pattern: { type: 'string' } },
    required: ['pattern'] } }

// ⑤ 精确改文件:把 old_string 替换成 new_string(比整文件重写更省 token、更安全)
{ name: 'edit_file',
  description: '在文件里做一次精确的字符串替换',
  parameters: { type: 'object',
    properties: {
      path:       { type: 'string' },
      old_string: { type: 'string', description: '要被替换的原文(需唯一)' },
      new_string: { type: 'string' } },
    required: ['path', 'old_string', 'new_string'] } }`;

// 以 read_file 为例,run 里才是真正干活的地方(Node 环境)
const nodeToolCode = `// 在 Node 后端里,read_file 的 run 大致长这样:
run: async ({ path, offset = 0, limit = 2000 }) => {
  const text = await fs.readFile(path, 'utf-8');
  const lines = text.split('\\n').slice(offset, offset + limit);
  // 常见做法:带上行号,方便模型引用"第几行"
  return lines.map((l, i) => \`\${offset + i + 1}\\t\${l}\`).join('\\n');
}`;

// 点破:tool_calls 里的 arguments 本身就是"结构化输出"
const structuredCode = `// 模型返回的 tool_calls,arguments 是一段【JSON 字符串】
{
  "tool_calls": [{
    "function": {
      "name": "calculator",
      "arguments": "{\\"expression\\": \\"123456 * 789\\"}"  // ← 结构化数据
    }
  }]
}

// 我们的代码正是靠"按字段读取"才能执行它:
const call = reply.tool_calls[0];
const args = JSON.parse(call.function.arguments); // → { expression: "123456 * 789" }
runTool(call.function.name, args.expression);     // 读 .name、读 .expression

// 如果模型回的是一句话"我想算 123456 乘 789",这几行代码全废 ——
// call.function 是 undefined,程序没法执行。`;

/* ============================================================
 * 讲解区:可播放的单工具往返图
 * 三条泳道(我们的代码 / 模型 / 工具),8 步走完一次 Tool Calling。
 * 只有【一轮】—— 和第 5 课的循环形成对照:这里第 8 步就结束了,
 * 如果模型还想再调一个工具,这段手写代码就接不住了。
 * ============================================================ */

const LANES: SeqLane[] = [
  { icon: '🖥️', name: '我们的代码', sub: '(浏览器)' },
  { icon: '🧠', name: '模型' },
  { icon: '🔧', name: '工具', sub: '(calculator)' },
];

const STATS: SeqStat[] = [{ label: '次请求模型', count: 'call' }];

const STEPS: SeqStep[] = [
  {
    from: 0, to: 0, kind: 'ask', meter: 2, group: '第 1 次请求',
    label: '准备 messages:system + 用户问题',
    note: '和前几课一样的两条消息。真正的新东西是下一步多带的那个字段。',
  },
  {
    from: 0, to: 1, kind: 'call', meter: 2, label: 'messages + tools(工具说明书)',
    note: '★ 本课唯一的新增:请求体里多了 tools 数组 —— 每个工具的名字、用途、参数 JSON Schema。模型这才知道"我有工具可用"。',
  },
  {
    from: 1, to: 0, kind: 'ret', meter: 3, label: 'tool_calls,content 为空',
    note: '★ 模型没有回答问题,而是回了一个结构化的请求:"我想调 calculator"。注意它只是【点名】—— 它没有、也不可能执行任何代码。',
  },
  {
    from: 0, to: 0, kind: 'ask', meter: 3, dep: true,
    label: 'JSON.parse(arguments)',
    note: '★ 最常踩的坑:arguments 是一段【字符串】,不是对象,必须自己 parse。解析出来才是 { expression: "123456 * 789" }。',
  },
  {
    from: 0, to: 2, kind: 'exec', meter: 3, dep: true, label: 'runTool("calculator", args)',
    note: '★ 执行发生在我们这一侧。按名字派发到工具的 run 函数 —— 左侧「工具代码(可编辑)」里就是这段 run,你可以当场改。',
  },
  {
    from: 2, to: 0, kind: 'obs', meter: 4, label: '"97406784"(精确结果)',
    note: '工具返回真实结果,并以 role:"tool" + tool_call_id 追加进 messages —— tool_call_id 让模型知道这是哪次调用的结果。',
  },
  {
    from: 0, to: 1, kind: 'call', meter: 4, loop: true, group: '第 2 次请求',
    label: '带着工具结果再问一次',
    note: '★ 一次工具调用 = 两次请求模型。第二次的 messages 里多了"模型的点名"和"工具的结果"两条。',
  },
  {
    from: 1, to: 0, kind: 'final', meter: 5, label: '"结果是 97406784"',
    note: '这次响应里没有 tool_calls,只有文字 —— 往返结束。但这套代码只写死了一轮:模型若想接着调第二个工具,这里就接不住了。那正是第 5 课要把它包进循环的原因。',
  },
];
</script>

<template>
  <DemoLayout demo-id="tools">
    <template #whatsnew>
      模型第一次拥有"调用外部能力"的资格。我们把 <code class="inline">tools</code> 定义发给它,
      它会返回一个 <code class="inline">tool_calls</code> 请求 —— 但<b>执行永远是我们的事</b>。
    </template>

    <template #playground>
      <NoModelHint />
      <label class="field-label">给模型一个需要算/查的问题</label>
      <textarea v-model="prompt" class="textarea" rows="2" />
      <div class="tools-avail">
        可用工具:<span class="tag tag-info">calculator</span>
        <span class="tag tag-info">now</span>
      </div>
      <button class="btn btn-primary" style="margin-top: 10px" :disabled="loading || !active" @click="run">
        {{ loading ? '处理中…' : '执行(看四步往返)' }}
      </button>

      <div v-if="errmsg" class="err">{{ errmsg }}</div>

      <div v-if="step1" class="flow">
        <div class="flow-step">
          <div class="flow-num">1</div>
          <div class="flow-content">
            <div class="flow-title">模型不直接回答,而是请求调用工具</div>
            <div v-for="(c, i) in step2" :key="i" class="chip">
              🔧 {{ c.name }}(<code class="inline">{{ JSON.stringify(c.args) }}</code>)
            </div>
            <div v-if="step2.length === 0" class="flow-note">模型选择直接回答,未用工具</div>
          </div>
        </div>
        <div v-if="step3.length" class="flow-step">
          <div class="flow-num">2</div>
          <div class="flow-content">
            <div class="flow-title">前端执行工具,拿到真实结果</div>
            <div v-for="(r, i) in step3" :key="i" class="chip chip-ok">
              📥 {{ r.name }} → {{ r.result }}
            </div>
          </div>
        </div>
        <div v-if="step4" class="flow-step">
          <div class="flow-num">3</div>
          <div class="flow-content">
            <div class="flow-title">把结果回填,模型给出最终答案</div>
            <div class="final">{{ step4 }}</div>
          </div>
        </div>
      </div>

      <RequestInspector tag="demo4" />

      <ToolCodeEditor :names="['calculator', 'now']" />

      <SourceViewer :files="['core/tools.ts', 'core/llm.ts', 'core/adapters.ts', 'core/types.ts']" />
    </template>

    <template #explain>
      <h3 class="sec-title">给模型趁手的工具</h3>
      <p class="para">
        <b>模型不会执行任何代码。</b>它只是读了工具"说明书"后,产出一个结构化的
        "我想调用 calculator,参数是 {...}"。真正的执行、拿结果、再把结果喂回去,
        全是<b>我们前端的代码</b>在做。想清楚这条,Tool Calling 就通了。
      </p>
      <CodeBlock title="① 工具定义(发给模型)" lang="ts" :code="toolDefCode" />
      <div style="height: 12px" />
      <CodeBlock title="② 完整往返(core/tools.ts + llm.ts)" lang="ts" :code="flowCode" />

      <h3 class="sec-title" style="margin-top: 20px">交互图:一次工具调用的完整往返</h3>
      <p class="para">
        把上面那段代码画出来。<b>点播放走一遍</b> —— 重点看两件事:
        <b>模型只"点名"、执行永远在我们这边</b>;以及<b>一次工具调用要请求模型两次</b>。
      </p>
      <SeqDiagram
        :lanes="LANES"
        :steps="STEPS"
        :stats="STATS"
        meter-label="messages"
        hint="点「▶ 播放」逐步观看一次 Tool Calling 往返:2 次请求模型、1 次工具执行、messages 从 2 条长到 5 条。"
      />

      <ul class="points">
        <li><code class="inline">arguments</code> 是<b>字符串化的 JSON</b>,必须 <code class="inline">JSON.parse</code>,这是新手最常踩的坑。</li>
        <li>工具结果要用 <code class="inline">role: "tool"</code> + <code class="inline">tool_call_id</code> 回填,模型才知道对应哪次调用。</li>
        <li>注意:这里<b>手动</b>只走了一轮。如果模型需要连续用多个工具呢?那就要把这套往返包进一个"循环"。</li>
      </ul>

      <h3 class="sec-title" style="margin-top: 20px">工具的真实代码</h3>
      <p class="para">
        上面的"说明书"只是给模型看的 schema。工具<b>真正的实现</b>是下面这段 —— 一个普通的
        <code class="inline">run</code> 函数,想写什么逻辑都行(算数、查数据库、调别的 API)。
        <b>模型永远看不到、也无法执行它</b>;它只能产出"我想调 calculator",执行始终在我们手里。
      </p>
      <CodeBlock title="工具实现:一个工具 = schema + run 函数" lang="ts" :code="toolImplCode" />
      <div style="height: 12px" />
      <CodeBlock title="runTool:按名字把调用派发到对应工具" lang="ts" :code="dispatchCode" />
      <ul class="points">
        <li>工具想干什么完全由 <code class="inline">run</code> 决定 —— 后面 Demo 6 的 <code class="inline">get_weather</code> 就在 <code class="inline">run</code> 里真的发了网络请求。</li>
        <li>安全上,<code class="inline">run</code> 里务必对模型给的参数做校验(如这里的白名单),别直接信任 —— 参数是模型"编"出来的。</li>
        <li>工具返回值最终会以 <code class="inline">role: "tool"</code> 回填,所以<b>返回字符串</b>最省事。</li>
      </ul>
      <div class="editor-hint">
        👉 左侧运行区底部有一个<b>「工具代码(可编辑)」</b>面板:那里显示的就是每个工具真正执行的
        <code class="inline">run</code> 源码,你可以<b>当场改它再点执行</b>,直观感受"执行完全在我们手里"。
        比如把 calculator 改成永远返回 42,看模型会拿到什么。
      </div>

      <h3 class="sec-title" style="margin-top: 20px">顺带认识一个词:结构化输出</h3>
      <p class="para">
        你可能没注意到:上面模型返回的 <code class="inline">tool_calls</code>,里面的 <code class="inline">arguments</code>
        <b>本身就是一段 JSON</b>。这就是"<b>结构化输出</b>" —— 模型的输出不是给人读的一段话,
        而是<b>能被代码按字段读取的数据</b>。
      </p>
      <CodeBlock title="tool_calls 里的 arguments 就是结构化输出" lang="ts" :code="structuredCode" />
      <p class="para">
        为什么工具调用非得这样?因为<b>接收方是代码,不是人</b>。我们的程序要靠
        <code class="inline">call.function.name</code>、<code class="inline">args.expression</code> 这种<b>按字段取值</b>去执行 ——
        代码只认字段,不认人话。<b>判断标准就一条:模型的输出下一步是进人的眼睛,还是进代码的 <code class="inline">.parse()</code>?</b>
        进代码,就必须结构化。
      </p>
      <div class="editor-hint">
        📌 记住这个概念 —— 它是后面 Agent 能"自主干活"的地基:第 5、6 课的循环,正是靠每一步都拿到
        <code class="inline">{ name, args }</code> 这种结构化数据,才能接住模型的决定、把结果喂给下一步。
        而"模型是概率的、万一没吐出合法结构怎么办",<b>第 7 课</b>会专门讲怎么兜底。
      </div>

      <details class="qa">
        <summary class="qa-summary">
          🛠️ 真实 Agent 都有哪些工具?(bash / read_file / grep / edit_file …)
        </summary>
        <div class="qa-body">
          <p class="para">
            我们 Demo 里的 calculator、天气只是玩具。<b>编码类 Agent</b>(如 Claude Code、Cursor、各种 CLI Agent)
            靠的是另一组工具 —— 让模型能真正读写代码库、跑命令。它们的 schema 结构和 calculator 一模一样,
            <b>差别只在 run 里干了什么</b>:
          </p>
          <CodeBlock title="编码 Agent 的标配工具(只看 schema)" lang="ts" :code="commonToolsCode" />

          <h4 class="qa-h">这些工具怎么分类</h4>
          <ul class="points">
            <li><b>读类</b>:<code class="inline">read_file</code>、<code class="inline">grep</code>、<code class="inline">glob</code>、<code class="inline">ls</code> —— 只获取信息,安全,可放心自动执行。</li>
            <li><b>写类</b>:<code class="inline">edit_file</code>、<code class="inline">write_file</code> —— 改动磁盘,通常需要审阅或确认。</li>
            <li><b>执行类</b>:<code class="inline">bash</code> —— 能力最强(装依赖、跑测试、git),也最危险,几乎都要权限控制。</li>
            <li><b>网络类</b>:<code class="inline">web_fetch</code>、<code class="inline">web_search</code> —— 补充模型没有的实时/外部信息(和本课 Demo 6 的天气工具同类)。</li>
          </ul>

          <h4 class="qa-h">run 里才是真正干活的地方</h4>
          <p class="para">
            浏览器里没有文件系统和 shell,所以上面这些只能在 <b>Node/后端</b>环境里跑。以 <code class="inline">read_file</code> 为例:
          </p>
          <CodeBlock title="read_file 的 run(Node 环境)" lang="ts" :code="nodeToolCode" />

          <h4 class="qa-h">几个来自真实工程的设计经验</h4>
          <ul class="points">
            <li><b>edit 用"精确替换"而非整文件重写</b>:传 <code class="inline">old_string→new_string</code> 比让模型重吐整个文件更省 token、更不易改错。</li>
            <li><b>read 带行号、支持区间</b>:大文件一次性读会撑爆上下文;返回时带行号,模型才能准确引用"第几行"。</li>
            <li><b>bash 是双刃剑</b>:一个 bash 工具几乎等于所有能力(它能 <code class="inline">cat</code>、<code class="inline">sed</code>…),但也能 <code class="inline">rm -rf</code>。所以真实 Agent 要么限制命令、要么危险操作弹确认。</li>
            <li><b>工具描述就是给模型的 API 文档</b>:描述含糊,模型就会用错、传错参数。写清楚"什么时候用、参数啥意思"和写代码注释一样重要。</li>
          </ul>
          <div class="side-note">
            一句话:给 Agent 加能力 = 加工具。工具的<b>协议</b>(schema)都一样,真正的差异和风险都在
            <code class="inline">run</code> 里。理解了 calculator,你就理解了 bash —— 只是后者的 run 危险得多。
          </div>
        </div>
      </details>
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
.tools-avail {
  margin-top: 8px;
  font-size: 12.5px;
  color: var(--c-text-soft);
  display: flex;
  align-items: center;
  gap: 6px;
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
.flow {
  margin-top: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.flow-step {
  display: flex;
  gap: 12px;
}
.flow-num {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--c-primary);
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 13px;
  font-weight: 600;
}
.flow-content {
  flex: 1;
}
.flow-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
}
.flow-note {
  font-size: 12.5px;
  color: var(--c-text-faint);
}
.chip {
  display: inline-block;
  margin: 3px 6px 3px 0;
  padding: 5px 10px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: var(--radius-sm);
  font-size: 12.5px;
}
.chip-ok {
  background: var(--c-success-soft);
  border-color: #a7f3d0;
}
.final {
  padding: 12px 14px;
  background: var(--c-primary-soft);
  border-radius: var(--radius-sm);
  font-size: 14px;
  white-space: pre-wrap;
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
.editor-hint {
  margin-top: 14px;
  padding: 12px 14px;
  background: var(--c-primary-soft);
  border: 1px solid #c7d2fe;
  border-radius: var(--radius-sm);
  font-size: 12.5px;
  color: var(--c-primary-hover);
  line-height: 1.7;
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
