/**
 * core/skills.ts —— Skill(技能)运行时:按需装载的"做事方法"
 *
 * 【本文件教什么】
 * 第 4~6 课给了 Agent【能力】(工具),第 10 课把工具标准化成可插拔服务(MCP)。
 * 但"能做"不等于"会做":同一个 write 工具,写出来的东西是否符合团队规范,
 * 取决于模型【知不知道那套规范】。这类"流程、规范、领域方法论"就是 Skill。
 *
 * 一个 Skill 本质上是【一个文件夹】:
 *   code-review/
 *     SKILL.md                    ← 正文:完整的做事说明(带 name / description 头部)
 *     references/checklist.md     ← 可选:更细的资料,正文里点名后才读
 *
 * 【核心机制:渐进式披露(progressive disclosure)】
 * 上下文窗口是有限且昂贵的稀缺资源,不能把所有技能全文都塞进 system prompt。
 * 所以分三层,越往下越贵、越晚加载:
 *
 *   Level 1  只把每个技能的 name + description 放进 system(几十 token,常驻)
 *   Level 2  模型判断相关 → 调用 read_skill 读 SKILL.md 全文(几百~几千 token)
 *   Level 3  正文里点名了 references/xxx.md → 再调 read_skill_resource 读它
 *
 * 【和前面几课的关系 —— 这是本文件最值得讲的一点】
 * 我们没有为 Skill 发明任何新机制:装载动作就是【两个普通工具】(read_skill /
 * read_skill_resource),跑的还是第 5 课那个 runAgentLoop,一行没改。
 * 换句话说 —— Skill 是"用工具送达的、由模型自己决定何时取用的上下文"。
 *
 * 【和 RAG(第 9 课)的区别】
 * RAG 是【我们的代码】先检索、把片段硬塞进上下文,模型没有发言权;
 * Skill 是【模型自己】看着目录决定要不要打开、打开哪一层。
 * 一个是"喂饭",一个是"给它一座图书馆和借书证"。
 */

import type { ToolSchema } from './types';

/* ============================================================
 * 类型
 * ============================================================ */

/** Level 3 资源:SKILL.md 里点名后才会被读取的附件 */
export interface SkillResource {
  /** 相对技能目录的路径,如 'references/checklist.md' */
  path: string;
  content: string;
}

/**
 * 一条"验收标准"。技能不是玄学 —— 它应该有可检查的产出要求。
 * 用于页面上把"装了技能 / 没装技能"的差别量化成 ✅❌。
 */
export interface SkillCheck {
  label: string;
  test: (output: string) => boolean;
}

/** 一个技能 = 一个文件夹 */
export interface Skill {
  /** 目录名,也是工具调用时的标识 */
  name: string;
  /** Level 1:唯一常驻上下文的部分。它同时是"给模型看的检索键" */
  description: string;
  /** Level 2:SKILL.md 正文 */
  body: string;
  /** Level 3:按需附件 */
  resources?: SkillResource[];
  /** 产出的验收标准(可选) */
  checks?: SkillCheck[];
}

/* ============================================================
 * token 估算
 *
 * 真实分词依模型而异,这里用一个够教学的粗估:
 * 中日韩字符约 1 字 = 1 token,其余(英文/符号/空白)约 4 字符 = 1 token。
 * 我们要说明的是【量级差异】,不是精确计费。
 * ============================================================ */

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = text.match(/[　-〿一-鿿＀-￯]/g)?.length ?? 0;
  const rest = text.length - cjk;
  return cjk + Math.ceil(rest / 4);
}

/** 一个技能"全文装载"要花多少 token(正文 + 所有附件) */
export function skillFullTokens(skill: Skill): number {
  const res = (skill.resources ?? []).reduce((sum, r) => sum + estimateTokens(r.content), 0);
  return estimateTokens(skill.body) + res;
}

/** 全部技能都塞进 system 的话,要花多少 token(用于对比"省了多少") */
export function allSkillsTokens(skills: Skill[]): number {
  return skills.reduce(
    (sum, s) => sum + estimateTokens(s.name + s.description) + skillFullTokens(s),
    0,
  );
}

/* ============================================================
 * Level 1:技能目录(常驻 system prompt 的那一小段)
 * ============================================================ */

/** 目录里描述一个技能的那一行 —— 这是它常驻上下文的全部体积 */
export function skillIndexLine(skill: Skill): string {
  return `- ${skill.name}: ${skill.description}`;
}

/**
 * 构造技能目录。★ 注意这里【只放 name 和 description】——
 * 正文一个字都没有。这就是渐进式披露省钱的地方。
 */
export function buildSkillIndex(skills: Skill[]): string {
  const list = skills.map(skillIndexLine).join('\n');
  return [
    '你可以使用下面这些【技能】。技能是团队沉淀下来的做事方法,',
    '此刻你只能看到它们的名字和用途,看不到具体内容:',
    '',
    list,
    '',
    '使用规则:',
    '1. 先判断哪个技能和当前任务相关。相关就【必须】先用 read_skill 读取它的完整说明,再照着做。',
    '2. 说明里如果提到 references/ 下的文件,用 read_skill_resource 把它读出来,不要凭猜测行事。',
    '3. 没有相关技能就直接回答,不要调用任何工具。',
    '4. 不要凭印象编造规范 —— 规范只以你读到的技能内容为准。',
  ].join('\n');
}

/** 目录里除技能条目之外的固定开销(说明 + 使用规则)。技能再多,这部分也只付一次。 */
export function indexPreambleTokens(skills: Skill[]): number {
  const lines = skills.reduce((sum, s) => sum + estimateTokens(skillIndexLine(s)), 0);
  return Math.max(0, estimateTokens(buildSkillIndex(skills)) - lines);
}

/* ============================================================
 * 装载技能用的两个工具
 *
 * 就是普通的 Tool Calling —— 和第 4 课的 calculator 没有本质区别。
 * ============================================================ */

export const READ_SKILL_TOOL: ToolSchema = {
  type: 'function',
  function: {
    name: 'read_skill',
    description:
      '读取一个技能的完整说明(SKILL.md)。在按某个技能做事之前必须先读它,不要凭猜测。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '技能名,必须来自技能目录,如 "code-review"' },
      },
      required: ['name'],
    },
  },
};

export const READ_SKILL_RESOURCE_TOOL: ToolSchema = {
  type: 'function',
  function: {
    name: 'read_skill_resource',
    description:
      '读取某个技能引用的附加资料文件。仅当该技能的说明里明确点到这个文件时才调用。',
    parameters: {
      type: 'object',
      properties: {
        skill: { type: 'string', description: '技能名,如 "code-review"' },
        path: {
          type: 'string',
          description: '技能目录内的相对路径,如 "references/checklist.md"',
        },
      },
      required: ['skill', 'path'],
    },
  },
};

/** 给模型的工具清单(装载技能只需要这两个) */
export const SKILL_TOOLS: ToolSchema[] = [READ_SKILL_TOOL, READ_SKILL_RESOURCE_TOOL];

/** 一次装载事件,供 UI 记账:到底往上下文里塞了多少 token */
export interface SkillLoadEvent {
  /** 2 = 读了 SKILL.md 正文;3 = 读了 references 附件 */
  level: 2 | 3;
  skill: string;
  /** level 3 才有 */
  path?: string;
  tokens: number;
}

/**
 * 造一个工具执行器,交给 runAgentLoop 的 execTool。
 *
 * ★ 关键:这里没有任何"技能框架"。就是根据名字从注册表里取出文本返回而已 ——
 *   技能的全部魔力都在【它被读进上下文的那一刻】,不在代码里。
 */
export function makeSkillExecutor(
  skills: Skill[],
  onLoad?: (e: SkillLoadEvent) => void,
): (name: string, args: any) => string {
  const byName = new Map(skills.map((s) => [s.name, s]));

  return (toolName, args) => {
    if (toolName === 'read_skill') {
      const skill = byName.get(String(args?.name ?? ''));
      if (!skill) {
        return `没有名为 "${args?.name}" 的技能。可用技能:${[...byName.keys()].join('、')}`;
      }
      onLoad?.({ level: 2, skill: skill.name, tokens: estimateTokens(skill.body) });
      return skill.body;
    }

    if (toolName === 'read_skill_resource') {
      const skill = byName.get(String(args?.skill ?? ''));
      if (!skill) return `没有名为 "${args?.skill}" 的技能。`;
      const res = (skill.resources ?? []).find((r) => r.path === args?.path);
      if (!res) {
        const paths = (skill.resources ?? []).map((r) => r.path).join('、') || '(该技能没有附件)';
        return `技能 "${skill.name}" 下找不到 "${args?.path}"。它的附件有:${paths}`;
      }
      onLoad?.({
        level: 3,
        skill: skill.name,
        path: res.path,
        tokens: estimateTokens(res.content),
      });
      return res.content;
    }

    return `未知工具 ${toolName}`;
  };
}

/* ============================================================
 * 内置技能:代码评审
 *
 * 刻意写成【模型绝不可能猜到】的虚构团队规范(编号、判定口径、输出格式都是我们自己定的),
 * 这样"装了技能 / 没装技能"的差别就是硬邦邦的对错,而不是"感觉答得好一点"。
 *
 * 它还刻意把判定标准放进 references/ —— 于是这一个技能就能演示完整的三层装载。
 * ============================================================ */

const codeReview: Skill = {
  name: 'code-review',
  description:
    '按团队评审清单检查一段前端代码。当用户要 review 代码、看代码有没有问题、找隐患、做代码检查时使用。',
  body: `# 前端代码评审流程(星轨项目)

## 重要:先读清单

本技能的判定标准【不在这份正文里】,而在附件
\`references/checklist.md\`。评审前必须先用 read_skill_resource 把它读出来,
逐条对照。凭经验泛泛而谈的评审在本项目视为无效评审。

## 输出格式

对清单里【每一条】给出结论,一条一行:

\`[条目编号] 状态 — 问题所在与改法\`

状态只用三种:\`违反\` / \`通过\` / \`不适用\`。

最后单独一行给出总结:\`结论: 可合并\` 或 \`结论: 需修改(N 处违反)\`。

不要夸奖代码,不要提清单之外的个人偏好。`,
  resources: [
    {
      path: 'references/checklist.md',
      content: `# 星轨前端评审清单(v3)

## R1 · 事件监听必须成对
在 onMounted 里 addEventListener 的,必须在 onUnmounted 里 removeEventListener,
且传入同一个函数引用。缺失即内存泄漏。

## R2 · v-for 的 key 必须稳定
禁止用数组下标 index 作为 key。必须用数据自身的稳定标识(如 id)。
列表发生插入/删除时,index 作 key 会导致状态错位。

## R3 · 模板里不写计算
模板中禁止出现 filter / map / reduce / 三目嵌套等表达式。
一律抽成 computed —— 模板里的表达式每次重渲染都会重算。

## R4 · 用户内容禁止 v-html
任何来自接口或用户输入的内容都不得用 v-html 渲染(XSS)。
需要富文本时必须先经过白名单净化。

## R5 · 异步请求必须有失败分支
fetch / axios 调用必须处理失败:catch 或 try/catch,并给用户可见的错误状态。
只写 .then 的链子视为违反。

## R6 · 不得提交调试残留
console.log、debugger、被注释掉的整段旧代码,一律不得进主干。`,
    },
  ],
  checks: [
    { label: '按编号逐条给了结论(出现 R1~R5 的编号)', test: (o) => /R1/.test(o) && /R5/.test(o) },
    { label: '指出了事件监听没有解绑(R1)', test: (o) => /(removeEventListener|解绑|移除监听|未移除)/i.test(o) },
    { label: '指出了 index 当 key 的问题(R2)', test: (o) => /(index|下标)/i.test(o) && /key/i.test(o) },
    { label: '指出了模板里写 filter 应抽 computed(R3)', test: (o) => /computed/i.test(o) },
    { label: '指出了 v-html 的 XSS 风险(R4)', test: (o) => /v-html/i.test(o) },
    { label: '指出了请求没有失败分支(R5)', test: (o) => /(catch|失败分支|错误处理|失败态)/i.test(o) },
    { label: '给出了 `结论: …` 收尾', test: (o) => /^\s*结论[::]/m.test(o) },
  ],
};

/** 内置技能库。教学起见只放一个 —— 机制看清楚了,加第二个只是复制粘贴。 */
export const SKILLS: Skill[] = [codeReview];
