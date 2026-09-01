/**
 * vite-plugin-llm-proxy.ts —— 开发期的动态 LLM 代理
 *
 * 【为什么需要它】
 * 浏览器直连模型厂商(尤其 Anthropic)会被 CORS 拦截:
 *   Access to fetch ... blocked by CORS policy: No 'Access-Control-Allow-Origin'...
 * 因为厂商接口没给浏览器放行跨域。解法是加一层"同源代理":
 * 浏览器只请求本地同源的 /llm-proxy,由 Node 端转发到真实厂商地址
 * —— 服务端之间的请求不受浏览器 CORS 约束。
 *
 * 【为什么是"动态"目标】
 * 项目里可以配置多个模型(DeepSeek/Kimi/通义/OpenAI/Claude…),host 各不相同,
 * Vite 内置的 server.proxy 只能配静态单目标,所以这里自己写中间件:
 * 客户端把真实 URL 放进请求头 x-llm-target,代理读出来转发即可。
 *
 * 【流式(SSE)】
 * 用 Readable.fromWeb 把上游的响应流原样 pipe 回浏览器,打字机效果不受影响。
 *
 * 注:仅用于本地开发。生产环境应由你自己的后端做同样的代理,并把 API Key 留在服务端。
 */
import type { Plugin, Connect } from 'vite';
import { Readable } from 'node:stream';

const PROXY_PATH = '/llm-proxy';
const TARGET_HEADER = 'x-llm-target';

// 不应转发给上游的逐跳头 / 代理自身用的头
const SKIP_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'origin',
  'referer',
  TARGET_HEADER,
]);

function readBody(req: Connect.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function llmProxy(): Plugin {
  return {
    name: 'llm-proxy',
    configureServer(server) {
      // ① MCP 代理:把浏览器的同源 /mcp-proxy 转发到真实的 MCP Server(独立进程)。
      //    这样浏览器无需关心 MCP Server 的地址/CORS,请求"看起来"是同源的。
      const MCP_TARGET = process.env.MCP_TARGET ?? 'http://localhost:5190/mcp';
      server.middlewares.use('/mcp-proxy', async (req, res) => {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          const lk = k.toLowerCase();
          if (['host', 'connection', 'content-length', 'origin', 'referer'].includes(lk)) continue;
          if (typeof v === 'string') headers[k] = v;
        }
        try {
          const body = await readBody(req);
          const upstream = await fetch(MCP_TARGET, {
            method: req.method,
            headers,
            body: body.length ? body : undefined,
          });
          res.statusCode = upstream.status;
          upstream.headers.forEach((value, key) => {
            const lk = key.toLowerCase();
            if (lk === 'content-encoding' || lk === 'content-length' || lk === 'connection') return;
            res.setHeader(key, value);
          });
          if (upstream.body) {
            Readable.fromWeb(upstream.body as any).pipe(res);
          } else {
            res.end();
          }
        } catch (e: any) {
          res.statusCode = 502;
          res.end(`MCP 代理转发失败(MCP Server 是否已启动?): ${e?.message ?? String(e)}`);
        }
      });

      // ② LLM 代理(原有)
      server.middlewares.use(PROXY_PATH, async (req, res) => {
        const target = req.headers[TARGET_HEADER];
        const targetUrl = Array.isArray(target) ? target[0] : target;

        if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
          res.statusCode = 400;
          res.end(`缺少或非法的 ${TARGET_HEADER} 头`);
          return;
        }

        // 透传客户端原始请求头(鉴权、content-type、anthropic-version 等)
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (SKIP_REQUEST_HEADERS.has(k.toLowerCase())) continue;
          if (typeof v === 'string') headers[k] = v;
        }

        try {
          const body = await readBody(req);
          const upstream = await fetch(targetUrl, {
            method: req.method,
            headers,
            body: body.length ? body : undefined,
          });

          res.statusCode = upstream.status;
          // 回传关键响应头;放掉 content-encoding/length(fetch 已解码,且流式)
          upstream.headers.forEach((value, key) => {
            const lk = key.toLowerCase();
            if (lk === 'content-encoding' || lk === 'content-length' || lk === 'connection') return;
            res.setHeader(key, value);
          });

          if (upstream.body) {
            // 原样流式转发(SSE 逐帧透传)
            Readable.fromWeb(upstream.body as any).pipe(res);
          } else {
            res.end();
          }
        } catch (e: any) {
          res.statusCode = 502;
          res.end(`代理转发失败: ${e?.message ?? String(e)}`);
        }
      });
    },
  };
}
