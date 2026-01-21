# 技术设计: Generate 使用上游图片节点渲染图

## 技术方案
### 核心技术
- React + TypeScript
- React Flow

### 实现要点
- 定位 Generate run 输入解析逻辑，优先使用 Image 节点自身的 `imageData/imageUrl/thumbnail` 作为当前展示图。
- 当 Image 节点无本地数据时才回溯上游节点，避免链路解析导致空图。
- 保持对 `flow-asset:`/`blob:`/远程 URL/OSS key 的兼容，解析失败时对 proxy URL 进行带鉴权的兜底拉取。

## 安全与性能
- **安全:** 不新增外部输入通道，沿用已有图片校验/替换逻辑。
- **性能:** 仅在 run 时解析一次输入，避免重复计算。

## 测试与部署
- **测试:** 复现链路 Multi-generate → Image → Generate，点击 run 确认使用上游图片；断开上游后应提示缺失输入或不生成。
- **部署:** 前端构建流程不变。
