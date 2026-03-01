# 任务清单: Seedance 视频结果走 OSS

目录: `helloagents/plan/202601211428_seedance-oss-video/`

---

## 1. 后端 Seedance 视频 OSS 上传
- [√] 1.1 在 `backend/src/ai/services/video-provider.service.ts` 中实现远程视频流上传到 OSS 的辅助方法（含域名校验与流式上传），验证 why.md#需求-seedance-video-uses-oss-场景-frontend-download-uses-oss-url
- [√] 1.2 在 `backend/src/ai/services/video-provider.service.ts` 的 `queryDoubao` 成功分支中调用上传逻辑并返回 OSS URL，验证 why.md#需求-seedance-video-uses-oss-场景-frontend-download-uses-oss-url，依赖任务1.1

## 2. 安全检查
- [√] 2.1 执行安全检查（按G9: 输入验证、敏感信息处理、权限控制、EHRB风险规避）

## 3. 文档更新
- [√] 3.1 更新 `helloagents/wiki/modules/backend-ai.md`（补充 Seedance 视频结果上传 OSS 的说明）

## 4. 测试
- [-] 4.1 手动触发 Seedance 视频任务并轮询 `/api/ai/video-task/doubao/:taskId`，确认返回 OSS URL 可下载
> 备注: 本地未配置 Seedance/OSS 环境，未执行手测。
