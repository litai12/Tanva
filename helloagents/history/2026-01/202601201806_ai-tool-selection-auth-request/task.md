# 任务清单: AI 工具选择鉴权请求合并

目录: `helloagents/plan/202601201806_ai-tool-selection-auth-request/`

---

## 1. 前端服务请求合并
- [√] 1.1 在 `frontend/src/services/aiImageService.ts` 中复用 `fetchWithAuth` 作为统一请求入口，验证 why.md#需求-工具选择请求携带登录态-场景-auto-模式触发工具选择
- [√] 1.2 保持 `callAPI` 的超时、重试与 fallback 行为一致，验证 why.md#需求-工具选择请求携带登录态-场景-auto-模式触发工具选择，依赖任务1.1

## 2. 安全检查
- [√] 2.1 执行安全检查（按G9: 输入验证、敏感信息处理、权限控制、EHRB风险规避）

## 3. 文档更新
- [√] 3.1 确认无需更新知识库文档（如有变更再补充）

## 4. 测试
- [-] 4.1 手工验证登录态下工具选择调用不再 401（含 token 刷新路径）
  > 备注: 未执行（未请求）
