# API 手册（概览）

## 基本信息
- Base URL：`/api`
- Swagger：`/api/docs`

## 路由前缀（按 Controller）
以下为后端 Controller 路由前缀（不含全局 `/api`）：
- `auth`：认证
- `users`：用户
- `projects`：项目
- `assets`：素材资源
- `uploads`：上传
- `video-frames`：视频帧相关
- `video-gif`：视频转 GIF
- `ai`：AI 能力
- `public/ai`：公开 AI API
- `credits`：积分/计费
- `payment`：充值支付
- `admin`：管理后台
- `invites`：邀请码
- `personal-library`：个人素材库
- `global-image-history`：全局图片历史
- `templates`：公共模板
- `settings`：公开系统设置（如登录提醒、微信二维码）
- `health`：健康检查

> 具体请求/响应以 Swagger 与 Controller 实现为准。

## 近期接口变更（摘要）
- `POST /api/uploads/model`:
  - Authenticated GLB/GLTF 3D model upload relay; backend writes to OSS/TOS and returns `{ url, key }`.
  - Flow 3D nodes use this by default to avoid browser direct POST 403/CORS failures against TOS. Design JSON still persists only remote URLs/keys.
- `GET /api/settings/login-notice`：
  - 公开读取登录后用户提醒弹窗配置，返回 `{ enabled, content, contentHtml, mediaType, mediaUrl, posterUrl, primaryButtonText, primaryButtonUrl, secondaryButtonText, secondaryButtonUrl, updatedAt }`。
  - 管理端对应系统设置 key 为 `login_notice`，值为 JSON 字符串；`contentHtml` 为受限富文本，`content` 为兼容用纯文本，`mediaUrl` / `posterUrl` 只保存远程 URL 或站内路径。
- `POST /api/ai/analyze-image`：
  - 新增可选 `sourceImages: string[]`，支持多图分析。
  - 兼容原有 `sourceImage: string` 单图请求。
  - 两者同时传入时会合并去重后统一参与分析。
  - PDF 输入复用该接口：`data:application/pdf`、PDF URL 或 PDF base64 头会按文件内容发送给 new-api/Gemini，并使用文档理解适合的文本模型。
