# 任务清单: Image 节点发送到画布

目录: `helloagents/plan/202601201727_image_send_to_canvas/`

---

## 1. Flow Image 节点增强
- [√] 1.1 在 `frontend/src/components/flow/FlowOverlay.tsx` 注入 Image 节点的 onSend 回调，复用现有发送逻辑，验证 why.md#需求-image-节点发送到画布-场景-image-节点存在图片
- [√] 1.2 在 `frontend/src/components/flow/nodes/ImageNode.tsx` 增加“发送到画布”按钮（内置操作区左侧），并绑定 onSend，验证 why.md#需求-image-节点发送到画布-场景-image-节点无图片

## 2. 安全检查
- [√] 2.1 执行安全检查（按G9: 输入验证、敏感信息处理、权限控制、EHRB风险规避）

## 3. 文档更新
- [√] 3.1 更新 `helloagents/wiki/modules/frontend-flow.md`

## 4. 测试
- [-] 4.1 手动验证：Image 节点发送到画布功能（有图/无图）
  > 备注: 未执行

## 执行补充
- Image 节点发送到画布时新增裁剪支持，确保 `crop` 图像发送为裁剪结果。
