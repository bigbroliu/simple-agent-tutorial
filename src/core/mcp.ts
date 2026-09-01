/**
 * core/mcp.ts —— 浏览器端的【真实】MCP 客户端
 *
 * 它通过同源的 /mcp-proxy(Vite 转发到独立进程的 MCP Server)说标准的
 * MCP over Streamable HTTP:每次调用 = 一个 HTTP POST,body 是 JSON-RPC 2.0,
 * 响应是 SSE(text/event-stream),我们把其中的 data: 行解析出来。
 *
 * 核心协议方法(和任何 MCP Server 都通用):
 *   - initialize   握手,交换协议版本与能力
 *   - tools/list   发现服务端提供哪些工具(返回 name/description/inputSchema)
 *   - tools/call   请求服务端执行某个工具
 *
 * 注意:这里没有"服务端逻辑" —— 服务端是另一个真实进程(见 mcp-server/index.ts)。
 * 浏览器只是个客户端,和生产里连一个第三方 MCP 服务没有本质区别。
 */

import type { ToolSchema } from './types';

/* ---------------- JSON-RPC 2.0 报文类型 ---------------- */

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: any;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: any;
  error?: { code: number; message: string };
}

/** 每收发一条报文都回调,便于 UI 把"电报"可视化 */
export type WireLogger = (dir: 'send' | 'recv', msg: JsonRpcRequest | JsonRpcResponse) => void;

/** 从一段 SSE 文本里取出最后一个 data: 的 JSON(Streamable HTTP 的响应体) */
function parseSse(text: string): any {
  // 兼容普通 JSON 响应(某些实现直接返回 application/json)
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      /* 落到下面按 SSE 解析 */
    }
  }
  let last: any = null;
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s.startsWith('data:')) continue;
    const payload = s.slice('data:'.length).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      last = JSON.parse(payload);
    } catch {
      /* 忽略非 JSON 帧 */
    }
  }
  return last;
}

/**
 * MCP 客户端(真实 HTTP 传输)。endpoint 默认走同源代理 /mcp-proxy。
 */
export class McpClient {
  private nextId = 1;
  private sessionId: string | null = null;

  constructor(
    private endpoint: string = '/mcp-proxy',
    private onWire?: WireLogger,
  ) {}

  private async call(method: string, params?: any): Promise<any> {
    const req: JsonRpcRequest = { jsonrpc: '2.0', id: this.nextId++, method, params };
    this.onWire?.('send', req);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      // Streamable HTTP 要求客户端声明能接收这两种响应
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2024-11-05',
    };
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;

    const resp = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(req),
    });

    // 有状态实现会在响应头带回 session id;无状态实现没有,忽略即可
    const sid = resp.headers.get('Mcp-Session-Id');
    if (sid) this.sessionId = sid;

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status}: ${errText.slice(0, 200)}`);
    }

    const text = await resp.text();
    const msg = parseSse(text) as JsonRpcResponse | null;
    if (!msg) throw new Error('MCP 响应为空或无法解析');
    this.onWire?.('recv', msg);
    if (msg.error) throw new Error(`MCP 错误 ${msg.error.code}: ${msg.error.message}`);
    return msg.result;
  }

  /** 握手 */
  initialize() {
    return this.call('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'hy-demo-client', version: '0.1.0' },
    });
  }

  /** 发现服务端提供的工具 */
  async listTools(): Promise<{ name: string; description: string; inputSchema: any }[]> {
    const result = await this.call('tools/list');
    return result.tools;
  }

  /** 请求服务端执行一个工具,返回拼好的文本结果 */
  async callTool(name: string, args: any): Promise<string> {
    const result = await this.call('tools/call', { name, arguments: args });
    const content = result?.content ?? [];
    return content.map((c: any) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n');
  }
}

/** 把 MCP 的工具描述,转换成我们模型侧熟悉的 ToolSchema(OpenAI 风格) */
export function mcpToolsToSchemas(
  mcpTools: { name: string; description: string; inputSchema: any }[],
): ToolSchema[] {
  return mcpTools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}
