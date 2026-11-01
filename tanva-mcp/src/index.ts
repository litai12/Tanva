#!/usr/bin/env node
import { loadConfig, resourceUrl, VERSION } from './config.js';
import { createMcpHttpServer } from './server.js';

const config = loadConfig();
const server = createMcpHttpServer(config);
server.listen(config.port, config.host, () => {
  console.log(`[tanva-mcp ${VERSION}] listening on http://${config.host}:${config.port}${config.mcpPath} → public ${resourceUrl(config)}, api ${config.apiOrigin}`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
