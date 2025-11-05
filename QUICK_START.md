# 🚀 抠图功能快速启动指南

## 1️⃣ 前置准备

### 确保库已安装
```bash
# 前端
npm install @imgly/background-removal onnxruntime-web

# 后端
cd server
npm install @imgly/background-removal-node
cd ..
```

## 2️⃣ 启动应用

### 启动后端服务器
```bash
cd server
npm run dev
```
- 输出: `Server running on http://localhost:4000`
- 检查: `curl http://localhost:4000/api/health`

### 启动前端应用（新终端）
```bash
npm run dev
```
- 输出: `Local: http://localhost:5173`
- 打开浏览器访问该地址

## 3️⃣ 使用抠图功能

### 找到魔棒按钮
![](docs/images/toolbar-wand-button.png)
- 位置: 左侧工具栏右下方
- 图标: ✨ 紫色魔棒(Wand2)
- 状态: 灰色(未激活) → 蓝紫色(激活)

### 完整流程

```
1. 点击魔棒按钮
   ↓
2. 右侧弹出 "Background Removal" 面板
   ↓
3. 点击 "Select Image" 或拖放图片
   ↓
4. 选择本地图片文件 (PNG/JPG/GIF/WebP, 最大100MB)
   ↓
5. 自动显示图片预览
   ↓
6. 点击 "Remove Background" 按钮
   ↓
7. 等待处理 (通常1-10秒)
   ↓
8. 图片自动添加到Paper.js画布中心
   ↓
9. 继续编辑(移动、缩放、旋转)或导出
```

## 4️⃣ 导出抠图结果

### 方式1: 直接下载PNG
```
1. 点击工具栏 "Background Removed Export" 面板
2. 选择要导出的图像
3. 点击 "下载PNG" 按钮
4. 文件保存为 background-removed-xxxxx.png
```

### 方式2: 复制到剪贴板
```
1. 同上打开导出面板
2. 选择图像
3. 点击 "复制" 按钮
4. 在PS、AI等软件中 Cmd+V 粘贴
```

### 方式3: 在画布继续编辑
```
1. 图像已在Paper.js中,可以:
   - 拖动改变位置
   - 缩放改变大小
   - 旋转改变角度
   - 与其他图形结合
2. 最后导出整个画布
```

## 5️⃣ 常见问题

### Q: 图片太大,处理很慢?
```
A: 预期行为。大图会自动发送到后端处理
   - < 2MB: 前端处理,毫秒级
   - > 2MB: 后端处理,秒级
   等待即可,质量更高
```

### Q: 出现错误信息?
```
A: 查看浏览器控制台和服务器日志

   后端日志位置:
   - 服务器终端输出
   - 查看 "✅" 或 "❌" 符号

   前端日志位置:
   - F12 打开开发者工具
   - 控制台标签查看日志
```

### Q: 背景移除效果不好?
```
A: 尝试:
   1. 使用高清图像(分辨率越高越好)
   2. 确保主体和背景有清晰的对比
   3. 尝试后端处理(自动选择)
   4. 复杂背景可在导出后手动调整
```

### Q: 库加载失败?
```
A: 这是正常的 - 前端库是可选的

   自动降级流程:
   1. 尝试加载前端库
   2. 失败 → 自动使用后端API
   3. 用户无感知,不影响功能
```

## 6️⃣ 代码示例

### React组件中使用
```typescript
import backgroundRemovalService from '@/services/backgroundRemovalService';

// 移除背景
const result = await backgroundRemovalService.removeBackground(
  imageDataUrl,
  'image/png'
);

if (result.success) {
  console.log('处理方式:', result.method); // 'frontend' 或 'backend'
  console.log('耗时:', result.processingTime, 'ms');
  console.log('结果:', result.imageData); // base64 PNG
}
```

### Paper.js中使用
```typescript
import PaperBackgroundRemovalService from '@/services/paperBackgroundRemovalService';

// 添加到画布
const raster = PaperBackgroundRemovalService.addTransparentImageToCanvas(
  imageDataUrl,
  {
    x: 100,
    y: 100,
    width: 300,
    height: 300,
    name: 'removed-bg-image'
  }
);

// 导出为PNG
await PaperBackgroundRemovalService.downloadRasterAsPNG(
  raster,
  'my-image.png'
);
```

### API直接调用
```bash
curl -X POST http://localhost:4000/api/ai/remove-background \
  -H "Content-Type: application/json" \
  -d '{
    "imageData": "data:image/png;base64,...",
    "mimeType": "image/png",
    "source": "base64"
  }'

# 响应
{
  "success": true,
  "imageData": "data:image/png;base64,...",
  "format": "png"
}
```

## 7️⃣ 调试技巧

### 启用详细日志
```javascript
// 浏览器控制台
localStorage.setItem('debug', '*');
location.reload();
```

### 检查API是否可用
```bash
# 健康检查
curl http://localhost:4000/api/ai/background-removal-info

# 输出示例
{
  "available": true,
  "version": "1.0.0",
  "features": [
    "Remove background with transparency",
    "Support PNG, JPEG, GIF, WebP"
  ]
}
```

### 性能监测
```javascript
// 查看处理时间
const result = await backgroundRemovalService.removeBackground(imageData);
console.log(`处理耗时: ${result.processingTime}ms`);
console.log(`处理方式: ${result.method}`);
```

## 8️⃣ 常用命令

```bash
# 后端开发
cd server && npm run dev

# 前端开发
npm run dev

# 生产构建
npm run build

# 检查类型错误
npm run build -- --no-emit

# 清空缓存重启
rm -rf node_modules package-lock.json
npm install
```

## 9️⃣ 相关文件

| 文件 | 说明 |
|------|------|
| `BACKGROUND_REMOVAL_GUIDE.md` | 完整技术文档 |
| `INSTALLATION_REPORT.md` | 安装状态报告 |
| `CLAUDE.md` | 项目架构指南 |
| `src/services/backgroundRemovalService.ts` | 前端服务 |
| `server/src/ai/services/background-removal.service.ts` | 后端服务 |

## 🔟 获得帮助

### 查看日志
```bash
# 后端
npm run dev 2>&1 | grep "background\|Background\|remove"

# 前端 - 打开F12开发者工具
```

### 检查网络请求
```javascript
// 浏览器控制台
fetch('/api/ai/background-removal-info')
  .then(r => r.json())
  .then(console.log)
```

### 测试API
```bash
# 使用PostMan或Insomnia
# 地址: POST http://localhost:4000/api/ai/remove-background
# Body (JSON):
{
  "imageData": "base64图片数据或URL",
  "mimeType": "image/png",
  "source": "base64"或"url"
}
```

---

**立即开始**: `npm run dev` + 点击魔棒! ✨

**需要帮助**: 查看 `BACKGROUND_REMOVAL_GUIDE.md` 的故障排除章节
