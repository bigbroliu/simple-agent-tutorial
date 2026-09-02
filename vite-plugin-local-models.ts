/**
 * vite-plugin-local-models.ts —— 把本地私密配置文件喂给前端(仅开发期)
 *
 * 【为什么需要它】
 * 模型配置原本只存在浏览器 localStorage 里,换浏览器、清缓存、换机器都要重新填一遍 Key。
 * 这个插件让你把常用配置写进项目根目录的 models.local.json(已被 .gitignore 忽略),
 * 启动 dev server 时自动注入前端、种进 localStorage。
 *
 * 【安全边界 —— 这是本文件最重要的部分】
 * ① 只在 `vite dev` 时注入。`vite build` 时一律返回 null,
 *    所以 Key 绝不会被打进 dist 产物、不会随静态资源发布出去。
 * ② 写入端点只认 localhost:本项目的 dev server 监听 0.0.0.0(host: true,方便手机扫码看),
 *    这意味着同一局域网内的其他设备也能访问。写本地文件这种能力不该开放给它们,
 *    所以要求"连接来自本机回环地址"且"Host 头是 localhost/127.0.0.1"。
 * 这仍然是"开发便利",不是生产方案:生产环境请把 Key 留在你自己的后端。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin, Connect } from 'vite';

/** 前端用 `import localModels from 'virtual:local-models'` 拿到配置 */
const VIRTUAL_ID = 'virtual:local-models';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

const FILE_NAME = 'models.local.json';

/** IPv4/IPv6 的回环地址(::ffff:127.0.0.1 是 IPv4-mapped 形式) */
function isLoopbackAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  const a = addr.replace(/^::ffff:/i, '');
  return a === '127.0.0.1' || a === '::1' || a.startsWith('127.');
}

/** Host 头里的主机名(去掉端口和 IPv6 方括号)是否为 localhost */
function isLocalhostHost(host: string | undefined): boolean {
  if (!host) return false;
  // [::1]:5188 → ::1 ;localhost:5188 → localhost
  const name = host.startsWith('[')
    ? host.slice(1, host.indexOf(']'))
    : host.split(':')[0];
  const n = name.toLowerCase();
  return n === 'localhost' || n === '127.0.0.1' || n === '::1' || n.startsWith('127.');
}

/**
 * 写文件这种能力只允许本机使用。
 * 两个条件都要满足:TCP 连接来自回环地址,且请求的 Host 是 localhost。
 * 前者防局域网设备直连,后者防 DNS rebinding(把某个域名解析到 127.0.0.1 再来打这个端点)。
 */
function isLocalRequest(req: Connect.IncomingMessage): boolean {
  return isLoopbackAddress(req.socket?.remoteAddress) && isLocalhostHost(req.headers.host);
}

export function localModels(): Plugin {
  let filePath = '';
  let isDev = false;

  return {
    name: 'local-models',

    configResolved(config) {
      filePath = resolve(config.root, FILE_NAME);
      // command === 'serve' 才是 dev;build 时不注入任何真实内容
      isDev = config.command === 'serve';
    },

    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },

    load(id) {
      if (id !== RESOLVED_ID) return;

      // 构建产物里永远是 null —— Key 不进 dist
      if (!isDev) return 'export default null;';

      if (!existsSync(filePath)) return 'export default null;';

      try {
        const raw = readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        // 原样透传,由前端 core/config.ts 负责校验字段
        return `export default ${JSON.stringify(parsed)};`;
      } catch (e: any) {
        this.warn(`${FILE_NAME} 解析失败(将忽略): ${e?.message ?? String(e)}`);
        return 'export default null;';
      }
    },

    configureServer(server) {
      // 自己写文件时,watcher 也会收到 change 事件。那次重载是多余的
      // (浏览器本来就是这份内容的源头),而且会把页面上的成功提示冲掉。
      // 记一个时间戳,短窗口内的 change 事件跳过重载。
      let selfWriteAt = 0;
      const SELF_WRITE_WINDOW = 1000;

      // ① 写入端点:把浏览器 localStorage 里已有的配置落盘成 models.local.json。
      //    仅 dev server 存在,且只写项目根目录这一个固定文件名 —— 路径不由请求决定。
      server.middlewares.use('/__write-local-models', async (req, res) => {
        const reply = (status: number, payload: Record<string, unknown>) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(payload));
        };

        if (req.method !== 'POST') return reply(405, { error: '只接受 POST' });

        // 只有本机能写文件 —— 局域网里的其他设备一律拒绝
        if (!isLocalRequest(req)) {
          server.config.logger.warn(
            `[local-models] 拒绝非本机的写入请求(from ${req.socket?.remoteAddress}, host ${req.headers.host})`,
          );
          return reply(403, {
            error: '这个功能只能在本机(localhost)使用 —— 当前是通过局域网地址访问的',
          });
        }

        try {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));

          if (!Array.isArray(body?.models) || body.models.length === 0) {
            return reply(400, { error: 'models 为空,没有可写入的配置' });
          }

          const existed = existsSync(filePath);
          selfWriteAt = Date.now();
          // 尾随换行,符合常规文本文件约定
          writeFileSync(filePath, JSON.stringify(body, null, 2) + '\n', 'utf-8');
          server.config.logger.info(
            `[local-models] 已${existed ? '覆盖' : '写入'} ${FILE_NAME}(${body.models.length} 个模型)`,
          );
          reply(200, { ok: true, path: filePath, overwritten: existed });
        } catch (e: any) {
          reply(500, { error: e?.message ?? String(e) });
        }
      });

      // ② 手工改了配置文件就整页重载,免得手动重启 dev server。
      //    注意:文件可能一开始不存在(等下才被上面的端点创建),所以无条件监听。
      server.watcher.add(filePath);
      server.watcher.on('change', (changed) => {
        if (resolve(changed) !== filePath) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        // 刚才是页面自己写的 → 只失效模块,不重载(否则会冲掉成功提示)
        if (Date.now() - selfWriteAt < SELF_WRITE_WINDOW) return;
        server.ws.send({ type: 'full-reload' });
        server.config.logger.info(`[local-models] ${FILE_NAME} 已更新,页面重载`);
      });
    },
  };
}
