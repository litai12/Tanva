# 后端模块：认证（backend-auth）

## 作用
- 提供注册/登录/短信登录/刷新/登出等认证能力。
- 通过 Cookie 维护会话（`access_token` / `refresh_token`），并提供 Guard/Strategy 保护业务接口。

## 关键文件
- `backend/src/auth/auth.controller.ts`：`/auth/*` 路由
- `backend/src/auth/auth.service.ts`：登录、签发/刷新 token、设置/清理 cookie
- `backend/src/auth/guards/*`：JWT / refresh / api-key-or-jwt
- `backend/src/auth/strategies/*`：passport-jwt 策略
- `backend/src/auth/sms.service.ts`：短信验证码发送与校验

## API（前缀 `/api/auth`）
- `POST register`：注册
- `POST login`：手机号+密码登录（写入 cookie）
- `GET watcha/authorize`：发起观猹 OAuth2 授权跳转（支持 `returnTo`）
- `GET watcha/callback`：处理观猹回调，自动登录并回跳前端
- `POST wechat-official/sessions`：创建公众号扫码登录会话，返回带场景值二维码
- `GET wechat-official/sessions/:id`：轮询公众号扫码登录状态（`pending/needs_phone_bind/authorized/expired`）
- `POST wechat-official/sessions/:id/bind-phone`：扫码识别到微信身份但未绑定真实手机号时，提交手机号 + 短信验证码完成绑定并登录；新建账号时支持额外携带可选 `inviteCode`
- `POST wechat-official/sessions/:id/consume`：消费已授权扫码会话，写入 cookie 并完成登录
- `GET wechat-official/callback`：微信公众平台回调 URL 验证
- `POST wechat-official/callback`：接收公众号 `subscribe/SCAN` 事件，完成扫码登录关联
- `POST send-sms`：发送短信验证码（开发可返回调试码）
- `POST login-sms`：短信登录
- `POST reset-password`：忘记密码重置
- `GET me`：获取当前用户（需要 `JwtAuthGuard`）
- `POST refresh`：刷新 token（需要 `RefreshAuthGuard`）
- `POST logout`：登出（需要 `RefreshAuthGuard`）

## 注意事项
- Controller 注释提示：生产短信建议配置阿里云与 `REDIS_URL`；开发可启用 `SMS_DEBUG=true`。
- 观猹 OAuth 依赖环境变量：`WATCHA_OAUTH_CLIENT_ID`、`WATCHA_OAUTH_CLIENT_SECRET`、`WATCHA_OAUTH_REDIRECT_URI`；可选 `WATCHA_OAUTH_SCOPE`、`WATCHA_OAUTH_FRONTEND_BASE_URL`、`WATCHA_OAUTH_FAILURE_PATH`。
- 用户表新增 `watchaUserId`（唯一）用于稳定关联第三方账号；若观猹未返回可用手机号，会自动生成 `watcha_*` 形式占位手机号，仅用于账号标识。
- 公众号扫码登录依赖环境变量：`WECHAT_OFFICIAL_APP_ID`、`WECHAT_OFFICIAL_APP_SECRET`、`WECHAT_OFFICIAL_TOKEN`；可选 `WECHAT_OFFICIAL_QR_EXPIRE_SECONDS`、`WECHAT_OFFICIAL_LOGIN_MESSAGE`。
- `WechatLoginSession` 的首版建表迁移遗漏了 `nickname` / `avatarUrl` 列；新环境需继续执行 `202604120001_fix_wechat_login_session_profile_columns`，已上线环境也需要补跑该迁移，否则扫码状态轮询会在 Prisma `findUnique` 阶段因缺列直接报 500。
- 当前扫码登录以手机号为主身份：`subscribe/SCAN` 只负责识别微信身份；若该微信未绑定真实手机号，会先进入 `needs_phone_bind`，需短信验证手机号后才发放登录态。
- 扫码会话状态接口会返回 `displayName`：优先取已关联账号的真实 `user.name`，其后才回退到微信昵称；绑定微信身份时不会再用微信昵称/占位名覆盖已有账号名称。
- 当前只实现微信公众平台 `明文模式` 回调；后台配置时不要启用仅加密模式，否则需要额外 AES 解密链路。
- 公众号全局 token 现通过微信推荐的 `cgi-bin/stable_token` 获取，并在生成二维码遇到 `access_token is invalid or not latest` 时自动强制刷新后重试一次，降低多实例/第三方系统并发刷新导致的失效问题。
