# 技术设计: AI 工具选择鉴权请求合并

## 技术方案
### 核心技术
- React + TypeScript
- fetchWithAuth（统一鉴权请求与刷新逻辑）

### 实现要点
- 在 `aiImageService` 的通用请求方法中使用 `fetchWithAuth`
- 保持现有超时与重试、fallback 逻辑不变

## 安全与性能
- **安全:** 统一鉴权头与 refresh 逻辑，降低 401 与未授权访问风险
- **性能:** 不引入额外请求，仅替换请求实现

## 测试与部署
- **测试:** 手工验证登录态下 `/api/ai/tool-selection` 不再 401；确认过期 token 可刷新
- **部署:** 前端常规发布流程
