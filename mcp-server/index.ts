/**
 * mcp-server/index.ts —— 一个【真实】的 MCP Server(独立 Node 进程)
 *
 * 这不是"页面内模拟",而是货真价实的 MCP 服务:
 *   - 用官方 SDK @modelcontextprotocol/sdk 实现协议
 *   - 走标准的 Streamable HTTP 传输,监听一个真实端口(默认 5190)
 *   - 浏览器端的 MCP Client 通过 Vite 代理(/mcp-proxy)真实地跨进程连过来
 *
 * 说明:本地工具类 MCP(如你在 Claude Code 里装的 Figma / Filesystem)通常用 stdio 传输
 * (客户端把 Server 当子进程拉起)。这里宿主是浏览器,起不了子进程,所以用 HTTP 传输
 * —— 这是远程/托管 MCP 的标准方式,协议方法(initialize/tools/list/tools/call)完全一致。
 *
 * 提供的工具都无害、纯计算 + 读取本进程可见的信息,便于现场稳定演示。
 */
import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const PORT = Number(process.env.MCP_PORT ?? 5190);

/** 构造一个带工具的 MCP Server 实例 */
function buildServer(): McpServer {
  const server = new McpServer({ name: 'hy-demo-mcp', version: '0.1.0' });

  // 工具①:掷骰子
  server.registerTool(
    'roll_dice',
    {
      description: '掷一个 N 面骰子,返回 1..N 之间的随机整数。',
      inputSchema: { sides: z.number().min(2).max(1000).optional() },
    },
    async ({ sides }) => {
      const n = sides ?? 6;
      const value = Math.floor(Math.random() * n) + 1;
      return { content: [{ type: 'text', text: `掷出了 ${value}(1-${n})` }] };
    },
  );

  // 工具②:统计文本字数
  server.registerTool(
    'count_words',
    {
      description: '统计一段文本里的字符数与单词数。',
      inputSchema: { text: z.string() },
    },
    async ({ text }) => {
      const chars = [...text].length;
      const words = text.trim().split(/\s+/).filter(Boolean).length;
      return { content: [{ type: 'text', text: `字符数 ${chars},单词数 ${words}` }] };
    },
  );

  // 工具③:返回 Server 进程信息 —— 用来"证明"这确实是另一个独立进程在跑
  server.registerTool(
    'server_info',
    {
      description: '返回本 MCP Server 进程的信息(PID、Node 版本、运行时长)。',
      inputSchema: {},
    },
    async () => {
      const info = {
        pid: process.pid,
        node: process.version,
        uptimeSec: Math.round(process.uptime()),
        platform: process.platform,
      };
      return {
        content: [
          {
            type: 'text',
            text: `我是独立的 MCP Server 进程:PID=${info.pid},Node=${info.node},已运行 ${info.uptimeSec}s,平台 ${info.platform}`,
          },
        ],
      };
    },
  );

  return server;
}

function readBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      if (chunks.length === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch {
        resolve(undefined);
      }
    });
    req.on('error', reject);
  });
}

const httpServer = createServer(async (req, res) => {
  // 允许被 Vite 代理调用;直接被浏览器打时也放行 CORS(便于调试)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, mcp-session-id, mcp-protocol-version');
  res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (!req.url?.startsWith('/mcp')) {
    res.statusCode = 404;
    res.end('Not Found. MCP endpoint is /mcp');
    return;
  }

  // 无状态模式:每个请求都用一个全新的 server + transport,处理完即释放。
  // 教学场景足够,也最简单;生产可用 sessionIdGenerator 做有状态会话。
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    const body = await readBody(req);
    await transport.handleRequest(req, res, body);
  } catch (e) {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end(String(e));
    }
  }
});

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`\x1b[35m[MCP]\x1b[0m 真实 MCP Server 已启动 → http://localhost:${PORT}/mcp  (PID ${process.pid})`);
});
