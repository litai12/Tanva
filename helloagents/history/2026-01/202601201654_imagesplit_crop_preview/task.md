# 任务清单: ImageSplit 裁剪链路输入展示修复

目录: `helloagents/plan/202601201654_imagesplit_crop_preview/`

---

## 1. Flow 节点输入解析
- [√] 1.1 在 `frontend/src/components/flow/nodes/ImageNode.tsx` 中修复上游 image 节点解析顺序，并支持读取上游 image 的 crop 作为裁剪预览，验证 why.md#需求-imageSplit-生成节点的裁剪输入下游可用-场景-imagesplit---image
- [-] 1.2 在 `frontend/src/components/flow/FlowOverlay.tsx` 中运行时解析图片输入时支持 image/imagePro 的 crop 裁剪，验证 why.md#需求-imageSplit-生成节点的裁剪输入下游可用-场景-imagesplit---image---generate4
  > 备注: 已存在，无需变更

## 2. 安全检查
- [√] 2.1 执行安全检查（按G9: 输入验证、敏感信息处理、权限控制、EHRB风险规避）

## 3. 文档更新
- [√] 3.1 更新 `helloagents/wiki/modules/frontend-flow.md`

## 4. 测试
- [-] 4.1 手动验证：ImageSplit -> Image / ImageGrid / Generate4 的裁剪预览与运行输入
  > 备注: 未执行
