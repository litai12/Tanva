# 任务清单: MiniMap 即时显示图片占位

目录: `helloagents/history/2026-01/202601211539_minimap_instant/`

---

## 1. 画布实例重建与同步
- [√] 1.1 在 `frontend/src/components/canvas/DrawingController.tsx` 中确保 `paper-project-imported` 时能立即种子化 `imageInstances`，验证 why.md#需求-刷新后-minimap-立即可见-场景-图片已渲染但-minimap-不显示
- [√] 1.2 在 `frontend/src/components/canvas/hooks/useImageTool.ts` 中完善快照种子化与后续覆盖逻辑，保证 `window.tanvaImageInstances` 立即可用且后续校准正确，依赖任务1.1
- [√] 1.3 在 `frontend/src/services/paperSaveService.ts` 中确认导入事件触发时序，避免等待 Raster 加载才触发重建，依赖任务1.1

## 2. 安全检查
- [√] 2.1 执行安全检查（按G9: 输入验证、敏感信息处理、权限控制、EHRB风险规避）

## 3. 测试
- [-] 3.1 手动刷新含图片项目，确认 1 秒内 MiniMap 立即显示并在 10 秒后不出现明显跳变
> 备注: 未在本地执行手动验证。
