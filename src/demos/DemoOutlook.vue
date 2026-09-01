<script setup lang="ts">
/**
 * 展望 —— 课程收尾页
 * 不分左右面板:单栏纵向排版。回顾已掌握的能力 + 指出真实工程里的后续方向。
 */
import { DEMOS } from '../demos/registry';

const meta = DEMOS.find((d) => d.id === 'outlook')!;

const recap = [
  { k: '调用', v: '大模型调用的本质是一个带鉴权头的 fetch POST' },
  { k: '流式', v: '手写 SSE 解析,实现打字机效果' },
  { k: '记忆', v: '把对话累积进 messages 数组' },
  { k: '工具', v: 'Tool Calling 四步往返,执行永远在我们这边' },
  { k: 'Agent 循环', v: '一个 while 让模型自主多步完成任务(ReAct)' },
  { k: '工具编排', v: '模型自己排调用顺序,把上一步结果喂给下一步' },
  { k: '可靠性', v: '结构化输出 + 解析容错 + 参数校验 + 重试 + 超时' },
  { k: '多模型', v: '用适配层吸收不同厂商的协议差异' },
  { k: 'RAG', v: '检索相关片段再喂给模型,让它"带着资料"回答' },
  { k: 'MCP', v: '把工具标准化成可插拔服务,连上即用' },
];

const next = [
  {
    icon: '🧠',
    title: '上下文管理',
    desc: '历史无限增长会撑爆上下文窗口。需要"记忆压缩":总结旧对话、只保留关键信息、按需 RAG 检索,而不是把全部历史一股脑塞给模型。',
  },
  {
    icon: '🛡️',
    title: '权限与安全',
    desc: 'Agent 能产生真实副作用(删文件、发请求、花钱)。生产系统需要人工确认、权限边界、沙箱隔离、审计日志 —— 能力越大,护栏越重要。',
  },
  {
    icon: '📊',
    title: '评估与可观测',
    desc: '怎么知道改动让 Agent 变好还是变差?需要一套评测集(eval)、轨迹回放、指标监控。"能跑"不等于"稳定可用",这条线决定它能否上生产。',
  },
  {
    icon: '🤝',
    title: '多 Agent 协作',
    desc: '复杂任务拆给多个专职 Agent(规划者 / 执行者 / 审查者),各自独立上下文、互相协作。但先把单 Agent 做扎实,再谈协作。',
  },
];
</script>

<template>
  <div class="outlook">
    <header class="head">
      <div class="head-main">
        <span class="order">STEP {{ meta.order }}</span>
        <h1 class="title">{{ meta.title }}</h1>
        <span class="tag tag-primary">{{ meta.concept }}</span>
      </div>
      <p class="sub">{{ meta.subtitle }}</p>
    </header>

    <div class="body">
      <div class="milestone">
        🎉 走到这里,你已经<b>亲手实现了一个完整的 Agent</b> —— 从"一个 fetch"一路搭到"连接标准工具生态"。
        你不再是"用 Agent 的人",而是"能造 Agent 的人"。
      </div>

      <section class="block">
        <h2 class="h2">回顾:你已经掌握了这些</h2>
        <div class="recap">
          <div v-for="(r, i) in recap" :key="r.k" class="recap-item">
            <span class="recap-num">{{ i }}</span>
            <span class="recap-k">{{ r.k }}</span>
            <span class="recap-v">{{ r.v }}</span>
          </div>
        </div>
        <div class="core-note">
          全部核心实现都在 <code class="inline">src/core/*.ts</code>(纯 TS),不依赖任何 Agent 框架 ——
          因为一个 Agent 的核心,真的就这么多。
        </div>
      </section>

      <section class="block">
        <h2 class="h2">下一步该学什么?</h2>
        <p class="lead">
          这门课把 Agent 的<b>骨架</b>讲透了。要把它做成真正上得了生产的系统,还有这些方向值得深入:
        </p>
        <div class="next">
          <div v-for="n in next" :key="n.title" class="next-item">
            <div class="next-t"><span class="next-ico">{{ n.icon }}</span>{{ n.title }}</div>
            <div class="next-d">{{ n.desc }}</div>
          </div>
        </div>
      </section>

      <div class="end-box">
        感谢一路看到这里。Agent 领域还在飞速演进,但万变不离其宗:<b>模型负责决策,代码负责执行,循环把两者串起来。</b>
        掌握了这条主线,再新的框架和名词,你都能一眼看穿它在解决哪一环。
      </div>
    </div>
  </div>
</template>

<style scoped>
.outlook {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.head {
  padding: 20px 28px 16px;
  border-bottom: 1px solid var(--c-border);
  background: var(--c-surface);
}
.head-main {
  display: flex;
  align-items: center;
  gap: 12px;
}
.order {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--c-text-faint);
  letter-spacing: 0.05em;
}
.title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
}
.sub {
  margin: 6px 0 0;
  color: var(--c-text-soft);
  font-size: 13.5px;
}
.body {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px;
  max-width: 820px;
}
.milestone {
  padding: 14px 16px;
  background: var(--c-primary-soft);
  border-radius: var(--radius-sm);
  font-size: 14px;
  color: var(--c-primary-hover);
  line-height: 1.7;
}
.block {
  margin-top: 26px;
}
.h2 {
  font-size: 16px;
  font-weight: 700;
  margin: 0 0 12px;
}
.lead {
  font-size: 13.5px;
  color: var(--c-text-soft);
  margin: 0 0 14px;
  line-height: 1.7;
}
.recap {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.recap-item {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 8px 12px;
  background: var(--c-bg);
  border-radius: var(--radius-sm);
}
.recap-num {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  background: var(--c-primary);
  color: #fff;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  align-self: center;
}
.recap-k {
  flex-shrink: 0;
  width: 76px;
  font-size: 13px;
  font-weight: 700;
}
.recap-v {
  font-size: 13px;
  color: var(--c-text-soft);
  line-height: 1.5;
}
.core-note {
  margin-top: 14px;
  padding: 12px 14px;
  background: #1e293b;
  color: #e2e8f0;
  border-radius: var(--radius-sm);
  font-size: 13px;
  line-height: 1.7;
}
.core-note code.inline {
  background: #334155;
  color: #93c5fd;
}
.next {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.next-item {
  padding: 14px 16px;
  border: 1px solid var(--c-border);
  border-radius: var(--radius-sm);
  background: var(--c-surface);
}
.next-t {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 6px;
}
.next-ico {
  font-size: 16px;
}
.next-d {
  font-size: 13px;
  color: var(--c-text-soft);
  line-height: 1.65;
}
.end-box {
  margin-top: 26px;
  padding: 16px 18px;
  background: var(--c-success-soft);
  border: 1px solid #a7f3d0;
  border-radius: var(--radius-sm);
  font-size: 13.5px;
  color: #065f46;
  line-height: 1.75;
}
@media (max-width: 720px) {
  .next {
    grid-template-columns: 1fr;
  }
}
</style>
