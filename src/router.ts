import { createRouter, createWebHashHistory } from 'vue-router';

// 用 hash 路由:纯静态、无需服务端配置,现场/本地双击打开也不怕 404
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/config' },
    { path: '/config', component: () => import('./demos/Demo0Config.vue') },
    { path: '/one-call', component: () => import('./demos/Demo1OneCall.vue') },
    { path: '/chat', component: () => import('./demos/Demo2Chat.vue') },
    { path: '/memory', component: () => import('./demos/Demo3Memory.vue') },
    { path: '/tools', component: () => import('./demos/Demo4Tools.vue') },
    { path: '/agent-loop', component: () => import('./demos/Demo5AgentLoop.vue') },
    { path: '/multi-tool', component: () => import('./demos/Demo6MultiTool.vue') },
    { path: '/structured', component: () => import('./demos/Demo7Structured.vue') },
    { path: '/multi-model', component: () => import('./demos/Demo8MultiModel.vue') },
    { path: '/rag', component: () => import('./demos/DemoRag.vue') },
    { path: '/mcp', component: () => import('./demos/Demo9Mcp.vue') },
    { path: '/skill', component: () => import('./demos/DemoSkill.vue') },
    { path: '/outlook', component: () => import('./demos/DemoOutlook.vue') },
  ],
});

export default router;
