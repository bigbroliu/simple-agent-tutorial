<script setup lang="ts">
/**
 * DemoLayout —— 每个 Demo 页的统一骨架
 * 左侧:可交互运行区(slot="playground")
 * 右侧:讲解 + 关键源码(slot="explain")
 * 顶部:阶段标题 + "本阶段新增了什么" + 右上角布局切换
 */
import { DEMOS } from '../demos/registry';
import { usePaneView } from './usePaneView';

const props = defineProps<{ demoId: string }>();

const meta = DEMOS.find((d) => d.id === props.demoId)!;
const { mode, setMode } = usePaneView();
</script>

<template>
  <div class="demo">
    <header class="demo-head">
      <div class="demo-head-top">
        <div class="demo-head-main">
          <span class="demo-order">STEP {{ meta.order }}</span>
          <h1 class="demo-title">{{ meta.title }}</h1>
          <span class="tag tag-primary">{{ meta.concept }}</span>
        </div>
        <!-- 右上角:切换只看运行区 / 两者 / 只看讲解 -->
        <div class="pane-switch" role="group" aria-label="布局切换">
          <button
            class="pane-btn"
            :class="{ on: mode === 'left' }"
            title="只显示运行区"
            @click="setMode('left')"
          >
            <span class="ico ico-left" /> 运行区
          </button>
          <button
            class="pane-btn"
            :class="{ on: mode === 'both' }"
            title="同时显示"
            @click="setMode('both')"
          >
            <span class="ico ico-both" /> 两者
          </button>
          <button
            class="pane-btn"
            :class="{ on: mode === 'right' }"
            title="只显示讲解区"
            @click="setMode('right')"
          >
            <span class="ico ico-right" /> 讲解区
          </button>
        </div>
      </div>
      <p class="demo-sub">{{ meta.subtitle }}</p>
      <div v-if="$slots.whatsnew" class="whatsnew">
        <span class="whatsnew-label">本阶段相比上一步新增</span>
        <div class="whatsnew-body"><slot name="whatsnew" /></div>
      </div>
    </header>

    <div class="demo-body" :class="'mode-' + mode">
      <section v-show="mode !== 'right'" class="pane pane-play">
        <slot name="playground" />
      </section>
      <section v-show="mode !== 'left'" class="pane pane-explain">
        <slot name="explain" />
      </section>
    </div>
  </div>
</template>

<style scoped>
.demo {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.demo-head {
  padding: 20px 28px 16px;
  border-bottom: 1px solid var(--c-border);
  background: var(--c-surface);
}
.demo-head-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.demo-head-main {
  display: flex;
  align-items: center;
  gap: 12px;
}
.pane-switch {
  flex-shrink: 0;
  display: inline-flex;
  border: 1px solid var(--c-border-strong);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--c-surface);
}
.pane-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: none;
  border-left: 1px solid var(--c-border);
  background: transparent;
  color: var(--c-text-soft);
  font-size: 12.5px;
  transition: all 0.12s;
}
.pane-btn:first-child {
  border-left: none;
}
.pane-btn:hover {
  background: var(--c-bg);
  color: var(--c-text);
}
.pane-btn.on {
  background: var(--c-primary);
  color: #fff;
}
/* 用两个小方块示意左右布局 */
.ico {
  position: relative;
  display: inline-block;
  width: 16px;
  height: 12px;
  border: 1.5px solid currentColor;
  border-radius: 2px;
}
.ico::before {
  content: '';
  position: absolute;
  top: 1px;
  bottom: 1px;
  background: currentColor;
  border-radius: 1px;
}
.ico-left::before {
  left: 1px;
  right: 50%;
  margin-right: 0.5px;
}
.ico-right::before {
  right: 1px;
  left: 50%;
  margin-left: 0.5px;
}
.ico-both::before {
  left: 1px;
  right: 1px;
}
.demo-order {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--c-text-faint);
  letter-spacing: 0.05em;
}
.demo-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
}
.demo-sub {
  margin: 6px 0 0;
  color: var(--c-text-soft);
  font-size: 13.5px;
}
.whatsnew {
  margin-top: 12px;
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px 14px;
  background: var(--c-success-soft);
  border: 1px solid #a7f3d0;
  border-radius: var(--radius-sm);
}
.whatsnew-label {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--c-success);
  padding: 2px 8px;
  background: #fff;
  border-radius: 4px;
}
.whatsnew-body {
  font-size: 13px;
  color: #065f46;
}
.demo-body {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  overflow: hidden;
}
/* 只显示一侧时,让可见面板占满整行 */
.demo-body.mode-left,
.demo-body.mode-right {
  grid-template-columns: 1fr;
}
.pane {
  overflow-y: auto;
  padding: 24px 28px;
}
.pane-play {
  border-right: 1px solid var(--c-border);
}
/* 单栏时不需要中缝分割线 */
.demo-body.mode-left .pane-play {
  border-right: none;
}
.pane-explain {
  background: #fbfbfd;
}
/* 单独看讲解区时,不再需要浅灰背景来区分,改用常规底色以便阅读 */
.demo-body.mode-right .pane-explain {
  background: var(--c-surface);
}
@media (max-width: 1100px) {
  .demo-body.mode-both {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }
  .demo-body.mode-both .pane {
    overflow-y: visible;
  }
}
</style>
