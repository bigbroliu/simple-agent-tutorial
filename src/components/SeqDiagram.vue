<script setup lang="ts">
/**
 * SeqDiagram —— 可播放的交互式时序图(讲解区通用组件)
 *
 * 把一段"谁把什么交给谁"的流程,画成 N 条泳道 + 一串带箭头的消息,
 * 支持逐步播放 / 单步 / 点击跳转,并在过程中显示计数与"上下文变长"的量条。
 *
 * 用法:父组件只提供数据(lanes / steps),不关心排版与动画。
 *   <SeqDiagram :lanes="LANES" :steps="STEPS" :stats="STATS" meter-label="messages" />
 */
import { ref, computed, onUnmounted } from 'vue';

/** 一条泳道 = 一个参与者 */
export interface SeqLane {
  icon: string;
  name: string;
  /** 副标题,如"(我们的代码)" */
  sub?: string;
}

/**
 * 消息类型,决定配色:
 * ask 中性 / call·ret 发问与回应 / exec·obs 外部执行与回填 / final·answer 收尾
 */
export type SeqKind = 'ask' | 'call' | 'ret' | 'exec' | 'obs' | 'final' | 'answer';

/** 一步消息 */
export interface SeqStep {
  /** 发起方泳道下标 */
  from: number;
  /** 接收方泳道下标 */
  to: number;
  kind: SeqKind;
  /** 箭头上的短标签(序号由组件自动加) */
  label: string;
  /** 底部解说 */
  note: string;
  /** 分组徽标(如"轮 1""阶段一 · 建库"),只在该组第一步标注 */
  group?: string;
  /** 标记"用到了上一步的结果" */
  dep?: boolean;
  /** 用虚线画,表示"回到前面某步再来一次" */
  loop?: boolean;
  /** 量条数值(如此刻 messages 有几条) */
  meter?: number;
}

/** 状态条上的一个计数项:数分组数,或数某种消息的条数 */
export interface SeqStat {
  label: string;
  count: 'group' | SeqKind;
}

const props = withDefaults(
  defineProps<{
    lanes: SeqLane[];
    steps: SeqStep[];
    /** 状态条计数项 */
    stats?: SeqStat[];
    /** 量条的名字,给了才显示量条 */
    meterLabel?: string;
    /** 未开始播放时,解说条里显示的提示 */
    hint?: string;
  }>(),
  { stats: () => [], meterLabel: '', hint: '' },
);

/** ①②③… 最多 20,超出退回普通数字 */
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
function numOf(i: number) {
  return i < CIRCLED.length ? CIRCLED[i] : String(i + 1);
}

/** 图例:按"图里真正出现了哪些类型"自动生成,措辞保持通用 */
const KIND_LEGEND: { kinds: SeqKind[]; cls: SeqKind; label: string }[] = [
  { kinds: ['ask'], cls: 'ask', label: '起点 / 输入' },
  { kinds: ['call'], cls: 'call', label: '送出请求' },
  { kinds: ['ret'], cls: 'ret', label: '回应 / 产出' },
  { kinds: ['exec', 'obs'], cls: 'exec', label: '外部执行与结果回填' },
  { kinds: ['final', 'answer'], cls: 'final', label: '收尾 / 最终结果' },
];
const legend = computed(() => {
  const present = new Set(props.steps.map((s) => s.kind));
  const items = KIND_LEGEND.filter((g) => g.kinds.some((k) => present.has(k))).map((g) => ({
    cls: 'k-' + g.cls,
    label: g.label,
  }));
  if (props.steps.some((s) => s.loop)) items.push({ cls: 'lg-dash', label: '虚线 = 回到前面再来一次' });
  if (props.steps.some((s) => s.dep)) items.push({ cls: 'lg-dep', label: '★ = 用到上一步的结果' });
  return items;
});

const cursor = ref(-1); // -1 = 尚未开始
const playing = ref(false);
const fast = ref(false);
let timer: number | undefined;

const cur = computed(() => (cursor.value >= 0 ? props.steps[cursor.value] : null));
const done = computed(() => props.steps.slice(0, cursor.value + 1));
const atEnd = computed(() => cursor.value >= props.steps.length - 1);

/** 量条:取"已播放的最后一个带 meter 的步骤",没播放时取第一步的值 */
const meter = computed(() => {
  for (let i = done.value.length - 1; i >= 0; i--) {
    const m = done.value[i].meter;
    if (m !== undefined) return m;
  }
  return props.steps.find((s) => s.meter !== undefined)?.meter ?? 0;
});

function statValue(st: SeqStat) {
  return st.count === 'group'
    ? done.value.filter((s) => s.group).length
    : done.value.filter((s) => s.kind === st.count).length;
}

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
    fast.value ? 700 : 1500,
  );
}
function togglePlay() {
  if (playing.value) {
    playing.value = false;
    stopTimer();
    return;
  }
  if (atEnd.value) cursor.value = -1; // 播完了再点 = 重播
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
  cursor.value = Math.min(props.steps.length - 1, Math.max(-1, cursor.value + delta));
}
function reset() {
  playing.value = false;
  stopTimer();
  cursor.value = -1;
}
function showAll() {
  playing.value = false;
  stopTimer();
  cursor.value = props.steps.length - 1;
}
/** 点某条消息:直接跳到那一步 */
function jump(i: number) {
  playing.value = false;
  stopTimer();
  cursor.value = i;
}
onUnmounted(stopTimer);

/** 箭头位置:按"泳道中心到泳道中心"算,与生命线严格对齐 */
function arrowStyle(s: SeqStep) {
  const n = props.lanes.length;
  const lo = Math.min(s.from, s.to);
  const span = Math.abs(s.to - s.from);
  return {
    marginLeft: `calc(${lo} / ${n} * 100% + 100% / ${2 * n})`,
    width: `calc(${span} / ${n} * 100%)`,
  };
}
/** 文字行缩进:跟随箭头起点,但最多缩进一格,免得被挤到看不见 */
function textStyle(s: SeqStep) {
  const n = props.lanes.length;
  const lo = Math.min(Math.min(s.from, s.to), 1);
  return { paddingLeft: `calc(${lo} / ${n} * 100% + 100% / ${2 * n})` };
}
function stepState(i: number) {
  if (cursor.value < 0 || i > cursor.value) return 'pending';
  return i === cursor.value ? 'active' : 'past';
}
/** 当前这一步涉及的两个角色要高亮 */
function laneActive(i: number) {
  return !!cur.value && (cur.value.from === i || cur.value.to === i);
}
</script>

<template>
  <div class="seq">
    <!-- 控制条 -->
    <div class="seq-bar">
      <button class="sbtn sbtn-main" @click="togglePlay">
        {{ playing ? '⏸ 暂停' : atEnd ? '↻ 重新播放' : '▶ 播放' }}
      </button>
      <button class="sbtn" :disabled="cursor < 0" @click="step(-1)">‹ 上一步</button>
      <button class="sbtn" :disabled="atEnd" @click="step(1)">下一步 ›</button>
      <button class="sbtn" title="切换播放速度" @click="toggleSpeed">速度 {{ fast ? '2x' : '1x' }}</button>
      <button class="sbtn" @click="showAll">全部展开</button>
      <button class="sbtn" :disabled="cursor < 0" @click="reset">清空</button>
      <span class="seq-progress">{{ cursor + 1 }} / {{ steps.length }}</span>
    </div>

    <!-- 实时状态:计数 + 量条 -->
    <div v-if="stats.length || meterLabel" class="seq-stats">
      <span v-for="st in stats" :key="st.label" class="stat">
        <b>{{ statValue(st) }}</b> {{ st.label }}
      </span>
      <span v-if="meterLabel" class="stat">
        {{ meterLabel }} <b>{{ meter }}</b>
        <span class="bars"><i v-for="n in meter" :key="n" class="bar" /></span>
      </span>
    </div>

    <div class="seq-scroll">
      <div class="seq-grid">
        <!-- 泳道表头 -->
        <div
          class="seq-heads"
          :style="{ gridTemplateColumns: `repeat(${lanes.length}, 1fr)` }"
        >
          <div
            v-for="(l, i) in lanes"
            :key="l.name"
            class="lane-head"
            :class="{ on: laneActive(i) }"
          >
            <span class="lane-ico">{{ l.icon }}</span>
            <span>{{ l.name }}</span>
            <small v-if="l.sub">{{ l.sub }}</small>
          </div>
        </div>

        <!-- 生命线(垫在底层)+ 消息(正常流,决定高度) -->
        <div class="seq-lines">
          <div class="lifelines" :style="{ gridTemplateColumns: `repeat(${lanes.length}, 1fr)` }">
            <span v-for="(l, i) in lanes" :key="l.name" class="lifeline" :class="{ on: laneActive(i) }" />
          </div>

          <div class="seq-msgs">
            <template v-for="(s, i) in steps" :key="i">
              <div v-if="s.group" class="group-sep" :class="stepState(i)">
                <span>{{ s.group }}</span>
              </div>
              <div
                class="msg-row"
                :class="[stepState(i), 'k-' + s.kind, { rev: s.to < s.from, dep: s.dep, loop: s.loop }]"
                role="button"
                tabindex="0"
                @click="jump(i)"
                @keydown.enter.prevent="jump(i)"
              >
                <!-- 箭头:只画"谁→谁",宽度对齐泳道;自己对自己则画一个 ↻ 标记 -->
                <div class="track">
                  <span v-if="s.from === s.to" class="selfmark" :style="arrowStyle(s)">↻</span>
                  <span v-else class="arrow" :style="arrowStyle(s)"><i class="packet" /></span>
                </div>
                <!-- 文字:独占一行,不受泳道宽度挤压 -->
                <div class="text" :style="textStyle(s)">
                  <span class="num">{{ numOf(i) }}</span>
                  <span class="txt">{{ s.label }}</span>
                  <span v-if="s.dep" class="dep-tag">★ 用到上一步的结果</span>
                </div>
              </div>
            </template>
          </div>
        </div>

        <!-- 图例:只列出这张图里真正出现的类型 -->
        <div class="seq-legend">
          <span v-for="g in legend" :key="g.label" class="lg" :class="g.cls"><i /> {{ g.label }}</span>
        </div>
      </div>
    </div>

    <!-- 解说 -->
    <div class="seq-note" :class="{ empty: !cur }">
      <template v-if="cur">
        <span class="note-k" :class="'k-' + cur.kind">{{ numOf(cursor) }}</span>
        <span>{{ cur.note }}</span>
      </template>
      <template v-else>
        <span>{{ hint || '点「▶ 播放」逐步观看这张图。也可以直接点任意一条消息跳到那一步。' }}</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.seq {
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  background: var(--c-surface);
  overflow: hidden;
}
/* ---- 控制条 ---- */
.seq-bar {
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
.seq-progress {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--c-text-faint);
}
/* ---- 状态条 ---- */
.seq-stats {
  display: flex;
  align-items: center;
  gap: 16px;
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
.bars {
  display: inline-flex;
  gap: 2px;
  margin-left: 5px;
  vertical-align: -1px;
}
.bar {
  width: 4px;
  height: 11px;
  border-radius: 1px;
  background: var(--c-primary);
  opacity: 0.55;
  animation: barIn 0.35s ease both;
}
@keyframes barIn {
  from {
    transform: scaleY(0.2);
    opacity: 0;
  }
}
/* ---- 泳道 ---- */
.seq-scroll {
  overflow-x: auto;
  padding: 12px 12px 6px;
}
.seq-grid {
  min-width: 420px;
}
.seq-heads {
  display: grid;
}
.lane-head {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  margin: 0 3px;
  padding: 6px 3px;
  text-align: center;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.25;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  transition: all 0.25s;
}
.lane-head small {
  font-weight: 400;
  font-size: 9.5px;
  color: var(--c-text-faint);
}
.lane-ico {
  font-size: 15px;
  line-height: 1;
}
/* 当前步骤涉及的角色高亮 */
.lane-head.on {
  border-color: var(--c-primary);
  background: var(--c-primary-soft);
  color: var(--c-primary-hover);
  box-shadow: 0 0 0 3px var(--c-primary-soft);
  transform: translateY(-1px);
}
.lane-head.on .lane-ico {
  animation: pop 0.4s ease;
}
@keyframes pop {
  50% {
    transform: scale(1.28);
  }
}
.seq-lines {
  position: relative;
  padding-top: 8px;
}
/* 无间隙:线正好落在各栏中心,与箭头的内联定位一致 */
.lifelines {
  position: absolute;
  inset: 8px 0 0;
  display: grid;
}
.lifeline {
  justify-self: center;
  width: 0;
  border-left: 1px dashed var(--c-border-strong);
  transition: border-color 0.25s;
}
.lifeline.on {
  border-left-color: var(--c-primary);
  border-left-style: solid;
}
/* 消息层:正常文档流,决定容器高度 */
.seq-msgs {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.group-sep {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0 1px;
  font-size: 10px;
  font-weight: 700;
  color: var(--c-primary-hover);
  transition: opacity 0.3s;
}
.group-sep::after {
  content: '';
  flex: 1;
  border-top: 1px dashed var(--c-primary);
  opacity: 0.5;
}
.group-sep span {
  padding: 1px 7px;
  background: var(--c-primary-soft);
  border-radius: 999px;
}
.group-sep.pending {
  opacity: 0.22;
}
/* ---- 一条消息 = 一条箭头 + 一行文字 ---- */
.msg-row {
  padding: 2px 0 4px;
  cursor: pointer;
  transition: opacity 0.3s;
}
.msg-row.pending {
  opacity: 0.2;
}
.msg-row.past {
  opacity: 0.6;
}
.msg-row.active,
.msg-row:hover {
  opacity: 1;
}
.msg-row:focus-visible {
  outline: 2px solid var(--c-primary);
  outline-offset: 1px;
  border-radius: 4px;
}
.track {
  height: 11px;
}
.arrow {
  position: relative;
  display: block;
  height: 0;
  margin-top: 5px;
  border-top: 1.5px solid var(--ac, var(--c-text-faint));
}
.arrow::after {
  content: '';
  position: absolute;
  top: -4.5px;
  right: -1px;
  border: 4.5px solid transparent;
  border-right-width: 0;
  border-left-color: var(--ac, var(--c-text-faint));
}
/* 反向(右→左)把箭头头部移到左端 */
.msg-row.rev .arrow::after {
  right: auto;
  left: -1px;
  border-left-width: 0;
  border-right-width: 4.5px;
  border-left-color: transparent;
  border-right-color: var(--ac, var(--c-text-faint));
}
/* "再来一次"的那几条用虚线 */
.msg-row.loop .arrow {
  border-top-style: dashed;
}
/* 自己对自己的一步:不画箭头,画一个原地打转的标记 */
.selfmark {
  display: block;
  margin-top: -2px;
  font-size: 12px;
  line-height: 1;
  color: var(--ac, var(--c-text-faint));
  transform: translateX(-5px);
}
.msg-row.active .selfmark {
  animation: spin 0.6s ease both;
}
@keyframes spin {
  from {
    transform: translateX(-5px) rotate(-180deg);
    opacity: 0.3;
  }
  to {
    transform: translateX(-5px) rotate(0deg);
    opacity: 1;
  }
}
/* 沿箭头飞过去的"数据包" —— 只在当前步出现 */
.packet {
  position: absolute;
  top: -3.5px;
  left: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ac, var(--c-text-faint));
  opacity: 0;
}
.msg-row.active .packet {
  animation: fly 0.75s cubic-bezier(0.4, 0, 0.2, 1) both;
}
.msg-row.active.rev .packet {
  animation-name: flyRev;
}
@keyframes fly {
  0% {
    left: 0;
    opacity: 0;
  }
  15%,
  80% {
    opacity: 1;
  }
  100% {
    left: calc(100% - 6px);
    opacity: 0;
  }
}
@keyframes flyRev {
  0% {
    left: calc(100% - 6px);
    opacity: 0;
  }
  15%,
  80% {
    opacity: 1;
  }
  100% {
    left: 0;
    opacity: 0;
  }
}
/* 文字行 */
.text {
  display: flex;
  align-items: baseline;
  gap: 5px;
  flex-wrap: wrap;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--lc, var(--c-text));
}
.num {
  flex-shrink: 0;
  font-weight: 700;
}
.txt {
  padding: 1px 7px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--lb, var(--c-border));
  background: var(--lg, var(--c-surface));
  overflow-wrap: anywhere;
}
.dep-tag {
  flex-shrink: 0;
  padding: 0 6px;
  font-size: 10px;
  font-weight: 700;
  border-radius: 999px;
  color: var(--c-warn);
  background: var(--c-warn-soft);
  border: 1px dashed var(--c-warn);
}
/* 按消息类型着色:--ac 箭头 / --lg 底色 / --lb 边框 / --lc 文字 */
.k-ask {
  --ac: var(--c-text-faint);
  --lg: var(--c-bg);
  --lb: var(--c-border-strong);
  --lc: var(--c-text);
}
.k-call {
  --ac: var(--c-primary);
  --lg: var(--c-primary-soft);
  --lb: #c7d2fe;
  --lc: var(--c-primary-hover);
}
.k-ret {
  --ac: #8b5cf6;
  --lg: #f5f3ff;
  --lb: #ddd6fe;
  --lc: #6d28d9;
}
.k-exec,
.k-obs {
  --ac: var(--c-info);
  --lg: var(--c-info-soft);
  --lb: #a5f3fc;
  --lc: var(--c-info);
}
.k-final,
.k-answer {
  --ac: var(--c-success);
  --lg: var(--c-success-soft);
  --lb: #a7f3d0;
  --lc: var(--c-success);
}
/* 当前步:文字发光 + 箭头描线 */
.msg-row.active .txt {
  box-shadow: 0 0 0 3px var(--lg, var(--c-primary-soft));
  animation: labelIn 0.3s ease both;
}
@keyframes labelIn {
  from {
    transform: translateY(-3px);
    opacity: 0;
  }
}
.msg-row.active .arrow {
  animation: draw 0.45s ease both;
}
@keyframes draw {
  from {
    clip-path: inset(-6px 100% -6px 0);
  }
  to {
    clip-path: inset(-6px -6px -6px 0);
  }
}
.msg-row.active.rev .arrow {
  animation-name: drawRev;
}
@keyframes drawRev {
  from {
    clip-path: inset(-6px 0 -6px 100%);
  }
  to {
    clip-path: inset(-6px 0 -6px -6px);
  }
}
/* ---- 图例 ---- */
.seq-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin-top: 12px;
  padding-top: 9px;
  border-top: 1px dashed var(--c-border);
  font-size: 10.5px;
  color: var(--c-text-soft);
}
.lg {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.lg i {
  width: 16px;
  border-top: 2px solid var(--ac, var(--c-text-faint));
}
.lg-dash i {
  border-top-style: dashed;
  border-top-color: var(--c-primary);
}
.lg-dep i {
  border-top-style: dashed;
  border-top-color: var(--c-warn);
}
/* ---- 解说条 ---- */
.seq-note {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  min-height: 44px;
  padding: 9px 12px;
  border-top: 1px solid var(--c-border);
  background: var(--c-bg);
  font-size: 12px;
  line-height: 1.6;
}
.seq-note.empty {
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
  background: var(--lg, var(--c-primary-soft));
  color: var(--lc, var(--c-primary-hover));
}
@media (prefers-reduced-motion: reduce) {
  .bar,
  .lane-head.on .lane-ico,
  .packet,
  .msg-row.active .selfmark,
  .msg-row.active .arrow,
  .msg-row.active .txt {
    animation: none;
  }
}
</style>
