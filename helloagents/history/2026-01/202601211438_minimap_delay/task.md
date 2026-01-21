# 任务清单: MiniMap 刷新延迟展示修复

目录: `helloagents/plan/202601211438_minimap_delay/`

---

## 1. MiniMap 展示触发
- [√] 1.1 在 `frontend/src/components/flow/MiniMapImageOverlay.tsx` 中增加事件/订阅驱动的刷新机制，验证 why.md#需求-minimap-refresh-场景-show-within-1s
- [√] 1.2 在 `frontend/src/components/canvas/DrawingController.tsx` 中补充图片实例更新的通知/标记，验证 why.md#需求-minimap-refresh-场景-show-within-1s，依赖任务1.1

## 2. 回归与兜底
- [√] 2.1 在 `frontend/src/components/flow/MiniMapImageOverlay.tsx` 中保留轻量兜底轮询并确保不会引入 30s 延迟，验证 why.md#需求-minimap-refresh-场景-show-within-1s

## 3. 安全检查
- [√] 3.1 执行安全检查（按G9: 输入验证、敏感信息处理、权限控制、EHRB风险规避）

## 4. 测试
- [-] 4.1 手动刷新页面验证 MiniMap 1s 内展示，缩放/拖动/切换项目无回归
> 备注: 未手动执行，本地需验证
