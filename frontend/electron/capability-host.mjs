import { Client } from '@modelcontextprotocol/client';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/client/stdio';
import { isAbsolute } from 'node:path';

const MAX_ARGS = 32;
const MAX_ENV_KEYS = 64;
const MAX_TOOLS = 500;
const MAX_SCHEMA_CHARS = 12_000;
const MAX_RESULT_CHARS = 24_000;

const withTimeout = async (promise, timeoutMs, message) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

export const validateStdioServerConfig = (value) => {
  if (!value || typeof value !== 'object') throw new Error('MCP 配置必须是对象');
  const command = typeof value.command === 'string' ? value.command.trim() : '';
  if (!command || !isAbsolute(command)) {
    throw new Error('MCP command 必须是绝对路径，避免 PATH 劫持');
  }
  const args = Array.isArray(value.args) ? value.args : [];
  if (args.length > MAX_ARGS || args.some((item) => typeof item !== 'string')) {
    throw new Error(`MCP args 必须是不超过 ${MAX_ARGS} 项的字符串数组`);
  }
  if (
    args.some((item) => /(?:^--?[^=]*(?:token|secret|password|credential|api[_-]?key)|^(?:token|secret|password|credential|api[_-]?key)=)/i.test(item))
  ) {
    throw new Error('MCP args 不能携带密钥；凭据必须进入系统安全存储');
  }
  const cwd = typeof value.cwd === 'string' && value.cwd.trim() ? value.cwd.trim() : undefined;
  if (cwd && !isAbsolute(cwd)) throw new Error('MCP cwd 必须是绝对路径');
  const rawEnv = value.env && typeof value.env === 'object' ? value.env : {};
  const envEntries = Object.entries(rawEnv);
  if (
    envEntries.length > MAX_ENV_KEYS ||
    envEntries.some(([key, item]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof item !== 'string')
  ) {
    throw new Error(`MCP env 必须是不超过 ${MAX_ENV_KEYS} 项的字符串键值`);
  }
  if (envEntries.some(([key]) => /(TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL)/i.test(key))) {
    throw new Error('MCP 配置不能内含密钥；凭据必须进入系统安全存储');
  }
  return {
    command,
    args: [...args],
    ...(cwd ? { cwd } : {}),
    env: Object.fromEntries(envEntries),
  };
};

export const classifyDesktopToolRisk = (name) => {
  const normalized = String(name || '').toLowerCase();
  if (/(eval|execute|run[_-]?script|shell|command|terminal)/.test(normalized)) return 'script';
  if (/(delete|remove|clear|purge|overwrite|replace|close|quit)/.test(normalized)) return 'destructive';
  if (/^(get|list|read|inspect|describe|search|find|preview|screenshot|status|version|measure|analy[sz]e)/.test(normalized)) return 'read';
  return 'write';
};

const sanitizeSchema = (schema) => {
  try {
    const encoded = JSON.stringify(schema || { type: 'object' });
    if (encoded.length > MAX_SCHEMA_CHARS) return { type: 'object', description: 'Schema omitted: too large' };
    return JSON.parse(encoded);
  } catch {
    return { type: 'object' };
  }
};

const sanitizeTools = (tools) =>
  (Array.isArray(tools) ? tools : []).slice(0, MAX_TOOLS).map((tool) => ({
    name: typeof tool?.name === 'string' ? tool.name.slice(0, 160) : 'unknown',
    description:
      typeof tool?.description === 'string' ? tool.description.slice(0, 800) : '',
    inputSchema: sanitizeSchema(tool?.inputSchema),
    risk: classifyDesktopToolRisk(tool?.name),
  }));

const sanitizeToolResult = (result) => {
  const textParts = [];
  let omittedContentCount = 0;
  for (const item of Array.isArray(result?.content) ? result.content : []) {
    if (item?.type === 'text' && typeof item.text === 'string') {
      textParts.push(item.text);
    } else {
      omittedContentCount += 1;
    }
  }
  const joined = textParts.join('\n');
  const safeText = joined
    .replace(/\b(?:data|blob):[^\s"'<>]+/gi, '[inline asset omitted]')
    .replace(/[A-Za-z0-9+/]{512,}={0,2}/g, '[base64 omitted]');
  return {
    isError: Boolean(result?.isError),
    text: safeText.slice(0, MAX_RESULT_CHARS),
    truncated: safeText.length > MAX_RESULT_CHARS,
    omittedContentCount,
  };
};

export class DesktopCapabilityHost {
  constructor(options = {}) {
    this.connections = new Map();
    this.connectTimeoutMs = options.connectTimeoutMs || 45_000;
  }

  getStatus(connectorId, configured = false) {
    const connection = this.connections.get(connectorId);
    if (!connection) {
      return {
        transport: configured ? 'configured' : 'not-configured',
        toolCount: 0,
        error: null,
      };
    }
    return {
      transport: connection.status,
      toolCount: connection.tools.length,
      error: connection.error,
    };
  }

  listTools(connectorId) {
    return this.connections.get(connectorId)?.tools || [];
  }

  async callTool(connectorId, toolName, args) {
    const connection = this.connections.get(connectorId);
    if (!connection || connection.status !== 'connected') throw new Error('MCP 尚未连接');
    const tool = connection.tools.find((item) => item.name === toolName);
    if (!tool) throw new Error('MCP 工具不存在或工具清单已变化');
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      throw new Error('MCP 工具参数必须是对象');
    }
    const result = await withTimeout(
      connection.client.callTool({ name: toolName, arguments: args }),
      120_000,
      'MCP 工具调用超时'
    );
    return { tool, result: sanitizeToolResult(result) };
  }

  async connect(connectorId, rawConfig) {
    const config = validateStdioServerConfig(rawConfig);
    await this.disconnect(connectorId);

    const client = new Client(
      { name: 'tanva-desktop', version: '0.1.0' },
      { versionNegotiation: { mode: 'legacy' } }
    );
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      ...(config.cwd ? { cwd: config.cwd } : {}),
      env: { ...getDefaultEnvironment(), ...config.env },
      stderr: 'pipe',
      maxBufferSize: 10 * 1024 * 1024,
    });
    const connection = {
      client,
      transport,
      status: 'connecting',
      tools: [],
      error: null,
    };
    this.connections.set(connectorId, connection);

    try {
      await withTimeout(
        client.connect(transport),
        this.connectTimeoutMs,
        'MCP 连接超时'
      );
      const result = await withTimeout(
        client.listTools(),
        Math.min(this.connectTimeoutMs, 30_000),
        'MCP 工具列表读取超时'
      );
      connection.tools = sanitizeTools(result?.tools);
      connection.status = 'connected';
      return this.getStatus(connectorId, true);
    } catch (error) {
      connection.status = 'error';
      connection.error = error instanceof Error ? error.message.slice(0, 500) : 'MCP 连接失败';
      try { await client.close(); } catch {}
      return this.getStatus(connectorId, true);
    }
  }

  async disconnect(connectorId) {
    const connection = this.connections.get(connectorId);
    if (!connection) return;
    this.connections.delete(connectorId);
    try { await connection.client.close(); } catch {}
  }

  async disconnectAll() {
    await Promise.allSettled(
      Array.from(this.connections.keys()).map((connectorId) => this.disconnect(connectorId))
    );
  }
}
