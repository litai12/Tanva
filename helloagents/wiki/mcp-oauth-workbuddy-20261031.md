# 远程 MCP + OAuth 2.1（WorkBuddy 连接器）— 2026-10-31

## 目标

外部 Agent（WorkBuddy 连接器市场、Claude、Cursor 等）通过浏览器一键授权接入用户的 Tanva 账号，授权后拥有与网页登录相同的全部权限。选择「远程 Streamable HTTP + 标准 MCP OAuth」，不用本地 stdio：WorkBuddy 的标准 OAuth 流程只对远程服务生效，用户点「连接」→ 浏览器授权就能用，本机不用安装任何东西。

## 组成

| 部分 | 位置 | 说明 |
|---|---|---|
| 授权服务器 | `backend/src/auth/oauth/` | `/api/oauth/{metadata,register,authorize,consent,decision,token,revoke}` |
| MCP 服务（独立目录，计划开源） | `tanva-mcp/` | 无状态 Streamable HTTP，`/mcp`，以及根路径下的 `/.well-known/oauth-*` |
| 登录回跳白名单 | `frontend/src/services/desktopLoginReturnTo.ts` | 新增放行 `/api/oauth/consent?requestId=<43>` |
| WorkBuddy 连接器包 | `tanva-mcp/workbuddy/` | meta / mcp.json / icon / SKILL.md |
| 部署 | `tanva-mcp/deploy/` | PM2 `tanvas-mcp`（127.0.0.1:3920）和 Nginx 配置片段 |

## 关键设计

- **client_id 无状态**：内容是 `tmc_<base64url(注册元数据)>.<HMAC>`，所以动态注册不用建表，也没法被用来刷爆存储。签名密钥是 `OAUTH_CLIENT_SIGNING_SECRET`，没配置时从 `JWT_ACCESS_SECRET` 按域隔离派生。
- **authorize → consent 两段式**：OAuth 参数很长，先存进 Redis（10 分钟），302 跳转到 `/api/oauth/consent?requestId=`。这样登录回跳只需要放行一个短的白名单地址。consent 页带 CSRF token，决策接口要求 `Origin` 等于 issuer。
- **令牌即 Tanva 会话，按授权管理**：授权码换令牌时调用 `AuthService.login(..., { grantId })`，每次授权生成一个 `grantId`（`g_…`），写进 `RefreshToken.grantId`，也写进 JWT 的 `gid`。refresh 走 `AuthService.refresh`：单次使用，先建新会话再删旧会话，按 grantId 查找。会话记录的 `userAgent` 前缀是 `oauth:<client_name>`。
- **授权一次长期有效**：OAuth access 有效期 1h（`OAUTH_ACCESS_TTL`），refresh 有效期 3650d（`OAUTH_REFRESH_TTL`），每次刷新顺延。网页、桌面会话仍用 `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL`。
- **吊销立即生效**：`JwtStrategy` 遇到带 `gid` 的令牌时，查 `UsersService.hasActiveOAuthGrant`（走 grantId 索引）。`/api/oauth/revoke` 接受 refresh 或 access 令牌，带 Agent refresh 令牌调 `/api/auth/logout` 也会吊销整条授权（`AuthService.revokeOAuthGrant`）。
- **redirect_uri**：允许 https、本机回环 http（端口可以不同）、私有 scheme（如 `workbuddy://`）；禁用 javascript/data/file 等。按字符串精确匹配。
- **授权码**：存的是 sha256 哈希，10 分钟有效，单次使用（校验失败也会作废）；PKCE 只支持 S256；`resource` 只接受 `https://tanvas.cn/mcp` 或 issuer 本身。
- **MCP 层鉴权**：先在本地检查 JWT 是否过期，再调 `/api/auth/me` 校验签名和封禁状态（结果缓存 60 秒）。校验失败返回 HTTP 401 并带上 `WWW-Authenticate resource_metadata`，客户端收到后会自动刷新或重新授权。
- **30 秒限制**：上游单次调用 25 秒超时；生图走 `generate-image-async`，等待不超过 20 秒，未完成就返回 taskId，交给 `tanva_get_image_task` 继续查。
- **防止令牌被转用**：`tanva_api_request` 只能访问 `/api/*`，并且禁止调用 `/api/oauth/*` 和 `/api/auth/{desktop,refresh,logout,login,register}`。

## 测试

- 后端：`npm run test:oauth`，覆盖动态注册、PKCE、consent 的 CSRF/Origin 校验、授权码单次使用、form/JSON 两种 token 请求、refresh 轮换、revoke、拒绝授权、回环端口、生产环境必须配 Redis。
- 前端：`node --experimental-strip-types --test src/services/desktopLoginReturnTo.test.ts`
- MCP：`cd tanva-mcp && npm test`，用官方 SDK 客户端加模拟 API，覆盖 401 质询、服务发现文档、工具调用、异步生图、路径防护。

## 101 发布（2026-11-01，`4524bdc6`）

- 后端：服务器 `git pull` → `npm run build` → `pm2 reload tanvas-api`（reload 前确认 `image-tasks` / `video-analysis-tasks` 队列 active=0、wait=0）。`/api/oauth/metadata` 内网返回正常。
- MCP：`tanva-mcp/` 下 `npm ci && npm run build && pm2 start deploy/ecosystem.config.cjs && pm2 save`，进程 `tanvas-mcp` 监听 127.0.0.1:3920（服务器 Node v20.20.2）。
- Nginx：`deploy/nginx-tanvas.conf` 复制为 `/www/server/panel/vhost/nginx/extension/tanvas.cn/mcp.conf`（宝塔主配置已 include 该目录，不改主配置），`nginx -t` 通过后 reload。回滚：删除该文件后 reload。
- 前端：本机以 `GITHUB_SHA` 构建，发布目录 `/opt/tanva-releases/mcp-oauth-20261101-4524bdc6/`（含 48 文件 SHA-256 清单），旧版备份 `/opt/tanva-backups/mcp-oauth-20261101-4524bdc6/frontend-dist.tar.gz`。先同步资源，最后切换 `sw.js` / `version.json` / `index.html`，不删除旧 hash 资源。
- 公网核验：`POST /mcp` 401 + `WWW-Authenticate resource_metadata`；两份 `/.well-known/oauth-*` 200；动态注册返回 `tmc_` client_id；`/api/oauth/authorize` 302 到 consent，未登录 302 到 `/auth/login?returnTo=/api/oauth/consent?...`；`version.json` commitSha=4524bdc6bfd7，入口 JS 哈希一致，旧 hash 资源仍 200；`/api/health` ok；PM2 三个进程 online。
- 未完成：尚未用 MCP Inspector / Claude Code / WorkBuddy 真实走完浏览器授权与工具调用。

## 2026-11-01 根治（线上真实授权验证后）

线上验证时，SDK 客户端加真实账号共 18 项检查，17 项通过。由此发现两处问题：
1. 吊销后 access 令牌还能用 24 小时（生产 `JWT_ACCESS_TTL=24h`）；refresh 令牌 30 天不用就过期；查找会话只扫最近 32 条，用户网页登录多了会把 Agent 授权挤掉，需要重新授权。
2. `tanva_describe_endpoint` 查不到请求体字段：74 个 schema 里 34 个是空的。DTO 只写了 class-validator 装饰器，后端用纯 tsc 构建，没有 Swagger 插件。

修复见上面「关键设计」，以及构建脚本 `backend/scripts/build.cjs`（官方 swagger 插件，`classValidatorShim`，`controllerFileNameSuffix: []`，`introspectComments: false`，因为部分 DTO 注释编码有问题）。验证方式：用 Nest preview 模式加载真实的 AppModule 生成完整文档，旧构建 303 个路径、34 个空 schema，新构建 0 个空 schema。
插件不支持字符串字面量联合类型，会生成 `type: object`。`main.ts` 在 `createDocument` 之后调用 `applyClassValidatorTypes(doc)`，按同一属性上的 class-validator 装饰器补出 type 和 enum，只改这类空 object 占位，`@IsObject` 和显式 schema 不动。

## 后续

1. 用 MCP Inspector 对 `https://tanvas.cn/mcp` 实际走一遍授权与工具调用。
2. 在 WorkBuddy 开放平台完成企业入驻，提交 `tanva-mcp/workbuddy/` 目录。
