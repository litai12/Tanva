# 任务清单: MiniMap 图片刷新异常修复

目录: `helloagents/history/2026-01/202601211501_minimap_image_refresh/`

---

## 1. MiniMap 覆盖层与图片同步
- [-] 1.1 在 `frontend/src/components/flow/MiniMapImageOverlay.tsx` 中补齐初始化刷新逻辑（目标 SVG 就绪/图片实例回填后触发一次更新），验证 why.md#需求-页面刷新后的-minimap-显示-场景-刷新后无需交互即可看到图片
> 备注: 问题根因在快照回填实例为空，已通过任务1.2修复，无需改动 overlay。
- [√] 1.2 在 `frontend/src/services/paperSaveService.ts` 中导入完成即触发 `paper-project-imported`，在 `frontend/src/components/canvas/DrawingController.tsx` 修复恢复路径的实例匹配并增加快照兜底，在 `frontend/src/components/canvas/hooks/useImageTool.ts` 中快照回填阶段先种子化 `imageInstances`，验证 why.md#需求-页面刷新后的-minimap-显示-场景-刷新后无需交互即可看到图片，依赖任务1.1

## 2. 安全检查
- [√] 2.1 执行安全检查（按G9: 输入验证、敏感信息处理、权限控制、EHRB风险规避）

## 3. 测试
- [-] 3.1 手动刷新含图片的项目，确认 MiniMap 立即显示；拖动/缩放后显示仍正确
> 备注: 未在本地执行手动验证。
