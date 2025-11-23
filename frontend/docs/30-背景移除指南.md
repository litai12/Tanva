# 抠图功能使用指南

## 功能概述

本功能集成了专业级的背景移除(图像抠图)能力,支持:

- ✅ **AI自动背景移除** - 使用开源深度学习模型,精确分离主体和背景
- ✅ **透明PNG输出** - 生成真正的透明背景图像(RGBA格式)
- ✅ **混合处理架构** - 小图前端快速处理,大图后端高质量处理
- ✅ **Paper.js无缝集成** - 直接添加到画布继续编辑
- ✅ **多种导出方式** - 下载PNG、复制到剪贴板、继续编辑

## 架构说明

### 后端服务
- **文件**: `server/src/ai/services/background-removal.service.ts`
- **API**: `POST /api/ai/remove-background`
- **库**: `@imgly/background-removal-node` (ONNX模型)
- **特性**: 高质量、支持大图、无前端加载时间

### 前端服务
- **文件**: `src/services/backgroundRemovalService.ts`
- **库**: `@imgly/background-removal` (可选,用于快速预览)
- **特性**: 本地处理、无隐私泄露、毫秒级响应

### Paper.js集成
- **文件**: `src/services/paperBackgroundRemovalService.ts`
- **功能**:
  - 将透明PNG转换为Paper.js Raster
  - 支持位置、大小、旋转调整
  - 导出为PNG、下载、复制到剪贴板

## 使用流程

### 1. 打开抠图工具
在工具栏右侧找到 **魔棒图标** (✨ Wand2Icon),点击打开抠图工具

### 2. 选择图像
- 点击 "Select Image" 按钮
- 从文件系统选择要抠图的图像
- 支持格式: PNG、JPG、JPEG、GIF、WebP
- 最大支持 100MB

### 3. 移除背景
- 点击 "Remove Background" 按钮
- 小图(<2MB)会在前端快速处理(毫秒级)
- 大图会自动发送到后端处理(秒级)
- 实时显示处理方法和耗时

### 4. 添加到画布
- 处理完成后自动添加到Paper.js画布
- 新图像位置在画布中心
- 自动选中,可以继续编辑(移动、缩放、旋转)

### 5. 导出结果
点击工具栏"Background Removed Export"面板,可以:
- **下载PNG**: 导出为透明PNG文件
- **复制到剪贴板**: 快速复制到其他应用
- **删除**: 从画布删除

## 技术细节

### 文件结构
```
后端:
server/src/ai/
├── services/background-removal.service.ts   # 核心服务
├── dto/background-removal.dto.ts            # 数据模型
├── ai.controller.ts                         # API路由 (/api/ai/remove-background)
└── ai.module.ts                             # 模块注册

前端:
src/
├── services/
│   ├── backgroundRemovalService.ts          # 前后端协调
│   └── paperBackgroundRemovalService.ts     # Paper.js集成
├── components/canvas/
│   ├── BackgroundRemovalTool.tsx            # 抠图工具UI
│   └── BackgroundRemovedImageExport.tsx     # 导出面板
└── components/toolbar/ToolBar.tsx           # 工具栏集成
```

### 处理流程
```
用户选择图像
    ↓
前端判断图像大小和浏览器能力
    ↓
├─ 小图(<2MB) + WebGPU支持 → 前端处理(40-80MB模型)
│                           → 毫秒级响应
│
└─ 大图(>2MB) 或 无WebGPU   → 后端处理(中等模型)
                            → 调用 /api/ai/remove-background
                            → 秒级响应

处理完成(透明PNG) → 添加到Paper.js → 可继续编辑 → 导出
```

### API 请求示例
```bash
# 请求格式
curl -X POST http://localhost:4000/api/ai/remove-background \
  -H "Content-Type: application/json" \
  -d '{
    "imageData": "data:image/png;base64,...",
    "mimeType": "image/png",
    "source": "base64"
  }'

# 响应格式
{
  "success": true,
  "imageData": "data:image/png;base64,...",
  "format": "png"
}
```

### 性能指标
- **前端处理**: 100KB-2MB 图像 → 50-500ms (取决于硬件)
- **后端处理**: 2MB-50MB 图像 → 1-10秒 (取决于图像复杂度)
- **模型大小**:
  - 前端小模型: 40MB
  - 后端中模型: 80MB
- **输出**: 总是 PNG + 透明alpha通道

## 限制和注意事项

### 当前限制
- ❌ 不支持Gemini API(它不输出透明PNG)
- ❌ 不支持视频或动画GIF处理
- ❌ 前端模型不支持非常大的图像(>4000px)

### 推荐用途
- ✅ 人物肖像背景移除
- ✅ 产品摄影抠图
- ✅ 物体隔离
- ✅ 头发、细节边缘处理

### 图像质量提示
- 清晰、对比度高的图像效果最好
- 复杂背景可能需要手动调整
- 透明度边缘可能有轻微毛边(正常现象)

## 故障排除

### 1. 前端模块加载失败
- 检查网络连接
- 清除浏览器缓存
- 尝试后端处理(自动降级)

### 2. 后端API返回错误
- 确认服务器正在运行: `npm run dev`
- 检查 `/api/ai/background-removal-info` 端点可用性
- 查看服务器日志输出

### 3. 处理速度慢
- 尝试前端处理小图
- 检查WebGPU支持: 浏览器控制台输入 `navigator.gpu`
- 后端处理需要时间,大图请耐心等待

### 4. 输出图像质量差
- 增加输入图像大小(分辨率)
- 尝试后端处理(质量更高)
- 手动调整不满意的区域

## 扩展建议

### 前端集成
- [ ] 添加实时预览
- [ ] 支持调整质量/模型大小
- [ ] 手动选区编辑(魔棒、套索工具)

### 后端增强
- [ ] 添加缓存机制(避免重复处理)
- [ ] 支持批量处理
- [ ] 添加自定义模型支持

### Paper.js集成
- [ ] 支持图层管理
- [ ] 支持多抠图合成
- [ ] 导出为其他格式(SVG、PDF)

## 相关文件映射

| 功能 | 文件位置 | 行数 |
|-----|--------|------|
| 后端服务 | server/src/ai/services/background-removal.service.ts | 1-200 |
| 前端服务 | src/services/backgroundRemovalService.ts | 1-250 |
| Paper.js服务 | src/services/paperBackgroundRemovalService.ts | 1-350 |
| 工具组件 | src/components/canvas/BackgroundRemovalTool.tsx | 1-180 |
| 导出面板 | src/components/canvas/BackgroundRemovedImageExport.tsx | 1-200 |
| 工具栏集成 | src/components/toolbar/ToolBar.tsx | 1-50, 160-210, 650-710 |

## 开发指南

### 如何修改模型大小
编辑 `server/src/ai/services/background-removal.service.ts`:
```typescript
// 改为小模型(更快但质量下降)
const result = await mod.removeBackground({
  data: buffer,
  mimeType,
  preview: true,  // 使用预览模式 = 小模型
  returnAsBlob: false,
});
```

### 如何添加新的导出格式
编辑 `src/services/paperBackgroundRemovalService.ts`:
```typescript
static async exportRasterAsJPEG(raster: paper.Raster): Promise<Blob> {
  const canvas = raster.canvas as HTMLCanvasElement;
  return new Promise((resolve) => {
    exportCanvas.toBlob(blob => resolve(blob), 'image/jpeg');
  });
}
```

### 如何集成自定义UI
参考 `src/components/canvas/BackgroundRemovalTool.tsx` 使用:
```typescript
import backgroundRemovalService from '@/services/backgroundRemovalService';

const result = await backgroundRemovalService.removeBackground(base64Image);
if (result.success) {
  // 使用 result.imageData (PNG base64)
}
```

---

**最后更新**: 2025-11-05
**版本**: 1.0.0
**许可证**: AGPL-3.0 (后端模型库)
