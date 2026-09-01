<script setup lang="ts">
/**
 * Demo 2 —— 会聊天(流式)
 * 教学目标:手写 SSE 解析,实现打字机效果 + system prompt 决定"它是谁"。
 */
import { ref } from 'vue';
import DemoLayout from '../components/DemoLayout.vue';
import CodeBlock from '../components/CodeBlock.vue';
import NoModelHint from '../components/NoModelHint.vue';
import RequestInspector from '../components/RequestInspector.vue';
import SourceViewer from '../components/SourceViewer.vue';
import { streamChatCompletion } from '../core/llm';
import { setActiveTag } from '../core/inspector';
import { useActiveModel } from '../components/useActiveModel';

const { active } = useActiveModel();

// 两套预设:切换后可直观对比 system 如何约束模型的行为
const PRESETS = [
  {
    label: '毒舌面试官',
    system: '你是一位毒舌但专业的前端技术面试官,回答简短犀利。',
    prompt: '闭包会造成内存泄漏吗?',
  },
  {
    label: '前端专家(会拒答越界问题)',
    system: '你是一个前端专家,只能回答前端开发相关的问题。',
    prompt: '中国的 24 节气都有什么?',
  },
];

const presetIdx = ref(0);
const system = ref(PRESETS[0].system);
const prompt = ref(PRESETS[0].prompt);
const output = ref('');
const loading = ref(false);
const errmsg = ref('');

function applyPreset(i: number) {
  presetIdx.value = i;
  system.value = PRESETS[i].system;
  prompt.value = PRESETS[i].prompt;
  output.value = '';
  errmsg.value = '';
}

async function run() {
  if (!active.value) return;
  setActiveTag('demo2');
  loading.value = true;
  output.value = '';
  errmsg.value = '';
  const messages = [
    { role: 'system' as const, content: system.value },
    { role: 'user' as const, content: prompt.value },
  ];
  try {
    await streamChatCompletion(active.value, messages, (delta) => {
      output.value += delta; // 每来一小段就追加,视觉上就是打字机
    });
  } catch (e: any) {
    errmsg.value = e?.message ?? String(e);
  } finally {
    loading.value = false;
  }
}

const sseCode = `// core/llm.ts —— 手写 SSE 流式解析(前端最陌生的一块)
const reader = resp.body.getReader();
const decoder = new TextDecoder('utf-8');
// 半包缓冲:一帧可能被网络切成两段
let buffer = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });

  // SSE 事件以空行分隔
  const parts = buffer.split('\\n\\n');
  // 最后一段可能不完整,留着
  buffer = parts.pop() ?? '';
  for (const part of parts) {
    for (const line of part.split('\\n')) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      const json = JSON.parse(payload);
      const delta = json.choices[0].delta.content ?? '';
      // 吐给 UI,追加显示
      if (delta) onDelta(delta);
    }
  }
}`;

// SSE 在网络上真实的样子:纯文本,每个事件之间用一个空行(\n\n)分隔
const sseWireFormat = `HTTP/1.1 200 OK
Content-Type: text/event-stream    ← 就是这个 MIME 类型标志着"这是 SSE"
Cache-Control: no-cache
Connection: keep-alive

data: {"choices":[{"delta":{"content":"你"}}]}

data: {"choices":[{"delta":{"content":"好"}}]}

data: [DONE]`;

// 为什么不用浏览器原生的 EventSource?
const whyNotEventSource = `// ❌ 原生 EventSource:看似为 SSE 而生,却用不了
const es = new EventSource('/chat');
// 1. 只能发 GET,无法带 body(我们要 POST 一大坨 messages)
// 2. 无法自定义请求头(带不了 Authorization / x-api-key)
// 3. 断线会自动重连 —— 对话场景反而会重复触发,不是我们想要的

// ✅ 所以用 fetch + ReadableStream 自己读,把控制权拿回手里`;

// 普通请求 vs SSE:同样一个 HTTP 请求,区别只在"响应体什么时候结束"
const connectionModel = `// 普通请求:一次性拿到完整响应,连接随即关闭
浏览器 ──请求──▶ 服务器
浏览器 ◀─完整响应─ 服务器        (耗时 3s,期间一直 pending)
连接关闭 ✅

// SSE:请求发出后连接【一直不关】,服务器分多次往里写
浏览器 ──请求──▶ 服务器
浏览器 ◀── data: 片段1 ── 服务器   ┐
浏览器 ◀── data: 片段2 ── 服务器   │ 连接始终 pending,
浏览器 ◀── data: 片段3 ── 服务器   │ 服务器有内容就写一段
浏览器 ◀── data: [DONE] ─ 服务器   ┘
连接关闭 ✅`;

// EventSource:浏览器给 SSE 内置的"官方客户端",几行就能用
const eventSourceBasic = `// 服务器只要按 SSE 格式吐数据,浏览器原生 API 就能收
const es = new EventSource('/notifications');
es.onmessage = (e) => {
  console.log('收到一条推送:', e.data);   // e.data 就是 data: 后面那段字符串
};
// 底层其实就是发了个普通 GET,然后保持连接、逐帧解析 —— 只是浏览器替你做了`;

// POST 版的"EventSource"其实早有了 —— 只是以库的形式,底座就是 fetch
const fetchBasedLib = `// 如 @microsoft/fetch-event-source:用起来像 EventSource,底层是 fetch
import { fetchEventSource } from '@microsoft/fetch-event-source';

await fetchEventSource('/chat', {
  method: 'POST',                              // ✅ 能用 POST
  headers: { Authorization: 'Bearer ...' },    // ✅ 能带鉴权头
  body: JSON.stringify({ messages }),          // ✅ 能带 body
  onmessage: (ev) => append(ev.data),
});
// 它内部做的,正是本页手写的那套:getReader → decode → 按 \\n\\n 切帧`;
</script>

<template>
  <DemoLayout demo-id="chat">
    <template #whatsnew>
      两点:① 加入 <code class="inline">system</code> 角色设定,决定模型"是谁";
      ② 打开 <code class="inline">stream: true</code>,自己解析 SSE 实现逐字输出。
    </template>

    <template #playground>
      <NoModelHint />
      <div class="presets">
        <span class="presets-label">预设:</span>
        <button
          v-for="(p, i) in PRESETS"
          :key="i"
          class="btn btn-sm"
          :class="{ 'preset-on': presetIdx === i }"
          @click="applyPreset(i)"
        >
          {{ p.label }}
        </button>
      </div>
      <label class="field-label">System(角色设定)—— 试着改改它,看回答风格如何突变</label>
      <textarea v-model="system" class="textarea" rows="2" />
      <label class="field-label">你的问题</label>
      <textarea v-model="prompt" class="textarea" rows="2" />
      <button class="btn btn-primary" style="margin-top: 10px" :disabled="loading || !active" @click="run">
        {{ loading ? '生成中…' : '流式发送' }}
      </button>

      <p class="preset-hint">
        💡 试试第二套预设:角色限定"只答前端问题",再问它"24 节气"这种<b>越界问题</b>,
        看 system 的约束力 —— 这就是角色设定的意义。
      </p>

      <div v-if="errmsg" class="err">{{ errmsg }}</div>

      <div v-if="output || loading" class="answer">
        <div class="answer-label">模型回复(逐字流式)<span v-if="loading" class="cursor">▋</span></div>
        <div class="answer-body">{{ output }}</div>
      </div>

      <RequestInspector tag="demo2" />

      <SourceViewer :files="['core/llm.ts', 'core/adapters.ts', 'core/types.ts']" />
    </template>

    <template #explain>
      <h3 class="sec-title">流式为什么重要?</h3>
      <p class="para">
        大模型是逐 token 生成的。等它全部生成完再显示,用户要干等好几秒;
        <b>流式</b>让文字像打字机一样即时出现,体验天差地别。这也是所有聊天产品的标配。
      </p>

      <h3 class="sec-title" style="margin-top: 18px">什么是 SSE?</h3>
      <p class="para">
        SSE = <b>Server-Sent Events</b>(服务器发送事件)。一句话:<b>服务器保持连接不关闭,
        持续不断地往客户端"推"文本片段</b>,直到自己说结束。它是<b>单向</b>的(只有服务器→客户端),
        这和大模型"边生成边吐字"的场景天然契合。
      </p>
      <p class="para">
        它<b>就是普通的 HTTP</b>,不是什么新协议——不需要像 WebSocket 那样"升级协议 / 换端口"。
        秘密只在两点:响应头里 <code class="inline">Content-Type: text/event-stream</code>,
        以及响应体<b>不一次性返回、而是慢慢写</b>。SSE 只是给这种"长响应"定了一套极简的文本格式:
      </p>
      <CodeBlock title="SSE 在网络上真实的样子(纯文本)" lang="ts" :code="sseWireFormat" />
      <ul class="points">
        <li>每个事件一行 <code class="inline">data:</code> 开头,事件之间用<b>一个空行</b>(<code class="inline">\n\n</code>)分隔。</li>
        <li><code class="inline">data:</code> 后面可以是任意字符串;这里各厂商放的是一段 JSON。</li>
        <li>结束由<b>约定</b>决定:OpenAI 系发一个 <code class="inline">data: [DONE]</code>,然后关闭连接。</li>
      </ul>

      <h3 class="sec-title" style="margin-top: 18px">是"调一次接口,一直 pending"吗?</h3>
      <p class="para">
        <b>正是如此。</b>SSE 不是轮询(不是每隔几秒发一个新请求),而是<b>只发一次请求,
        然后这个连接就一直挂着不关</b>。区别于普通请求的唯一一点是:普通请求服务器把响应体
        一次性写完就关闭连接;SSE 里服务器<b>把响应体拆成很多段、隔一会儿写一段</b>,连接始终保持,
        直到服务器主动结束。
      </p>
      <CodeBlock title="普通请求 vs SSE:区别只在响应体何时结束" lang="ts" :code="connectionModel" />
      <ul class="points">
        <li>在浏览器 Network 面板里,SSE 请求会长时间停在 <b>pending</b> 状态,响应内容<b>随时间一点点变长</b>——这就是它"活着"的样子。</li>
        <li>正因为连接长期占用,服务端通常要为它调大超时时间,并在客户端断开时及时释放资源。</li>
        <li>它比"前端每隔 N 秒轮询一次"更省资源、更实时——没有反复建连的开销,服务器有新数据即刻推。</li>
      </ul>

      <h3 class="sec-title" style="margin-top: 18px">SSE 在 AI 之前是干嘛的?</h3>
      <p class="para">
        SSE 不是为大模型发明的,它 2010 年前后就随 HTML5 进了标准,是个"老技术"。
        只是过去它一直比较小众,典型用在这些<b>"服务器有新东西就推给我"</b>的单向场景:
      </p>
      <ul class="points">
        <li><b>实时通知 / 消息提醒</b>:站内信、系统公告、"你有一条新回复"。</li>
        <li><b>数据看板 / 监控大屏</b>:股价、体育比分、服务器指标持续刷新。</li>
        <li><b>进度推送</b>:后端跑长任务(导出、转码、构建),不断把进度百分比推给前端。</li>
        <li><b>feed 流更新</b>:社交时间线有新内容时提示"点击查看 N 条新动态"。</li>
      </ul>
      <p class="para">
        这些场景的共同点和 AI 对话一模一样:<b>数据只从服务器流向客户端,客户端不需要边收边发</b>。
        大模型"逐字吐 token"恰好落在这个模型里,于是 SSE 一下子成了 AI 对话的事实标准——
        它不是新事物,而是<b>一个老能力找到了它最合适的杀手级场景</b>。
      </p>

      <h3 class="sec-title" style="margin-top: 18px">那和 WebSocket 是什么关系?</h3>
      <p class="para">
        既然要"服务器实时推数据",很多人第一反应是 WebSocket。两者确实都能做实时,但定位不同:
        <b>SSE 是单向(服务器→客户端)的纯 HTTP;WebSocket 是全双工(双向)的独立协议</b>。
      </p>
      <div class="table-wrap">
        <table class="cmp">
          <thead>
            <tr><th></th><th>SSE</th><th>WebSocket</th></tr>
          </thead>
          <tbody>
            <tr><td>方向</td><td>单向 · 服务器→客户端</td><td>双向 · 全双工</td></tr>
            <tr><td>底层</td><td>就是 HTTP,普通请求</td><td>握手后升级为 ws:// 独立协议</td></tr>
            <tr><td>数据</td><td>只能文本(UTF-8)</td><td>文本 + 二进制</td></tr>
            <tr><td>断线重连</td><td>用 EventSource 时浏览器自动重连</td><td>要自己实现心跳与重连</td></tr>
            <tr><td>基建友好度</td><td>高:走 80/443,代理/CDN 通吃</td><td>低:部分代理、网关需特殊配置</td></tr>
            <tr><td>复杂度</td><td>低</td><td>较高</td></tr>
          </tbody>
        </table>
      </div>
      <p class="para">
        判断很简单:<b>只需要"服务器往下推"就用 SSE;需要客户端也高频往上发(在线协作、多人游戏、
        实时音视频信令)才上 WebSocket。</b>大模型对话是"我发一次问题、服务器持续吐答案"——
        典型的单向推送,所以全行业几乎都选 SSE 而非 WebSocket。用 WebSocket 也能做,但属于杀鸡用牛刀,
        还要自己扛心跳、重连、二进制帧这些额外复杂度。
      </p>

      <h3 class="sec-title" style="margin-top: 18px">EventSource:浏览器为 SSE 内置的客户端</h3>
      <p class="para">
        既然 SSE 就是一套固定格式的文本流,浏览器干脆内置了一个专门的客户端 API 来消费它,
        就叫 <code class="inline">EventSource</code>。你把 URL 交给它,它替你完成"发请求 → 保持连接 →
        逐帧解析 → 断线自动重连",几行代码就能收推送。前面那些非 AI 场景(通知、看板、进度)
        大多就是用它实现的。
      </p>
      <CodeBlock title="EventSource:官方 SSE 客户端,开箱即用" lang="ts" :code="eventSourceBasic" />
      <p class="para">
        所以 <b>SSE 是"协议 / 数据格式",EventSource 是"浏览器提供的、消费这个格式的现成工具"</b>。
        两者是"规范"与"官方实现"的关系——就像 SSE 是一种文件格式,EventSource 是系统自带的看图软件。
      </p>

      <h3 class="sec-title" style="margin-top: 18px">那我们为什么不用 EventSource?</h3>
      <p class="para">
        既然它这么省事,为什么本项目还要用 <code class="inline">fetch</code> 手写解析?因为
        <code class="inline">EventSource</code> 有三个硬伤,在"调大模型"这个场景里全部踩中:
      </p>
      <CodeBlock title="EventSource 的三个硬伤" lang="ts" :code="whyNotEventSource" />
      <p class="para">
        所以业界通行做法是:<b>沿用 SSE 这套数据格式,但换掉 EventSource 这个客户端</b>——
        改用 <code class="inline">fetch</code> 发 POST(带鉴权头和 body),再把响应体当<b>可读流</b>自己解析。
        这样既保留了 SSE 的流式体验,又拿回了对请求的完全控制。<b>下面的手写解析,就是在做
        EventSource 内部本来替我们做的那些事。</b>
      </p>

      <details class="qa">
        <summary class="qa-summary">
          🤔 深挖:AI 都火这么久了,为什么还没有一个支持 POST 的原生 EventSource?
        </summary>
        <div class="qa-body">
          <p class="para">
            先纠正一个常见误解:<b>POST 版的"EventSource"其实早就有了</b>,只是它没被做成浏览器
            <b>原生 API</b>,而是做成了 <b>fetch 之上的库</b>。最主流的是微软的
            <code class="inline">@microsoft/fetch-event-source</code>,用起来跟 EventSource 一样,
            底层却是 fetch,于是能自定义 method / headers / body。
          </p>
          <CodeBlock title="POST 版 SSE 客户端:以库的形式存在" lang="ts" :code="fetchBasedLib" />
          <p class="para" style="margin-top: 12px">
            所以更准确的说法是:<b>没有 POST 版的"原生 EventSource",但有大量基于 fetch 的库补上了。</b>
            你本页手写的解析,正是这些库内部做的事。那为什么原生 API 至今不加 POST?
          </p>
          <ul class="points">
            <li>
              <b>① 语义冲突(根本原因)</b>:EventSource 的核心卖点是<b>断线自动重连 + 用
              <code class="inline">Last-Event-ID</code> 补发漏掉的消息</b>。要能反复"自动重放"请求,
              它就必须是<b>幂等、可安全重放</b>的 —— GET 天然满足,而 POST 语义是"提交 / 改状态",
              自动重放一个 POST 很危险。<b>自动重连和 POST 从语义上就打架</b>,不是加个参数能调和的。
            </li>
            <li>
              <b>② fetch 出现后动机就没了</b>:EventSource 是 2010 年前后的老 API;2015 年 fetch +
              Streams 落地后,浏览器已有更底层、更通用的原语 —— fetch 能带任意 method/header/body,
              <code class="inline">response.body</code> 又是可读流,天然能消费 SSE。与其给旧的高层 API
              打补丁,不如暴露底层能力、让生态在上面长库。这是 Web 平台的典型演进方式。
            </li>
            <li>
              <b>③ 改标准的 ROI 太低</b>:给 EventSource 加 POST 要改 WHATWG 规范、各浏览器重新实现、
              还要处理与自动重连的交互,收益却只是"省掉一个 npm 依赖" —— 因为 fetch 方案已经完美工作。
            </li>
            <li>
              <b>④ AI 场景反而不要自动重连</b>:对话流断了若自动重连,会<b>重复触发生成</b>。
              所以 AI 场景主动放弃了 EventSource 唯一的独特优势,就更没理由等它进化了。
            </li>
          </ul>
          <p class="para" style="margin-bottom: 0">
            <b>一句话:</b>不是"缺一个 POST 客户端",而是 fetch 本身就是更好的底座、POST 能力早已由
            fetch-based 库补齐;原生 EventSource 因"自动重连"与 POST 的语义冲突、且已被 fetch 替代,
            标准层面没有动力去扩展它。
          </p>
        </div>
      </details>

      <h3 class="sec-title" style="margin-top: 18px">怎么读才优雅、不出 bug?</h3>
      <p class="para">
        核心是三步:<code class="inline">getReader()</code> 逐块读 →
        <code class="inline">TextDecoder</code> 解码 → 按 <code class="inline">\n\n</code> 切事件。
        但真正容易埋 bug 的是下面这几个坑:
      </p>
      <CodeBlock title="core/llm.ts · streamChatCompletion" lang="ts" :code="sseCode" />
      <ul class="points">
        <li>
          <b>① 半包 / 粘包</b>:网络按字节流传输,一个 <code class="inline">read()</code> 拿到的
          <b>不一定是完整的一帧</b>——可能切在半个汉字、半行 JSON 上。所以必须用
          <code class="inline">buffer</code> 累积,只处理切出来的完整段,把最后不完整的尾巴留到下一轮。
          <b>这是流式解析最常见的 bug 来源。</b>
        </li>
        <li>
          <b>② 解码要 <code class="inline">{ stream: true }</code></b>:一个 UTF-8 汉字占 3 字节,
          可能被切成两次 <code class="inline">read()</code>。<code class="inline">decode(value, { stream: true })</code>
          会替你缓存不完整的字节,不加这个参数就会出现"�"乱码。
        </li>
        <li>
          <b>③ 每帧解析要 try/catch</b>:半包留下的残缺 JSON、心跳注释行、空行,都可能让
          <code class="inline">JSON.parse</code> 抛错。单帧解析失败应<b>跳过而非中断整个流</b>。
        </li>
        <li>
          <b>④ 可中断</b>:给 <code class="inline">fetch</code> 传 <code class="inline">AbortSignal</code>,
          用户点"停止"或组件卸载时能真正掐断请求,避免内存泄漏和"幽灵输出"。
        </li>
        <li>
          <b>⑤ 别忘了错误分支</b>:<code class="inline">resp.ok</code> 为 false 时,body 往往是一段
          <b>普通 JSON 错误</b>(不是流),要当作错误读出来,而不是傻等流。
        </li>
      </ul>

      <div class="tip-box">
        <b>💡 一句话总结:</b>SSE 不是新协议,而是"长时间不关闭的 HTTP 响应 + 一套极简文本格式"。
        前端优雅处理它的关键,是把它当<b>字节流</b>而非"一条条完整消息"来对待——
        缓冲、解码、逐帧容错、可中断,四件事做全就不会出 bug。
      </div>

      <div class="side-note">
        关于 <code class="inline">system</code>:它不是"更强的用户消息",而是给模型的<b>身份 / 规则</b>设定,
        优先级高于普通对话。改改左边的 System,回答风格会立刻变化。
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
.presets {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.presets-label {
  font-size: 12px;
  color: var(--c-text-soft);
}
.preset-on {
  background: var(--c-primary);
  border-color: var(--c-primary);
  color: #fff;
}
.preset-on:hover {
  color: #fff;
}
.preset-hint {
  margin-top: 10px;
  padding: 9px 12px;
  background: var(--c-info-soft);
  border: 1px solid #a5f3fc;
  border-radius: var(--radius-sm);
  font-size: 12.5px;
  color: #155e75;
  line-height: 1.6;
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
  min-height: 20px;
}
.cursor {
  animation: blink 1s step-end infinite;
}
@keyframes blink {
  50% {
    opacity: 0;
  }
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
.tip-box {
  margin-top: 18px;
  padding: 12px 14px;
  background: var(--c-primary-soft);
  border: 1px solid #c7d2fe;
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--c-primary-hover);
  line-height: 1.7;
}
.side-note {
  margin-top: 12px;
  padding: 10px 14px;
  background: var(--c-bg);
  border-left: 3px solid var(--c-border-strong);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  font-size: 12.5px;
  color: var(--c-text-soft);
  line-height: 1.6;
}
.table-wrap {
  overflow-x: auto;
  margin: 4px 0 12px;
}
.cmp {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
.cmp th,
.cmp td {
  border: 1px solid var(--c-border);
  padding: 7px 10px;
  text-align: left;
  vertical-align: top;
}
.cmp thead th {
  background: var(--c-bg);
  font-weight: 600;
}
.cmp tbody td:first-child {
  color: var(--c-text-soft);
  font-weight: 500;
  white-space: nowrap;
  background: #fbfbfd;
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
</style>
