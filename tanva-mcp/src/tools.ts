import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { fetchPublicJson, TanvaApi, type ApiResponse, type HttpMethod } from './tanva-api.js';

const MAX_TEXT = 24_000;

const text = (value: unknown, isError = false): CallToolResult => {
  let out = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (out.length > MAX_TEXT) out = `${out.slice(0, MAX_TEXT)}\n…（已截断，原始长度 ${out.length} 字符；可用 query 参数分页或缩小范围）`;
  return { content: [{ type: 'text', text: out }], isError };
};

/** Turns an API response into a tool result; non-2xx become readable tool errors. */
const fromResponse = (res: ApiResponse): CallToolResult => {
  if (res.ok) return text(res.data);
  const message = typeof res.data === 'object' && res.data && 'message' in res.data ? (res.data as { message: unknown }).message : res.data;
  return text({ error: true, status: res.status, message }, true);
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ------------------------------------------------------------ OpenAPI cache

interface OpenApiDoc { paths: Record<string, Record<string, OpenApiOperation>>; components?: { schemas?: Record<string, unknown> } }
interface OpenApiOperation { summary?: string; description?: string; tags?: string[]; parameters?: unknown[]; requestBody?: { content?: Record<string, { schema?: unknown }> } }
let openApiCache: { at: number; doc: OpenApiDoc } | null = null;
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const HIDDEN_PREFIXES = ['/api/admin', '/api/internal', '/api/oauth', '/api/auth/desktop', '/api/ai/internal'];

async function openApi(apiOrigin: string, timeoutMs: number): Promise<OpenApiDoc> {
  if (openApiCache && Date.now() - openApiCache.at < 10 * 60_000) return openApiCache.doc;
  const doc = (await fetchPublicJson(apiOrigin, '/api/docs-json', timeoutMs)) as OpenApiDoc;
  openApiCache = { at: Date.now(), doc };
  return doc;
}

function resolveRefs(node: unknown, doc: OpenApiDoc, depth = 0): unknown {
  if (depth > 4 || node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(item => resolveRefs(item, doc, depth + 1));
  const ref = (node as { $ref?: string }).$ref;
  if (typeof ref === 'string' && ref.startsWith('#/components/schemas/')) {
    return resolveRefs(doc.components?.schemas?.[ref.slice('#/components/schemas/'.length)] ?? node, doc, depth + 1);
  }
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, resolveRefs(v, doc, depth + 1)]));
}

// ------------------------------------------------------------------ tools

export interface ToolContext {
  api: TanvaApi;
  apiOrigin: string;
  timeoutMs: number;
}

export function registerTools(server: McpServer, ctx: ToolContext) {
  const { api } = ctx;

  server.registerTool('tanva_whoami', {
    title: '当前账号',
    description: '返回当前授权的 Tanva 账号信息（id、昵称、手机号、角色等）。用于确认以哪个账号在操作。',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => fromResponse(await api.request({ method: 'GET', path: '/api/auth/me' })));

  server.registerTool('tanva_credits_balance', {
    title: '积分余额',
    description: '查询当前账号的积分余额与明细（可用积分、即将过期积分等）。调用 AI 生成前可先确认余额。',
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async () => fromResponse(await api.request({ method: 'GET', path: '/api/credits/balance' })));

  server.registerTool('tanva_list_projects', {
    title: '项目列表',
    description: '列出当前账号可访问的 Tanva 项目（画布）。scope=personal 仅个人；scope=team 需配合 teamId 仅团队；不传返回个人 + 团队可访问项目。',
    inputSchema: {
      scope: z.enum(['personal', 'team']).optional().describe('personal | team；不传为全部可访问'),
      teamId: z.string().optional().describe('团队 ID（scope=team 时必填）'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ scope, teamId }) => fromResponse(await api.request({
    method: 'GET', path: '/api/projects', query: { ...(scope ? { scope } : {}), ...(teamId ? { teamId } : {}) }, teamId,
  })));

  server.registerTool('tanva_get_project', {
    title: '项目详情',
    description: '获取单个项目的元信息；includeContent=true 时同时返回画布设计 JSON（可能很大，会被截断）。',
    inputSchema: {
      projectId: z.string().min(1).describe('项目 ID'),
      includeContent: z.boolean().optional().describe('是否同时返回画布内容，默认 false'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ projectId, includeContent }) => {
    const id = encodeURIComponent(projectId);
    const meta = await api.request({ method: 'GET', path: `/api/projects/${id}` });
    if (!meta.ok || !includeContent) return fromResponse(meta);
    const content = await api.request({ method: 'GET', path: `/api/projects/${id}/content` });
    return content.ok ? text({ project: meta.data, content: content.data }) : fromResponse(content);
  });

  const pollImageTask = async (taskId: string, waitMs: number): Promise<CallToolResult> => {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const res = await api.request({ method: 'GET', path: `/api/ai/image-task/${encodeURIComponent(taskId)}` });
      if (!res.ok) return fromResponse(res);
      const task = res.data as { status?: string };
      const finished = task.status === 'succeeded' || task.status === 'failed' || task.status === 'cancelled';
      if (finished || Date.now() + 2_500 > deadline) {
        return text(finished ? { taskId, ...task } : { taskId, ...task, hint: '任务仍在进行中，请稍后调用 tanva_get_image_task 继续查询（不要重复提交生成，以免重复扣积分）。' }, task.status === 'failed');
      }
      await sleep(2_500);
    }
  };

  server.registerTool('tanva_generate_image', {
    title: 'AI 生成图片',
    description: '用 Tanva 的 AI 生成图片（会消耗当前账号积分）。提交异步任务后最多等待 waitSeconds 秒；未完成会返回 taskId，再用 tanva_get_image_task 查询结果。参考图 imageUrls 必须是可公开访问的 http(s) 地址。',
    inputSchema: {
      prompt: z.string().min(1).max(8000).describe('图片描述提示词'),
      aiProvider: z.string().optional().describe('生图通道，如 gemini-pro、banana-3.1、nano2、seedream5、midjourney；不传用默认'),
      model: z.string().optional().describe('具体模型名（可选）'),
      aspectRatio: z.enum(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9', '2:1', '1:2', '9:21', '4:1', '1:4', '8:1', '1:8']).optional().describe('画面比例'),
      imageSize: z.string().optional().describe('分辨率档位，如 1K / 2K / 4K'),
      imageUrls: z.array(z.string().url()).max(10).optional().describe('参考图 URL 列表（可选）'),
      waitSeconds: z.number().int().min(0).max(20).optional().describe('提交后同步等待秒数，默认 18，最大 20'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ waitSeconds, ...dto }) => {
    const created = await api.request({ method: 'POST', path: '/api/ai/generate-image-async', body: dto });
    if (!created.ok) return fromResponse(created);
    const { taskId } = created.data as { taskId?: string };
    if (!taskId) return text({ error: true, message: '服务端未返回 taskId', response: created.data }, true);
    return pollImageTask(taskId, (waitSeconds ?? 18) * 1000);
  });

  server.registerTool('tanva_get_image_task', {
    title: '查询生图任务',
    description: '查询 tanva_generate_image 返回的 taskId 的状态与结果图片地址（imageUrl）。可等待最多 waitSeconds 秒。',
    inputSchema: {
      taskId: z.string().min(1),
      waitSeconds: z.number().int().min(0).max(20).optional().describe('最多等待秒数，默认 15'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ taskId, waitSeconds }) => pollImageTask(taskId, (waitSeconds ?? 15) * 1000));

  server.registerTool('tanva_list_endpoints', {
    title: '查找 Tanva 接口',
    description: '搜索 Tanva 全部开放 REST 接口（来自线上 OpenAPI 文档）。当内置工具不够用时，先用本工具找到接口，再用 tanva_describe_endpoint 看参数，最后用 tanva_api_request 调用。',
    inputSchema: {
      keyword: z.string().optional().describe('按路径 / 摘要 / 标签模糊匹配，如 project、video、credits、template'),
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
      limit: z.number().int().min(1).max(200).optional().describe('最多返回条数，默认 60'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ keyword, method, limit }) => {
    const doc = await openApi(ctx.apiOrigin, ctx.timeoutMs);
    const kw = keyword?.toLowerCase();
    const rows: string[] = [];
    for (const [path, ops] of Object.entries(doc.paths)) {
      if (HIDDEN_PREFIXES.some(prefix => path.startsWith(prefix))) continue;
      for (const [m, op] of Object.entries(ops)) {
        if (!HTTP_METHODS.includes(m) || (method && m.toUpperCase() !== method)) continue;
        const line = `${m.toUpperCase()} ${path}${op.summary ? ` — ${op.summary}` : ''}${op.tags?.length ? ` [${op.tags.join(',')}]` : ''}`;
        if (kw && !line.toLowerCase().includes(kw)) continue;
        rows.push(line);
      }
    }
    const max = limit ?? 60;
    return text(rows.length ? `${rows.slice(0, max).join('\n')}${rows.length > max ? `\n…共 ${rows.length} 个，已显示 ${max} 个，请缩小 keyword` : ''}` : '没有匹配的接口');
  });

  server.registerTool('tanva_describe_endpoint', {
    title: '接口参数说明',
    description: '查看某个 Tanva 接口的参数与请求体结构（OpenAPI）。',
    inputSchema: {
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
      path: z.string().describe('OpenAPI 中的路径，如 /api/projects/{id}'),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ method, path }) => {
    const doc = await openApi(ctx.apiOrigin, ctx.timeoutMs);
    const op = doc.paths[path]?.[method.toLowerCase()];
    if (!op) return text(`未找到 ${method} ${path}，请先用 tanva_list_endpoints 搜索`, true);
    return text({
      method, path, summary: op.summary, description: op.description, tags: op.tags,
      parameters: resolveRefs(op.parameters, doc),
      requestBody: resolveRefs(op.requestBody?.content?.['application/json']?.schema, doc),
    });
  });

  server.registerTool('tanva_api_request', {
    title: '调用任意 Tanva 接口',
    description: '以当前授权用户身份调用任意 Tanva /api/* 接口（拥有与网页登录相同的全部权限）。路径参数请直接填入 path（如 /api/projects/abc123）。删除、付费、消耗积分、分享等操作前务必先向用户确认。耗时的生成类接口请优先使用 *-async 版本并轮询任务状态。',
    inputSchema: {
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
      path: z.string().min(1).describe('以 /api/ 开头的路径，可带查询串'),
      query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional().describe('查询参数'),
      body: z.unknown().optional().describe('JSON 请求体（GET 忽略）'),
      teamId: z.string().optional().describe('以团队身份操作时传团队 ID（对应 x-team-id 请求头）'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, async ({ method, path, query, body, teamId }) => fromResponse(await api.request({ method: method as HttpMethod, path, query, body, teamId })));
}
