const normalizeName = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/mcp$/i, '')
  .replace(/[^a-z0-9]+/g, '');

const protocolFromType = (value) => {
  const type = String(value || '').trim().toLowerCase();
  if (type === 'sse') return 'sse';
  if (type === 'streamable-http' || type === 'streamable_http' || type === 'http') return 'streamable-http';
  return 'stdio';
};

/** Parse JSON exported by the reference Windows app, including UTF-8 BOM files. */
export const parseJsonDocument = (raw) => {
  if (typeof raw !== 'string') throw new Error('MCP 配置文件不是文本');
  return JSON.parse(raw.replace(/^\uFEFF/, ''));
};

/** Convert the reference WPF appsettings MCP entry to the MCP client schema. */
export const normalizeReferenceMcpServer = (entry) => {
  if (!entry || typeof entry !== 'object') return entry;
  const type = protocolFromType(entry.type ?? entry.Type);
  if (type === 'sse' || type === 'streamable-http') {
    return {
      type,
      url: entry.url ?? entry.urlTemplate ?? entry.Endpoint ?? entry.endpoint,
      headers: entry.headers ?? entry.Headers,
    };
  }
  return {
    type: 'stdio',
    command: entry.command ?? entry.Command,
    args: entry.args ?? entry.Args ?? [],
    cwd: entry.cwd ?? entry.Cwd,
    env: entry.env ?? entry.Env,
  };
};

/**
 * Select one server from either the standard MCP JSON shape or the reference
 * package's `MCP.Servers` array. Matching is case-insensitive and ignores an
 * optional trailing MCP suffix.
 */
export const selectMcpServer = (document, connectorId) => {
  if (!document || typeof document !== 'object') throw new Error('MCP 配置文件不是有效对象');
  const wanted = normalizeName(connectorId);
  const standard = document.mcpServers;
  if (standard && typeof standard === 'object' && !Array.isArray(standard)) {
    if (standard[connectorId]) return standard[connectorId];
    const match = Object.entries(standard).find(([name]) => normalizeName(name) === wanted);
    if (match) return match[1];
  }
  const referenceServers = document.MCP?.Servers;
  if (Array.isArray(referenceServers)) {
    const match = referenceServers.find((entry) => normalizeName(entry?.Name ?? entry?.name) === wanted);
    if (match) return normalizeReferenceMcpServer(match);
  }
  return document;
};
