// PM2 config for the Tanva remote MCP service (tanvas.cn/mcp).
// Deploy: cd /www/wwwroot/tanvas.cn && git pull && cd tanva-mcp && npm ci && npm run build
//         pm2 start deploy/ecosystem.config.cjs   (first time)  |  pm2 reload tanvas-mcp
module.exports = {
  apps: [
    {
      name: 'tanvas-mcp',
      script: 'dist/index.js',
      cwd: '/www/wwwroot/tanvas.cn/tanva-mcp',
      interpreter: '/usr/bin/node',
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '512M',
      restart_delay: 3000,
      kill_timeout: 15000,
      env: {
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: '3920',
        // What users/agents see (OAuth issuer + MCP resource id).
        TANVA_PUBLIC_ORIGIN: 'https://tanvas.cn',
        // Call the backend directly on the box instead of looping through nginx.
        TANVA_API_ORIGIN: 'http://127.0.0.1:4000',
        TANVA_API_TIMEOUT_MS: '25000',
      },
    },
  ],
};
