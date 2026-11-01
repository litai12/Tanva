// End-to-end: real MCP HTTP server + official MCP SDK client, against a fake Tanva API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { discoverOAuthProtectedResourceMetadata, discoverAuthorizationServerMetadata } from '@modelcontextprotocol/sdk/client/auth.js';
import { loadConfig } from '../dist/config.js';
import { createMcpHttpServer } from '../dist/server.js';

const jwt = (claims) => `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const VALID = jwt({ sub: 'u1', exp: Math.floor(Date.now() / 1000) + 3600 });
const REVOKED = jwt({ sub: 'u1', exp: Math.floor(Date.now() / 1000) + 3600, jti: 'revoked' });
const EXPIRED = jwt({ sub: 'u1', exp: Math.floor(Date.now() / 1000) - 10 });
const LATE = jwt({ sub: 'u1', exp: Math.floor(Date.now() / 1000) + 3600, jti: 'late' });
let lateRevoked = false;

const seen = [];
let taskPolls = 0;
let jobPolls = 0;
const fakeApi = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let body = '';
  for await (const chunk of req) body += chunk;
  seen.push({ method: req.method, path: url.pathname, search: url.search, auth: req.headers.authorization, team: req.headers['x-team-id'], body });
  const send = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
  if (url.pathname === '/api/docs-json') return send(200, {
    paths: {
      '/api/projects': { get: { summary: 'list projects', tags: ['projects'] }, post: { tags: ['projects'], requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateProjectDto' } } } } } },
      '/api/admin/users': { get: { summary: 'admin only' } },
    },
    components: { schemas: { CreateProjectDto: { type: 'object', properties: { name: { type: 'string' } } } } },
  });
  if (req.headers.authorization !== `Bearer ${VALID}` && !(req.headers.authorization === `Bearer ${LATE}` && !lateRevoked)) return send(401, { message: 'Unauthorized' });
  if (url.pathname === '/api/auth/me') return send(200, { user: { id: 'u1', name: 'Fixture' } });
  if (url.pathname === '/api/credits/balance') return send(200, { balance: 123 });
  if (url.pathname === '/api/projects') return send(200, [{ id: 'p1', name: 'Demo' }]);
  if (url.pathname === '/api/ai/generate-image-async') return send(201, { taskId: 't1', status: 'queued' });
  if (url.pathname === '/api/ai/image-task/t1') { taskPolls += 1; return send(200, taskPolls >= 2 ? { status: 'succeeded', imageUrl: 'https://cdn.example/t1.png' } : { status: 'processing' }); }
  if (url.pathname === '/api/projects/p1' && req.method === 'DELETE') return send(403, { message: '无权限删除' });
  if (url.pathname === '/api/video-productions/models') return send(200, { plan: { models: ['m1'] }, image: [{ modelKey: 'nano-banana-pro' }], video: [{ modelKey: 'seedance-2.0', available: true }], defaults: { videoModel: 'seedance-2.0' } });
  if (url.pathname === '/api/video-productions' && req.method === 'POST') {
    const b = JSON.parse(body || '{}');
    if (b.mode === 'film' && !b.story) return send(400, { message: '一键成片需要提供 story（故事或章节原文）' });
    return send(202, { jobId: 'job1', status: 'processing', stage: b.mode === 'single' ? 'producing' : 'planning' });
  }
  if (url.pathname === '/api/video-productions/job1') { jobPolls += 1; return send(200, jobPolls >= 2 ? { jobId: 'job1', status: 'succeeded', stage: 'succeeded', finalVideoUrl: 'https://cdn.example/final.mp4' } : { jobId: 'job1', status: 'processing', stage: 'producing' }); }
  if (url.pathname === '/api/video-productions/job1/retry') return send(409, { message: '只有失败的任务可以重试' });
  return send(404, { message: 'not found' });
});

let mcp, mcpUrl, apiOrigin;
const listen = (server) => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

before(async () => {
  apiOrigin = `http://127.0.0.1:${await listen(fakeApi)}`;
  mcp = createMcpHttpServer({ ...loadConfig({ TANVA_API_ORIGIN: apiOrigin }), port: 0 });
  const port = await listen(mcp);
  mcpUrl = `http://127.0.0.1:${port}/mcp`;
});
after(() => { mcp.close(); fakeApi.close(); });

const connect = async (token = VALID) => {
  const client = new Client({ name: 'e2e', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  return client;
};
const textOf = (result) => result.content.map(c => c.text).join('\n');

test('unauthenticated and expired requests get a 401 OAuth challenge', async () => {
  for (const token of [undefined, EXPIRED, REVOKED]) {
    const res = await fetch(mcpUrl, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } }) });
    assert.equal(res.status, 401);
    const challenge = res.headers.get('www-authenticate');
    assert.match(challenge, /resource_metadata="https:\/\/tanvas\.cn\/\.well-known\/oauth-protected-resource\/mcp"/);
    if (token) assert.match(challenge, /invalid_token/);
  }
});

test('OAuth discovery documents validate with the MCP SDK', async () => {
  const base = mcpUrl.replace('/mcp', '');
  const prm = await discoverOAuthProtectedResourceMetadata(new URL(mcpUrl), { resourceMetadataUrl: new URL(`${base}/.well-known/oauth-protected-resource/mcp`) });
  assert.equal(prm.resource, 'https://tanvas.cn/mcp');
  assert.deepEqual(prm.authorization_servers, ['https://tanvas.cn']);
  const asm = await discoverAuthorizationServerMetadata(new URL(base));
  assert.equal(asm.issuer, 'https://tanvas.cn');
  assert.equal(asm.registration_endpoint, 'https://tanvas.cn/api/oauth/register');
  assert.deepEqual(asm.code_challenge_methods_supported, ['S256']);
  assert.equal((await fetch(mcpUrl, { method: 'GET' })).status, 405);
});

test('tools list and curated tools act as the user', async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  const names = tools.map(t => t.name).sort();
  assert.deepEqual(names, ['tanva_api_request', 'tanva_credits_balance', 'tanva_describe_endpoint', 'tanva_generate_image', 'tanva_generate_video', 'tanva_get_image_task', 'tanva_get_project',
    'tanva_list_endpoints', 'tanva_list_models', 'tanva_list_projects', 'tanva_list_video_jobs', 'tanva_make_video', 'tanva_video_cancel', 'tanva_video_job', 'tanva_video_produce', 'tanva_video_retry', 'tanva_whoami']);
  assert.equal(tools.find(t => t.name === 'tanva_api_request').annotations.destructiveHint, true);
  assert.match(textOf(await client.callTool({ name: 'tanva_whoami', arguments: {} })), /Fixture/);
  assert.match(textOf(await client.callTool({ name: 'tanva_credits_balance', arguments: {} })), /123/);
  assert.match(textOf(await client.callTool({ name: 'tanva_list_projects', arguments: { scope: 'personal' } })), /Demo/);
  assert(seen.some(r => r.path === '/api/projects' && r.search === '?scope=personal' && r.auth === `Bearer ${VALID}`));
  await client.close();
});

test('image generation submits async task and polls to completion', async () => {
  const client = await connect();
  const result = await client.callTool({ name: 'tanva_generate_image', arguments: { prompt: 'a cat', aspectRatio: '1:1', waitSeconds: 10 } });
  assert.equal(result.isError, false);
  assert.match(textOf(result), /https:\/\/cdn\.example\/t1\.png/);
  assert.equal(JSON.parse(seen.find(r => r.path === '/api/ai/generate-image-async').body).prompt, 'a cat');
  await client.close();
});

test('generic api_request: full access, readable errors, path guard', async () => {
  const client = await connect();
  const del = await client.callTool({ name: 'tanva_api_request', arguments: { method: 'DELETE', path: '/api/projects/p1', teamId: 'team9' } });
  assert.equal(del.isError, true); assert.match(textOf(del), /无权限删除/);
  assert(seen.some(r => r.method === 'DELETE' && r.path === '/api/projects/p1' && r.team === 'team9'));
  for (const path of ['//evil.example/api/x', 'https://evil.example/api/x', '/api/../etc', '/api/oauth/token', '/api/auth/refresh', '/api/auth/desktop/session']) {
    const r = await client.callTool({ name: 'tanva_api_request', arguments: { method: 'POST', path } });
    assert.equal(r.isError, true, path);
  }
  assert(!seen.some(r => r.path.startsWith('/api/oauth') || r.path === '/api/auth/refresh'));
  const list = textOf(await client.callTool({ name: 'tanva_list_endpoints', arguments: { keyword: 'project' } }));
  assert.match(list, /GET \/api\/projects/); assert.doesNotMatch(list, /admin/);
  const described = textOf(await client.callTool({ name: 'tanva_describe_endpoint', arguments: { method: 'POST', path: '/api/projects' } }));
  assert.match(described, /"name"/);
  await client.close();
});

test('revocation takes effect on the very next MCP request (no verification cache)', async () => {
  const client = await connect(LATE);
  assert.equal((await client.listTools()).tools.length, 17);
  await client.close();
  lateRevoked = true;
  const res = await fetch(mcpUrl, { method: 'POST', headers: { authorization: `Bearer ${LATE}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) });
  assert.equal(res.status, 401);
  assert.match(res.headers.get('www-authenticate'), /invalid_token/);
});

test('one-click video: models, submit, poll to final video, readable errors', async () => {
  const client = await connect();
  assert.match(textOf(await client.callTool({ name: 'tanva_list_models', arguments: { category: 'video' } })), /seedance-2\.0/);
  const bad = await client.callTool({ name: 'tanva_make_video', arguments: { mode: 'film' } });
  assert.equal(bad.isError, true); assert.match(textOf(bad), /story/);
  jobPolls = 0;
  const made = await client.callTool({ name: 'tanva_make_video', arguments: { mode: 'film', story: '故事', videoModel: 'seedance-2.0', waitSeconds: 10 } });
  assert.equal(made.isError, false); assert.match(textOf(made), /final\.mp4/); assert.match(textOf(made), /以视频形式发给用户/);
  const sent = JSON.parse(seen.filter(r => r.path === '/api/video-productions' && r.method === 'POST').at(-1).body);
  assert.deepEqual([sent.mode, sent.videoModel, sent.waitSeconds], ['film', 'seedance-2.0', undefined]);
  jobPolls = 0;
  await client.callTool({ name: 'tanva_generate_video', arguments: { prompt: '海浪', model: 'seedance-2.5', durationSeconds: 20, waitSeconds: 0 } });
  const single = JSON.parse(seen.filter(r => r.path === '/api/video-productions' && r.method === 'POST').at(-1).body);
  assert.deepEqual([single.mode, single.videoModel, single.durationSeconds, single.model], ['single', 'seedance-2.5', 20, undefined]);
  assert.match(textOf(await client.callTool({ name: 'tanva_video_job', arguments: { jobId: 'job1', waitSeconds: 0 } })), /不要重复提交/);
  const retry = await client.callTool({ name: 'tanva_video_retry', arguments: { jobId: 'job1' } });
  assert.equal(retry.isError, true); assert.match(textOf(retry), /只有失败/);
  await client.close();
});
