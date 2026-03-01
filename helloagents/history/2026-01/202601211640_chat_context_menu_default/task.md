# 任务清单: 对话框右键菜单恢复为浏览器默认

目录: `helloagents/plan/202601211640_chat_context_menu_default/`

---

## 1. Chat 对话框
- [√] 1.1 在 `frontend/src/components/chat/AIChatDialog.tsx` 中移除自定义右键菜单触发与渲染，验证 why.md#需求-对话框右键菜单恢复默认-场景-对话框内容区域右键

## 2. 安全检查
- [√] 2.1 执行安全检查（按G9: 输入验证、敏感信息处理、权限控制、EHRB风险规避）

## 3. 文档更新
- [√] 3.1 更新 `helloagents/CHANGELOG.md`

## 4. 测试
- [-] 4.1 手动验证对话框内容区域右键菜单为浏览器默认，验证点: 默认菜单出现且无自定义菜单
  > 备注: 未在本地运行进行手动验证。
