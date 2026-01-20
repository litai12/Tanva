# 任务清单: 画布与对话框 JSON 复制/导入

目录: `helloagents/plan/202601201739_copy-json-workflow/`

---

## 1. 复制/导入服务层
- [√] 1.1 在 `frontend/src/services/clipboardJsonService.ts` 中实现导出/导入 JSON 的包装结构与剪贴板读写，验证 why.md#需求-画布内容-json-复制导入-场景-复制画布-json
- [√] 1.2 在 `frontend/src/services/clipboardJsonService.ts` 中实现导入合并逻辑（层/节点/会话 ID 去重），验证 why.md#需求-画布内容-json-复制导入-场景-导入画布-json

## 2. 画布接入
- [√] 2.1 在 `frontend/src/components/canvas/DrawingController.tsx` 中新增右键菜单“复制/导入 JSON”，验证 why.md#需求-画布内容-json-复制导入-场景-复制画布-json
- [√] 2.2 在 `frontend/src/components/canvas/DrawingController.tsx` 中接入导入追加逻辑（Paper.js 追加导入 + store 合并），验证 why.md#需求-画布内容-json-复制导入-场景-导入画布-json，依赖任务1.2

## 3. 对话框接入
- [√] 3.1 在 `frontend/src/components/chat/AIChatDialog.tsx` 中新增右键菜单与复制 JSON/文本入口，验证 why.md#需求-对话内容-json文本-复制导入-场景-复制对话-json文本
- [√] 3.2 在 `frontend/src/components/chat/AIChatDialog.tsx` 中接入对话 JSON 导入追加逻辑，验证 why.md#需求-对话内容-json文本-复制导入-场景-导入对话-json，依赖任务1.2

## 4. 快捷键接入
- [√] 4.1 在 `frontend/src/components/KeyboardShortcuts.tsx` 中新增复制/导入 JSON 快捷键（根据当前焦点区域分发），验证 why.md#需求-画布内容-json-复制导入-场景-复制画布-json

## 5. 安全检查
- [√] 5.1 执行安全检查（按G9: 输入验证、敏感信息处理、权限控制、EHRB风险规避）

## 6. 文档更新
- [√] 6.1 更新 `helloagents/wiki/modules/frontend-canvas.md` 记录画布 JSON 复制/导入
- [√] 6.2 更新 `helloagents/wiki/modules/frontend-stores.md` 记录对话会话 JSON 合并规则

## 7. 测试
- [-] 7.1 手动测试：画布/对话复制、跨项目导入、含非持久化图片的清理提示
> 备注: 本地未执行手动测试。
