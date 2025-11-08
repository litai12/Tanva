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
  - `src/services/imageUploadService.ts`：将 `dataUrl`/`base64` 上传为图片资产
  - `src/services/projectApi.ts`：项目内容的 JSON 读写由后端协调（OSS 优先、DB 回退）

## 环境变量

- 服务器端（`.env`）：`OSS_REGION`, `OSS_BUCKET`, `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET`, `OSS_CDN_HOST?`, `OSS_ENDPOINT?`
- 前端（`.env.local` 示例项）：按需开启/指示 OSS 功能即可，无需暴露密钥到前端

## 最佳实践

- 图片体积控制：上传前可压缩 `dataUrl`，减少延迟与流量
- 目录归档：按 `projectId`/日期等维度划分 `dir`
- 失败兜底：上传失败不阻断流程，保留 base64/本地引用并提示稍后重试

