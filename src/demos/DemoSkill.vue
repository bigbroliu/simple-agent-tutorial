<script setup lang="ts">
/**
 * Demo 11 —— Skill(技能):按需装载的"做事方法"
 *
 * 教学目标:
 * ① 讲清 Tool 与 Skill 的区别 —— 一个给「能做」,一个给「会做」;
 *    并点明关键:Skill 不是 Tool 的对立面,它是【用 Tool 实现的】。
 * ② 把「渐进式披露」讲成可量化的事:常驻上下文只有一行 description,
 *    正文与附件由【模型自己】决定读不读 —— 上下文预算是核心矛盾。
 * ③ 证明它没有新机制:装载动作就是两个普通工具,跑的还是第 5 课的 runAgentLoop。
 *
 * 用「不给技能 / 给技能」并排对比 + 硬性验收清单,把差别变成对错而非感觉。
 */
import { ref, computed } from 'vue';
import DemoLayout from '../components/DemoLayout.vue';
import CodeBlock from '../components/CodeBlock.vue';
import NoModelHint from '../components/NoModelHint.vue';
import AgentTrace from '../components/AgentTrace.vue';
import RequestInspector from '../components/RequestInspector.vue';
import SourceViewer from '../components/SourceViewer.vue';
import SeqDiagram, { type SeqLane, type SeqStep, type SeqStat } from '../components/SeqDiagram.vue';
import { runAgentLoop, type AgentEvent } from '../core/agent';
import { chatCompletion } from '../core/llm';
import { setActiveTag } from '../core/inspector';
import {
  SKILLS,
  SKILL_TOOLS,
  buildSkillIndex,
  makeSkillExecutor,
  estimateTokens,
  skillFullTokens,
  skillIndexLine,
  type SkillLoadEvent,
  type SkillCheck,
} from '../core/skills';
import type { ChatMessage } from '../core/types';
import { useActiveModel } from '../components/useActiveModel';

const { active } = useActiveModel();

/** 本课只有一个技能 —— 机制看清楚了,加第二个只是复制粘贴 */
const skill = SKILLS[0];

/* ---------------- 两个任务:一个命中,一个故意不命中 ---------------- */

interface Task {
  key: string;
  title: string;
  /** true = 期望命中技能 */
  hit: boolean;
  note: string;
  prompt: string;
}

const TASKS: Task[] = [
  {
    key: 'review',
    title: '评审一段代码',
    hit: true,
    note: '命中 code-review。它的正文会点名 references/checklist.md —— 于是会触发第 3 层装载。',
    prompt: `帮我 review 这段 Vue 组件代码:

const list = ref([])
onMounted(() => {
  window.addEventListener('resize', onResize)
  fetch('/api/items').then(r => r.json()).then(d => { list.value = d })
})
// <div v-for="(it, index) in list" :key="index">
//   <span v-html="it.html" />
//   <b>{{ list.filter(x => x.done).length }}</b>
// </div>
console.log('debug', list)`,
  },
  {
    key: 'none',
    title: '无关的任务',
    hit: false,
    note: '技能不相关。正确行为是【一个工具都不调】,直接回答 —— 别浪费上下文。',
    prompt: '用一句话解释什么是防抖(debounce)。',
  },
];

const task = ref<Task>(TASKS[0]);
const prompt = ref(TASKS[0].prompt);

function pickTask(t: Task) {
  task.value = t;
  prompt.value = t.prompt;
  reset();
}

/* ---------------- 上下文预算记账 ---------------- */

const skillIndex = computed(() => buildSkillIndex(SKILLS));
/** 一个技能常驻上下文的真实边际成本 = 目录里那一行 */
const lineTokens = computed(() => estimateTokens(skillIndexLine(skill)));
const fullTokens = computed(() => skillFullTokens(skill));
const ratio = computed(() => (fullTokens.value / Math.max(1, lineTokens.value)).toFixed(0));

/* ---------------- 运行:并排对比 ---------------- */

const events = ref<AgentEvent[]>([]);
const loads = ref<SkillLoadEvent[]>([]);
const withSkill = ref('');
const without = ref('');
const running = ref(false);
const errmsg = ref('');
const ran = ref(false);

const loadedTokens = computed(() => loads.value.reduce((s, l) => s + l.tokens, 0));

function reset() {
  events.value = [];
  loads.value = [];
  withSkill.value = '';
  without.value = '';
  errmsg.value = '';
  ran.value = false;
}

async function run() {
  if (!active.value || running.value) return;
  setActiveTag('demo-skill');
  reset();
  running.value = true;
  ran.value = true;

  const cfg = active.value;
  const userMsg = prompt.value;

  // ① 对照组:什么技能都不给,只有一个普通 system
  const baseline = (async () => {
    const msg = await chatCompletion(cfg, [
      { role: 'system', content: '你是一个乐于助人的助手。' },
      { role: 'user', content: userMsg },
    ]);
    without.value = msg.content ?? '';
  })();

  // ② 实验组:system 里【只放技能目录】,再给两个装载工具,跑同一个 Agent 循环
  const equipped = (async () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: skillIndex.value },
      { role: 'user', content: userMsg },
    ];
    const result = await runAgentLoop({
      cfg,
      tools: SKILL_TOOLS,
      messages,
      maxSteps: 6,
      // ★ 全部秘密就这一行:工具执行 = 从技能库里把文本读出来
      execTool: makeSkillExecutor(SKILLS, (e) => loads.value.push(e)),
      onEvent: (e) => {
        events.value.push(e);
        if (e.type === 'final') withSkill.value = e.content;
      },
    });
    // 循环因步数上限提前结束时,兜底取最后一条 assistant 文本
    if (!withSkill.value) {
      const last = [...result].reverse().find((m) => m.role === 'assistant' && m.content);
      withSkill.value = last?.content ?? '';
    }
  })();

  try {
    await Promise.all([baseline, equipped]);
  } catch (e: any) {
    errmsg.value = e?.message ?? String(e);
  } finally {
    running.value = false;
  }
}

/* ---------------- 验收:把"差别"量化成对错 ---------------- */

const checks = computed<SkillCheck[]>(() => (task.value.hit ? (skill.checks ?? []) : []));

function passCount(output: string) {
  return checks.value.filter((c) => c.test(output)).length;
}

/** 不该装载时,模型是否忍住了 */
const restraintOk = computed(() => ran.value && !running.value && loads.value.length === 0);

/* ---------------- 技能库浏览器 ---------------- */

const openPath = ref<string | null>(null);
const openContent = computed(() =>
  openPath.value
    ? (skill.resources?.find((r) => r.path === openPath.value)?.content ?? '')
    : skill.body,
);

/* ---------------- 讲解区代码片段 ---------------- */

const layoutCode = `code-review/               ← 一个技能就是一个文件夹
├── SKILL.md               ← Level 2:正文(带 name / description 头部)
└── references/            ← Level 3:正文点名后才读的资料
    └── checklist.md

# SKILL.md 的头部就是 Level 1 —— 唯一常驻上下文的部分
---
name: code-review
description: 按团队评审清单检查一段前端代码。当用户要 review 代码、
             看代码有没有问题、找隐患时使用。
---
(以下正文…… 模型调用 read_skill 之后才会看到)`;

// 同一件事,分别用 Tool 和 Skill 做 —— 对比的关键素材
const asToolCode = `// ❌ 把评审规范做成"工具":拧巴,而且不可行
{
  name: 'review_code',
  description: '评审一段代码',
  parameters: { type: 'object', properties: { code: { type: 'string' } } },
}
run: ({ code }) => {
  // 然后呢?难道用正则去判断"事件监听有没有成对"、"这段 v-html 危不危险"?
  // 评审是【判断力】,不是【确定性计算】——
  // 能做这个判断的恰恰是模型本身,不是我们的 JS 函数。
  return '???';
}`;

const asSkillCode = `// ✅ 做成"技能":我们不写判断逻辑,只把【判断标准】交给模型
// references/checklist.md
## R1 · 事件监听必须成对
在 onMounted 里 addEventListener 的,必须在 onUnmounted 里 removeEventListener…
## R4 · 用户内容禁止 v-html
任何来自接口或用户输入的内容都不得用 v-html 渲染(XSS)…

// 判断力来自模型,标准来自我们。各司其职。`;

const indexCode = `// core/skills.ts —— Level 1:只把 name + description 拼进 system
export function buildSkillIndex(skills) {
  const list = skills.map(s => \`- \${s.name}: \${s.description}\`).join('\\n');
  return \`你可以使用下面这些【技能】…此刻你只能看到名字和用途:\\n\\n\${list}\\n
  1. 相关就【必须】先用 read_skill 读全文,再照着做。
  2. 说明里提到 references/ 下的文件,用 read_skill_resource 读出来。
  3. 没有相关技能就直接回答,不要调用任何工具。\`;
}
// ★ 正文一个字都没进去 —— 这就是省钱的地方`;

const executorCode = `// 装载技能的"执行器":没有任何框架,就是按名字取文本
export function makeSkillExecutor(skills, onLoad) {
  const byName = new Map(skills.map(s => [s.name, s]));
  return (toolName, args) => {
    if (toolName === 'read_skill') {
      const skill = byName.get(args.name);
      return skill.body;                    // ← 返回值进 messages,就是"装载"
    }
    if (toolName === 'read_skill_resource') {
      return find(args.skill, args.path).content;
    }
  };
}`;

const loopCode = `// 页面里真正跑的代码 —— 和第 5、6、10 课【同一个】runAgentLoop
await runAgentLoop({
  cfg,
  tools: SKILL_TOOLS,                       // read_skill / read_skill_resource
  messages: [
    { role: 'system', content: buildSkillIndex(SKILLS) }, // 只有目录
    { role: 'user',   content: userMsg },
  ],
  execTool: makeSkillExecutor(SKILLS),      // 工具执行 = 读技能文本
  onEvent,
});
// ★ 循环一行没改。Skill 不是新机制,是"用工具送达的上下文"。`;

/* ---------------- 时序图:一次触达第 3 层的完整装载 ---------------- */

const LANES: SeqLane[] = [
  { icon: '👤', name: '用户' },
  { icon: '🔁', name: 'Agent 循环', sub: '(我们的代码)' },
  { icon: '🧠', name: '模型' },
  { icon: '📚', name: '技能库', sub: '(文件夹)' },
];

const STATS: SeqStat[] = [
  { label: '轮对话', count: 'group' },
  { label: '次装载', count: 'obs' },
];

const STEPS: SeqStep[] = [
  {
    from: 0, to: 1, kind: 'ask', meter: 350, label: '"帮我 review 这段代码"',
    note: '此刻上下文里只有:技能目录(其中描述这个技能的只有一行,51 token)+ 两个工具的 schema + 用户这段代码。',
  },
  {
    from: 1, to: 2, kind: 'call', meter: 350, group: '轮 1',
    label: 'system=技能目录(Level 1)+ 两个装载工具',
    note: '★ 技能正文一个字都没发。模型只看到「有这个技能、它管什么」—— 这就是 Level 1。',
  },
  {
    from: 2, to: 1, kind: 'ret', meter: 350, label: 'read_skill("code-review")',
    note: '★ 决定打开它的是【模型】,不是我们的代码。它读了目录,自己判断相关 —— 这是 Skill 与 RAG 的分水岭。',
  },
  {
    from: 1, to: 3, kind: 'exec', meter: 350, label: '读 code-review/SKILL.md',
    note: '循环执行这个工具:从技能库把正文取出来。和第 4 课执行 calculator 没有任何区别。',
  },
  {
    from: 3, to: 1, kind: 'obs', meter: 549, label: '正文进上下文(+199 token)',
    note: 'Level 2 装载完成。正文明确写着:判定标准在 references/checklist.md 里,评审前必须读。',
  },
  {
    from: 1, to: 2, kind: 'call', meter: 549, group: '轮 2', loop: true,
    label: '回到 ②:带着正文再问',
    note: '同样的请求,只是 messages 里多了正文。这一步和第 6 课工具结果回填后的"再问一次"完全同构。',
  },
  {
    from: 2, to: 1, kind: 'ret', meter: 549, dep: true,
    label: 'read_skill_resource("references/checklist.md")',
    note: '★ 依赖:模型知道要读这个文件,是因为刚装载的正文里点了名。第 3 层由第 2 层触发。',
  },
  {
    from: 1, to: 3, kind: 'exec', meter: 549, label: '读 references/checklist.md',
    note: '按需加载最深的一层。若这次任务无关评审,这 322 token 永远不会被付。',
  },
  {
    from: 3, to: 1, kind: 'obs', meter: 871, label: '6 条清单进上下文(+322 token)',
    note: 'Level 3 装载完成。现在模型手上有了这个任务所需的全部知识 —— 且仅有这些。',
  },
  {
    from: 1, to: 2, kind: 'call', meter: 871, group: '轮 3', loop: true,
    label: '回到 ②:带着正文 + 清单再问',
    note: '技能内容累计 521 token,是它常驻成本(51)的 10 倍 —— 而这 10 倍只在真正要用时才付。',
  },
  {
    from: 2, to: 1, kind: 'final', meter: 871, label: '不再调工具,按 R1~R6 逐条评审',
    note: '★ 终止条件和第 5 课一模一样:响应里没有 tool_calls,循环就跳出。',
  },
  {
    from: 1, to: 0, kind: 'answer', meter: 871, label: '合规的评审报告 ✅',
    note: '它给出的编号、判定口径、结尾格式,全部来自那两个文件 —— 而不是它的"经验"。',
  },
];
</script>

<template>
  <DemoLayout demo-id="skill">
    <template #whatsnew>
      前面十课攒的都是<b>「能做」</b> —— 工具给手脚,MCP 让工具可插拔。这一课补<b>「会做」</b>:
      同一个模型,评审出来的东西合不合你团队的规范,取决于它<b>知不知道那套规范</b>。
      而规范不能全塞进 system(太贵),于是有了<b>渐进式披露</b> ——
      常驻的只有<b>一行简介</b>,正文与附件由<b>模型自己</b>决定读哪层。
      装载动作是<b>两个普通工具</b>,Agent 循环<b>一行没改</b>。
    </template>

    <template #playground>
      <NoModelHint />

      <!-- ① 常驻上下文的那一小段 -->
      <div class="lv1">
        <div class="lv1-head">
          <span class="lv1-title">Level 1 · 常驻 system 的技能目录</span>
          <span class="lv1-budget">
            这个技能常驻 <b>{{ lineTokens }}</b> token
            <span class="lv1-vs">/ 全文 {{ fullTokens }}</span>
            <span class="lv1-save">1 : {{ ratio }}</span>
          </span>
        </div>
        <pre class="lv1-body">{{ skillIndex }}</pre>
        <div class="lv1-note">
          ⬆️ 这就是模型开局能看到的<b>全部</b>技能信息。正文和清单,一个字都不在里面。
        </div>
      </div>

      <!-- ② 选任务 -->
      <label class="field-label">选一个任务(第二个故意与技能无关)</label>
      <div class="tasks">
        <button
          v-for="t in TASKS"
          :key="t.key"
          class="task"
          :class="{ on: task.key === t.key }"
          @click="pickTask(t)"
        >
          <span class="task-title">{{ t.title }}</span>
          <span class="task-expect">{{ t.hit ? '应命中 code-review' : '应不装载' }}</span>
        </button>
      </div>
      <div class="task-note">{{ task.note }}</div>

      <textarea v-model="prompt" class="textarea" rows="5" spellcheck="false" />
      <button
        class="btn btn-primary"
        style="margin-top: 10px"
        :disabled="running || !active"
        @click="run"
      >
        {{ running ? '运行中…' : '▶ 并排对比:不给技能 vs 给技能' }}
      </button>
      <div v-if="errmsg" class="err">{{ errmsg }}</div>

      <!-- ③ 本次装载记账 -->
      <div v-if="ran" class="ledger">
        <div class="ledger-head">
          本次实际装载:<b>{{ loads.length }}</b> 次,共 <b>{{ loadedTokens }}</b> token
        </div>
        <div v-if="loads.length === 0" class="ledger-empty">
          <template v-if="!task.hit">
            <span :class="restraintOk ? 'ok' : 'bad'">
              {{ restraintOk
                ? '✅ 一次都没装载 —— 正确:技能不相关就别浪费上下文。'
                : '⏳ 等待运行结果…' }}
            </span>
          </template>
          <template v-else>
            ⚠️ 一次都没装载。可能是模型没听懂目录里的指示 —— 换个模型,或把 description
            写得更贴近用户的真实说法。
          </template>
        </div>
        <div v-for="(l, i) in loads" :key="i" class="ledger-row">
          <span class="lv-badge" :class="'lv' + l.level">L{{ l.level }}</span>
          <code class="inline">{{ l.skill }}/{{ l.path ?? 'SKILL.md' }}</code>
          <span class="ledger-tk">+{{ l.tokens }} token</span>
        </div>
      </div>

      <!-- ④ 并排对比 -->
      <div v-if="ran" class="compare">
        <div class="col col-bad">
          <div class="col-head">
            ❌ 不给技能
            <span v-if="checks.length" class="score">
              达标 {{ passCount(without) }}/{{ checks.length }}
            </span>
          </div>
          <div class="col-body">
            <span v-if="running && !without" class="loading">请求中…</span>
            <span v-else>{{ without || '(空)' }}</span>
          </div>
        </div>
        <div class="col col-good">
          <div class="col-head">
            ✅ 给技能(按需装载)
            <span v-if="checks.length" class="score">
              达标 {{ passCount(withSkill) }}/{{ checks.length }}
            </span>
          </div>
          <div class="col-body">
            <span v-if="running && !withSkill" class="loading">思考中…</span>
            <span v-else>{{ withSkill || '(空)' }}</span>
          </div>
        </div>
      </div>

      <!-- ⑤ 硬性验收 -->
      <div v-if="ran && checks.length && !running" class="checks">
        <div class="checks-head">
          验收标准(来自技能里写死的规范 —— 不是"感觉好不好")
        </div>
        <div v-for="c in checks" :key="c.label" class="check-row">
          <span class="ck" :class="{ pass: c.test(without) }">{{ c.test(without) ? '✓' : '✗' }}</span>
          <span class="ck" :class="{ pass: c.test(withSkill) }">{{ c.test(withSkill) ? '✓' : '✗' }}</span>
          <span class="check-label">{{ c.label }}</span>
        </div>
        <div class="checks-legend">左列 = 不给技能,右列 = 给技能</div>
      </div>

      <h3 class="sec-title" style="margin-top: 20px">执行轨迹(实验组)</h3>
      <AgentTrace :events="events" :running="running" />

      <!-- ⑥ 技能库浏览器 -->
      <section class="lib">
        <div class="lib-head">
          📚 <code class="inline">{{ skill.name }}/</code> 的真实内容 ——
          也就是模型装载后读到的东西
        </div>
        <div class="lib-body">
          <div class="sk-files">
            <button class="sk-file" :class="{ on: openPath === null }" @click="openPath = null">
              SKILL.md
              <span class="sk-file-lv">L2</span>
            </button>
            <button
              v-for="r in skill.resources ?? []"
              :key="r.path"
              class="sk-file"
              :class="{ on: openPath === r.path }"
              @click="openPath = r.path"
            >
              {{ r.path }}
              <span class="sk-file-lv">L3</span>
            </button>
          </div>
          <pre class="sk-content">{{ openContent }}</pre>
        </div>
      </section>

      <RequestInspector tag="demo-skill" />

      <SourceViewer :files="['core/skills.ts', 'core/agent.ts', 'core/types.ts', 'core/llm.ts']" />
    </template>

    <template #explain>
      <h3 class="sec-title">Tool 和 Skill,到底差在哪?</h3>
      <p class="para">
        这是本课最容易含混的地方,先用一句话钉住:<b>Tool 给的是「能做」,Skill 给的是「会做」。</b>
        工具是<b>一条执行通道</b> —— 模型点名,我们的代码去干,产生真实副作用;
        技能是<b>一份说明书</b> —— 被读进上下文,改变模型接下来怎么想、怎么写,自己不执行任何东西。
      </p>
      <table class="cmp">
        <thead>
          <tr><th></th><th>Tool(第 4~6 课)</th><th>Skill(本课)</th></tr>
        </thead>
        <tbody>
          <tr>
            <td class="cmp-k">给什么</td>
            <td><b>能力</b>:手脚</td>
            <td><b>方法</b>:手册</td>
          </tr>
          <tr>
            <td class="cmp-k">用什么写</td>
            <td>JS 函数 + JSON Schema</td>
            <td><b>Markdown 文件夹</b></td>
          </tr>
          <tr>
            <td class="cmp-k">谁能写</td>
            <td>只有工程师</td>
            <td>产品、设计、任何懂业务的人</td>
          </tr>
          <tr>
            <td class="cmp-k">谁在执行</td>
            <td><b>我们的代码</b>(模型只点名)</td>
            <td>没有执行 —— 只是<b>被读进上下文</b></td>
          </tr>
          <tr>
            <td class="cmp-k">有副作用吗</td>
            <td>有:改文件、发请求、开灯、花钱</td>
            <td>无。它只影响<b>模型的输出</b></td>
          </tr>
          <tr>
            <td class="cmp-k">在上下文里</td>
            <td>schema <b>每轮都发</b>(常驻)</td>
            <td>只有一行简介常驻,正文<b>按需</b></td>
          </tr>
          <tr>
            <td class="cmp-k">"失败"长什么样</td>
            <td>抛异常、返回错误串</td>
            <td>更隐蔽:<b>没被打开</b>,或打开了<b>没照做</b></td>
          </tr>
          <tr>
            <td class="cmp-k">加一个要做什么</td>
            <td>写代码 → 测试 → 发版</td>
            <td>加一个文件夹,提个 PR</td>
          </tr>
        </tbody>
      </table>

      <h3 class="sec-title" style="margin-top: 22px">两者不是二选一 —— Skill 是用 Tool 实现的</h3>
      <p class="para">
        很多人会把它们摆成对立的两个选项,这是误解。看清这一层,这一课就通了:
        <code class="inline">read_skill</code> 本身<b>就是一个普通工具</b> ——
        和第 4 课那个 <code class="inline">calculator</code> 走的是同一套 Tool Calling 协议。
      </p>
      <div class="stack">
        <div class="stack-row">
          <span class="stack-k">Skill</span>
          <span class="stack-v">技能内容(Markdown)—— 装进上下文的<b>知识</b></span>
        </div>
        <div class="stack-arr">↑ 由下面这层送达</div>
        <div class="stack-row">
          <span class="stack-k tool">Tool</span>
          <span class="stack-v"><code class="inline">read_skill</code> / <code class="inline">read_skill_resource</code> —— <b>取用知识的通道</b></span>
        </div>
        <div class="stack-arr">↑ 由下面这层驱动</div>
        <div class="stack-row">
          <span class="stack-k loop">Loop</span>
          <span class="stack-v"><code class="inline">runAgentLoop</code> —— 第 5 课那个 while,<b>一行没改</b></span>
        </div>
      </div>
      <p class="para" style="margin-top: 12px">
        所以准确的说法是:<b>Skill 是「用工具送达的、由模型自己决定何时取用的上下文」。</b>
        它没有发明任何新机制,只是把 Tool Calling 用在了一个新地方 ——
        不是去<b>执行动作</b>,而是去<b>取知识</b>。
      </p>

      <h3 class="sec-title" style="margin-top: 22px">那什么时候该用哪个?</h3>
      <p class="para">判断标准只有一条:<b>这件事需要「确定性计算 / 真实副作用」,还是需要「判断力」?</b></p>
      <div class="pick">
        <div class="pick-item">
          <div class="pick-k">写成 Tool</div>
          <div class="pick-v">
            代码能算准、模型算不准的:<code class="inline">calculator</code>、查天气、读文件、
            调接口、开灯。共同点是 —— <b>有唯一正确答案,且必须真的发生</b>。
          </div>
        </div>
        <div class="pick-item">
          <div class="pick-k">写成 Skill</div>
          <div class="pick-v">
            靠判断、靠规范、没法用 <code class="inline">if/else</code> 穷举的:代码评审、
            文案风格、命名约定、排障流程。共同点是 —— <b>你能说清标准,但写不出判定函数</b>。
          </div>
        </div>
      </div>
      <p class="para" style="margin-top: 12px">
        本课这个例子恰好卡在分界线上,值得当反例讲一遍:假如硬把"代码评审"做成工具,会是什么样?
      </p>
      <CodeBlock title="反例:把评审做成 Tool —— 写不下去" lang="ts" :code="asToolCode" />
      <div style="height: 12px" />
      <CodeBlock title="正解:做成 Skill —— 标准给模型,判断留给模型" lang="ts" :code="asSkillCode" />
      <p class="para" style="margin-top: 12px">
        分水岭在于:<code class="inline">calculator</code> 里我们能写出
        <b>确定的计算</b>;而"这段 <code class="inline">v-html</code> 危不危险"没有这样的函数 ——
        能做这个判断的恰恰是<b>模型自己</b>。我们要给的不是判定代码,而是<b>判定标准</b>。
      </p>

      <h3 class="sec-title" style="margin-top: 22px">一个技能 = 一个文件夹</h3>
      <p class="para">
        没有注册表、没有 DSL、没有 SDK。就是<b>目录 + Markdown</b> ——
        这是它最被低估的优点:用 git 管、用 PR 评审、非工程师也能写。
      </p>
      <CodeBlock title="技能的目录结构" lang="ts" :code="layoutCode" />

      <h3 class="sec-title" style="margin-top: 22px">核心矛盾:上下文预算</h3>
      <p class="para">
        为什么要分层?因为<b>上下文窗口是有限且昂贵的稀缺资源</b>。回想第 3 课:模型是无状态的,
        历史<b>每一轮都要全量重发</b>。所以塞进 system 的东西,你不是付一次,而是<b>付 N 次</b>。
      </p>
      <p class="para">
        这个技能全文 <b>{{ fullTokens }}</b> token,但常驻上下文的只有目录里那一行
        <b>{{ lineTokens }}</b> token —— <b>1 : {{ ratio }}</b>。技能一多,这个账就很可观:
        50 个技能全塞进 system 是 2 万多 token 每轮,而<b>其中相关的通常只有一个</b>。
      </p>
      <div class="levels">
        <div class="level">
          <span class="lv-badge lv1">L1</span>
          <div class="level-body">
            <div class="level-t">目录:name + description</div>
            <div class="level-d">
              <b>常驻</b> system,每个技能几十 token。它唯一的职责是让模型判断"要不要打开我"
              —— 所以 description 必须写清<b>什么时候用</b>,而不只是"这是什么"。
            </div>
          </div>
        </div>
        <div class="level">
          <span class="lv-badge lv2">L2</span>
          <div class="level-body">
            <div class="level-t">正文:SKILL.md</div>
            <div class="level-d">
              模型判断相关后,调 <code class="inline">read_skill</code> 读进来
              (本例 199 token),<b>只在本次会话、只为这个任务</b>付。
            </div>
          </div>
        </div>
        <div class="level">
          <span class="lv-badge lv3">L3</span>
          <div class="level-body">
            <div class="level-t">附件:references/*.md</div>
            <div class="level-d">
              正文里点名了才读(<code class="inline">read_skill_resource</code>,本例 322 token)。
              适合放长清单、schema、样例库 —— 本例的评审清单就在这一层。
            </div>
          </div>
        </div>
      </div>

      <h3 class="sec-title" style="margin-top: 22px">实现:循环一行没改</h3>
      <CodeBlock title="① Level 1:只拼 name + description" lang="ts" :code="indexCode" />
      <div style="height: 12px" />
      <CodeBlock title="② 装载 = 工具返回文本,返回值进 messages" lang="ts" :code="executorCode" />
      <div style="height: 12px" />
      <CodeBlock title="③ 循环还是那个循环" lang="ts" :code="loopCode" />

      <h3 class="sec-title" style="margin-top: 22px">时序图:一次触达第 3 层的装载</h3>
      <p class="para">
        <b>点播放看一遍</b>。重点盯两件事:<b>决定打开技能的是模型</b>(第 ③ 步),
        以及<b>上下文只在真正需要时才涨</b>(量条)。
      </p>
      <SeqDiagram
        :lanes="LANES"
        :steps="STEPS"
        :stats="STATS"
        meter-label="上下文 token"
        hint="点「▶ 播放」看 Level 1 → 2 → 3 逐层装载:3 轮对话、2 次装载,上下文 350 → 871。"
      />

      <h3 class="sec-title" style="margin-top: 22px">和 RAG(第 9 课)的分水岭</h3>
      <p class="para">
        RAG 也是"往上下文里补料",很容易和 Skill 混。差别在<b>谁做决定</b>:
        RAG 是<b>我们的代码</b>先检索、把片段拼好硬塞进去,模型没有发言权;
        Skill 是<b>模型</b>看着目录自己决定开不开、开哪层。
        一个是<b>喂饭</b>,一个是<b>给一座图书馆加借书证</b>。
      </p>
      <p class="para">
        它们不互斥,而且常常配合:技能正文里完全可以写"先去检索知识库"。
        <b>Skill 管方法,RAG 管事实。</b>
      </p>

      <h3 class="sec-title" style="margin-top: 22px">写好一个技能的几条实战经验</h3>
      <ul class="points">
        <li>
          <b>description 决定它会不会被打开</b>。这是整条链路上最关键的一句话 ——
          它是模型唯一的检索线索。要写<b>触发场景</b>并覆盖用户的真实说法
          ("review 代码、看代码有没有问题、找隐患"),而不是只写"代码评审规范"。
        </li>
        <li>
          <b>正文写给"会照做的执行者",不是给读者科普</b>。用命令句、给闭合枚举、
          给可复制的完整示例。本例把状态限定成 <code class="inline">违反 / 通过 / 不适用</code>
          三种,模型就没有自由发挥的空间。
        </li>
        <li>
          <b>长清单下沉到 L3</b>。正文保持能一眼读完,细节挪进 <code class="inline">references/</code>
          并在正文里<b>明确点名</b>("判定标准在 references/checklist.md,评审前必须读")。
          不点名,那个文件就永远不会被打开。
        </li>
        <li>
          <b>给技能配验收标准</b>。像左侧那样把规范写成可机器检查的条目(正则也行),
          你才能回答"改了这个技能是变好还是变差" —— 这就是下一课要提的 eval 的雏形。
        </li>
        <li>
          <b>要防"过度装载"</b>。左侧第二个任务就是这个测试:技能不相关时,
          正确行为是<b>一个工具都不调</b>。所以目录里那条"没有相关技能就直接回答"必须写。
        </li>
      </ul>

      <div class="note-box">
        <b>那 Skill 和 MCP 又是什么关系?</b> 正交,而且互补,常常一起用:
        <br />• <b>MCP</b> 送来<b>能力</b> —— 进程外、标准协议、要跑一个 Server。
        <br />• <b>Skill</b> 送来<b>方法</b> —— 就是几个 Markdown 文件,没有协议、没有进程。
        <br />典型组合:MCP 给你操作 GitHub 的工具,Skill 告诉模型你们团队的分支模型和 PR 规范。
        少了任何一半,它都只能算"能动",算不上"会干活"。
      </div>

      <div class="end-box">
        至此,Agent 的四块拼图齐了:<b>能力</b>(Tool / MCP)、<b>方法</b>(Skill)、
        <b>事实</b>(RAG)、<b>循环</b>(ReAct)。而这一课真正给你的是那个更普适的心法 ——
        <b>上下文是稀缺资源,该由模型自己按需取用</b>。下一页是课程收尾与展望。
      </div>
    </template>
  </DemoLayout>
</template>

<style scoped>
/* ---- Level 1 面板 ---- */
.lv1 {
  margin-top: 4px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--c-surface);
}
.lv1-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 9px 14px;
  background: var(--c-primary-soft);
  border-bottom: 1px solid var(--c-border);
}
.lv1-title {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--c-primary-hover);
}
.lv1-budget {
  font-size: 11.5px;
  color: var(--c-text-soft);
  font-family: var(--font-mono);
}
.lv1-vs {
  color: var(--c-text-faint);
}
.lv1-save {
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--c-success-soft);
  color: var(--c-success);
  font-weight: 700;
}
.lv1-body {
  margin: 0;
  padding: 12px 14px;
  background: #0f172a;
  color: #cbd5e1;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 220px;
  overflow-y: auto;
}
.lv1-note {
  padding: 8px 14px;
  font-size: 11.5px;
  color: var(--c-text-soft);
  background: var(--c-bg);
}

/* ---- 任务选择 ---- */
.field-label {
  display: block;
  font-size: 12.5px;
  color: var(--c-text-soft);
  font-weight: 500;
  margin: 16px 0 6px;
}
.tasks {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.task {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 7px 12px;
  border: 1px solid var(--c-border-strong);
  border-radius: var(--radius-sm);
  background: var(--c-surface);
  text-align: left;
}
.task:hover {
  border-color: var(--c-primary);
}
.task.on {
  border-color: var(--c-primary);
  background: var(--c-primary-soft);
}
.task-title {
  font-size: 13px;
  font-weight: 600;
}
.task-expect {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--c-text-faint);
}
.task.on .task-expect {
  color: var(--c-primary);
}
.task-note {
  margin: 8px 0 10px;
  font-size: 12px;
  color: var(--c-text-soft);
  line-height: 1.6;
}
.err {
  margin-top: 12px;
  padding: 10px 12px;
  background: var(--c-danger-soft);
  border: 1px solid #fecaca;
  border-radius: var(--radius-sm);
  color: var(--c-danger);
  font-size: 12.5px;
}

/* ---- 装载记账 ---- */
.ledger {
  margin-top: 14px;
  padding: 10px 14px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  background: var(--c-bg);
}
.ledger-head {
  font-size: 12.5px;
  color: var(--c-text-soft);
  margin-bottom: 6px;
}
.ledger-empty {
  font-size: 12px;
  color: var(--c-text-soft);
  line-height: 1.6;
}
.ledger-empty .ok {
  color: var(--c-success);
  font-weight: 600;
}
.ledger-empty .bad {
  color: var(--c-text-faint);
}
.ledger-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 12.5px;
}
.ledger-tk {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--c-text-faint);
}
.lv-badge {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 24px;
  height: 19px;
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 700;
  color: #fff;
}
.lv-badge.lv1 {
  background: var(--c-text-faint);
}
.lv-badge.lv2 {
  background: var(--c-primary);
}
.lv-badge.lv3 {
  background: #7c3aed;
}

/* ---- 并排对比 ---- */
.compare {
  margin-top: 16px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.col {
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--c-surface);
  display: flex;
  flex-direction: column;
}
.col-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 12px;
  font-size: 12.5px;
  font-weight: 700;
  border-bottom: 1px solid var(--c-border);
}
.col-bad .col-head {
  background: var(--c-danger-soft);
  color: var(--c-danger);
}
.col-good .col-head {
  background: var(--c-success-soft);
  color: var(--c-success);
}
.score {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
}
.col-body {
  flex: 1;
  padding: 12px;
  font-size: 12.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  min-height: 120px;
  max-height: 340px;
  overflow-y: auto;
}
.loading {
  color: var(--c-text-faint);
}

/* ---- 验收清单 ---- */
.checks {
  margin-top: 14px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.checks-head {
  padding: 8px 12px;
  background: var(--c-bg);
  border-bottom: 1px solid var(--c-border);
  font-size: 12px;
  font-weight: 700;
  color: var(--c-text-soft);
}
.check-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--c-border);
}
.check-row:last-of-type {
  border-bottom: none;
}
.ck {
  flex-shrink: 0;
  width: 18px;
  text-align: center;
  font-weight: 700;
  color: var(--c-danger);
}
.ck.pass {
  color: var(--c-success);
}
.check-label {
  font-size: 12.5px;
  line-height: 1.5;
}
.checks-legend {
  padding: 6px 12px;
  background: var(--c-bg);
  font-size: 11px;
  color: var(--c-text-faint);
}

/* ---- 技能库浏览器 ---- */
.lib {
  margin-top: 20px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  background: var(--c-surface);
  overflow: hidden;
}
.lib-head {
  padding: 10px 14px;
  background: var(--c-bg);
  border-bottom: 1px solid var(--c-border);
  font-size: 13px;
  font-weight: 700;
}
.lib-body {
  padding: 10px 14px 14px;
  background: #fbfbfd;
}
.sk-files {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.sk-file {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 11px;
  border: 1px solid var(--c-border-strong);
  border-radius: 999px;
  background: var(--c-surface);
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--c-text-soft);
}
.sk-file:hover {
  border-color: var(--c-primary);
  color: var(--c-primary);
}
.sk-file.on {
  background: var(--c-primary);
  border-color: var(--c-primary);
  color: #fff;
}
.sk-file-lv {
  font-size: 9.5px;
  opacity: 0.75;
}
.sk-content {
  margin: 0;
  padding: 12px;
  background: #1e293b;
  color: #e2e8f0;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 320px;
  overflow-y: auto;
}

/* ---- 讲解区 ---- */
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
.cmp {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
.cmp th,
.cmp td {
  padding: 7px 10px;
  border: 1px solid var(--c-border);
  text-align: left;
  vertical-align: top;
}
.cmp thead th {
  background: var(--c-bg);
  font-size: 12px;
}
.cmp-k {
  width: 92px;
  font-weight: 700;
  color: var(--c-text-soft);
  background: #fbfbfd;
}
/* ---- 三层叠放图 ---- */
.stack {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
  margin: 4px 0;
}
.stack-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  background: var(--c-surface);
}
.stack-k {
  flex-shrink: 0;
  width: 54px;
  text-align: center;
  padding: 3px 0;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 11.5px;
  font-weight: 700;
  background: #7c3aed;
  color: #fff;
}
.stack-k.tool {
  background: var(--c-primary);
}
.stack-k.loop {
  background: var(--c-text-soft);
}
.stack-v {
  font-size: 12.5px;
  line-height: 1.5;
}
.stack-arr {
  padding-left: 20px;
  font-size: 11px;
  color: var(--c-text-faint);
}
/* ---- 该用哪个 ---- */
.pick {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pick-item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.pick-k {
  flex-shrink: 0;
  width: 82px;
  text-align: center;
  padding: 3px 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--c-primary-hover);
  background: var(--c-primary-soft);
  border-radius: var(--radius-sm);
}
.pick-v {
  font-size: 13px;
  line-height: 1.6;
  padding-top: 1px;
}
.levels {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 4px;
}
.level {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.level-t {
  font-size: 13px;
  font-weight: 700;
}
.level-d {
  font-size: 12.5px;
  color: var(--c-text-soft);
  line-height: 1.6;
  margin-top: 2px;
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
@media (max-width: 900px) {
  .compare {
    grid-template-columns: 1fr;
  }
}
</style>
