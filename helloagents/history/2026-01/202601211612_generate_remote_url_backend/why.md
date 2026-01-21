# 变更提案: 生成链路使用远程 URL 由后端处理

## 需求背景
Generate 节点在有上游图片输入时需要读取图片数据，但前端跨域拉取失败导致未使用上游图片。用户要求直接传递远程 URL 由后端处理。

## 变更内容
1. 前端在生成链路中允许传递远程 URL（不强制转换为 dataURL）。
2. 后端 edit/blend 接口支持 `sourceImageUrl(s)` 并在服务端下载转码。

## 影响范围
- **模块:** Flow 生成链路、AI 图像接口
- **文件:** `frontend/src/components/flow/FlowOverlay.tsx`, `frontend/src/types/ai.ts`, `backend/src/ai/ai.controller.ts`, `backend/src/ai/dto/image-generation.dto.ts`
- **API:** `/api/ai/edit-image`, `/api/ai/blend-images`
- **数据:** 无

## 核心场景

### 需求: 生成链路使用远程 URL
**模块:** Flow 生成链路
Generate 在有上游图片输入时直接传远程 URL，后端完成下载并生成。

#### 场景: OSS 直链作为输入
上游 Image 节点为 OSS 远程 URL。
- 生成可正常使用该图片，不受前端 CORS 影响

## 风险评估
- **风险:** 服务器端拉取 URL 可能引入 SSRF 风险或大图内存压力。
- **缓解:** 白名单主机校验 + 大小限制。
