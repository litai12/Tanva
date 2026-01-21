# 任务清单: Generate 使用上游图片节点渲染图

目录: `helloagents/history/2026-01/202601211547_generate_uses_upstream_image/`

---

## 1. 生成链路输入解析
- [√] 1.1 在 `frontend/src/components/flow/FlowOverlay.tsx` 中定位 Generate run 的输入解析逻辑，确认上游 Image 节点数据来源并补齐当前展示图的优先级，验证 why.md#需求-generate-读取上游图片-场景-使用-image-节点展示图
- [-] 1.2 在 `frontend/src/components/flow/nodes/ImageNode.tsx`（或相关节点文件）中确保“当前渲染图”可被下游读取，避免走 Image Split 分支，依赖任务1.1
> 备注: 通过 FlowOverlay 输入解析优先使用 Image 节点当前数据即可覆盖问题，无需改动 ImageNode。

## 2. 安全检查
- [√] 2.1 执行安全检查（按G9: 输入验证、敏感信息处理、权限控制、EHRB风险规避）

## 3. 测试
- [-] 3.1 手动复现 Multi-generate → Image → Generate，点击 run 确认使用上游图片；断开上游后应提示缺失输入或不生成
> 备注: 未在本地执行手动验证。
