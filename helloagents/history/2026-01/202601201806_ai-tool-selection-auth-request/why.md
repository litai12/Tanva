# 变更提案: AI 工具选择鉴权请求合并

## 需求背景
前端 `tool-selection` 调用使用独立 `fetch`，未注入 `Authorization`，跨站场景仅依赖 cookie 容易 401。需要与现有鉴权请求统一，确保登录态与刷新逻辑一致。

## 变更内容
1. 统一 AI 请求走同一鉴权请求实例（包含 Bearer 与 refresh 逻辑）
2. 保持现有失败回退与日志行为不变

## 影响范围
- **模块:** frontend/services
- **文件:** `frontend/src/services/aiImageService.ts`
- **API:** `/api/ai/tool-selection`（以及同服务类内其他 AI 接口）
- **数据:** 无

## 核心场景

### 需求: 工具选择请求携带登录态
**模块:** frontend/services
登录用户进行工具选择时，请求需包含 `Authorization`（或刷新后的 token），避免 401。

#### 场景: Auto 模式触发工具选择
用户在对话中触发工具选择（auto 模式），请求携带 token 并可自动刷新。
- 请求不再因缺失认证头返回 401

## 风险评估
- **风险:** 统一请求后可能改变部分错误处理与重试时机
- **缓解:** 复用现有 `fetchWithAuth` 行为，保持原 fallback 逻辑
