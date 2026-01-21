# 变更提案: 远程图片直传后端处理

## 需求背景
当前对话框选择的图片本身是远程 URL，但在“融合/其他工具”流程中仍会被序列化为 base64，再发送给后端。这会触发跨域与内存问题，也违背“远程 URL 可直接由后端下载处理”的现有能力。

## 变更内容
1. 对融合与相关工具流程：当图片来源为远程 URL 时，不再转 base64，改为传 `sourceImageUrls` / `sourceImageUrl`。
2. 保持本地/临时资源（blob/dataURL）路径：仅在无法提供远程 URL 时继续走 base64 兜底。
3. 统一前端判定逻辑，避免无意义序列化与重复转换。

## 影响范围
- **模块:** 前端 AI 对话/工具链路，后端 AI 图片处理接口调用
- **文件:** `frontend/src/stores/aiChatStore.ts`, `frontend/src/services/aiBackendAPI.ts`, `frontend/src/utils/imageSource.ts`
- **API:** `POST /api/ai/blend-images`, `POST /api/ai/edit-image`
- **数据:** 无

## 核心场景

### 需求: 远程图片直传后端处理
**模块:** AI 对话/工具链路
对话框选中远程 URL 图片后发起融合/编辑/分析操作。

#### 场景: 融合远程图片
远程 URL 列表进入融合流程。
- 后端批量下载并完成处理，返回新 URL。

#### 场景: 编辑单张远程图片
单张远程 URL 进入编辑流程。
- 直接传 URL，避免序列化为 base64。

## 风险评估
- **风险:** 混合来源（远程 URL 与本地/临时图片）处理不一致。
- **缓解:** 仅当全部为远程 URL 时使用 URL 通道；否则走现有 base64 兜底，并在前端提示或上传后统一。
