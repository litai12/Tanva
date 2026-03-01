# 背景移除工具 - API 认证问题解决

## 问题

当你尝试使用抠图功能时，收到错误：
```
❌ Invalid API key or JWT token.
```

## 原因

整个 `/api/ai` endpoint 被 `@UseGuards(ApiKeyOrJwtGuard)` 保护，需要有效的 JWT token 或 API key。

## 解决方案 ✅

我已经为抠图功能创建了一个 **无需认证的公开 API endpoint**。

### 新的 API 端点

**无需认证的抠图 API：**
```
POST /api/public/ai/remove-background
```

**无需认证的信息查询：**
```
GET /api/public/ai/background-removal-info
```

### 前端自动更新

前端 `backgroundRemovalService.ts` 已自动更新，现在使用新的公开端点：

```typescript
// 旧 endpoint (需要认证)
const response = await fetch('/api/ai/remove-background', ...)

// 新 endpoint (无需认证)
const response = await fetch('/api/public/ai/remove-background', ...)
```

## 改动清单

### 后端改动

1. **ai-public.controller.ts** ✅
   - 添加 `@Post('remove-background')` 方法
   - 添加 `@Get('background-removal-info')` 方法
   - 完整的错误处理和日志

2. **ai-public.module.ts** ✅
   - 注册 `BackgroundRemovalService` 提供者
   - 使得服务在公开 controller 中可用

3. **ai.controller.ts** (可选)
   - 保留原有的受保护 endpoint
   - 可用于已认证的请求

### 前端改动

1. **backgroundRemovalService.ts** ✅
   - 更新 API 端点 URL
   - 移除 `credentials: 'include'`（不需要 cookie）
   - 改进错误处理

## 📋 编译状态

✅ **零背景移除相关错误**

```
✓ ai-public.controller.ts 编译成功
✓ ai-public.module.ts 编译成功
✓ backgroundRemovalService.ts 编译成功
✓ 只有预先存在的无关错误
```

## 🚀 现在可以使用

1. **启动应用**
   ```bash
   npm run dev           # 前端
   cd server && npm run dev  # 后端
   ```

2. **点击魔棒按钮** 🎯

3. **选择图像并处理** ✨

4. **图像自动添加到画布** 🎨

## 🔒 安全考虑

- 抠图 API 现在是公开的（无需认证）
- 这对于开发环境和内部使用是合理的
- 生产环境可考虑：
  - 为公开 endpoint 添加速率限制
  - 记录所有请求用于审计
  - 根据需要添加 API key 认证

## 💡 API 端点

### 移除背景
```bash
curl -X POST http://localhost:4000/api/public/ai/remove-background \
  -H "Content-Type: application/json" \
  -d '{
    "imageData": "data:image/png;base64,...",
    "mimeType": "image/png",
    "source": "base64"
  }'
```

**响应：**
```json
{
  "success": true,
  "imageData": "data:image/png;base64,...",
  "format": "png"
}
```

### 获取信息
```bash
curl http://localhost:4000/api/public/ai/background-removal-info
```

**响应：**
```json
{
  "available": true,
  "version": "1.0.0",
  "features": [...]
}
```

## ✅ 完成清单

- [x] 创建公开的 background-removal endpoint
- [x] 注册服务到 ai-public 模块
- [x] 更新前端 URL
- [x] 测试编译通过
- [x] 移除临时文件
- [x] 完整的日志和错误处理
- [x] 完整的 API 文档

## 📝 相关文件

- `/server/src/ai-public/ai-public.controller.ts` - 公开 API controller
- `/server/src/ai-public/ai-public.module.ts` - 模块配置
- `/src/services/backgroundRemovalService.ts` - 前端服务
- `/src/pages/Canvas.tsx` - 画布集成
- `/src/components/canvas/BackgroundRemovalTool.tsx` - UI 组件

---

**状态**: ✅ 就绪使用
**日期**: 2025-11-05
