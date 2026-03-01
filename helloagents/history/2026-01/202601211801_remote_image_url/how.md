# 技术设计: 远程图片直传后端处理

## 技术方案
### 核心技术
- React + TypeScript 前端请求拼装
- NestJS 后端已支持 `sourceImageUrls` / `sourceImageUrl`

### 实现要点
- 在前端统一判断图片来源类型：远程 URL vs 临时/本地（blob/dataURL）。
- 融合与其他工具请求：
  - 若全部为远程 URL，填充 `sourceImageUrls`/`sourceImageUrl`，跳过 `resolveImageToDataUrl`。
  - 若存在非远程资源，保持原有 base64 兜底路径。
- 保持“设计 JSON”约束：持久化仅保存远程引用，运行时临时态不入库。

## 架构决策 ADR
### ADR-001: 远程 URL 优先的图片输入通道
**上下文:** 远程 URL 已由后端支持批量下载，但前端仍统一转 base64，导致跨域与内存问题。
**决策:** 当输入为远程 URL 时，优先传 URL 给后端，仅在非远程资源时使用 base64 兜底。
**理由:** 最小变更，直接复用后端能力，降低前端内存和跨域失败风险。
**替代方案:** 全量统一上传到 OSS 再传 URL → 需要新增上传流程与更多改动。
**影响:** 需要在前端请求构造层区分来源类型，并处理混合来源。

## API设计
### [POST] /api/ai/blend-images
- **请求:** `sourceImageUrls?: string[]`（远程 URL 列表）
- **响应:** 维持现有返回结构

### [POST] /api/ai/edit-image
- **请求:** `sourceImageUrl?: string`（远程 URL）
- **响应:** 维持现有返回结构

## 安全与性能
- **安全:** 仅透传 URL，避免在前端/本地落库 base64；保持后端 URL 下载路径的安全校验策略。
- **性能:** 避免 base64 序列化和大字符串传输，减少内存峰值与 CORS 触发。

## 测试与部署
- **测试:** 手动验证融合/编辑/其他工具对远程 URL 的调用链路，确认不再出现 base64。
- **部署:** 前端发布即可；后端无需变更或仅做兼容性验证。
