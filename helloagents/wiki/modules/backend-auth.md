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
- `POST send-sms`：发送短信验证码（开发可返回调试码）
- `POST login-sms`：短信登录
- `POST reset-password`：忘记密码重置
- `GET me`：获取当前用户（需要 `JwtAuthGuard`）
- `POST refresh`：刷新 token（需要 `RefreshAuthGuard`）
- `POST logout`：登出（需要 `RefreshAuthGuard`）

## 注意事项
- Controller 注释提示：生产短信建议配置阿里云与 `REDIS_URL`；开发可启用 `SMS_DEBUG=true`。

