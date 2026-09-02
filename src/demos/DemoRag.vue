<script setup lang="ts">
/**
 * Demo 9 —— RAG(检索增强生成)
 * 教学目标:让模型回答它"本来不知道"的私有知识。
 * 完整管线:切分 → 检索 → 增强(拼上下文)→ 生成。
 * 用开关对比"开 RAG / 关 RAG",直观证明检索到的资料确实改变了回答。
 */
import { ref, computed } from 'vue';
import DemoLayout from '../components/DemoLayout.vue';
import CodeBlock from '../components/CodeBlock.vue';
import NoModelHint from '../components/NoModelHint.vue';
import RequestInspector from '../components/RequestInspector.vue';
import SourceViewer from '../components/SourceViewer.vue';
import SeqDiagram, { type SeqLane, type SeqStep, type SeqStat } from '../components/SeqDiagram.vue';
import { chunkDocument, retrieve, buildAugmentedSystem, type Chunk } from '../core/rag';
import { streamChatCompletion } from '../core/llm';
import { setActiveTag } from '../core/inspector';
import { useActiveModel } from '../components/useActiveModel';

const { active } = useActiveModel();

// 一份"模型不可能知道"的虚构私有知识库(公司内部资料)
const KB_DEFAULT = `幻狐科技成立于 2021 年,总部位于杭州,创始人是沈青岚。

公司的核心产品叫「星轨」,是一个面向前端团队的 AI 研发协作平台。

星轨的定价分三档:个人版每月 39 元,团队版每月 199 元,企业版需要联系销售定制。

星轨支持私有化部署,但仅对企业版客户开放。

公司的技术栈以 TypeScript 和 Rust 为主,前端统一使用 Vue 3。

客服邮箱是 support@huanhu.example,工作时间为工作日 9:00 到 18:00。`;

const kb = ref(KB_DEFAULT);
const useRag = ref(true);
const topK = ref(3);
const question = ref('星轨的团队版多少钱?支持私有化部署吗?');

const output = ref('');
const loading = ref(false);
const errmsg = ref('');
const retrieved = ref<Chunk[]>([]);

// 实时切分预览
const chunks = computed(() => chunkDocument(kb.value));

async function run() {
  if (!active.value) return;
  setActiveTag('demo-rag');
  loading.value = true;
  output.value = '';
  errmsg.value = '';
  retrieved.value = [];

  // ① 切分 → ② 检索(仅在开启 RAG 时)
  const hits = useRag.value ? retrieve(question.value, chunks.value, topK.value) : [];
  retrieved.value = hits;

  // ③ 增强:把检索结果拼进 system;关闭 RAG 时用一个普通 system
  const system = useRag.value
    ? buildAugmentedSystem(hits)
    : '你是一个问答助手,请回答用户的问题。';

  const messages = [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: question.value },
  ];

  try {
    // ④ 生成
    await streamChatCompletion(active.value, messages, (delta) => {
      output.value += delta;
    });
  } catch (e: any) {
    errmsg.value = e?.message ?? String(e);
  } finally {
    loading.value = false;
  }
}

const pipelineCode = `// ===== 阶段一 · 建库:只做一次,结果存起来复用 =====
const chunks = chunkDocument(kb);          // 切分:长文档 → 小片段
const index  = await embedAll(chunks);     // 向量化:每段转成向量,存入向量库

// ===== 阶段二 · 查询:每次提问都走一遍 =====
const hits   = retrieve(question, index, 3);  // ① 检索:找最相关的 3 段
const system = buildAugmentedSystem(hits);    // ② 增强:命中片段拼进 system
await streamChatCompletion(cfg, [             // ③ 生成:模型据此回答
  { role: 'system', content: system },
  { role: 'user',   content: question },
], onDelta);
// 注意:切分/向量化【不在】每次查询里 —— 那是建库阶段一次性做好的`;

const topKCode = `// 检索会给【所有】候选按相关度打分(高→低),但只取 Top-K 放进上下文
const scored = chunks
  .map(c => ({ ...c, score: scoreChunk(qTokens, tokenize(c.text)) }))
  .filter(c => c.score > 0)        // ① 阈值:不相关的一段都不给(宁缺毋滥)
  .sort((a, b) => b.score - a.score); // ② 按相关度排序

const hits = scored.slice(0, topK); // ③ 只取前 K 段(本 Demo 默认 3)
// 更成熟的做法:按 token 预算截断,而不是按固定段数`;


const retrieveCode = `// ③ 检索的打分函数 —— 这就是 RAG 里【唯一可插拔】的部分
export function scoreChunk(queryTokens, chunkTokens) {
  // 本项目:词重合度(纯前端,零依赖,连的网关没有 embeddings 接口)
  const chunkSet = new Set(chunkTokens);
  let hit = 0;
  for (const q of new Set(queryTokens)) if (chunkSet.has(q)) hit++;
  return hit / Math.sqrt(chunkTokens.length);
}
// 生产级做法:把这行换成向量语义检索,其余管线一行都不用改
// return cosineSimilarity(embed(query), embed(chunk));`;

// embedding:把文本变成向量,让"语义"变成可计算的坐标
const embeddingCode = `// 一段文本 → 一串数字(向量),语义相近的向量方向也相近
"团队版每月 199 元"  → [0.021, -0.88, 0.13, ...]   // 比如 1536 个数
"团队套餐的价格"      → [0.019, -0.85, 0.15, ...]   // ← 方向几乎一致
"今天杭州下雨"        → [0.770,  0.12, -0.63, ...]  // ← 方向差很远

// "两段话有多相关" 于是变成一道数学题:算向量夹角的余弦
similarity = cosine(embed(query), embed(chunk));  // 越接近 1 越相关`;

// 词重合 vs 语义:同一个问题,两种检索的差别
const matchCompare = `问题:  "团队版多少钱?"
资料:  "团队版每月 199 元"

// 词重合度检索:两句没有"钱"这个共同词 → 可能漏掉 ❌
// 向量语义检索:理解 "多少钱" ≈ "价格/元/定价" → 照样命中 ✅`;

/* ============================================================
 * 讲解区:可播放的 RAG 管线图
 * 五条泳道 = 管线上的五个角色。两个分组:建库(离线一次)与查询(每次提问)。
 * 重点让人看见:① 切分/向量化只在建库发生 ② 查询时"检索结果"如何变成 system
 * ============================================================ */

const RAG_LANES: SeqLane[] = [
  { icon: '📄', name: '私有文档' },
  { icon: '🔢', name: 'Embedding', sub: '(文本→向量)' },
  { icon: '🗄️', name: '向量库' },
  { icon: '🧩', name: '我们的代码', sub: '(拼上下文)' },
  { icon: '🤖', name: '模型' },
];

const RAG_STATS: SeqStat[] = [{ label: '次调用 embedding', count: 'call' }];

const RAG_STEPS: SeqStep[] = [
  {
    from: 0, to: 3, kind: 'ask', group: '阶段一 · 建库(离线,只做一次)',
    label: '✂️ 切分:长文档 → 一堆小片段',
    note: '文档太长,不能整篇当一个单位。先切成语义完整的小段(本 Demo 按空行切),左边"已切分为 N 个片段"就是这一步的结果。',
  },
  {
    from: 3, to: 1, kind: 'call', label: '每个片段送去向量化',
    note: '★ 注意:这一步只在建库阶段发生。文档有多大都无所谓 —— 它只是一次性的离线开销。',
  },
  {
    from: 1, to: 2, kind: 'obs', label: '片段向量 [0.02, -0.88, …] 入库',
    note: '每段文本变成一串数字,连同原文一起存进向量库。这就是那张"语义地图",意思相近的片段自然聚在一起。',
  },
  {
    from: 3, to: 3, kind: 'ask', group: '阶段二 · 查询(在线,每次提问)',
    label: '❓ 用户提问:"团队版多少钱?"',
    note: '建库已经完成,从这里开始才是每次提问都要走一遍的热路径。',
  },
  {
    from: 3, to: 1, kind: 'call', label: '问题也送去向量化',
    dep: true,
    note: '★ 关键:必须用【同一个】embedding 模型。只有这样,问题向量和文档向量才落在同一张地图上、能比较距离。',
  },
  {
    from: 1, to: 2, kind: 'exec', label: '拿问题向量去库里找最近的几段',
    note: '算余弦相似度,给所有候选打分排序。本 Demo 没有 embedding 接口,这一步换成了纯前端的词重合度打分。',
  },
  {
    from: 2, to: 3, kind: 'obs', label: 'Top-K 命中片段(默认 3 段)',
    note: '只返回最相关的前 K 段,并且低于阈值的直接丢弃 —— 宁缺毋滥。左侧运行区的"检索到的片段"就是这个返回值。',
  },
  {
    from: 3, to: 3, kind: 'ret', dep: true,
    label: '🧩 增强:把命中片段拼进 system',
    note: '★ 这就是 RAG 里的 A(Augmented):检索结果被写进 system 提示词。展开左侧请求检查器,能亲眼看到 system 里多出来的那段资料。',
  },
  {
    from: 3, to: 4, kind: 'call', label: 'system(含资料) + 用户问题',
    note: '模型收到的是一个"开卷考试"的请求 —— 答案就在 system 里,它只需要据此组织语言。',
  },
  {
    from: 4, to: 3, kind: 'final', label: '"团队版每月 199 元"',
    note: '★ 模型本来完全不知道这件事。注意它没有"学到"新知识 —— 只是这次上下文里刚好有。关掉 RAG 再问,它就只能胡编或承认不知道。',
  },
];

</script>

<template>
  <DemoLayout demo-id="rag">
    <template #whatsnew>
      让模型回答它<b>本来不知道</b>的私有知识:先从知识库<b>检索</b>出相关片段,
      再把它们塞进上下文一起发给模型。这就是 <b>RAG</b> —— 上下文管理最重要的一种手段。
    </template>

    <template #playground>
      <NoModelHint />

      <label class="field-label">📚 知识库(模型训练时绝不可能见过的虚构资料,可自行编辑)</label>
      <textarea v-model="kb" class="textarea kb" rows="8" />
      <div class="kb-meta">已切分为 <b>{{ chunks.length }}</b> 个片段</div>

      <label class="field-label">你的问题</label>
      <textarea v-model="question" class="textarea" rows="2" />

      <div class="controls">
        <label class="switch">
          <input type="checkbox" v-model="useRag" />
          启用 RAG(关掉试试:模型会答不上来或胡编)
        </label>
        <label class="topk">
          检索 Top
          <input type="number" v-model.number="topK" min="1" max="6" class="topk-input" />
          段
        </label>
      </div>

      <button class="btn btn-primary" style="margin-top: 12px" :disabled="loading || !active" @click="run">
        {{ loading ? '生成中…' : useRag ? '检索 + 回答' : '直接回答(不检索)' }}
      </button>

      <div v-if="errmsg" class="err">{{ errmsg }}</div>

      <!-- ② 检索命中:让"检索"这一步肉眼可见 -->
      <div v-if="retrieved.length" class="retrieved">
        <div class="retrieved-label">🔍 检索到的片段(按相关度)—— 只有这些会被塞进上下文</div>
        <div v-for="(c, i) in retrieved" :key="c.id" class="hit">
          <div class="hit-head">
            <span class="hit-rank">#{{ i + 1 }}</span>
            <span class="hit-score">score {{ c.score?.toFixed(3) }}</span>
          </div>
          <div class="hit-text">{{ c.text }}</div>
        </div>
      </div>
      <div v-else-if="useRag && output && !loading" class="retrieved-empty">
        🔍 没检索到相关片段 —— 模型将被告知"资料中没有提到"。
      </div>

      <div v-if="output || loading" class="answer">
        <div class="answer-label">
          模型回复<span class="mode-tag" :class="useRag ? 'on' : 'off'">{{ useRag ? 'RAG 开' : 'RAG 关' }}</span>
          <span v-if="loading" class="cursor">▋</span>
        </div>
        <div class="answer-body">{{ output }}</div>
      </div>

      <RequestInspector tag="demo-rag" />

      <SourceViewer :files="['core/rag.ts', 'core/llm.ts', 'core/adapters.ts', 'core/types.ts']" />
    </template>

    <template #explain>
      <h3 class="sec-title">为什么需要 RAG?</h3>
      <p class="para">
        大模型只知道<b>训练时见过的公开知识</b>,它不知道你公司的内部文档、你昨天写的代码、
        今天的新闻。而上一课也讲了:上下文窗口有限,不可能把整个知识库一股脑塞进去。
      </p>
      <p class="para">
        <b>RAG(Retrieval-Augmented Generation,检索增强生成)</b>的思路很直接:
        把知识存在外部,<b>每次只按当前问题检索出最相关的几段</b>,临时塞进上下文,再让模型据此回答。
        知识库可以无限大,而上下文里只放"这次用得上的"。
      </p>

      <h3 class="sec-title" style="margin-top: 18px">先理解基石:embeddings(嵌入)</h3>
      <p class="para">
        RAG 的检索靠的就是它,所以先讲清楚。一句话:<b>把一段文本变成一串数字(向量),
        让"语义"变成可计算的坐标</b>。经过一个 embedding 模型,文本会被转成几百~几千维的向量,
        且有个关键性质 —— <b>语义相近的文本,向量方向也相近</b>。
      </p>
      <CodeBlock title="文本 → 向量,再用余弦相似度比较" lang="ts" :code="embeddingCode" />
      <p class="para" style="margin-top: 12px">
        于是"两段话有多相关"就变成一道数学题:算向量夹角的余弦,越接近 1 越相关。
        一个直观类比:embedding 把每段文字放到一张巨大的<b>"语义地图"</b>上,意思相近的内容自然聚在一起;
        <b>检索就是"在地图上找离问题最近的几个点"</b>。
      </p>

      <h3 class="sec-title" style="margin-top: 18px">全局架构:两个阶段</h3>
      <p class="para">
        有了 embedding 的概念,来看总体流程。RAG 分成<b>两个独立阶段</b> ——
        建库只做一次,查询每次提问都走一遍。<b>点播放走一遍</b>,看清每一步东西交到了谁手上:
      </p>
      <SeqDiagram
        :lanes="RAG_LANES"
        :steps="RAG_STEPS"
        :stats="RAG_STATS"
        hint="点「▶ 播放」逐步观看完整管线:前 3 步是建库(只做一次),后 7 步是每次提问都要走的查询。"
      />
      <p class="para arch-note">
        关键点:<b>建库和查询都用同一个 embedding 模型</b>,才能让"问题向量"和"文档向量"落在同一张
        语义地图上、可以比较距离。<b>切分和向量化只发生在建库阶段</b> —— 查询时文档早已是现成的向量,
        不必再切一遍。
      </p>

      <h3 class="sec-title" style="margin-top: 18px">代码:建库一次,查询多次</h3>
      <CodeBlock title="core/rag.ts" lang="ts" :code="pipelineCode" />
      <p class="para" style="margin-top: 10px">这也回答一个常见疑问:</p>
      <div class="tip-box tip-blue">
        <b>❓ 为什么不用每次查询都重新切分文档?</b><br />
        因为<b>切分 + 向量化属于"建库阶段",只做一次</b>,结果持久化在向量库里反复复用。
        每次查询只做三件事:<b>把问题向量化 → 在库里检索 → 拼上下文生成</b>。
        文档有多大都无所谓,查询开销只和"问题"与"检索"有关,不随文档增长。
      </div>
      <div class="side-note" style="margin-top: 12px">
        注:本 Demo 是<b>简化形态</b> —— 因网关没有 embedding 接口,没有"预先建库",
        而是每次提问时<b>现场</b>对知识库切分、用词重合度打分。这只是为了零依赖演示;
        生产里请按上面的两阶段来,别把切分放进查询热路径。
      </div>

      <h3 class="sec-title" style="margin-top: 18px">拼多少进上下文?Top-K 与取舍</h3>
      <p class="para">
        检索会给<b>所有</b>候选按相关度打分(高到低),但<b>不会全放</b>,而是取前 K 段(<b>Top-K</b>)。
        本 Demo 里对应那个"检索 Top N 段"输入框(默认 3)。K 怎么定,是几个约束的平衡:
      </p>
      <CodeBlock title="从候选到 Top-K" lang="ts" :code="topKCode" />
      <ul class="points">
        <li><b>窗口是硬上限</b>:片段 + system + 历史 + 问题 + 留给回答的空间,总和不能超上下文窗口。</li>
        <li><b>成本与延迟</b>:每段都是要计费的 token,放得越多越贵越慢。多数场景 <b>K=3~5</b> 就够。</li>
        <li>
          <b>更多 ≠ 更好(反直觉但关键)</b>:塞进低相关片段等于掺"干扰项",可能把模型带偏;
          且上下文太长时模型对<b>中间部分</b>注意力下降(lost in the middle)。宁可精准给 3 段,不要贪多给 15 段。
        </li>
        <li>
          <b>阈值优先于凑数</b>:低于某个相关度就直接丢弃,哪怕不够 K 段 ——
          这正是本 Demo 里 <code class="inline">score &gt; 0</code> 过滤的思想:没相关的<b>一段都不给</b>,
          让模型老实说"资料里没有",而不是硬凑。
        </li>
      </ul>
      <div class="tip-box">
        <b>🔧 更成熟的做法:</b>不按"段数"而按 <b>token 预算</b>截断(如"资料最多 2000 token,装满为止");
        以及 <b>Rerank(重排)</b> —— 先用快而糙的检索粗筛 Top-50,再用更强的模型精排出真正最相关的 Top-5,
        召回与精度兼顾。
      </div>

      <h3 class="sec-title" style="margin-top: 18px">检索:RAG 里唯一"可插拔"的部分</h3>
      <p class="para">
        回到检索本身。生产级 RAG 的检索用<b>向量嵌入</b>算余弦相似度,能匹配到语义相近但用词不同的片段
        —— 这样"团队版价格"能匹配到"每月 199 元",哪怕没有一个共同的字:
      </p>
      <CodeBlock title="字面匹配 vs 语义匹配" lang="ts" :code="matchCompare" />
      <CodeBlock title="打分函数是可替换的模块" lang="ts" :code="retrieveCode" />
      <div class="tip-box">
        <b>⚠️ 本 Demo 的取舍(如实说明):</b>本项目连接的网关<b>没有提供 embeddings 接口</b>,
        所以这里的检索用的是<b>纯前端的词重合度打分</b>(中文按 bigram 切词)。它零依赖、可离线演示,
        教的是 RAG 的<b>完整管线与思想</b>。要升级成向量检索,<b>只需替换 <code class="inline">scoreChunk</code> 这一个函数</b>,
        切分、拼接、生成三步完全不动 —— 这正说明检索是个独立可换的模块。
      </div>

      <details class="qa">
        <summary class="qa-summary">
          📐 补充:为什么本项目的网关没有 embeddings 接口?
        </summary>
        <div class="qa-body">
          <p class="para">
            先纠正一个前提:<b>不是"模型做不到",而是"这个网关没暴露这个接口"</b> —— 这是两件事。
          </p>
          <ul class="points">
            <li>
              <b>① embedding 是一类独立的模型,不是对话模型附带的功能。</b>
              <code class="inline">gpt-5.5</code>、<code class="inline">claude-opus</code> 是<b>生成模型</b>(文本→文本);
              embedding 是<b>另一类模型</b>(文本→向量,如 <code class="inline">text-embedding-3-small</code>)。
              二者分开训练、分开部署 —— 平台"有对话模型"不代表"上架了 embedding 模型"。
            </li>
            <li>
              <b>② 这个网关是聚合代理,只选择性转发了对话接口。</b>
              实测 <code class="inline">/v1/chat/completions</code> 通,而 <code class="inline">/v1/embeddings</code> 全部 404 ——
              它只代理了 chat 这一条路径。常见原因:搭建时只覆盖"对话"主场景、embedding 需单独接入与计费没上、
              或内部另有独立向量服务不对外开放。
            </li>
          </ul>
          <p class="para" style="margin-bottom: 0">
            所以这跟"技术能不能做"无关,纯粹是<b>这个特定网关的接口覆盖范围</b>。
            换成 OpenAI 官方、通义、智谱等直连接口,<code class="inline">/embeddings</code> 一般都有。
            也正因为 RAG 里<b>只有"检索"这一步依赖 embedding</b>,我们才能先用词重合度把管线跑通,
            接口就绪后只换 <code class="inline">scoreChunk</code> 一个函数即可升级。
          </p>
        </div>
      </details>

      <div class="side-note">
        动手对比:① 保持"启用 RAG",问"团队版多少钱",模型会答出"199 元/月"(资料里的);
        ② 关掉 RAG 再问同一句,模型只能<b>胡编或承认不知道</b>。打开下方请求检查器,
        对比两次的 <code class="inline">system</code> —— 开 RAG 时里面多了检索到的资料,这就是"增强"。
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
.kb {
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.6;
}
.kb-meta {
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--c-text-faint);
}
.controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 12px;
}
.switch {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  cursor: pointer;
}
.topk {
  font-size: 13px;
  color: var(--c-text-soft);
  display: flex;
  align-items: center;
  gap: 6px;
}
.topk-input {
  width: 52px;
  padding: 4px 8px;
  border: 1px solid var(--c-border-strong);
  border-radius: var(--radius-sm);
  font-size: 13px;
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
.retrieved {
  margin-top: 16px;
  padding: 12px 14px;
  background: var(--c-info-soft);
  border: 1px solid #a5f3fc;
  border-radius: var(--radius-sm);
}
.retrieved-label {
  font-size: 12px;
  font-weight: 600;
  color: #155e75;
  margin-bottom: 8px;
}
.hit {
  padding: 8px 10px;
  background: var(--c-surface);
  border-radius: var(--radius-sm);
  margin-bottom: 6px;
}
.hit:last-child {
  margin-bottom: 0;
}
.hit-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
}
.hit-rank {
  font-weight: 700;
  font-size: 12px;
  color: var(--c-primary);
}
.hit-score {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--c-text-faint);
}
.hit-text {
  font-size: 12.5px;
  line-height: 1.5;
}
.retrieved-empty {
  margin-top: 16px;
  padding: 10px 14px;
  background: var(--c-warn-soft);
  border-radius: var(--radius-sm);
  font-size: 12.5px;
  color: #92400e;
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
  display: flex;
  align-items: center;
  gap: 8px;
}
.mode-tag {
  font-size: 10.5px;
  padding: 1px 7px;
  border-radius: 999px;
  font-weight: 600;
}
.mode-tag.on {
  background: var(--c-success-soft);
  color: var(--c-success);
}
.mode-tag.off {
  background: var(--c-danger-soft);
  color: var(--c-danger);
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
  margin-top: 14px;
  padding: 12px 14px;
  background: var(--c-warn-soft);
  border: 1px solid #fde68a;
  border-radius: var(--radius-sm);
  font-size: 12.5px;
  color: #92400e;
  line-height: 1.7;
}
.tip-box.tip-blue {
  background: var(--c-primary-soft);
  border-color: #c7d2fe;
  color: var(--c-primary-hover);
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
/* ---- 两阶段架构图 ---- */
.arch-note {
  margin-top: 12px;
  font-size: 12.5px;
  color: var(--c-text-soft);
}
</style>
