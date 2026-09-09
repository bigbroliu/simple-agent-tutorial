<script setup lang="ts">
/**
 * Demo 9 —— MCP:把工具变成可插拔的标准服务
 * 一个【能跑】的最简 MCP 例子:页面内有一个真实按 MCP 协议说话的 Server,
 * 客户端 initialize → tools/list 发现工具 → 交给 Agent 循环,tools/call 转发执行。
 * 所有 JSON-RPC 报文实时显示在"协议报文"面板里。
 */
import { ref } from 'vue';
import DemoLayout from '../components/DemoLayout.vue';
import CodeBlock from '../components/CodeBlock.vue';
import NoModelHint from '../components/NoModelHint.vue';
import AgentTrace from '../components/AgentTrace.vue';
import RequestInspector from '../components/RequestInspector.vue';
import SourceViewer from '../components/SourceViewer.vue';
import { runAgentLoop, type AgentEvent } from '../core/agent';
import { setActiveTag } from '../core/inspector';
import {
  McpClient,
  mcpToolsToSchemas,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from '../core/mcp';
import type { ToolSchema } from '../core/types';
import type { ChatMessage } from '../core/types';
import { useActiveModel } from '../components/useActiveModel';

const { active } = useActiveModel();

interface WireEntry {
  dir: 'send' | 'recv';
  text: string;
}
const wire = ref<WireEntry[]>([]);
const connected = ref(false);
const discoveredTools = ref<{ name: string; description: string }[]>([]);
let toolSchemas: ToolSchema[] = [];
let client: McpClient | null = null;

const prompt = ref('帮我掷一个 20 面骰子,然后统计「hello world from mcp」有几个单词。');
const events = ref<AgentEvent[]>([]);
const running = ref(false);
const connectError = ref('');

function logWire(dir: 'send' | 'recv', msg: JsonRpcRequest | JsonRpcResponse) {
  wire.value.push({ dir, text: JSON.stringify(msg, null, 2) });
}

// ① 连接真实的 MCP Server(独立进程)并发现工具
async function connect() {
  wire.value = [];
  discoveredTools.value = [];
  connected.value = false;
  connectError.value = '';
  try {
    // 通过同源 /mcp-proxy 连到独立进程的 MCP Server(见 mcp-server/index.ts)。
    // 换成任意远程 MCP 的 URL,下面的代码一行都不用改。
    client = new McpClient('/mcp-proxy', logWire);
    await client.initialize();
    const tools = await client.listTools();
    discoveredTools.value = tools.map((t) => ({ name: t.name, description: t.description }));
    toolSchemas = mcpToolsToSchemas(tools);
    connected.value = true;
  } catch (e: any) {
    connectError.value =
      `连接失败:${e?.message ?? e}。请确认 MCP Server 已启动(npm run dev 会一并拉起,或单独运行 npm run mcp)。`;
  }
}

// ② 把发现的工具交给 Agent 循环;工具执行【转发】给 MCP Server
async function run() {
  if (!active.value || !client) return;
  setActiveTag('demo9');
  running.value = true;
  events.value = [];
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: '你是一个助手,可以使用下列工具完成用户的任务,必要时多次调用。',
    },
    { role: 'user', content: prompt.value },
  ];
  try {
    await runAgentLoop({
      cfg: active.value,
      tools: toolSchemas,
      messages,
      maxSteps: 6,
      // ★ 关键:工具不在本地执行,而是通过 MCP 协议转发给 Server
      execTool: (name, args) => client!.callTool(name, args),
      onEvent: (e) => events.value.push(e),
    });
  } finally {
    running.value = false;
  }
}

const serverCode = `// mcp-server/index.ts —— 一个【真实、独立进程】的 MCP Server(官方 SDK)
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const server = new McpServer({ name: 'hy-demo-mcp', version: '0.1.0' });
server.registerTool('roll_dice',
  { description: '掷一个 N 面骰子',
    inputSchema: { sides: z.number().min(2).max(1000).optional() } },
  async ({ sides = 6 }) => ({
    content: [{ type: 'text', text: '掷出了 ' + (Math.floor(Math.random()*sides)+1) }],
  }),
);
// ...还注册了 count_words、server_info

// 走标准 Streamable HTTP,监听真实端口 5190
createServer(async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, await readBody(req));
}).listen(5190);`;

const clientCode = `// core/mcp.ts —— 浏览器端客户端:通过同源 /mcp-proxy 说真实 MCP over HTTP
const client = new McpClient('/mcp-proxy');   // 换成任意远程 MCP 的 URL 也一样
await client.initialize();                    // 握手(HTTP POST + JSON-RPC)
const tools = await client.listTools();       // 发现工具(tools/list)

// 交给我们已有的 Agent 循环,只把"工具执行"换成转发给 MCP:
await runAgentLoop({
  tools: mcpToolsToSchemas(tools),
  execTool: (name, args) => client.callTool(name, args), // tools/call
  /* cfg, messages, onEvent ... 其余和第 5、6 课完全一样 */
});`;
</script>

<template>
  <DemoLayout demo-id="mcp">
    <template #whatsnew>
      前面工具都是我们<b>写死在项目里</b>的。这一课换个来源:工具放在一个<b>真实、独立运行的
      MCP Server 进程</b>里(官方 SDK + 标准 HTTP 传输),Agent 通过协议<b>连上它、自动发现工具、远程调用</b>
      —— 而我们的 Agent 循环<b>几乎一行没改</b>。
    </template>

    <template #playground>
      <NoModelHint />

      <div class="step-card">
        <div class="step-head">① 连接 MCP Server 并发现工具</div>
        <button class="btn" :class="connected ? 'btn-ghost' : 'btn-primary'" @click="connect">
          {{ connected ? '✓ 已连接(可重连)' : '🔌 连接 hy-demo-mcp' }}
        </button>
        <div v-if="connectError" class="conn-err">{{ connectError }}</div>
        <div v-if="discoveredTools.length" class="discovered">
          <div class="discovered-label">Server 自报家门(tools/list),提供这些工具:</div>
          <div v-for="t in discoveredTools" :key="t.name" class="tool-chip">
            <code class="inline">{{ t.name }}</code><span>{{ t.description }}</span>
          </div>
        </div>
      </div>

      <div class="step-card" :class="{ disabled: !connected }">
        <div class="step-head">② 让模型使用这些(远程)工具完成任务</div>
        <textarea v-model="prompt" class="textarea" rows="2" :disabled="!connected" />
        <button
          class="btn btn-primary"
          style="margin-top: 8px"
          :disabled="running || !active || !connected"
          @click="run"
        >
          {{ running ? '运行中…' : '▶ 运行' }}
        </button>
        <p v-if="connected" class="hint-need-connect">
          试试问它 <code class="inline">server_info</code>:让模型报出 MCP Server 的进程 PID ——
          那个 PID 不是本页面的,证明工具真的跑在另一个进程里。
        </p>
        <p v-else class="hint-need-connect">请先完成第 ① 步连接。</p>
      </div>

      <h3 class="sec-title" style="margin-top: 18px">执行轨迹</h3>
      <AgentTrace :events="events" :running="running" />

      <div v-if="wire.length" class="wire">
        <div class="wire-label">📡 MCP 协议报文(经 /mcp-proxy 的真实 JSON-RPC 2.0 往返)</div>
        <div v-for="(w, i) in wire" :key="i" class="wire-item" :class="w.dir">
          <span class="wire-dir">{{ w.dir === 'send' ? 'Client →' : '← Server' }}</span>
          <pre class="wire-body">{{ w.text }}</pre>
        </div>
      </div>

      <RequestInspector tag="demo9" />

      <SourceViewer :files="['core/mcp.ts', 'core/agent.ts', 'core/types.ts']" />
    </template>

    <template #explain>
      <h3 class="sec-title">MCP 到底解决什么?</h3>
      <p class="para">
        回想第 4~7 课:每个工具都是<b>我们自己写在 <code class="inline">core/tools.ts</code> 里的代码</b>。
        工具少时没问题,但真实世界你想接入无数能力:读文件、查数据库、操作 GitHub、调 Figma……
        每个都自己实现、自己维护,既重复又不通用。
      </p>
      <p class="para">
        <b>MCP(Model Context Protocol)</b> 是 Anthropic 提出的开放协议,把"工具/数据源"标准化成
        <b>MCP Server</b>。任何遵循协议的 Agent(<b>MCP Client</b>)都能连上、<b>自动发现</b>它提供的工具、
        用统一方式调用。相当于给工具生态定了一个"USB 接口":一次接入,处处复用。
      </p>

      <h3 class="sec-title" style="margin-top: 18px">这次是"真的"MCP:一个独立进程</h3>
      <p class="para">
        和"页面内模拟"不同,这里的 Server 是一个<b>真正独立运行的 Node 进程</b>
        (<code class="inline">mcp-server/index.ts</code>,用官方 <code class="inline">@modelcontextprotocol/sdk</code> 写),
        监听端口 5190,走标准 <b>Streamable HTTP</b> 传输。浏览器端通过同源的
        <code class="inline">/mcp-proxy</code>(Vite 转发)连过去 —— 上面报文面板里的每一次收发,都是<b>真实的跨进程 HTTP 往返</b>。
      </p>
      <CodeBlock title="Server:独立进程,官方 SDK + HTTP 传输" lang="ts" :code="serverCode" />
      <div style="height: 12px" />
      <CodeBlock title="Client:浏览器端说真实 MCP over HTTP" lang="ts" :code="clientCode" />

      <ul class="points">
        <li><b>和 Tool Calling 的关系</b>:MCP 不取代 Tool Calling,而是它的"上游"—— 工具从哪来、怎么描述、怎么调用由 MCP 标准化;模型侧仍然是熟悉的 <code class="inline">tool_calls</code>。</li>
        <li><b>循环几乎没改</b>:我们只把 <code class="inline">runAgentLoop</code> 的工具执行器换成 <code class="inline">execTool: (n,a) => client.callTool(n,a)</code>。工具来源从"本地"变成"远程标准服务",循环逻辑不变。</li>
        <li>你在 <code class="inline">core/tools.ts</code> 里写的 <code class="inline">{ schema, run }</code>,本质就是一个"迷你的、本地的 MCP"。MCP 只是把它<b>搬到进程外、标准化</b>而已。</li>
      </ul>

      <div class="note-box">
        <b>两种传输,选哪种?</b> MCP 规定了两种标准传输,底层都是 JSON-RPC 2.0:
        <br />• <b>stdio</b> —— Server 作为客户端拉起的<b>子进程</b>,走标准输入输出。你在 Claude Code / Desktop 里装的本地工具
        (Figma、Filesystem、GitHub……)几乎都是这种。
        <br />• <b>Streamable HTTP</b> —— Server 是<b>独立/远程的 HTTP 服务</b>,连一个 URL。适合托管在别处的 MCP。
        <br />我们宿主是<b>浏览器</b>,起不了子进程,所以用 HTTP —— 这也是远程 MCP 的标准做法,协议方法完全一致。
      </div>

      <h3 class="sec-title" style="margin-top: 18px">什么该留在本地?</h3>
      <p class="para">
        既然 MCP 只是工具的一个<b>来源</b>,那问题就只有一个:<b>什么东西过不了进程边界</b>。
      </p>
      <ul class="points">
        <li>
          <b>进程内副作用</b> —— <code class="inline">toggle_lamp</code> 要派发 DOM 事件、
          <code class="inline">save_profile_card</code> 要 canvas 画图再触发下载。别的进程摸不到这张页面。
          <b>凡是要影响自家界面的工具(跳路由、开弹窗、高亮元素),天然只能在本地。</b>
        </li>
        <li>
          <b>宿主的身份与环境</b> —— <code class="inline">now</code> 返回的是<b>用户机器</b>的时钟与时区;
          换成 MCP 就成了服务器的。同理:cookie / session,以及剪贴板、定位、摄像头这些授权给<b>本页面</b>的能力。
        </li>
        <li>
          <b>不可序列化的东西</b> —— 协议上只能过 JSON。DOM 节点、函数、打开的连接都过不去。
          这也是浏览器自动化类 MCP 只能返回<b>元素 id</b> 的原因:真实句柄留在 Server 那边。
        </li>
        <li>
          <b>信任与失败面</b> —— 调 MCP 等于把参数交给第三方进程,还多出"服务没起来"这种失败模式
          (上面那句连接失败提示就是这一层)。
        </li>
      </ul>
      <div class="side-note">
        这条边界<b>有多硬,取决于宿主</b>。浏览器画得最硬(连子进程都起不了);若宿主是 Node 进程,
        前两条的大半就消失了。但最底下这条永远成立:<b>没有本地工具这一层,MCP 落不了地</b> ——
        <code class="inline">tools/list</code> 拿回的描述要靠本地代码翻译成 schema,
        <code class="inline">tools/call</code> 也得由本地代码发起。<b>Tool 是原语,MCP 是投递方式。</b>
      </div>

      <div class="end-box">
        到这里,工具的来源从"本地私有代码"扩展到了"另一个进程里的标准可插拔服务"。
        但工具解决的是<b>「能做」</b> —— 下一课讲<b>「会做」</b>:把团队的流程与规范沉淀成
        <b>Skill</b>,让模型按需装载。
      </div>
    </template>
  </DemoLayout>
</template>

<style scoped>
.step-card {
  padding: 14px 16px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  background: var(--c-surface);
  margin-bottom: 12px;
}
.step-card.disabled {
  opacity: 0.55;
}
.step-head {
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 10px;
}
.discovered {
  margin-top: 12px;
}
.discovered-label {
  font-size: 12px;
  color: var(--c-text-soft);
  margin-bottom: 6px;
}
.tool-chip {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12.5px;
  padding: 5px 0;
}
.tool-chip span {
  color: var(--c-text-soft);
}
.hint-need-connect {
  font-size: 12px;
  color: var(--c-text-faint);
  margin: 8px 0 0;
}
.conn-err {
  margin-top: 10px;
  padding: 10px 12px;
  background: var(--c-danger-soft);
  border: 1px solid #fecaca;
  border-radius: var(--radius-sm);
  color: var(--c-danger);
  font-size: 12.5px;
  line-height: 1.6;
}
.wire {
  margin-top: 16px;
}
.wire-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--c-text-soft);
  margin-bottom: 6px;
}
.wire-item {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
}
.wire-dir {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  padding-top: 8px;
  width: 58px;
  color: var(--c-text-faint);
}
.wire-item.send .wire-dir {
  color: var(--c-primary);
}
.wire-item.recv .wire-dir {
  color: var(--c-success);
}
.wire-body {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 8px 10px;
  background: #0f172a;
  color: #cbd5e1;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
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
  margin-bottom: 8px;
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
.note-box {
  margin-top: 18px;
  padding: 12px 14px;
  background: var(--c-warn-soft);
  border: 1px solid #fde68a;
  border-radius: var(--radius-sm);
  font-size: 12.5px;
  color: #92400e;
  line-height: 1.7;
}
.end-box {
  margin-top: 16px;
  padding: 14px 16px;
  background: #1e293b;
  color: #e2e8f0;
  border-radius: var(--radius-sm);
  font-size: 13px;
  line-height: 1.7;
}
.end-box code.inline {
  background: #334155;
  color: #93c5fd;
}
</style>
