# 变更提案: Seedance 视频结果走 OSS

## 需求背景
Seedance（豆包）视频生成返回的是火山 TOS 预签名链接，前端在本地/生产下载时触发 CORS 拦截，无法稳定下载。根据需求，Seedance 的资源需要先上传到我们自己的 OSS，并由前端使用自有 OSS 链接进行展示与下载。

## 变更内容
1. Seedance 视频任务完成后，后端将视频 URL 拉取并上传到 OSS。
2. 后端仅向前端返回 OSS 公网链接（不再返回上游 TOS 预签名链接）。

## 影响范围
- **模块:** backend-ai, backend-oss
- **文件:**
  - `backend/src/ai/services/video-provider.service.ts`
  - （如需新增工具函数）`backend/src/ai/utils/*`
- **API:** `GET /api/ai/video-task/:provider/:taskId`
- **数据:** 无

## 核心场景

### 需求: Seedance video uses OSS
**模块:** backend-ai
Seedance 任务完成后，返回可被前端下载的 OSS 公网链接。

#### 场景: Frontend download uses OSS URL
Seedance 任务状态为 succeeded 时，前端收到的 videoUrl 为自有 OSS 域名链接，下载不再触发跨域拦截。

## 风险评估
- **风险:** OSS 未配置或上传失败导致任务返回失败。
- **缓解:** 对 OSS 可用性进行前置检查，失败时返回明确错误并记录日志，避免返回不可用链接。
