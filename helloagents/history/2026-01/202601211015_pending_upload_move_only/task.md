# 任务清单: 上传中图片仅允许移动

目录: `helloagents/plan/202601211015_pending_upload_move_only/`

---

## 1. 交互层限制
- [√] 1.1 在 `frontend/src/components/canvas/hooks/useInteractionController.ts` 中识别 `pendingUpload` 图片，允许拖拽移动但禁止 resize/变形，验证 why.md#需求-上传中图片可移动-场景-用户上传图片后立即调整位置
- [√] 1.2 在 `frontend/src/components/canvas/DrawingController.tsx` 中限制上传中图片的组合/截图操作，仅保留移动，验证 why.md#需求-上传中图片可移动-场景-用户上传图片后立即调整位置

## 2. UI 操作限制
- [√] 2.1 在 `frontend/src/components/canvas/ImageContainer.tsx` 中对上传中图片禁用工具栏按钮与编辑入口，仅保留移动提示，验证 why.md#需求-上传中图片可移动-场景-用户上传图片后立即调整位置

## 3. 安全检查
- [√] 3.1 执行安全检查（按G9: 输入验证、敏感信息处理、权限控制、EHRB风险规避）

## 4. 文档更新
- [√] 4.1 无需更新知识库文档（交互小改动）

## 5. 测试
- [ ] 5.1 手动验证上传中图片可拖拽、其他操作禁用；上传完成后功能恢复
> 备注: 未执行测试
