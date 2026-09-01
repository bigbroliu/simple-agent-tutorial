<script setup lang="ts">
/**
 * Demo 6 —— 多工具编排
 * 教学目标:同一个 Agent 循环,面对一个【需要多个工具按依赖顺序协作】的复合任务,
 * 模型如何自己规划调用顺序、把前一步的结果喂给后一步。重点讲"编排"的概念、时间线与交互。
 */
import { ref, onMounted, onUnmounted } from 'vue';
import DemoLayout from '../components/DemoLayout.vue';
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

const prompt = ref(
  '现在几点了?帮我算一下此刻距离今晚 24:00 还剩多少分钟,算完之后把灯打开表示你已完成。',
);
const events = ref<AgentEvent[]>([]);
const running = ref(false);
const lampOn = ref(false);

// 三个工具,彼此配合:报时、计算、开关灯
const tools = toolSchemas(['now', 'calculator', 'toggle_lamp']);

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
  setActiveTag('demo6');
  running.value = true;
  events.value = [];
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        '你是一个能干的助手,可以报时(now)、计算(calculator)、开关灯(toggle_lamp)。' +
        '请用工具一步步完成用户的复合任务:先取得需要的信息,再基于上一步的结果进行下一步。',
    },
    { role: 'user', content: prompt.value },
  ];
  try {
    await runAgentLoop({
      cfg: active.value,
      tools,
      messages,
      maxSteps: 8, // 任务需多轮,放宽步数
      onEvent: (e) => events.value.push(e),
    });
  } finally {
    running.value = false;
  }
}
</script>

<template>
  <DemoLayout demo-id="multi-tool">
    <template #whatsnew>
      任务里藏着<b>依赖关系</b>:先报时 → 用报时结果去计算 → 再开灯收尾。
      同一个 Agent 循环<b>一行没改</b>,模型自己排出了调用顺序,并把<b>上一步的结果喂给下一步</b> —— 这就是"工具编排"。
    </template>

    <template #playground>
      <NoModelHint />
      <div class="lamp-row">
        <div class="lamp" :class="{ on: lampOn }">{{ lampOn ? '💡' : '🔌' }}</div>
        <span class="lamp-text">灯:{{ lampOn ? '开' : '关' }}(任务完成后 Agent 会点亮它)</span>
      </div>

      <label class="field-label">一个需要多工具按顺序协作的复合任务</label>
      <textarea v-model="prompt" class="textarea" rows="3" />
      <div class="tools-avail">
        工具:<span class="tag tag-info">now</span>
        <span class="tag tag-info">calculator</span>
        <span class="tag tag-info">toggle_lamp</span>
      </div>
      <button class="btn btn-primary" style="margin-top: 10px" :disabled="running || !active" @click="run">
        {{ running ? '运行中…' : '▶ 运行复合任务' }}
      </button>

      <h3 class="sec-title" style="margin-top: 20px">执行轨迹</h3>
      <AgentTrace :events="events" :running="running" />

      <RequestInspector tag="demo6" />

      <ToolCodeEditor :names="['now', 'calculator', 'toggle_lamp']" />

      <SourceViewer :files="['core/agent.ts', 'core/tools.ts', 'core/llm.ts', 'core/adapters.ts', 'core/types.ts']" />
    </template>

    <template #explain>
      <h3 class="sec-title">什么是"工具编排"?</h3>
      <p class="para">
        单个工具调用你在第 4 课已经见过。<b>编排(Orchestration)</b>指的是:一个任务需要<b>多个工具、按特定顺序</b>
        配合完成,而且<b>后一步往往依赖前一步的结果</b>。关键在于 —— 这个顺序<b>不是我们写死的</b>,
        而是<b>模型在循环里自己一步步决定</b>的。我们只提供工具清单和目标,怎么排、排几步,交给模型。
      </p>
      <div class="concept">
        <div class="concept-item">
          <div class="concept-k">目标</div>
          <div class="concept-v">"报时 → 算剩余分钟 → 开灯"是一个整体任务,用户只说一句话。</div>
        </div>
        <div class="concept-item">
          <div class="concept-k">依赖</div>
          <div class="concept-v">calculator 的输入,来自 now 的输出 —— 必须先拿到时间才能算。</div>
        </div>
        <div class="concept-item">
          <div class="concept-k">编排者</div>
          <div class="concept-v">是<b>模型</b>,不是我们的代码。循环只负责"执行它点名的工具、把结果还回去"。</div>
        </div>
      </div>

      <h3 class="sec-title" style="margin-top: 22px">时间线:模型如何一步步推进</h3>
      <p class="para">这个任务会跑完整的多轮循环,典型时间线如下(左边是轮次):</p>
      <ol class="timeline">
        <li>
          <span class="tl-badge">轮1</span>
          <div class="tl-body">
            <div class="tl-title">💭 模型:我需要先知道现在几点 → 请求调用 <code class="inline">now()</code></div>
            <div class="tl-sub">还不能算,因为缺少"当前时间"这个输入</div>
          </div>
        </li>
        <li>
          <span class="tl-badge tool">执行</span>
          <div class="tl-body">
            <div class="tl-title">🔧 我们执行 <code class="inline">now()</code> → 返回 "22:15" → 回填给模型</div>
          </div>
        </li>
        <li>
          <span class="tl-badge">轮2</span>
          <div class="tl-body">
            <div class="tl-title">💭 模型:有时间了,距 24:00 还剩 → 请求调用 <code class="inline">calculator("(24*60)-(22*60+15)")</code></div>
            <div class="tl-sub">★ 注意:表达式里的数字来自<b>上一步的结果</b> —— 这就是"依赖"</div>
          </div>
        </li>
        <li>
          <span class="tl-badge tool">执行</span>
          <div class="tl-body">
            <div class="tl-title">🔧 执行 calculator → 返回 "105" → 回填</div>
          </div>
        </li>
        <li>
          <span class="tl-badge">轮3</span>
          <div class="tl-body">
            <div class="tl-title">💭 模型:算完了,任务要求"算完开灯" → 请求调用 <code class="inline">toggle_lamp(true)</code></div>
          </div>
        </li>
        <li>
          <span class="tl-badge tool">执行</span>
          <div class="tl-body">
            <div class="tl-title">🔧 执行 toggle_lamp → 灯亮 💡 → 回填 "灯已打开"</div>
          </div>
        </li>
        <li>
          <span class="tl-badge done">轮4</span>
          <div class="tl-body">
            <div class="tl-title">✅ 模型:不再请求工具,输出总结 —— "现在 22:15,距 24:00 还有 105 分钟,灯已打开"</div>
            <div class="tl-sub">没有 tool_calls → 循环终止</div>
          </div>
        </li>
      </ol>

      <h3 class="sec-title" style="margin-top: 22px">交互图:三方在循环里怎么传话</h3>
      <p class="para">
        把上面的时间线抽象成"谁和谁在交换什么"。注意<b>模型自己不执行任何工具</b>,一切工具都由中间的循环代劳:
      </p>
      <div class="seq">
        <div class="seq-cols">
          <div class="seq-actor">👤 用户</div>
          <div class="seq-actor hl">🔁 Agent 循环<br /><small>(我们的代码)</small></div>
          <div class="seq-actor">🧠 模型</div>
          <div class="seq-actor">🔧 工具</div>
        </div>
        <div class="seq-rows">
          <div class="seq-row">
            <span class="seq-msg a-to-b">① 复合任务(一句话)</span>
          </div>
          <div class="seq-row">
            <span class="seq-msg b-to-c">② messages + tools →</span>
          </div>
          <div class="seq-row">
            <span class="seq-msg c-to-b">③ ← "我要调 now"</span>
          </div>
          <div class="seq-row">
            <span class="seq-msg b-to-d">④ 执行 now →</span>
          </div>
          <div class="seq-row">
            <span class="seq-msg d-to-b">⑤ ← "22:15"</span>
          </div>
          <div class="seq-row loop-label">
            <span>⑥ 把结果加进 messages,回到 ② 再问一次(带着新结果)——如此往复 now→calculator→toggle_lamp</span>
          </div>
          <div class="seq-row">
            <span class="seq-msg c-to-b final">⑦ ← 模型不再要工具,给出最终答复</span>
          </div>
          <div class="seq-row">
            <span class="seq-msg b-to-a">⑧ 返回结果给用户 ✅</span>
          </div>
        </div>
      </div>

      <h3 class="sec-title" style="margin-top: 22px">要点</h3>
      <ul class="points">
        <li><b>顺序由模型规划</b>:我们没写"先 now 再 calculator"的逻辑,是模型根据依赖关系自己排的。换个任务,它会排出不同顺序。</li>
        <li><b>数据靠 messages 传递</b>:每个工具结果都以 <code class="inline">role:"tool"</code> 追加进历史,下一轮模型能看到全部,于是能"用上一步的结果"。</li>
        <li><b>循环逻辑没变</b>:和第 5 课同一个 <code class="inline">runAgentLoop</code>,一行没改。工具变多≠循环变复杂,复杂度都在模型的决策里。</li>
        <li><b>可能出错、会重试</b>:若模型把时间算错、或调错工具,它能从回填的结果里发现并在下一轮纠正 —— 这正是循环比"一次性调用"强的地方。</li>
      </ul>
      <div class="side-note">
        动手观察:展开下方<b>请求检查器</b>,你会看到<b>好几次</b>请求(每轮一次),且 messages 一次比一次长 ——
        后面的请求里带着前面所有工具的结果。这就是"编排"在数据层面的真相。
      </div>
    </template>
  </DemoLayout>
</template>

<style scoped>
.lamp-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: var(--c-bg);
  border-radius: var(--radius-sm);
}
.lamp {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 20px;
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
/* ---- 概念三连 ---- */
.concept {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}
.concept-item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.concept-k {
  flex-shrink: 0;
  width: 52px;
  text-align: center;
  padding: 3px 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--c-primary-hover);
  background: var(--c-primary-soft);
  border-radius: var(--radius-sm);
}
.concept-v {
  font-size: 13px;
  line-height: 1.55;
  padding-top: 2px;
}
/* ---- 时间线 ---- */
.timeline {
  list-style: none;
  margin: 0;
  padding: 0;
  border-left: 2px solid var(--c-border);
  margin-left: 8px;
}
.timeline li {
  position: relative;
  display: flex;
  gap: 10px;
  padding: 0 0 14px 16px;
}
.timeline li:last-child {
  padding-bottom: 0;
}
.tl-badge {
  flex-shrink: 0;
  align-self: flex-start;
  margin-left: -33px;
  width: 34px;
  height: 20px;
  display: grid;
  place-items: center;
  font-size: 10.5px;
  font-weight: 700;
  border-radius: 999px;
  background: var(--c-primary);
  color: #fff;
  z-index: 1;
}
.tl-badge.tool {
  background: var(--c-text-faint);
}
.tl-badge.done {
  background: var(--c-success);
}
.tl-body {
  flex: 1;
}
.tl-title {
  font-size: 13px;
  line-height: 1.5;
}
.tl-sub {
  font-size: 11.5px;
  color: var(--c-text-soft);
  margin-top: 2px;
}
/* ---- 交互(时序)图 ---- */
.seq {
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  padding: 12px;
  background: var(--c-bg);
  overflow-x: auto;
}
.seq-cols {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin-bottom: 10px;
  min-width: 440px;
}
.seq-actor {
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 4px;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  line-height: 1.3;
}
.seq-actor small {
  font-weight: 400;
  color: var(--c-text-faint);
  font-size: 10px;
}
.seq-actor.hl {
  border-color: var(--c-primary);
  background: var(--c-primary-soft);
  color: var(--c-primary-hover);
}
.seq-rows {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 440px;
}
.seq-row {
  display: flex;
}
.seq-msg {
  font-size: 12px;
  padding: 5px 10px;
  border-radius: var(--radius-sm);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  line-height: 1.4;
}
/* 用左边距把消息大致对齐到"发起方→接收方"之间 */
.a-to-b {
  margin-left: 0;
}
.b-to-c {
  margin-left: 25%;
}
.c-to-b {
  margin-left: 25%;
  background: #f5f3ff;
  border-color: #ddd6fe;
}
.b-to-d {
  margin-left: 50%;
}
.d-to-b {
  margin-left: 50%;
}
.b-to-a {
  margin-left: 0;
  background: var(--c-success-soft);
  border-color: #a7f3d0;
}
.c-to-b.final {
  background: var(--c-success-soft);
  border-color: #a7f3d0;
  margin-left: 25%;
}
.loop-label {
  font-size: 11.5px;
  color: var(--c-primary-hover);
  background: var(--c-primary-soft);
  border: 1px dashed var(--c-primary);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  line-height: 1.45;
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
