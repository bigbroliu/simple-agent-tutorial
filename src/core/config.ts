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

// 开发期由 vite-plugin-local-models 注入根目录 models.local.json 的内容;
// 没有该文件时、以及在 build 产物里,都是 null。
import localModels from 'virtual:local-models';

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
  /** 来自根目录 models.local.json(开发期注入),而非手工在页面上添加 */
  fromLocalFile?: boolean;
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

/* ============================================================
 * 本地配置文件(开发期便利,不进版本库)
 *
 * 把常用模型写进根目录 models.local.json(见 models.local.example.json),
 * dev server 启动时由 vite-plugin-local-models 注入,这里合并进 localStorage。
 * 于是换浏览器、清缓存都不用重填 Key。
 *
 * 注意:build 产物里 localModels 恒为 null —— Key 不会被打包发布。
 * 这只是开发便利,生产环境请把 Key 留在自己的后端。
 * ============================================================ */

/** 以 label 作为本地文件配置的身份(同名视为同一个,可覆盖更新) */
function keyOf(c: { label: string }): string {
  return c.label.trim();
}

/**
 * 把 models.local.json 的内容合并进 localStorage。
 * - 文件里的同名(label)配置会覆盖已存的那条,保证改了文件就生效
 * - 用户在页面上手工添加的配置一律保留,不受影响
 * - 文件指定的 active 会被选中(仅当当前没有有效选中项时)
 *
 * 返回是否发生了改动,调用方可据此决定要不要刷新界面。
 */
export function syncLocalFileConfigs(): boolean {
  if (!localModels?.models?.length) return false;

  const existing = loadConfigs();
  const merged = [...existing];
  let changed = false;

  for (const item of localModels.models) {
    // 缺了必要字段就跳过,避免把半成品写进存储
    if (!item?.label || !item?.baseURL || !item?.model) continue;

    const incoming: Omit<ModelConfig, 'id'> = {
      label: item.label,
      protocol: item.protocol === 'anthropic' ? 'anthropic' : 'openai',
      baseURL: item.baseURL,
      apiKey: item.apiKey ?? '',
      model: item.model,
      fromLocalFile: true,
    };

    const idx = merged.findIndex((c) => keyOf(c) === keyOf(item));
    if (idx >= 0) {
      const prev = merged[idx];
      const next: ModelConfig = { id: prev.id, ...incoming };
      // 内容一致就不写,免得每次刷新都触发一次无意义的更新
      if (JSON.stringify(prev) !== JSON.stringify(next)) {
        merged[idx] = next;
        changed = true;
      }
    } else {
      merged.push({ id: genId(), ...incoming });
      changed = true;
    }
  }

  if (changed) saveConfigs(merged);

  // 文件里指定了默认模型,且当前没有有效选中项时,替它选上
  const activeId = loadActiveId();
  const activeStillValid = !!activeId && merged.some((c) => c.id === activeId);
  if (!activeStillValid) {
    const wanted = localModels.active?.trim();
    const target = (wanted && merged.find((c) => keyOf(c) === wanted)) || merged[0];
    if (target) {
      saveActiveId(target.id);
      changed = true;
    }
  }

  return changed;
}

/** 把当前 localStorage 里的配置,转成 models.local.json 的内容结构 */
export function buildLocalFileJson(): {
  active?: string;
  models: Omit<ModelConfig, 'id' | 'fromLocalFile'>[];
} {
  const list = loadConfigs();
  const activeLabel = getActiveConfig()?.label;
  return {
    ...(activeLabel ? { active: activeLabel } : {}),
    // 去掉 id(本地随机生成的,写进文件没意义)和 fromLocalFile(由插件回填)
    models: list.map(({ label, protocol, baseURL, apiKey, model }) => ({
      label,
      protocol,
      baseURL,
      apiKey,
      model,
    })),
  };
}

/**
 * 当前页面是否跑在本机 —— 写入功能只在本机可用。
 * 局域网里用 http://192.168.x.x:5188 打开时,服务端也会拒绝(见插件里的同名校验),
 * 这里提前判断是为了直接把按钮藏掉,而不是等用户点了才报错。
 */
export function canWriteLocalFile(): boolean {
  const h = location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.startsWith('127.');
}

/**
 * 把当前配置写进根目录 models.local.json(仅 dev server + 本机可用)。
 * 走 vite 插件提供的写入端点 —— 浏览器自己没有写本地文件的能力。
 */
export async function writeLocalFile(): Promise<{ path: string; overwritten: boolean }> {
  const payload = buildLocalFileJson();
  if (payload.models.length === 0) throw new Error('当前没有任何模型配置,无需导出');

  const res = await fetch('/__write-local-models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  // 端点只在 dev server 存在;build 后的静态站点会返回 HTML 而非 JSON
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('写入端点不可用 —— 这个功能只在 npm run dev 下有效');
  }
  if (!res.ok || data?.error) throw new Error(data?.error ?? `写入失败(HTTP ${res.status})`);
  return { path: data.path, overwritten: data.overwritten };
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
