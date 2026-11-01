# tanva-mcp

Tanva（[tanvas.cn](https://tanvas.cn)）的远程 MCP 服务：任何支持 MCP 的 Agent（WorkBuddy、Claude、Cursor、Codex 等）都可以通过**浏览器一键授权**接入用户的 Tanva 账号，授权后拥有与网页登录相同的全部权限。

- 传输方式：MCP Streamable HTTP（无状态），地址 `https://tanvas.cn/mcp`
- 鉴权方式：标准 MCP OAuth 2.1，公开客户端 + PKCE S256 + RFC 7591 动态注册，无需 API Key
- 工具：常用工具（账号、积分、项目、AI 生图）加上通用接口调用（覆盖 Tanva 全部开放接口）

## 接入

| 客户端 | 方式 |
|---|---|
| WorkBuddy | 在连接器市场搜索「Tanva」，点「连接」，浏览器里点「授权」 |
| Claude Code | `claude mcp add --transport http tanva https://tanvas.cn/mcp`，然后在 `/mcp` 里完成授权 |
| Cursor / 其它 | 添加远程 MCP：`{"mcpServers":{"tanva":{"url":"https://tanvas.cn/mcp"}}}` |

客户端第一次请求会收到 `401`，响应头 `WWW-Authenticate` 里带着 `resource_metadata`。客户端据此自动发现授权服务器，完成动态注册，再打开 Tanva 授权页。用户登录后点「授权」，客户端拿到令牌，之后会自动刷新。

## 授权流程

```
Agent ──POST /mcp──────────────────────────▶ tanva-mcp  ──401 + resource_metadata
Agent ──GET /.well-known/oauth-protected-resource/mcp ─▶ tanva-mcp
Agent ──GET /.well-known/oauth-authorization-server ───▶ tanva-mcp（描述后端端点）
Agent ──POST /api/oauth/register ──────────▶ Tanva 后端（无状态签名 client_id）
浏览器 ─GET /api/oauth/authorize ─▶ 302 /api/oauth/consent ─(未登录→/auth/login)─▶ 用户点「授权」
浏览器 ─▶ redirect_uri?code=…&state=…&iss=https://tanvas.cn
Agent ──POST /api/oauth/token（code + code_verifier）─▶ access_token / refresh_token
Agent ──POST /mcp  Authorization: Bearer … ─▶ tanva-mcp ──以该用户身份调用──▶ Tanva /api/*
```

- 授权服务器在 Tanva 后端（`backend/src/auth/oauth/`）；本服务只负责 MCP 和服务发现文档。
- **授权一次，长期有效**：签发的是 Tanva 登录会话，但单独标记一个授权 ID（`grantId`）。access 令牌 1 小时（`OAUTH_ACCESS_TTL`），客户端自动刷新，用户无感；refresh 令牌 3650 天（`OAUTH_REFRESH_TTL`），每次刷新都会轮换并顺延有效期。只有用户吊销时授权才会失效，不需要重复授权。
- 按 `grantId` 查找授权会话，用户在网页、桌面登录多少次都不会把 Agent 授权挤掉；并发刷新时只有一个请求成功，授权本身不会丢。
- **吊销立即生效**：`POST /api/oauth/revoke`（refresh 或 access 令牌都可以），或用 Agent 的 refresh 令牌调用 `/api/auth/logout`，会吊销整条授权。已签发的 access 令牌下一次请求就会返回 401，不用等到过期。每次授权互相独立，也不影响网页登录。
- 网页、桌面的 refresh 令牌不能拿到 `/api/oauth/token` 换 Agent 令牌；Agent 的 refresh 令牌走 `/api/auth/refresh` 时，换出来的仍属于同一条授权（同样 1 小时、可吊销）。
- `redirect_uri` 按字符串精确匹配；本机回环地址 `http://127.0.0.1:{port}` 允许端口不同（RFC 8252）。

## 工具

| 工具 | 说明 |
|---|---|
| `tanva_list_models` | 当前账号可用的规划 / 生图 / 视频模型、是否可用、参考价格 |
| `tanva_make_video` | 一键成片（`story`）/ 爆款复刻（`referenceVideoUrl`）：服务端规划 → 参考图 → Seedance 视频 → ffmpeg 合成，可指定 `planModel` / `imageModel` / `videoModel` |
| `tanva_generate_video` | 单段生视频（文生 / 首帧 / 多参考图） |
| `tanva_video_job` / `tanva_list_video_jobs` | 查询进度、分镜、预估积分、成片地址 |
| `tanva_video_produce` / `tanva_video_retry` / `tanva_video_cancel` | 余额补足后继续（可改分镜）/ 只重跑失败部分 / 取消 |
| `tanva_whoami` | 当前授权账号 |
| `tanva_credits_balance` | 积分余额 |
| `tanva_list_projects` / `tanva_get_project` | 项目列表、详情（可附带画布 JSON） |
| `tanva_generate_image` / `tanva_get_image_task` | 异步生图并轮询结果（会消耗积分；单次调用不超过 30 秒） |
| `tanva_list_endpoints` / `tanva_describe_endpoint` | 从线上 OpenAPI（`/api/docs-json`）搜索接口、查看参数 |
| `tanva_api_request` | 以当前用户身份调用任意 `/api/*` 接口 |

安全边界：所有请求只发往配置的 Tanva 源站。`/api/oauth/*`、`/api/auth/{desktop,refresh,logout,login,register}` 不能通过 MCP 调用，防止拿 MCP 令牌再去签发新的会话。`tanva_api_request` 标了 `destructiveHint`，客户端会提示用户确认。

## 开发

```bash
npm install
npm test            # 编译后运行端到端测试（官方 MCP SDK 客户端 + 模拟的 Tanva API）
TANVA_API_ORIGIN=http://127.0.0.1:4000 npm start   # 本机后端
```

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `TANVA_PUBLIC_ORIGIN` | `https://tanvas.cn` | 对外源站，用作 OAuth issuer 和 MCP resource |
| `TANVA_API_ORIGIN` | 同上 | 本服务调用 Tanva API 的地址（部署在同一台机器上时用 `http://127.0.0.1:4000`） |
| `TANVA_MCP_PATH` | `/mcp` | MCP 挂载路径 |
| `HOST` / `PORT` | `127.0.0.1` / `3920` | 监听地址 |
| `TANVA_API_TIMEOUT_MS` | `25000` | 单次上游调用超时（上限 28000） |

后端相关环境变量：`OAUTH_ISSUER`（默认 `https://tanvas.cn`）；`OAUTH_CLIENT_SIGNING_SECRET`（可选，不填时从 `JWT_ACCESS_SECRET` 派生）；生产环境必须配置 `REDIS_URL`。

## 部署（tanvas.cn）

1. 后端：照常 `git pull`，然后 `npm run build`，再 `pm2 reload tanvas-api`（会带上 `/api/oauth/*`）。
2. 本服务：`cd tanva-mcp && npm ci && npm run build && pm2 start deploy/ecosystem.config.cjs`（以后更新用 `pm2 reload tanvas-mcp`）。
3. Nginx：把 `deploy/nginx-tanvas.conf` 加进 tanvas.cn 的 server 块，然后执行 `nginx -t && nginx -s reload`。
4. 验证：
   ```bash
   curl -i https://tanvas.cn/mcp -X POST -H 'content-type: application/json' -d '{}'    # 401 + WWW-Authenticate
   curl https://tanvas.cn/.well-known/oauth-protected-resource/mcp
   curl https://tanvas.cn/.well-known/oauth-authorization-server
   npx @modelcontextprotocol/inspector   # 选 Streamable HTTP，填 https://tanvas.cn/mcp，走一遍授权
   ```

## WorkBuddy 连接器

`workbuddy/` 目录就是提交给 WorkBuddy 的连接器包：`connector-meta.json`、`mcp.json`（streamableHttp，不填 `auth_mode`，走标准 MCP OAuth）、`icon.png`、`skills/tanvas/SKILL.md`。打包这个目录，在 WorkBuddy 开放平台（open.workbuddy.cn）完成企业入驻后提交审核。
