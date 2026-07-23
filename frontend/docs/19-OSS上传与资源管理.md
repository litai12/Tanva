# OSS 上传与资源管理

本篇介绍阿里云 OSS 直传签名、JSON 工具与前端集成用法。

## 服务端能力（NestJS）

- 路由模块：`server/src/oss/*`
- 直传签名：`POST /api/uploads/presign`（需登录）
  - 请求：`{ dir?: string = 'uploads/', maxSize?: number = 10MB }`
  - 响应：`{ host, dir, expire, accessId, policy, signature }`
  - 前端按表单直传至 `https://<bucket>.<region>.aliyuncs.com`（或 `OSS_CDN_HOST`）
- JSON 工具：`putJSON(key, data)`、`getJSON(key)`、`publicUrl(key)`
  - 作为项目内容存储的兜底与资源公开地址生成

详细见：`docs/Server-后端功能说明.md`

## 前端集成

- 演示页面：`/oss`（文件：`src/pages/OSSDemo.tsx`）
- 服务：
  - `src/services/ossUploadService.ts`：直传与表单构造
  - `src/services/imageUploadService.ts`：将文件、`dataUrl`、`blob:`、base64 或外部图片 URL 转存为托管图片资产
  - `src/services/projectApi.ts`：项目内容的 JSON 读写由后端协调（OSS 优先、DB 回退）

## 环境变量

- 服务器端（`.env`）：`OSS_REGION`, `OSS_BUCKET`, `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET`, `OSS_CDN_HOST?`, `OSS_ENDPOINT?`
- 前端（`.env.local` 示例项）：按需开启/指示 OSS 功能即可，无需暴露密钥到前端

## 最佳实践

- 图片体积控制：可在组件内部用 Blob/canvas 处理或压缩图片，避免用 base64 承载大图
- 目录归档：按 `projectId`/日期等维度划分 `dir`
- 正式资产：Canvas 图元、Flow Image 节点和素材历史必须在上传成功并取得远程 HTTP(S) URL 后创建；上传失败时不创建资产，不得回退到 base64、`data:`、`blob:` 或未托管外链
- 临时预览：裁剪、蒙版、画笔等组件内部状态可短暂使用 Blob/object URL；替换正式资产、保存设计 JSON 或提交 AI 生成/编辑/融合前必须上传并换成远程 URL
- 生成边界：前端负责上传输入，后端 Controller、BullMQ 入队服务和 new-api Provider 逐层拒绝非 HTTP(S) 图片，确保 base64 不进入任务记录、队列或 new-api `image_urls`
- Seedance 普通参考图：Flow 只提交当前渲染结果对应的远程 OSS URL，不复用普通上游 `assetId`；后端每次运行创建一次性 Ark 审核组，视频任务终态后删除。活体认证 asset 是承载本人授权的独立凭据，不得用普通审核素材静默替换
