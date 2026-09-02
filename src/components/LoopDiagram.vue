<script setup lang="ts">
/**
 * LoopDiagram —— 可播放的循环流程图(讲解区通用组件)
 *
 * 与 SeqDiagram 的分工:
 *   SeqDiagram  画"谁把什么交给谁"(泳道时序图,适合讲协议往返)
 *   LoopDiagram 画"控制流怎么走"(流程图 + 判断分支 + 回边,适合讲循环本身)
 *
 * 节点是静态的,播放时移动的是"当前执行位置"。同一批节点会被反复走过 ——
 * 这正是"循环"要让人看见的东西:光标自己爬回去了。
 */
import { ref, computed, onUnmounted } from 'vue';

/** 节点形状,决定外观 */
export type NodeShape =
  | 'start' // 入口
  | 'step' // 普通语句
  | 'decision' // 判断(菱形语义,这里用左侧色条 + 问号表达)
  | 'exit' // 从循环里跳出去的出口(右缩进,虚线连接)
  | 'error'; // 出错分支(不崩,回填后继续)

export interface LoopNode {
  id: string;
  shape: NodeShape;
  /** 节点标题,支持简单的 <code> 片段 */
  label: string;
  /** 节点下方的小字说明 */
  sub?: string;
  /** 是否属于循环体(会被 while 框圈起来) */
  inLoop?: boolean;
  /** 对应的源码行,悬浮可见 */
  code?: string;
}

/** 一帧 = 执行位置停在某个节点上 */
export interface LoopFrame {
  /** 停在哪个节点 */
  node: string;
  /** 底部解说 */
  note: string;
  /** 第几轮(从 1 开始);同一轮内的帧填同一个值 */
  round: number;
  /** 此刻 messages 有几条 */
  msgs: number;
  /** 判断节点走了哪个分支,显示在节点右侧 */
  branch?: string;
  /** 这一帧是"回到循环开头"——播放时画一次回边动画 */
  loopBack?: boolean;
  /** 高亮成警示色(出错/兜底路径) */
  warn?: boolean;
}

const props = withDefaults(
  defineProps<{
    nodes: LoopNode[];
    frames: LoopFrame[];
    /** while 框上的标签,如 "for (let step = 0; step < maxSteps; step++)" */
    loopLabel?: string;
    /** 步数上限,用于画预算格子 */
    maxSteps?: number;
    hint?: string;
  }>(),
  { loopLabel: '', maxSteps: 0, hint: '' },
);

const cursor = ref(-1);
const playing = ref(false);
const fast = ref(false);
let timer: number | undefined;

const cur = computed(() => (cursor.value >= 0 ? props.frames[cursor.value] : null));
const atEnd = computed(() => cursor.value >= props.frames.length - 1);
const round = computed(() => cur.value?.round ?? 0);
// 未开始时显示"—",避免出现"第 0 轮"这种不存在的状态
const roundText = computed(() => (cur.value ? String(cur.value.round) : '—'));
const msgs = computed(() => cur.value?.msgs ?? props.frames[0]?.msgs ?? 0);
/** 走过几次"问模型"= 花了几次 API 调用,这是循环最实在的成本 */
const asks = computed(() =>
  props.frames.slice(0, cursor.value + 1).filter((f) => f.node === 'ask').length,
);

const loopNodes = computed(() => props.nodes.filter((n) => n.inLoop));
const preNodes = computed(() => props.nodes.filter((n) => !n.inLoop));

function stopTimer() {
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
}
function startTimer() {
  stopTimer();
  timer = window.setInterval(
    () => {
      if (atEnd.value) {
        playing.value = false;
        stopTimer();
        return;
      }
      cursor.value++;
    },
    fast.value ? 600 : 1300,
  );
}
function togglePlay() {
  if (playing.value) {
    playing.value = false;
    stopTimer();
    return;
  }
  if (atEnd.value) cursor.value = -1;
  playing.value = true;
  startTimer();
}
function toggleSpeed() {
  fast.value = !fast.value;
  if (playing.value) startTimer();
}
function step(delta: number) {
  playing.value = false;
  stopTimer();
  cursor.value = Math.min(props.frames.length - 1, Math.max(-1, cursor.value + delta));
}
function reset() {
  playing.value = false;
  stopTimer();
  cursor.value = -1;
}
/** 跳到下一轮的开头,方便"我只想看第 3 轮" */
function nextRound() {
  playing.value = false;
  stopTimer();
  const from = Math.max(cursor.value, 0);
  const r = props.frames[from]?.round ?? 0;
  const idx = props.frames.findIndex((f, i) => i > from && f.round > r);
  cursor.value = idx >= 0 ? idx : props.frames.length - 1;
}
onUnmounted(stopTimer);

/** 节点状态:当前 / 走过过 / 还没到 */
function nodeState(id: string) {
  if (cursor.value < 0) return 'idle';
  if (cur.value?.node === id) return 'active';
  return props.frames.slice(0, cursor.value + 1).some((f) => f.node === id) ? 'visited' : 'idle';
}
/** 某节点被走过几次 —— 循环里的节点会 >1,直接体现"反复执行" */
function hitCount(id: string) {
  if (cursor.value < 0) return 0;
  return props.frames.slice(0, cursor.value + 1).filter((f) => f.node === id).length;
}
function branchOn(id: string) {
  return cur.value?.node === id ? cur.value.branch : undefined;
}
</script>

<template>
  <div class="loop" :class="{ warn: cur?.warn }">
    <!-- 控制条 -->
    <div class="bar">
      <button class="sbtn sbtn-main" @click="togglePlay">
        {{ playing ? '⏸ 暂停' : atEnd ? '↻ 重新播放' : '▶ 播放' }}
      </button>
      <button class="sbtn" :disabled="cursor < 0" @click="step(-1)">‹ 上一步</button>
      <button class="sbtn" :disabled="atEnd" @click="step(1)">下一步 ›</button>
      <button class="sbtn" :disabled="atEnd" @click="nextRound">下一轮 ⏭</button>
      <button class="sbtn" title="切换播放速度" @click="toggleSpeed">速度 {{ fast ? '2x' : '1x' }}</button>
      <button class="sbtn" :disabled="cursor < 0" @click="reset">清空</button>
      <span class="progress">{{ cursor + 1 }} / {{ frames.length }}</span>
    </div>

    <!-- 实时状态:轮次 / API 调用次数 / messages / 步数预算 -->
    <div class="stats">
      <span class="stat">第 <b>{{ roundText }}</b> 轮</span>
      <span class="stat"><b>{{ asks }}</b> 次 API 调用</span>
      <span class="stat">messages <b>{{ msgs }}</b> 条</span>
      <span v-if="maxSteps" class="stat budget">
        步数预算
        <span class="cells">
          <i v-for="n in maxSteps" :key="n" class="cell" :class="{ used: n <= round }" />
        </span>
        <b>{{ roundText }}</b>/{{ maxSteps }}
      </span>
    </div>

    <div class="body">
      <!-- 循环外的准备工作 -->
      <div
        v-for="n in preNodes"
        :key="n.id"
        class="node"
        :class="[n.shape, nodeState(n.id)]"
        :title="n.code"
      >
        <div class="node-main">
          <span class="node-label" v-html="n.label" />
          <span v-if="hitCount(n.id) > 1" class="hits">×{{ hitCount(n.id) }}</span>
        </div>
        <div v-if="n.sub" class="node-sub">{{ n.sub }}</div>
      </div>

      <div class="conn" />

      <!-- 循环体 -->
      <div class="loopbox" :class="{ spinning: cur?.loopBack }">
        <div class="loopbox-tag">
          <span class="loopbox-kw">while</span>
          <code>{{ loopLabel }}</code>
        </div>

        <!-- 回边:从底部绕回顶部 -->
        <div class="backedge" :class="{ on: cur?.loopBack }">
          <span class="backedge-arrow">▲</span>
          <span class="backedge-text">回到开头</span>
        </div>

        <div class="loopbody">
          <template v-for="(n, i) in loopNodes" :key="n.id">
            <div class="conn" v-if="i > 0" />
            <div
              class="node"
              :class="[n.shape, nodeState(n.id), { warned: nodeState(n.id) === 'active' && cur?.warn }]"
              :title="n.code"
            >
              <div class="node-main">
                <span class="node-label" v-html="n.label" />
                <span v-if="hitCount(n.id) > 1" class="hits">×{{ hitCount(n.id) }}</span>
                <span v-if="branchOn(n.id)" class="branch">{{ branchOn(n.id) }}</span>
              </div>
              <div v-if="n.sub" class="node-sub">{{ n.sub }}</div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- 解说 -->
    <div class="note" :class="{ empty: !cur, warn: cur?.warn }">
      <template v-if="cur">
        <span class="note-k">{{ round }}</span>
        <span>{{ cur.note }}</span>
      </template>
      <template v-else>
        <span>{{ hint || '点「▶ 播放」跟着执行位置走一遍这个循环。' }}</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.loop {
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  background: var(--c-surface);
  overflow: hidden;
}
/* ---- 控制条 ---- */
.bar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 8px 10px;
  background: var(--c-bg);
  border-bottom: 1px solid var(--c-border);
}
.sbtn {
  padding: 3px 9px;
  font-size: 11.5px;
  font-family: inherit;
  border: 1px solid var(--c-border-strong);
  border-radius: var(--radius-sm);
  background: var(--c-surface);
  color: var(--c-text-soft);
  transition: all 0.12s;
}
.sbtn:hover:not(:disabled) {
  border-color: var(--c-primary);
  color: var(--c-primary);
}
.sbtn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.sbtn-main {
  min-width: 74px;
  background: var(--c-primary);
  border-color: var(--c-primary);
  color: #fff;
  font-weight: 600;
}
.sbtn-main:hover:not(:disabled) {
  background: var(--c-primary-hover);
  border-color: var(--c-primary-hover);
  color: #fff;
}
.progress {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--c-text-faint);
}
/* ---- 状态条 ---- */
.stats {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 7px 12px;
  border-bottom: 1px dashed var(--c-border);
  font-size: 11.5px;
  color: var(--c-text-soft);
}
.stat b {
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--c-primary-hover);
}
.budget {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.cells {
  display: inline-flex;
  gap: 2px;
}
.cell {
  width: 9px;
  height: 11px;
  border-radius: 2px;
  border: 1px solid var(--c-border-strong);
  background: var(--c-surface);
}
.cell.used {
  background: var(--c-primary);
  border-color: var(--c-primary);
}
/* ---- 流程图主体 ---- */
.body {
  padding: 14px 12px 10px;
}
/* 节点间的竖线 */
.conn {
  height: 12px;
  margin-left: 18px;
  border-left: 1.5px solid var(--c-border-strong);
}
.node {
  position: relative;
  padding: 7px 10px;
  border: 1px solid var(--c-border);
  border-left: 3px solid var(--c-border-strong);
  border-radius: var(--radius-sm);
  background: var(--c-surface);
  transition:
    background 0.25s,
    border-color 0.25s,
    box-shadow 0.25s,
    transform 0.25s;
}
.node-main {
  display: flex;
  align-items: baseline;
  gap: 7px;
  flex-wrap: wrap;
  font-size: 12px;
  line-height: 1.5;
}
.node-label :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.92em;
  padding: 0 3px;
  border-radius: 3px;
  background: var(--c-bg);
}
.node-sub {
  margin-top: 2px;
  font-size: 10.5px;
  color: var(--c-text-faint);
  line-height: 1.45;
}
/* 形状语义 */
.node.start {
  border-left-color: var(--c-text-faint);
  background: var(--c-bg);
}
.node.decision {
  border-left-color: var(--c-warn);
}
.node.decision .node-label::before {
  content: '◆ ';
  color: var(--c-warn);
}
.node.exit {
  margin-left: 34px;
  border-left-color: var(--c-success);
  border-style: dashed;
}
.node.error {
  margin-left: 34px;
  border-left-color: var(--c-danger);
  border-style: dashed;
}
/* 走过 / 当前 */
.node.visited {
  background: var(--c-bg);
}
.node.active {
  border-color: var(--c-primary);
  border-left-color: var(--c-primary);
  background: var(--c-primary-soft);
  box-shadow: 0 0 0 3px var(--c-primary-soft);
  transform: translateX(3px);
}
.node.active .node-sub {
  color: var(--c-primary-hover);
}
.node.active.warned {
  border-color: var(--c-danger);
  border-left-color: var(--c-danger);
  background: var(--c-danger-soft);
  box-shadow: 0 0 0 3px var(--c-danger-soft);
}
/* 命中次数:循环里的节点会 >1 */
.hits {
  flex-shrink: 0;
  padding: 0 5px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  border-radius: 999px;
  color: var(--c-primary-hover);
  background: var(--c-primary-soft);
  border: 1px solid #c7d2fe;
}
/* 判断节点走了哪个分支 */
.branch {
  flex-shrink: 0;
  padding: 0 6px;
  font-size: 10px;
  font-weight: 700;
  border-radius: 999px;
  color: var(--c-warn);
  background: var(--c-warn-soft);
  border: 1px solid #fde68a;
}
/* ---- 循环体外框 ---- */
.loopbox {
  position: relative;
  padding: 10px 10px 12px 30px;
  border: 1px dashed var(--c-primary);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--c-primary-soft) 45%, transparent);
}
.loopbox-tag {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 10px;
  font-size: 10.5px;
  color: var(--c-primary-hover);
}
.loopbox-kw {
  padding: 1px 7px;
  border-radius: 999px;
  font-weight: 700;
  background: var(--c-primary);
  color: #fff;
}
.loopbox-tag code {
  font-family: var(--font-mono);
  font-size: 10.5px;
}
/* 回边:贴在左侧的一条竖线 + 箭头 */
.backedge {
  position: absolute;
  left: 9px;
  top: 34px;
  bottom: 12px;
  width: 13px;
  border-left: 1.5px solid var(--c-border-strong);
  border-top: 1.5px solid var(--c-border-strong);
  border-bottom: 1.5px solid var(--c-border-strong);
  border-radius: 4px 0 0 4px;
  transition: border-color 0.25s;
}
.backedge-arrow {
  position: absolute;
  top: -7px;
  left: -5.5px;
  font-size: 9px;
  line-height: 1;
  color: var(--c-border-strong);
  transition: color 0.25s;
}
.backedge-text {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: max-content;
  font-size: 9px;
  line-height: 1.3;
  text-align: center;
  writing-mode: vertical-rl;
  letter-spacing: 0.05em;
  color: var(--c-text-faint);
  background: var(--c-surface);
  padding: 3px 1px;
  border-radius: 3px;
  transition: all 0.25s;
}
/* 正在"回到开头"这一帧:整条回边点亮 */
.backedge.on,
.backedge.on .backedge-arrow {
  border-color: var(--c-primary);
  color: var(--c-primary);
}
.backedge.on {
  animation: pulse 0.7s ease;
}
.backedge.on .backedge-text {
  color: var(--c-primary-hover);
  font-weight: 700;
  box-shadow: 0 0 0 2px var(--c-primary-soft);
}
@keyframes pulse {
  50% {
    box-shadow: -2px 0 0 var(--c-primary);
  }
}
.loopbody {
  display: flex;
  flex-direction: column;
}
/* ---- 解说条 ---- */
.note {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  min-height: 44px;
  padding: 9px 12px;
  border-top: 1px solid var(--c-border);
  background: var(--c-bg);
  font-size: 12px;
  line-height: 1.6;
  transition: background 0.25s;
}
.note.warn {
  background: var(--c-danger-soft);
}
.note.empty {
  color: var(--c-text-soft);
}
.note-k {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 700;
  font-family: var(--font-mono);
  background: var(--c-primary-soft);
  color: var(--c-primary-hover);
}
.note.warn .note-k {
  background: #fff;
  color: var(--c-danger);
}
@media (prefers-reduced-motion: reduce) {
  .backedge.on {
    animation: none;
  }
}
</style>
