import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { authorizationServerMetadata, protectedResourceMetadata, resourceUrl, VERSION, type TanvaMcpConfig } from './config.js';
import { TanvaApi, UpstreamUnauthorizedError } from './tanva-api.js';
import { registerTools } from './tools.js';

const MAX_BODY = 4 * 1024 * 1024;
const INSTRUCTIONS = `Tanvas（tanvas.cn）是 AI 设计画布平台。本服务以用户 OAuth 授权的身份访问其 Tanvas 账号，拥有与网页登录相同的全部权限。
- 常用操作优先使用内置工具：tanva_whoami / tanva_credits_balance / tanva_list_projects / tanva_get_project / tanva_generate_image。
- 视频：一键成片 / 爆款复刻用 tanva_make_video，单段视频用 tanva_generate_video，之后用 tanva_video_job 轮询直到出片；指定模型前先 tanva_list_models。整条片约 5–15 分钟，轮询即可，不要重复提交。
- 其它能力：tanva_list_endpoints 搜索接口 → tanva_describe_endpoint 看参数 → tanva_api_request 调用。
- 删除数据、付费、分享、批量消耗积分前必须先征得用户明确同意。生成类任务不要重复提交。`;

// ------------------------------------------------------------ token check

interface TokenInfo { userId: string; exp: number }

function decodeJwt(token: string): { sub?: string; exp?: number } | null {
  try { return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')); } catch { return null; }
}

/**
 * Local expiry pre-check, then a live upstream check on every request (no cache):
 * a revoked / banned / expired grant yields HTTP 401 on the very next MCP request,
 * which makes MCP clients refresh or re-authorize instead of seeing a tool error.
 * The upstream call goes over loopback (TANVA_API_ORIGIN) and is cheap.
 */
async function verifyToken(config: TanvaMcpConfig, token: string): Promise<TokenInfo | null> {
  const claims = decodeJwt(token);
  if (!claims?.exp || claims.exp * 1000 <= Date.now() + 5_000) return null;
  const res = await fetch(new URL('/api/auth/me', config.apiOrigin), {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'user-agent': `tanva-mcp/${VERSION}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`Tanvas 鉴权服务异常（HTTP ${res.status}）`);
  const body = (await res.json()) as { user?: { id?: string } };
  return { userId: body.user?.id || claims.sub || '', exp: claims.exp * 1000 };
}

// ---------------------------------------------------------------- helpers

function setCors(res: ServerResponse) {
  // Bearer-only (no cookies), so a wildcard origin is safe and lets browser-based MCP clients connect.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID');
  res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id');
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function unauthorized(res: ServerResponse, config: TanvaMcpConfig, invalid: boolean) {
  const metadataUrl = `${config.publicOrigin}/.well-known/oauth-protected-resource${config.mcpPath}`;
  const challenge = `Bearer realm="tanva", resource_metadata="${metadataUrl}"${invalid ? ', error="invalid_token", error_description="token expired or revoked"' : ''}`;
  json(res, 401, { jsonrpc: '2.0', error: { code: -32001, message: '需要授权 Tanvas 账号' }, id: null }, { 'www-authenticate': challenge });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw Object.assign(new Error('请求体过大'), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return undefined;
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error('请求体不是合法 JSON'), { status: 400 }); }
}

// ----------------------------------------------------------------- server

export function createMcpHttpServer(config: TanvaMcpConfig): Server {
  const prm = protectedResourceMetadata(config);
  const asm = authorizationServerMetadata(config);

  return createServer(async (req, res) => {
    setCors(res);
    const url = new URL(req.url || '/', 'http://local');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }

      if (req.method === 'GET' && (path === '/.well-known/oauth-protected-resource' || path === `/.well-known/oauth-protected-resource${config.mcpPath}`)) {
        return json(res, 200, prm, { 'cache-control': 'public, max-age=3600' });
      }
      if (req.method === 'GET' && (path === '/.well-known/oauth-authorization-server' || path === `/.well-known/oauth-authorization-server${config.mcpPath}`)) {
        return json(res, 200, asm, { 'cache-control': 'public, max-age=3600' });
      }
      if (req.method === 'GET' && path === `${config.mcpPath}/healthz`) return json(res, 200, { ok: true, version: VERSION });

      if (path !== config.mcpPath) return json(res, 404, { error: 'not_found' });
      // Stateless server: no standalone SSE stream and no sessions to delete.
      if (req.method !== 'POST') return json(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }, { allow: 'POST, OPTIONS' });

      const header = req.headers.authorization || '';
      const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
      if (!token) return unauthorized(res, config, false);
      const info = await verifyToken(config, token);
      if (!info) return unauthorized(res, config, true);

      const body = await readJson(req);
      const server = new McpServer({ name: 'tanva', title: 'Tanvas', version: VERSION }, { instructions: INSTRUCTIONS });
      registerTools(server, { api: new TanvaApi(config.apiOrigin, token, config.apiTimeoutMs), apiOrigin: config.apiOrigin, timeoutMs: config.apiTimeoutMs });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => { void transport.close(); void server.close(); });
      await server.connect(transport);
      (req as IncomingMessage & { auth?: unknown }).auth = { token, clientId: 'tanva-oauth', scopes: ['tanva'], expiresAt: Math.floor(info.exp / 1000), resource: new URL(resourceUrl(config)), extra: { userId: info.userId } };
      await transport.handleRequest(req, res, body);
    } catch (error) {
      if (error instanceof UpstreamUnauthorizedError) return unauthorized(res, config, true);
      const status = (error as { status?: number }).status || 500;
      if (!res.headersSent) json(res, status, { jsonrpc: '2.0', error: { code: -32603, message: status === 500 ? '服务内部错误' : (error as Error).message }, id: null });
      if (status === 500) console.error('[tanva-mcp]', error);
    }
  });
}
