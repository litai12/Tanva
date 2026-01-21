# 任务清单: 画布图片预览历史列表

目录: `helloagents/plan/202601211650_paper_image_history/`

---

## 1. 画布图片预览
- [√] 1.1 在 `frontend/src/components/canvas/ImageContainer.tsx` 中调整预览集合来源为项目历史列表，确保主预览优先显示当前双击图片，验证 why.md#需求-画布图片双击预览-场景-查看项目历史图片
- [-] 1.2 在 `frontend/src/components/ui/ImagePreviewModal.tsx` 中确认缩略图高亮与切换逻辑适配历史列表（必要时微调），验证 why.md#需求-画布图片双击预览-场景-查看项目历史图片
  > 备注: 当前逻辑已支持历史列表导航，无需额外修改。

## 2. 安全检查
- [√] 2.1 执行安全检查（按G9: 输入验证、敏感信息处理、权限控制、EHRB风险规避）

## 3. 文档更新
- [√] 3.1 更新 `helloagents/wiki/modules/frontend-canvas.md` 同步预览历史行为说明

## 4. 测试
- [ ] 4.1 手动验证双击画布图片打开预览后右侧展示项目历史列表，切换缩略图更新主图，当前预览不被自动替换
