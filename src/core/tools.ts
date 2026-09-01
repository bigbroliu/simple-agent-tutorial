/**
 * core/tools.ts —— 工具注册表(源码可在页面上查看/编辑)
 *
 * 【本文件教什么】
 * "给 Agent 一个能力" = 定义一个工具。一个工具由两部分组成:
 *   1. schema:给模型看的"说明书"(名字、干什么、要什么参数),JSON Schema 格式。
 *   2. run:真正干活的 JS 函数。模型只会"请求"调用它,执行永远发生在我们代码里。
 *
 * 关键认知:模型不会执行任何代码。它只是根据说明书,产出一个"我想调用 X,参数是 Y"
 * 的结构化请求(tool_call)。执行、拿结果、把结果还给模型 —— 全是我们前端的活。
 *
 * 【为什么 run 用"源码字符串"表示】
 * 为了能在页面上把工具的真实代码显示出来、并允许现场编辑,这里把每个工具的 run
 * 存成一段【函数表达式源码】。运行时用 compile() 把它编译成真正的函数来执行。
 * 用户在页面上的改动存进 localStorage,runTool 会优先用改过的版本 —— 于是"改完即生效"。
 */

import type { ToolSchema } from './types';

export interface ToolDef {
  schema: ToolSchema;
  /** run 的默认源码:一个函数表达式,如 "({x}) => {...}"。可在页面上编辑覆盖。 */
  defaultSource: string;
}

const OVERRIDE_KEY = 'hy-agent:tool-src-overrides';

/* ---------------- 各工具的 schema + 默认源码 ---------------- */

/** 计算器:演示"模型不擅长精确计算,交给代码" */
const calculator: ToolDef = {
  schema: {
    type: 'function',
    function: {
      name: 'calculator',
      description: '计算一个数学表达式并返回结果。适用于任何算术运算。',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: '要计算的表达式,如 "23 * (4 + 1)"' },
        },
        required: ['expression'],
      },
    },
  },
  defaultSource: `({ expression }) => {
  // 教学项目:仅允许数字与运算符,避免 eval 任意代码
  if (!/^[\\d\\s+\\-*/.()%]+$/.test(expression)) {
    return '错误:表达式含有不允许的字符';
  }
  try {
    const result = Function('"use strict"; return (' + expression + ')')();
    return String(result);
  } catch (e) {
    return '错误:无法计算该表达式';
  }
}`,
};

/** 当前时间:演示"模型没有实时信息,需要工具补充" */
const now: ToolDef = {
  schema: {
    type: 'function',
    function: {
      name: 'now',
      description: '获取当前的日期和时间。',
      parameters: { type: 'object', properties: {} },
    },
  },
  defaultSource: `() => new Date().toLocaleString('zh-CN')`,
};

/** 开关灯:改 localStorage + 派发事件,让页面上真的有个灯泡亮/灭(视觉可见的副作用) */
const toggleLamp: ToolDef = {
  schema: {
    type: 'function',
    function: {
      name: 'toggle_lamp',
      description: '打开或关闭房间里的灯。参数 on=true 为开灯,false 为关灯。',
      parameters: {
        type: 'object',
        properties: {
          on: { type: 'boolean', description: 'true 开灯,false 关灯' },
        },
        required: ['on'],
      },
    },
  },
  defaultSource: `({ on }) => {
  // 副作用:写 localStorage,并派发事件让页面上的灯泡亮/灭
  localStorage.setItem('hy-agent:lamp', on ? '1' : '0');
  window.dispatchEvent(new CustomEvent('lamp-change', { detail: { on } }));
  return on ? '灯已打开' : '灯已关闭';
}`,
};

const LAMP_KEY = 'hy-agent:lamp';
export function getLampState(): boolean {
  return localStorage.getItem(LAMP_KEY) === '1';
}

/** 设置灯的状态并广播事件(供页面进入时复位为关) */
export function setLampState(on: boolean): void {
  localStorage.setItem(LAMP_KEY, on ? '1' : '0');
  window.dispatchEvent(new CustomEvent('lamp-change', { detail: { on } }));
}

/** 真实工具:调用公开天气 API(Open-Meteo,免费无需 key,支持 CORS) */
const getWeather: ToolDef = {
  schema: {
    type: 'function',
    function: {
      name: 'get_weather',
      description: '查询某个城市当前的实时天气(温度、天气状况)。',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: '城市名,如 "北京"、"Shanghai"' },
        },
        required: ['city'],
      },
    },
  },
  defaultSource: `async ({ city }) => {
  // 把 WMO 天气代码转成中文
  const codeText = (code) => {
    if (code === 0) return '晴';
    if (code <= 3) return '多云';
    if (code <= 48) return '雾';
    if (code <= 67) return '雨';
    if (code <= 77) return '雪';
    if (code <= 82) return '阵雨';
    return '天气多变';
  };
  try {
    // 1) 先把城市名解析成经纬度
    const geoResp = await fetch(
      'https://geocoding-api.open-meteo.com/v1/search?name=' +
        encodeURIComponent(city) + '&count=1&language=zh'
    );
    const geo = await geoResp.json();
    const place = geo.results && geo.results[0];
    if (!place) return '没有找到城市「' + city + '」';

    // 2) 再查该经纬度的实时天气
    const wResp = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=' + place.latitude +
        '&longitude=' + place.longitude + '&current=temperature_2m,weather_code'
    );
    const w = await wResp.json();
    const temp = w.current && w.current.temperature_2m;
    const code = w.current && w.current.weather_code;
    return place.name + ' 当前气温 ' + temp + '°C,天气代码 ' +
      code + '(' + codeText(code) + ')';
  } catch {
    return '查询「' + city + '」天气失败(可能是网络问题),请稍后再试';
  }
}`,
};

/**
 * save_profile_card:把【结构化】的个人信息画成一张名片图片并下载。
 * 这个工具的入参必须是结构化字段 —— 模型不吐结构化数据,就根本没法调它。
 * 用于演示"结构化输出"的刚需(Demo 7)。
 */
const saveProfileCard: ToolDef = {
  schema: {
    type: 'function',
    function: {
      name: 'save_profile_card',
      description:
        '把一个人的结构化信息生成一张名片图片(PNG)并自动下载。只有拿到规范字段才能生成。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '姓名' },
          age: { type: 'number', description: '年龄(数字)' },
          city: { type: 'string', description: '所在城市' },
          role: { type: 'string', description: '职位/角色' },
          skills: {
            type: 'array',
            items: { type: 'string' },
            description: '技能列表,字符串数组',
          },
        },
        required: ['name', 'age', 'city', 'role', 'skills'],
      },
    },
  },
  defaultSource: `({ name, age, city, role, skills }) => {
  // ★ 关键:下面每一行都在"按字段"取值 —— 这就是为什么入参必须结构化
  const W = 640, H = 360;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // 背景
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#4f46e5');
  grad.addColorStop(1, '#7c3aed');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  // 白色卡片
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(28, 28, W - 56, H - 56);

  // 姓名(大字)
  ctx.fillStyle = '#111827';
  ctx.font = 'bold 40px sans-serif';
  ctx.fillText(String(name), 56, 104);
  // 职位
  ctx.fillStyle = '#4f46e5';
  ctx.font = '22px sans-serif';
  ctx.fillText(String(role) + '  ·  ' + String(age) + ' 岁', 56, 146);
  // 城市
  ctx.fillStyle = '#6b7280';
  ctx.font = '18px sans-serif';
  ctx.fillText('📍 ' + String(city), 56, 186);

  // 技能标签(遍历数组字段)
  ctx.font = '16px sans-serif';
  let x = 56;
  const y = 240;
  for (const s of (skills || [])) {
    const w = ctx.measureText(String(s)).width + 28;
    ctx.fillStyle = '#eef2ff';
    ctx.fillRect(x, y, w, 34);
    ctx.fillStyle = '#4338ca';
    ctx.fillText(String(s), x + 14, y + 23);
    x += w + 12;
  }

  // 触发下载
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = 'profile_' + String(name) + '.png';
  a.click();

  return '已生成名片图片:' + name + '(' + role + ',' + city + '),技能 ' +
    (skills || []).length + ' 项,已触发下载。';
}`,
};

/** 全部工具的注册表 */
export const ALL_TOOLS: Record<string, ToolDef> = {
  calculator,
  now,
  toggle_lamp: toggleLamp,
  get_weather: getWeather,
  save_profile_card: saveProfileCard,
};

/* ---------------- 源码的读取 / 覆盖 / 编译 ---------------- */

function loadOverrides(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(OVERRIDE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveOverrides(o: Record<string, string>): void {
  localStorage.setItem(OVERRIDE_KEY, JSON.stringify(o));
}

/** 当前生效的源码:优先用用户在页面上改过的版本,否则用默认 */
export function getToolSource(name: string): string {
  const overrides = loadOverrides();
  return overrides[name] ?? ALL_TOOLS[name]?.defaultSource ?? '';
}

export function getDefaultSource(name: string): string {
  return ALL_TOOLS[name]?.defaultSource ?? '';
}

/** 该工具是否被用户改过(用于 UI 显示"已修改"标记) */
export function isToolModified(name: string): boolean {
  const overrides = loadOverrides();
  return name in overrides && overrides[name] !== ALL_TOOLS[name]?.defaultSource;
}

/** 保存用户编辑的源码;若与默认相同则视为还原 */
export function setToolSource(name: string, source: string): void {
  const overrides = loadOverrides();
  if (source === ALL_TOOLS[name]?.defaultSource) {
    delete overrides[name];
  } else {
    overrides[name] = source;
  }
  saveOverrides(overrides);
  compileCache.delete(name); // 让下次调用重新编译
}

/** 还原某工具到默认源码 */
export function resetToolSource(name: string): void {
  const overrides = loadOverrides();
  delete overrides[name];
  saveOverrides(overrides);
  compileCache.delete(name);
}

/** 把一段函数表达式源码编译成可执行函数。编译失败会抛错。 */
function compile(source: string): (args: any) => Promise<string> | string {
  // 用 Function 构造器把"函数表达式"求值出来。全局的 fetch / localStorage / window 都可用。
  const factory = new Function(`"use strict"; return (${source});`);
  const fn = factory();
  if (typeof fn !== 'function') {
    throw new Error('工具代码必须是一个函数表达式,例如:({ x }) => { ... }');
  }
  return fn;
}

/** 校验源码能否编译(供编辑器实时提示语法错误)。返回错误信息或 null。 */
export function validateToolSource(source: string): string | null {
  try {
    compile(source);
    return null;
  } catch (e: any) {
    return e?.message ?? String(e);
  }
}

// 编译结果缓存:key=工具名,避免每次调用都重新编译
const compileCache = new Map<string, (args: any) => Promise<string> | string>();

/** 按名字取出若干工具的 schema(发给模型用) */
export function toolSchemas(names: string[]): ToolSchema[] {
  return names.map((n) => ALL_TOOLS[n].schema);
}

/** 执行一个工具调用(用当前生效的源码 —— 可能是用户改过的) */
export async function runTool(name: string, args: any): Promise<string> {
  if (!ALL_TOOLS[name]) return `错误:未知工具 ${name}`;
  try {
    let fn = compileCache.get(name);
    if (!fn) {
      fn = compile(getToolSource(name));
      compileCache.set(name, fn);
    }
    return await fn(args);
  } catch (e: any) {
    return `工具「${name}」执行出错:${e?.message ?? String(e)}`;
  }
}
