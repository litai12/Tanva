import { VERSION } from './config.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiRequest {
  method: HttpMethod;
  path: string;
  query?: Record<string, string | number | boolean>;
  body?: unknown;
  teamId?: string;
}

export interface ApiResponse {
  status: number;
  ok: boolean;
  contentType: string;
  /** Parsed JSON for JSON responses, text otherwise, or a note for binary bodies. */
  data: unknown;
}

export class UpstreamUnauthorizedError extends Error {}

const USER_AGENT = `tanva-mcp/${VERSION}`;

/** Normalizes an agent-supplied path to a Tanva `/api/*` URL pinned to `apiOrigin`. */
export function resolveApiUrl(apiOrigin: string, path: string, query?: ApiRequest['query']): URL {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    throw new Error('path 必须是以 / 开头的站内路径，例如 /api/projects');
  }
  const url = new URL(path.startsWith('/api/') ? path : `/api${path}`, apiOrigin);
  if (url.origin !== apiOrigin || !url.pathname.startsWith('/api/')) throw new Error('只允许访问 Tanva 的 /api/* 接口');
  // The MCP token must never be used to mint further OAuth grants or sessions.
  if (/^\/api\/(oauth|auth\/(desktop|refresh|logout|login|register))(\/|$)/.test(url.pathname)) {
    throw new Error('该接口不允许通过 MCP 调用');
  }
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, String(value));
  return url;
}

/** Thin client for the Tanva REST API acting as the OAuth-authorized user. */
export class TanvaApi {
  constructor(private readonly apiOrigin: string, private readonly accessToken: string, private readonly timeoutMs: number) {}

  async request(input: ApiRequest): Promise<ApiResponse> {
    const url = resolveApiUrl(this.apiOrigin, input.path, input.query);
    const headers: Record<string, string> = {
      accept: 'application/json, */*',
      authorization: `Bearer ${this.accessToken}`,
      'user-agent': USER_AGENT,
    };
    if (input.teamId) headers['x-team-id'] = input.teamId;
    let body: string | undefined;
    if (input.body !== undefined && input.method !== 'GET') {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(input.body);
    }
    let response: Response;
    try {
      response = await fetch(url, { method: input.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      if ((error as Error).name === 'TimeoutError') {
        throw new Error(`Tanva 接口 ${input.method} ${url.pathname} 超过 ${Math.round(this.timeoutMs / 1000)} 秒未响应。耗时操作请使用异步接口（如 *-async + 任务查询）。`);
      }
      throw new Error(`无法连接 Tanva 接口：${(error as Error).message}`);
    }
    if (response.status === 401) throw new UpstreamUnauthorizedError('Tanva 授权已失效，请重新连接 Tanva');
    return parseResponse(response);
  }
}

export async function fetchPublicJson(apiOrigin: string, path: string, timeoutMs: number): Promise<unknown> {
  const response = await fetch(new URL(path, apiOrigin), { headers: { accept: 'application/json', 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`获取 ${path} 失败（HTTP ${response.status}）`);
  return response.json();
}

async function parseResponse(response: Response): Promise<ApiResponse> {
  const contentType = response.headers.get('content-type') || '';
  let data: unknown;
  if (contentType.includes('json')) {
    const text = await response.text();
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  } else if (contentType === '' || /^(text\/|application\/(xml|javascript))/.test(contentType)) {
    data = await response.text();
  } else {
    data = `[二进制响应 ${contentType}，${(await response.arrayBuffer()).byteLength} 字节，未返回内容]`;
  }
  return { status: response.status, ok: response.ok, contentType, data };
}
