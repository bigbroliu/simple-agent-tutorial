/**
 * useActiveModel —— 一个极简的响应式全局状态,跟踪"当前选中的模型"
 * 各 Demo 都能读到它;Demo0 里修改后,顶部指示灯与其它页立即同步。
 */
import { ref } from 'vue';
import { getActiveConfig, type ModelConfig } from '../core/config';

// 模块级单例:所有组件共享同一份响应式引用
const active = ref<ModelConfig | null>(getActiveConfig());

function refresh() {
  active.value = getActiveConfig();
}

export function useActiveModel() {
  return { active, refresh };
}
