# 任务清单: 对话框图片模式可用性保护

目录: `helloagents/plan/202601211750_chat_image_mode_guard/`

---

## 1. AI 对话框模式可用性
- [√] 1.1 在 `frontend/src/components/chat/AIChatDialog.tsx` 中实现“图片数量→模式可用性”计算与工具提示文案，验证 why.md#需求-图片数量变化下的模式防护-场景-从单图切到多图
- [√] 1.2 在 `frontend/src/components/chat/AIChatDialog.tsx` 中为模式下拉与发送按钮接入可用性禁用/提示，并在发送入口追加校验，验证 why.md#需求-图片数量变化下的模式防护-场景-手动选择不兼容模式，依赖任务1.1

## 2. 安全检查
- [√] 2.1 执行安全检查（按G9: 输入验证、敏感信息处理、权限控制、EHRB风险规避）

## 3. 测试
- [-] 3.1 手动测试：单图/多图切换、Edit/Blend/Analyze/Auto 切换、发送按钮禁用与 tooltip 文案
  > 备注: 未执行（需在本地对话框手动验证）
