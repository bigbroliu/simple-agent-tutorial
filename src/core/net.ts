/**
 * core/net.ts —— 仅用于本地开发的网络适配(与 Agent 逻辑无关)
 *
 * 浏览器直连厂商域名会被 CORS 拦截,于是开发期改为请求同源的 /llm-proxy,
 * 真实目标 URL 放进 x-llm-target 头,由 Vite 的 Node 端转发(见 vite-plugin-llm-proxy.ts)。
 * 生产环境应由自己的后端转发,这一层可整体替换掉 —— 所以单独抽出,不混进 llm.ts。
 */
export function viaProxy(url: string, init: RequestInit): { url: string; init: RequestInit } {
  return {
    url: '/llm-proxy',
    init: {
      ...init,
      headers: { ...(init.headers as Record<string, string>), 'x-llm-target': url },
    },
  };
}
