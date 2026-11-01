export const VERSION = '0.2.0';

export interface TanvaMcpConfig {
  /** Public origin users/agents see, e.g. https://tanvas.cn. Used for OAuth metadata and the MCP resource id. */
  publicOrigin: string;
  /** Origin this service calls the Tanva API on (on the same box: http://127.0.0.1:4000 to skip nginx). */
  apiOrigin: string;
  /** Path the MCP endpoint is mounted at (behind nginx). */
  mcpPath: string;
  host: string;
  port: number;
  /** Per upstream API call; WorkBuddy expects tool responses within 30s. */
  apiTimeoutMs: number;
}

const origin = (name: string, raw: string, allowHttpAnyHost = false) => {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error(`${name} 无效：${raw}`); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (loopback || allowHttpAnyHost))) {
    throw new Error(`${name} 必须是 https（本机地址可用 http）`);
  }
  return url.origin;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): TanvaMcpConfig {
  const publicOrigin = origin('TANVA_PUBLIC_ORIGIN', env.TANVA_PUBLIC_ORIGIN || 'https://tanvas.cn');
  const mcpPath = (env.TANVA_MCP_PATH || '/mcp').replace(/\/+$/, '') || '/mcp';
  if (!mcpPath.startsWith('/')) throw new Error('TANVA_MCP_PATH 必须以 / 开头');
  return {
    publicOrigin,
    apiOrigin: origin('TANVA_API_ORIGIN', env.TANVA_API_ORIGIN || publicOrigin, env.TANVA_API_ALLOW_HTTP === 'true'),
    mcpPath,
    host: env.HOST || '127.0.0.1',
    port: Number(env.PORT || 3920),
    apiTimeoutMs: Math.min(Number(env.TANVA_API_TIMEOUT_MS || 25_000), 28_000),
  };
}

export const resourceUrl = (config: TanvaMcpConfig) => `${config.publicOrigin}${config.mcpPath}`;

export function protectedResourceMetadata(config: TanvaMcpConfig) {
  return {
    resource: resourceUrl(config),
    authorization_servers: [config.publicOrigin],
    bearer_methods_supported: ['header'],
    scopes_supported: ['tanva'],
    resource_name: 'Tanva',
    resource_documentation: `${config.publicOrigin}/api/docs`,
  };
}

/** Mirrors backend OAuthService.metadata(); the authorization server lives in the Tanva backend. */
export function authorizationServerMetadata(config: TanvaMcpConfig) {
  const o = config.publicOrigin;
  return {
    issuer: o,
    authorization_endpoint: `${o}/api/oauth/authorize`,
    token_endpoint: `${o}/api/oauth/token`,
    registration_endpoint: `${o}/api/oauth/register`,
    revocation_endpoint: `${o}/api/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['tanva'],
  };
}
