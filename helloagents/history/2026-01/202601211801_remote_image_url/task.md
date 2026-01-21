# 任务清单: 远程图片直传后端处理

目录: `helloagents/plan/202601211801_remote_image_url/`

---

## 1. 图片来源判定
- [√] 1.1 在 `frontend/src/utils/imageSource.ts` 中补充远程 URL 判断与辅助方法，验证 why.md#需求:-远程图片直传后端处理-场景:-融合远程图片

## 2. AI 工具链路改造
- [√] 2.1 在 `frontend/src/stores/aiChatStore.ts` 中调整融合流程：当全部为远程 URL 时使用 `sourceImageUrls`，否则保持 base64 兜底，验证 why.md#需求:-远程图片直传后端处理-场景:-融合远程图片
- [√] 2.2 在 `frontend/src/stores/aiChatStore.ts` 中调整编辑/其他工具流程：远程 URL 直传 `sourceImageUrl`，验证 why.md#需求:-远程图片直传后端处理-场景:-编辑单张远程图片

## 3. 安全检查
- [√] 3.1 执行安全检查（按G9: 输入验证、敏感信息处理、权限控制、EHRB风险规避）

## 4. 文档更新
- [√] 4.1 更新 `helloagents/wiki/modules/frontend-stores.md` 中 AI 对话/工具链路说明

## 5. 测试
- [-] 5.1 手动验证：远程 URL 进入融合/编辑时请求体使用 `sourceImageUrls`/`sourceImageUrl`，且无 base64 序列化
> 备注: 未执行（未进行手动验证）
