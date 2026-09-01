/**
 * core/llm.ts —— 与大模型对话的最小内核
 *
 * 【本文件教什么】
 * 1. chatCompletion():一次普通(非流式)调用。剥开各种 SDK 后,
 *    "调大模型"本质就是一个带鉴权头的 fetch POST。
 * 2. streamChatCompletion():手写 SSE(Server-Sent Events)流式解析。
 *    这是前端工程师做 Agent 最陌生的一块:如何把 response.body 当成流,
 *    逐帧读出来、拼成打字机效果。
 *
 * 全项目所有对话都走这两个函数,后面的记忆、工具、Agent 循环都建立在此之上。
 *
 * 说明:代码里出现的 viaProxy(仅本地开发绕过 CORS,见 net.ts)与 recordRequest
 * (把请求可视化到页面检查器,见 inspector.ts)都与 Agent 逻辑无关,已抽到别处,
 * 这里只留"构造请求 → 发送 → 解析回复"这条主线。
 */

import type { ModelConfig } from './config';
import { getAdapter, type ChatRequest } from './adapters';
import type { ChatMessage, ToolSchema } from './types';
import { viaProxy } from './net';
import { recordRequest } from './inspector';

/** 一次非流式对话:发消息 -> 拿到完整回复 */
export async function chatCompletion(
  cfg: ModelConfig,
  messages: ChatMessage[],
  options: { tools?: ToolSchema[]; temperature?: number } = {},
): Promise<ChatMessage> {
  const adapter = getAdapter(cfg);
  const req: ChatRequest = { messages, tools: options.tools, temperature: options.temperature };
  const built = adapter.buildRequest(cfg, req);

  const rec = recordRequest(cfg, built, false);
  const { url, init } = viaProxy(built.url, built.init);

  try {
    const resp = await fetch(url, init);
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      rec.fail(resp.status, text.slice(0, 500));
      throw new Error(`请求失败 ${resp.status}: ${text.slice(0, 500)}`);
    }
    const json = await resp.json();
    rec.done(resp.status);
    return adapter.parseResponse(json).message;
  } catch (e: any) {
    rec.fail(undefined, e?.message ?? String(e));
    throw e;
  }
}

/**
 * 流式对话:每读到一点新文本就通过 onDelta 回调吐出来,实现打字机效果。
 *
 * SSE 的数据长这样(每帧以两个换行 \n\n 分隔):
 *   data: {"choices":[{"delta":{"content":"你"}}]}
 *   data: {"choices":[{"delta":{"content":"好"}}]}
 *   data: [DONE]
 *
 * 我们手写解析,是为了看清"流式"到底是怎么一回事,而不是黑盒 SDK。
 */
export async function streamChatCompletion(
  cfg: ModelConfig,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  options: { temperature?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const adapter = getAdapter(cfg);
  const req: ChatRequest = { messages, stream: true, temperature: options.temperature };
  const built = adapter.buildRequest(cfg, req);

  const rec = recordRequest(cfg, built, true);
  const { url, init } = viaProxy(built.url, built.init);

  const resp = await fetch(url, { ...init, signal: options.signal });
  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => '');
    rec.fail(resp.status, text.slice(0, 500));
    throw new Error(`请求失败 ${resp.status}: ${text.slice(0, 500)}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = ''; // 半包缓冲:一帧可能被网络切成两段
  let full = ''; // 累积的完整文本

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // 把这次读到的二进制块解码成文本,追加到缓冲区
      buffer += decoder.decode(value, { stream: true });

      // 按 \n\n 切出一个个完整的 SSE 事件;最后一段可能不完整,留在 buffer
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';

      for (const part of parts) {
        // 一个事件里可能有多行,我们只取以 data: 开头的行
        for (const line of part.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice('data:'.length).trim();
          if (payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            const delta = adapter.parseStreamChunk(json);
            if (delta) {
              full += delta;
              onDelta(delta);
            }
          } catch {
            // 半包或非 JSON 帧,忽略即可
          }
        }
      }
    }
    rec.done(resp.status);
    return full;
  } catch (e: any) {
    rec.fail(resp.status, e?.message ?? String(e));
    throw e;
  }
}
