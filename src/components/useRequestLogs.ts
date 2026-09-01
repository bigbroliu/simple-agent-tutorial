/**
 * useRequestLogs —— 把 core/inspector 的订阅接口桥接成 Vue 响应式数据
 * 传入 tag 时只返回该 Demo 触发的请求。
 */
import { ref, computed, onUnmounted } from 'vue';
import {
  getRequestLogs,
  subscribeRequestLog,
  type RequestLog,
} from '../core/inspector';

export function useRequestLogs(tag?: string) {
  const all = ref<readonly RequestLog[]>([...getRequestLogs()]);
  // inspector 里是同一个数组实例被原地修改,这里每次复制一份新数组触发更新
  const unsub = subscribeRequestLog(() => {
    all.value = [...getRequestLogs()];
  });
  onUnmounted(unsub);

  const logs = computed(() =>
    tag === undefined ? all.value : all.value.filter((l) => l.tag === tag),
  );
  return { logs };
}
