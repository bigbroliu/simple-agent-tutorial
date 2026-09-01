/**
 * usePaneView —— 内容区左右面板的显示模式(全局共享)
 * both:左右都显示;left:只显示运行区;right:只显示讲解区。
 * 用模块级单例,切换后所有 Demo 页统一生效;存 localStorage 记住选择。
 */
import { ref } from 'vue';

export type PaneMode = 'both' | 'left' | 'right';

const STORAGE_KEY = 'hy-agent:pane-mode';

function load(): PaneMode {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'left' || v === 'right' || v === 'both' ? v : 'both';
}

const mode = ref<PaneMode>(load());

function setMode(m: PaneMode) {
  mode.value = m;
  localStorage.setItem(STORAGE_KEY, m);
}

export function usePaneView() {
  return { mode, setMode };
}
