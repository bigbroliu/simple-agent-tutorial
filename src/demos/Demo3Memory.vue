<script setup lang="ts">
/**
 * Demo 3 —— 有记忆
 * 教学目标:所谓"记忆",就是把历史消息全部再发一遍。演示"关掉记忆"会怎样。
 */
import { ref, nextTick } from 'vue';
import DemoLayout from '../components/DemoLayout.vue';
import CodeBlock from '../components/CodeBlock.vue';
import NoModelHint from '../components/NoModelHint.vue';
import RequestInspector from '../components/RequestInspector.vue';
import SourceViewer from '../components/SourceViewer.vue';
import { streamChatCompletion } from '../core/llm';
import { setActiveTag } from '../core/inspector';
import type { ChatMessage } from '../core/types';
import { useActiveModel } from '../components/useActiveModel';

const { active } = useActiveModel();

const withMemory = ref(true); // 开关:是否携带历史
const history = ref<ChatMessage[]>([]);
const input = ref('我叫小狐,今年 25 岁');
const loading = ref(false);
const errmsg = ref('');
const listEl = ref<HTMLElement>();

async function send() {
  if (!active.value || !input.value.trim()) return;
  setActiveTag('demo3');
  errmsg.value = '';
  const userMsg: ChatMessage = { role: 'user', content: input.value };
  history.value.push(userMsg);
  input.value = '';

  // 关键:带不带记忆,区别只在这一行 —— 发全部历史,还是只发最新一条
  const messagesToSend: ChatMessage[] = withMemory.value
    ? [...history.value]
    : [userMsg];

  const assistantMsg: ChatMessage = { role: 'assistant', content: '' };
  history.value.push(assistantMsg);
  loading.value = true;
  await scrollBottom();

  try {
    await streamChatCompletion(active.value, messagesToSend, (delta) => {
      assistantMsg.content = (assistantMsg.content ?? '') + delta;
      scrollBottom();
    });
  } catch (e: any) {
    errmsg.value = e?.message ?? String(e);
    assistantMsg.content = '(出错了)';
  } finally {
    loading.value = false;
  }
}

async function scrollBottom() {
  await nextTick();
  listEl.value?.scrollTo({ top: listEl.value.scrollHeight });
}

function clearAll() {
  history.value = [];
}

const memoryCode = `// 记忆的真相:没有黑科技,就是把历史再发一遍
const messagesToSend = withMemory
  // 带上全部历史 → 模型"记得";只发最新一条 → 模型"失忆"
  ? [...history]
  : [latestUserMsg];

await streamChatCompletion(cfg, messagesToSend, onDelta);`;

// 一个"上下文"里其实塞了很多东西 —— 远不止对话历史
const contextAnatomy = `// 每次请求发出去的 messages,就是这一刻模型能看到的【全部世界】
[
  { role: 'system', content: '你是一个能干的助手,可以调用工具…' }, // ① 角色/规则设定
  { role: 'user',   content: '北京天气怎么样?' },                  // ② 历史对话
  { role: 'assistant', content: '', tool_calls: [ /* 查天气 */ ] }, // ③ 模型的动作
  { role: 'tool',   content: '北京 12°C 晴' },                     // ④ 工具返回结果
  { role: 'user',   content: '那要穿外套吗?' },                    // ⑤ 最新问题
  // 还可能有:检索到的知识片段(RAG)、示例(few-shot)、总结过的旧对话…
]
// 模型没有"记忆"、也没有"数据库"—— 它只看这一个数组,答完就忘`;

// 上下文窗口:一个固定大小的"桌面",什么都得摊在上面
const windowMath = `// 上下文窗口 = 模型单次能接收的最大 token 数(输入+输出共享)
总窗口 = system + 历史对话 + 工具定义 + 检索片段 + 本次提问 + 模型输出

// 举例:窗口 8K,而你已经堆了 7.5K 历史
可用于回答的空间 = 8000 - 7500 = 500 token  // 模型会答得很短,甚至报错
// 对话越长 → 占用越多 → 留给"思考和回答"的空间越少`;

// 策略一:滑动窗口 —— 只保留最近 N 轮
const stratWindow = `// 最简单:永远只带最近若干轮(加上不可省略的 system)
function buildContext(history, keep = 10) {
  const system = history.filter(m => m.role === 'system');
  const recent = history.filter(m => m.role !== 'system').slice(-keep);
  return [...system, ...recent];   // 早期对话被直接丢弃
}
// ✅ 实现零成本  ❌ 丢弃的早期信息彻底消失("我开头说的名字呢?")`;

// 策略二:摘要压缩 —— 用模型把旧对话总结成一小段
const stratSummary = `// 当历史超过阈值,先让模型把"旧的一段"压缩成摘要,再替换掉原文
if (estimateTokens(history) > THRESHOLD) {
  const old = history.slice(0, -6);              // 保留最近 6 条,压缩更早的
  const summary = await chat([
    { role: 'system', content: '把下面的对话浓缩成要点,保留关键事实与结论' },
    ...old,
  ]);
  history = [
    { role: 'system', content: '【前情摘要】' + summary },  // 一条顶原来几十条
    ...history.slice(-6),
  ];
}
// ✅ 长对话也能延续  ❌ 多花一次调用;摘要会丢细节`;

// 策略三:RAG —— 不全塞,按需检索最相关的片段
const stratRag = `// RAG(检索增强生成):把知识存在外部,用时才捞相关的几段塞进上下文
const query = latestUserMessage;
const docs  = await vectorSearch(query, { topK: 3 });   // 语义检索最相关的 3 段
const context = [
  { role: 'system', content: '参考以下资料回答:\\n' + docs.join('\\n---\\n') },
  ...recentHistory,
  { role: 'user', content: query },
];
// ✅ 知识库可无限大,窗口只放"这次用得上的"  ❌ 检索质量直接决定回答质量`;


</script>

<template>
  <DemoLayout demo-id="memory">
    <template #whatsnew>
      把每一轮的消息<b>累积</b>成一个数组整体发给模型 —— 这就是"记忆"。
      而"记忆"只是<b>上下文(Context)</b>的一部分。这一课的核心,是理解<b>上下文</b>这个概念。
    </template>

    <template #playground>
      <NoModelHint />
      <div class="toolbar">
        <label class="switch">
          <input type="checkbox" v-model="withMemory" />
          携带历史记忆(关掉试试它会不会"失忆")
        </label>
        <button class="btn btn-sm" @click="clearAll">清空对话</button>
      </div>

      <div ref="listEl" class="chat">
        <div v-if="history.length === 0" class="chat-empty">
          试试:先说"我叫小狐,今年 25 岁",再问"我叫什么?我几岁?"
        </div>
        <div
          v-for="(m, i) in history"
          :key="i"
          class="msg"
          :class="'msg-' + m.role"
        >
          <div class="msg-role">{{ m.role === 'user' ? '你' : 'AI' }}</div>
          <div class="msg-content">{{ m.content }}</div>
        </div>
      </div>

      <div v-if="errmsg" class="err">{{ errmsg }}</div>

      <div class="composer">
        <textarea
          v-model="input"
          class="textarea"
          rows="2"
          placeholder="输入消息,Enter 发送"
          @keydown.enter.exact.prevent="send"
        />
        <button class="btn btn-primary" :disabled="loading || !active" @click="send">发送</button>
      </div>

      <RequestInspector tag="demo3" />

      <SourceViewer :files="['core/llm.ts', 'core/adapters.ts', 'core/types.ts']" />
    </template>

    <template #explain>
      <h3 class="sec-title">先看现象:模型本身是"无状态"的</h3>
      <p class="para">
        每次请求都是独立的,模型不会自动记得上一轮。那 ChatGPT 为什么好像记得?
        因为客户端<b>每次都把完整对话历史重新发过去</b>。记忆,是我们前端维护的,不是模型的。
      </p>
      <CodeBlock title="记忆 = 累积的 messages 数组" lang="ts" :code="memoryCode" />

      <h3 class="sec-title" style="margin-top: 20px">那么,什么是"上下文(Context)"?</h3>
      <p class="para">
        上面这个每次发出去的 <code class="inline">messages</code> 数组,有个正式的名字:
        <b>上下文(Context)</b>。它是模型在<b>这一次推理时能看到的全部信息</b> ——
        模型没有记忆、没有数据库、不会上网,<b>它眼里的整个世界,就是你这次发给它的这一坨</b>。
        答完,它立刻忘得干干净净;下一次全靠你把上下文再拼一遍发过去。
      </p>
      <div class="tip-box">
        <b>💡 关键转念:</b>模型为什么"知道"上下文?不是它有什么神秘能力 ——
        而是 <b>Agent(也就是我们写的代码)在每次请求前,主动把该带的信息都拼进 messages 里</b>。
        所谓"上下文管理",管理的就是这个数组。这是做 Agent 最核心的工作之一。
      </div>

      <h3 class="sec-title" style="margin-top: 20px">上下文里,远不止"记忆"</h3>
      <p class="para">
        这一课我们只演示了"对话历史"这一种。但真实 Agent 的上下文里,通常还塞着很多别的东西 ——
        它们全都以 message 的形式,一起发给模型:
      </p>
      <ul class="points">
        <li><b>System 指令</b>:角色、规则、可用能力说明(Demo 2 见过)。</li>
        <li><b>对话历史</b>:也就是本课的"记忆"。</li>
        <li><b>工具定义与工具返回结果</b>:模型能调什么、调完拿到了什么(Demo 4 起会看到)。</li>
        <li><b>检索到的知识片段(RAG)</b>:从知识库/文档里查到的相关内容,临时塞进来给模型参考。</li>
        <li><b>少样本示例(few-shot)</b>:给几个"输入→期望输出"的范例,引导模型照着做。</li>
        <li><b>压缩过的历史摘要</b>:对话太长时,把早期内容总结成一小段,替代原文。</li>
      </ul>
      <CodeBlock title="一个真实上下文的组成(都塞进同一个 messages)" lang="ts" :code="contextAnatomy" />

      <h3 class="sec-title" style="margin-top: 20px">上下文窗口:一张大小固定的"桌面"</h3>
      <p class="para">
        既然什么都得塞进上下文,就有个物理上限:<b>上下文窗口(Context Window)</b> ——
        模型单次能接收的<b>最大 token 数</b>。可以把它想成一张固定大小的桌面:
        system、历史、工具、检索片段、你的提问、以及<b>模型的回答</b>,全都得摊在这张桌子上,一起挤。
      </p>
      <CodeBlock title="窗口是输入和输出共享的" lang="ts" :code="windowMath" />
      <p class="para">窗口大小不同,会实实在在地影响 Agent 的能力和成本:</p>
      <ul class="points">
        <li><b>窗口太小 / 对话太长</b>:塞不下就<b>报错</b>,或被<b>悄悄截断</b> —— 模型突然"忘了"前面说过的话。</li>
        <li><b>越接近上限,回答空间越少</b>:输入占满了,留给输出的 token 就不够,回答会变短甚至被切断。</li>
        <li><b>大窗口 ≠ 免费</b>:token 越多,单次请求<b>越贵、越慢</b>;而且每轮都重发全部历史,成本随对话线性增长。</li>
        <li><b>"大海捞针"问题</b>:窗口大不代表都记得清 —— 内容太长时,模型对<b>中间部分</b>的注意力会下降。</li>
      </ul>
      <p class="para">
        正因为窗口有限,才需要<b>上下文管理</b>策略:压缩旧对话成摘要、只保留最相关的几轮、
        用 RAG 按需检索而不是全塞进去。这些都是后续进阶的方向 —— 但它们解决的,始终是这同一个问题:
        <b>如何在有限的桌面上,摆下模型此刻最该看到的东西。</b>
      </p>

      <details class="qa">
        <summary class="qa-summary">
          🚀 进阶:上下文管理的三种主流策略(滑动窗口 / 摘要压缩 / RAG)
        </summary>
        <div class="qa-body">
          <p class="para">
            当对话或知识超出窗口,不能简单地"全塞进去"。工程上有三类常见做法,由简到繁,
            实际产品里也常常<b>组合使用</b>。
          </p>

          <h4 class="qa-h">① 滑动窗口(Truncation):只留最近 N 轮</h4>
          <p class="para">
            最朴素:永远只带最近若干轮对话(system 通常固定保留),更早的直接丢弃。
            像聊天软件"只显示最近消息"。
          </p>
          <CodeBlock title="滑动窗口" lang="ts" :code="stratWindow" />

          <h4 class="qa-h">② 摘要压缩(Summarization):把旧对话总结成一小段</h4>
          <p class="para">
            舍不得丢早期信息时,先让模型把"旧的一段"<b>压缩成摘要</b>,再用这条摘要替换掉原文 ——
            一条顶几十条,既省 token 又保住关键事实。代价是要多花一次调用,且摘要会丢细节。
          </p>
          <CodeBlock title="摘要压缩" lang="ts" :code="stratSummary" />

          <h4 class="qa-h">③ RAG(检索增强):不全塞,用时才捞</h4>
          <p class="para">
            知识量远超窗口(整个文档库、代码库)时,把知识存在<b>外部向量库</b>,每次只按当前问题
            <b>检索最相关的几段</b>塞进上下文。这样知识库可以无限大,而窗口只承载"这次用得上的"。
            它也是给模型补充<b>私有 / 实时知识</b>的主要手段。
          </p>
          <CodeBlock title="RAG:按需检索" lang="ts" :code="stratRag" />

          <div class="table-wrap">
            <table class="cmp">
              <thead>
                <tr><th>策略</th><th>解决什么</th><th>代价</th></tr>
              </thead>
              <tbody>
                <tr><td>滑动窗口</td><td>对话太长</td><td>早期信息彻底丢失</td></tr>
                <tr><td>摘要压缩</td><td>长对话要保留要点</td><td>多一次调用 · 丢细节</td></tr>
                <tr><td>RAG</td><td>知识量远超窗口</td><td>依赖检索质量 · 需建向量库</td></tr>
              </tbody>
            </table>
          </div>
          <p class="para" style="margin-bottom: 0">
            <b>共同内核:</b>它们都不是模型的能力,而是<b>我们在拼 messages 之前做的加工</b> ——
            决定"这一次,把什么放进那张有限的桌面"。这正是"上下文工程(Context Engineering)"的日常。
          </p>
        </div>
      </details>

      <div class="side-note">
        动手验证:关掉上方"携带历史记忆"开关,再问"我叫什么",模型会"失忆" ——
        因为你把它的上下文砍成了只有最新一句。打开下方<b>请求检查器</b>,能看到 messages 数组随对话
        <b>逐轮变长</b>,这就是上下文在你手里被一点点拼大的过程。
      </div>
    </template>
  </DemoLayout>
</template>

<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.switch {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  color: var(--c-text);
  cursor: pointer;
}
.chat {
  height: 340px;
  overflow-y: auto;
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  padding: 14px;
  background: var(--c-bg);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.chat-empty {
  color: var(--c-text-faint);
  font-size: 13px;
  text-align: center;
  margin: auto;
}
.msg {
  display: flex;
  gap: 8px;
}
.msg-user {
  flex-direction: row-reverse;
}
.msg-role {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 600;
  background: var(--c-border);
  color: var(--c-text-soft);
}
.msg-user .msg-role {
  background: var(--c-primary);
  color: #fff;
}
.msg-content {
  max-width: 76%;
  padding: 9px 13px;
  border-radius: 12px;
  font-size: 13.5px;
  white-space: pre-wrap;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
}
.msg-user .msg-content {
  background: var(--c-primary-soft);
  border-color: transparent;
}
.composer {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  align-items: flex-end;
}
.composer .textarea {
  flex: 1;
}
.err {
  margin-top: 10px;
  padding: 8px 12px;
  background: var(--c-danger-soft);
  border-radius: var(--radius-sm);
  color: var(--c-danger);
  font-size: 13px;
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
  margin-top: 14px;
  padding: 12px 14px;
  background: var(--c-primary-soft);
  border: 1px solid #c7d2fe;
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--c-primary-hover);
  line-height: 1.7;
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
  margin: 16px 0 6px;
}
.qa-h:first-of-type {
  margin-top: 4px;
}
.table-wrap {
  overflow-x: auto;
  margin: 14px 0 12px;
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
</style>
