# 任务清单: 生成链路使用远程 URL 由后端处理

目录: `helloagents/history/2026-01/202601211612_generate_remote_url_backend/`

---

## 1. 生成链路输入解析
- [√] 1.1 在 `frontend/src/components/flow/FlowOverlay.tsx` 中允许生成链路传递远程 URL，并按需发送 `sourceImageUrl(s)`，验证 why.md#需求-生成链路使用远程-url-场景-oss-直链作为输入
- [√] 1.2 在 `frontend/src/types/ai.ts` 中补齐 `sourceImageUrl(s)` 请求类型

## 2. 后端接口支持
- [√] 2.1 在 `backend/src/ai/dto/image-generation.dto.ts` 中支持 `sourceImageUrl(s)` 校验
- [√] 2.2 在 `backend/src/ai/ai.controller.ts` 中新增 URL 下载与白名单校验，并用于 edit/blend

## 3. 安全检查
- [√] 3.1 执行安全检查（按G9: 输入验证、敏感信息处理、权限控制、EHRB风险规避）

## 4. 测试
- [-] 4.1 手动复现 Multi-generate → Image → Generate，使用 OSS 直链输入确认生成正常
> 备注: 未在本地执行手动验证。
