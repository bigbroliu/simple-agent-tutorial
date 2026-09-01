/**
 * core/config.ts —— 模型配置中心的"大脑"
 *
 * 【本文件教什么】
 * 前端工程师做 Agent 的第一道坎:请求要发去哪、怎么鉴权、用哪个模型。
 * 这里把这些配置抽象成一个可增删改、可持久化(localStorage)的数据模型。
 *
 * 关键认知:所谓"接入大模型",本质就是一个带鉴权头的 HTTP POST。
 * 不同厂商的差异,主要集中在 3 个字段:baseURL、鉴权方式、model 名。
 */

/** 支持的 API 协议风格。绝大多数国产/开源模型都兼容 OpenAI 协议 */
export type ProtocolStyle = 'openai' | 'anthropic';

/** 单个模型配置 */
export interface ModelConfig {
  /** 前端本地生成的唯一 id */
  id: string;
  /** 展示用名称,如 "DeepSeek-V3" */
  label: string;
  /** 协议风格,决定请求体/响应体/鉴权头的构造方式 */
  protocol: ProtocolStyle;
  /** 接口基地址,如 https://api.deepseek.com/v1 */
  baseURL: string;
  /** API Key(仅存本地 localStorage,绝不上传) */
  apiKey: string;
  /** 模型名,如 deepseek-chat / gpt-4o-mini / claude-3-5-sonnet-20241022 */
  model: string;
}

const STORAGE_KEY = 'hy-agent:model-configs';
const ACTIVE_KEY = 'hy-agent:active-model-id';

/** 生成一个简单的本地 id(够用即可,不追求全局唯一) */
export function genId(): string {
  return 'm_' + Math.random().toString(36).slice(2, 10);
}

/** 读取全部模型配置 */
export function loadConfigs(): ModelConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as ModelConfig[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** 保存全部模型配置 */
export function saveConfigs(list: ModelConfig[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

/** 读取当前选中的模型 id */
export function loadActiveId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

/** 设置当前选中的模型 id */
export function saveActiveId(id: string): void {
  localStorage.setItem(ACTIVE_KEY, id);
}

/** 取当前生效的模型配置(供各 Demo 直接使用) */
export function getActiveConfig(): ModelConfig | null {
  const list = loadConfigs();
  const activeId = loadActiveId();
  return list.find((c) => c.id === activeId) ?? list[0] ?? null;
}

/** 预置一些常见厂商的模板,降低第一次配置的心智负担 */
export interface ConfigPreset {
  label: string;
  protocol: ProtocolStyle;
  baseURL: string;
  model: string;
  hint: string;
}

export const PRESETS: ConfigPreset[] = [
  {
    label: 'DeepSeek',
    protocol: 'openai',
    baseURL: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    hint: 'OpenAI 兼容,鉴权头 Authorization: Bearer <key>',
  },
  {
    label: 'Kimi (Moonshot)',
    protocol: 'openai',
    baseURL: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    hint: 'OpenAI 兼容',
  },
  {
    label: '通义千问 (DashScope)',
    protocol: 'openai',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    hint: 'OpenAI 兼容模式',
  },
  {
    label: 'OpenAI',
    protocol: 'openai',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    hint: 'OpenAI 官方',
  },
  {
    label: 'Anthropic Claude',
    protocol: 'anthropic',
    baseURL: 'https://api.anthropic.com/v1',
    model: 'claude-3-5-sonnet-20241022',
    hint: '鉴权头是 x-api-key,请求体结构也不同(见 Demo 8)',
  },
];
