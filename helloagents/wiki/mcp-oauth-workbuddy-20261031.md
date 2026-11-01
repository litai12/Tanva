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
- **令牌即 Tanva 会话**：授权码换令牌时直接调用 `AuthService.login`，refresh 走 `AuthService.refresh`（单次使用、轮换），revoke 走 `logout`。会话记录的 `userAgent` 前缀是 `oauth:<client_name>`。
- **redirect_uri**：允许 https、本机回环 http（端口可以不同）、私有 scheme（如 `workbuddy://`）；禁用 javascript/data/file 等。按字符串精确匹配。
- **授权码**：存的是 sha256 哈希，10 分钟有效，单次使用（校验失败也会作废）；PKCE 只支持 S256；`resource` 只接受 `https://tanvas.cn/mcp` 或 issuer 本身。
- **MCP 层鉴权**：先在本地检查 JWT 是否过期，再调 `/api/auth/me` 校验签名和封禁状态（结果缓存 60 秒）。校验失败返回 HTTP 401 并带上 `WWW-Authenticate resource_metadata`，客户端收到后会自动刷新或重新授权。
- **30 秒限制**：上游单次调用 25 秒超时；生图走 `generate-image-async`，等待不超过 20 秒，未完成就返回 taskId，交给 `tanva_get_image_task` 继续查。
- **防止令牌被转用**：`tanva_api_request` 只能访问 `/api/*`，并且禁止调用 `/api/oauth/*` 和 `/api/auth/{desktop,refresh,logout,login,register}`。

## 测试

- 后端：`npm run test:oauth`，覆盖动态注册、PKCE、consent 的 CSRF/Origin 校验、授权码单次使用、form/JSON 两种 token 请求、refresh 轮换、revoke、拒绝授权、回环端口、生产环境必须配 Redis。
- 前端：`node --experimental-strip-types --test src/services/desktopLoginReturnTo.test.ts`
- MCP：`cd tanva-mcp && npm test`，用官方 SDK 客户端加模拟 API，覆盖 401 质询、服务发现文档、工具调用、异步生图、路径防护。

## 上线步骤（未部署）

1. 后端 build，然后 `pm2 reload tanvas-api`。
2. `tanva-mcp`：`npm ci && npm run build && pm2 start deploy/ecosystem.config.cjs`。
3. Nginx：在 tanvas.cn 的 server 块加入 `deploy/nginx-tanvas.conf`（`/mcp` 和 `/.well-known/oauth-` 两条规则）。
4. 用 MCP Inspector 对 `https://tanvas.cn/mcp` 实际走一遍授权，确认通过后，在 WorkBuddy 开放平台完成企业入驻并提交 `tanva-mcp/workbuddy/` 目录。
