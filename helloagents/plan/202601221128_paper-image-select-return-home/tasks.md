# 任务清单: paper_image_select_return_home

目录: `helloagents/plan/202601221128_paper-image-select-return-home/`

---

## 任务状态符号说明

| 符号 | 状态 | 说明 |
|------|------|------|
| `[ ]` | pending | 待执行 |
| `[√]` | completed | 已完成 |
| `[X]` | failed | 执行失败 |
| `[-]` | skipped | 已跳过 |
| `[?]` | uncertain | 待确认 |

---

## 执行状态
```yaml
总任务: 5
已完成: 2
完成率: 40%
```

---

## 任务列表

### 1. 问题定位与复现
- [ ] 1.1 复现场景：进入项目 → 返回首页 → 再进入项目，记录图片是否可选中/可操作
  - 验证: 记录是否触发 `paper-project-imported`/`paper-project-changed` 与 `rebuildFromPaper`
- [ ] 1.2 排查是否存在点击被覆盖层拦截（FlowOverlay pointer-events）
  - 验证: Canvas 点击事件是否触发、hitTest 是否命中

### 2. 交互恢复修复
- [√] 2.1 在 `frontend/src/components/canvas/DrawingController.tsx` 增加“缺失检测 + 兜底重建”逻辑
  - 验证: 当 Paper 有 Raster 但图片实例/选择元素缺失时能自动恢复
- [√] 2.2 在 `frontend/src/utils/paperCoords.ts` 或点击命中逻辑中使用 `paper.view.element` 作为坐标转换基准（若发现 canvasRef 与 view 不一致）
  - 验证: 返回后点击图片稳定命中
- [ ] 2.3 如确认 Flow 层拦截，调整 `frontend/src/components/flow/FlowOverlay.tsx` 的 pointer-events 策略
  - 验证: Flow 启用时不影响 Flow，Canvas 模式下不阻断点击

### 3. 回归与安全检查
- [ ] 3.1 确认不影响画布缩放/拖拽/选择框/图片组块等交互
  - 验证: 画布基础交互与历史行为一致
- [ ] 3.2 检查保存链路与设计 JSON 约束无新增风险
  - 验证: 不引入 data/blob/base64 写入

### 4. 测试
- [ ] 4.1 手动验证：返回首页再进入项目后图片可选中、可操作
- [ ] 4.2 手动验证：刷新后图片选择与操作正常
- [ ] 4.3 手动验证：Flow UI 与画布交互互不影响

### 5. 文档同步
- [ ] 5.1 评估是否需要更新 `helloagents/wiki/` 或 `frontend/docs/`，如无需更新说明原因

---

## 执行备注

> 执行过程中的重要记录

| 任务 | 状态 | 备注 |
|------|------|------|
