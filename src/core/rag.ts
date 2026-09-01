/**
 * core/rag.ts —— 极简 RAG(检索增强生成)内核
 *
 * 【本文件教什么】
 * RAG 的完整管线,拆成四步,每一步都可独立理解:
 *   ① 切分(chunk):把长文档切成小片段
 *   ② 索引(index):为每个片段建立可检索的表示
 *   ③ 检索(retrieve):根据问题,找出最相关的几段
 *   ④ 增强(augment):把检索到的片段拼进上下文,再交给模型生成
 *
 * 【关于检索算法的取舍 —— 请一定读】
 * 生产级 RAG 的第 ③ 步用【向量嵌入(embeddings)】做语义检索:把文本转成向量,
 * 用余弦相似度找最近邻。但那需要一个 embeddings 接口,而本项目连接的网关未提供。
 * 因此这里用一个【纯前端的词重合度打分】来演示检索 —— 它不依赖任何网络,
 * 教的是 RAG 的"管线与思想";真正换成向量检索时,只需替换 scoreChunk 这一个函数,
 * 其余(切分、拼接、生成)完全不变。这本身就是 RAG "检索模块可插拔"的最好例证。
 */

export interface Chunk {
  id: number;
  text: string;
  /** 本次检索的得分(检索后填充,用于 UI 展示) */
  score?: number;
}

/** ① 切分:按空行/换行把文档切成段落级片段,并过滤太短的碎片 */
export function chunkDocument(doc: string): Chunk[] {
  return doc
    .split(/\n\s*\n/) // 按空行分段
    .map((s) => s.trim())
    .filter((s) => s.length >= 4)
    .map((text, id) => ({ id, text }));
}

/**
 * 把一段文本拆成用于匹配的"词"。
 * 中文没有天然空格,这里用一个朴素但有效的办法:
 *   - 英文/数字按单词切
 *   - 中文按【连续 2 字】(bigram)切,能捕捉"节气""白露"这类词
 */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens: string[] = [];

  // 英文单词与数字
  const latin = lower.match(/[a-z0-9]+/g);
  if (latin) tokens.push(...latin);

  // 中文:提取连续汉字,做 bigram 切分
  const hanRuns = lower.match(/[一-龥]+/g) ?? [];
  for (const run of hanRuns) {
    if (run.length === 1) {
      tokens.push(run);
    } else {
      for (let i = 0; i < run.length - 1; i++) {
        tokens.push(run.slice(i, i + 2));
      }
    }
  }
  return tokens;
}

/**
 * ③ 检索的打分函数(可插拔点)。
 * 这里用词重合度:问题与片段共享的词越多、片段本身越不冗长,得分越高。
 * —— 换成向量检索时,只需把这里替换成 cosineSimilarity(embed(query), embed(chunk))。
 */
export function scoreChunk(queryTokens: string[], chunkTokens: string[]): number {
  if (queryTokens.length === 0 || chunkTokens.length === 0) return 0;
  const chunkSet = new Set(chunkTokens);
  let hit = 0;
  const counted = new Set<string>();
  for (const q of queryTokens) {
    if (chunkSet.has(q) && !counted.has(q)) {
      hit++;
      counted.add(q);
    }
  }
  // 命中数按片段长度做轻微归一,避免长片段仅因为"词多"就总是胜出
  return hit / Math.sqrt(chunkTokens.length);
}

/** ③ 检索:对所有片段打分,返回得分最高的 topK 段(得分>0) */
export function retrieve(query: string, chunks: Chunk[], topK = 3): Chunk[] {
  const qTokens = tokenize(query);
  return chunks
    .map((c) => ({ ...c, score: scoreChunk(qTokens, tokenize(c.text)) }))
    .filter((c) => (c.score ?? 0) > 0)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, topK);
}

/** ④ 增强:把检索到的片段拼成给模型的参考资料块 */
export function buildAugmentedSystem(retrieved: Chunk[]): string {
  if (retrieved.length === 0) {
    return '你是一个严谨的问答助手。如果参考资料中没有相关信息,请直接说"资料中没有提到",不要编造。';
  }
  const refs = retrieved.map((c, i) => `[资料${i + 1}] ${c.text}`).join('\n');
  return (
    '你是一个严谨的问答助手。请【只根据下面提供的参考资料】回答用户问题,' +
    '不要使用资料之外的知识;如果资料中没有相关信息,请直接说"资料中没有提到"。\n\n' +
    '参考资料:\n' +
    refs
  );
}
