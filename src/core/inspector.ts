/**
 * core/inspector.ts —— 请求检查器的数据源(纯 TS,不依赖框架)
 *
 * 【它做什么】
 * 把每一次真正发给大模型的请求"核心数据"记录下来:模型、目标地址、method、
 * 脱敏后的请求头、请求体、是否流式、HTTP 状态、耗时。供页面上的检查器面板展示,
 * 让"我到底发了什么"变得肉眼可见 —— 这本身也是理解 Agent 的重要一环。
 *
 * 用极简的订阅模式对外通知,避免 core 层引入 Vue。
 */

export interface RequestLog {
  id: string;
  startedAt: number;
  /** 触发该请求的 Demo 标记,用于在对应 Demo 内联展示各自的请求 */
  tag?: string;
  modelLabel: string;
  protocol: string;
  method: string;
  /** 真实厂商地址(不是本地代理地址) */
  targetUrl: string;
  /** 是否经过本地开发代理转发 */
  viaProxy: boolean;
  stream: boolean;
  /** 脱敏后的请求头(鉴权值已打码) */
  headers: Record<string, string>;
  /** 解析后的请求体 */
  body: unknown;
  status: 'pending' | 'done' | 'error';
  httpStatus?: number;
  durationMs?: number;
  error?: string;
}

const logs: RequestLog[] = [];
const listeners = new Set<() => void>();

/**
 * 当前正在运行的 Demo 标记。Demo 运行前调用 setActiveTag,
 * 之后 beginRequest 记录的请求都会带上这个标记(因为同一时刻只有一个 Demo 在跑)。
 */
let activeTag: string | undefined;
export function setActiveTag(tag: string | undefined): void {
  activeTag = tag;
}

function notify() {
  listeners.forEach((l) => l());
}

/** 订阅日志变化;返回取消订阅函数 */
export function subscribeRequestLog(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getRequestLogs(): readonly RequestLog[] {
  return logs;
}

/** 清空日志;可只清某个 Demo 标记下的 */
export function clearRequestLogs(tag?: string): void {
  if (tag === undefined) {
    logs.length = 0;
  } else {
    for (let i = logs.length - 1; i >= 0; i--) {
      if (logs[i].tag === tag) logs.splice(i, 1);
    }
  }
  notify();
}

let seq = 0;

/** 记录一次请求的开始,返回 id 供后续更新状态 */
export function beginRequest(
  info: Omit<RequestLog, 'id' | 'startedAt' | 'status' | 'tag'>,
): string {
  const id = `req_${Date.now()}_${seq++}`;
  logs.unshift({ id, startedAt: Date.now(), status: 'pending', tag: activeTag, ...info });
  // 只保留最近 40 条,避免无限增长
  if (logs.length > 40) logs.length = 40;
  notify();
  return id;
}

/** 更新一次请求的结束状态 */
export function endRequest(
  id: string,
  patch: Partial<Pick<RequestLog, 'status' | 'httpStatus' | 'durationMs' | 'error'>>,
): void {
  const log = logs.find((l) => l.id === id);
  if (!log) return;
  Object.assign(log, patch);
  notify();
}

/** 把请求头里的鉴权值打码,避免把 Key 明文展示出来 */
export function maskHeaders(headers: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase();
    if (lk === 'authorization') {
      // "Bearer sk-xxxx1234" → "Bearer ••••1234"
      const tail = v.slice(-4);
      masked[k] = v.startsWith('Bearer ') ? `Bearer ••••${tail}` : `••••${tail}`;
    } else if (lk === 'x-api-key') {
      masked[k] = `••••${v.slice(-4)}`;
    } else {
      masked[k] = v;
    }
  }
  return masked;
}

/**
 * 记录一次请求并返回计时/收尾的句柄,让调用方(llm.ts)保持整洁:
 *   const rec = recordRequest(cfg, built, stream);
 *   ... rec.done(status) / rec.fail(status, errText)
 * built 里放的是"发给厂商的真实请求"(真实地址、头、body 字符串)。
 */
export function recordRequest(
  meta: { label: string; protocol: string },
  built: { url: string; init: RequestInit },
  stream: boolean,
) {
  const headers = (built.init.headers as Record<string, string>) ?? {};
  let body: unknown = built.init.body;
  try {
    body = typeof built.init.body === 'string' ? JSON.parse(built.init.body) : built.init.body;
  } catch {
    /* 保留原始字符串 */
  }
  const id = beginRequest({
    modelLabel: meta.label,
    protocol: meta.protocol,
    method: built.init.method ?? 'POST',
    targetUrl: built.url,
    viaProxy: true,
    stream,
    headers: maskHeaders(headers),
    body,
  });
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  return {
    done: (httpStatus?: number) => endRequest(id, { status: 'done', httpStatus, durationMs: ms() }),
    fail: (httpStatus: number | undefined, error: string) =>
      endRequest(id, { status: 'error', httpStatus, durationMs: ms(), error }),
  };
}
