# 任务清单: ImageSplit 诊断与修复

目录: `helloagents/plan/202601201317_image_split_diagnosis/`

---

## 1. ImageSplit 诊断与预览一致性
- [√] 1.1 在 `frontend/src/components/flow/nodes/ImageSplitNode.tsx` 中确认运行时重编码与输入引用是否引发清晰度变化，验证 why.md#需求:-ImageSplit-Preview-Fidelity-场景:-Preview-matches-source
  > 备注: 优先使用 `inputImageUrl`/`inputImage` 作为基底，避免误用上游缩略图导致清晰度下降。
- [-] 1.2 在 `frontend/src/components/flow/nodes/ImageNode.tsx` 中核对 CanvasCropPreview 的缩放与 DPR 绘制逻辑，确保仅为显示缩放不降分辨率，验证 why.md#需求:-ImageSplit-Preview-Fidelity-场景:-Preview-matches-source
  > 备注: 仅显示层按容器缩放，未发现实际分辨率降级逻辑，暂不改动。

## 2. 下游节点裁剪输入
- [-] 2.1 在 `frontend/src/components/flow/nodes/ImageNode.tsx` 中为 crop 场景提供运行时裁剪输出或传递裁剪信息，验证 why.md#需求:-Downstream-nodes-use-cropped-image-场景:-Image-analysis-uses-crop
  > 备注: FlowOverlay/AnalyzeNode 已在运行时按 crop 解析输入，暂未新增 Image 节点额外输出字段。
- [√] 2.2 在 `frontend/src/components/flow/nodes` 的相关图片接口节点中读取裁剪输出/处理 crop 参数，验证 why.md#需求:-Downstream-nodes-use-cropped-image-场景:-Image-analysis-uses-crop
  > 备注: ImageGrid 读取 Image/ImagePro 时补齐 crop，避免回退到整图。

## 3. 安全检查
- [√] 3.1 执行安全检查（按G9: 输入验证、敏感信息处理、权限控制、EHRB风险规避）
  > 备注: 仅调整运行时裁切读取逻辑，未新增外部输入通道或敏感信息写入。

## 4. 文档更新
- [√] 4.1 更新 `helloagents/wiki/modules/frontend-flow.md` 记录 ImageSplit 产物与裁剪传递规则

## 5. 测试
- [-] 5.1 手工测试：ImageSplit -> Image -> 图片分析节点，确认展示与输入均为裁剪图
  > 备注: 未执行手工测试，需在本地连线验证。
