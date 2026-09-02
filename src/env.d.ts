/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

/**
 * 由 vite-plugin-local-models 提供:开发期读取根目录 models.local.json 的内容。
 * 没有该文件、或在 build 产物里,值都是 null。
 */
declare module 'virtual:local-models' {
  const config: {
    /** 想默认选中哪个模型(填 label) */
    active?: string;
    models?: {
      label: string;
      protocol?: 'openai' | 'anthropic';
      baseURL: string;
      apiKey?: string;
      model: string;
    }[];
  } | null;
  export default config;
}
