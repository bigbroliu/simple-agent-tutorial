import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';
import { llmProxy } from './vite-plugin-llm-proxy';
import { localModels } from './vite-plugin-local-models';

// 纯前端教学项目:无需 SSR,Vite 启动轻快,现场演示更稳
export default defineConfig({
  plugins: [vue(), llmProxy(), localModels()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    // 这些包名只出现在讲解用的"代码示例字符串"里,并非真实 import。
    // 排除掉,避免 Vite 依赖扫描器误报 "could not be resolved"。
    exclude: ['@microsoft/fetch-event-source'],
  },
  server: {
    host: true, // 监听 0.0.0.0,允许局域网内其他设备通过本机 IP 访问
    port: 5188,
    open: true,
  },
});
