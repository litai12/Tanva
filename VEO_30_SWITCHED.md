# 🔄 已切换到 Veo 3.0 Fast 模型

## 📝 更新内容

已将视频生成模型从 **Veo 3.1** 切换到 **Veo 3.0 Fast**：

```typescript
// 旧配置
private readonly VIDEO_MODEL = 'veo-2-exp'; // Veo 3.1

// 新配置
private readonly VIDEO_MODEL = 'veo-3.0-fast-generate-001'; // Veo 3.0 Fast
```

---

## 🎬 模型对比

| 特性 | Veo 3.1 | Veo 3.0 Fast |
|------|---------|--------------|
| **模型 ID** | veo-2-exp | veo-3.0-fast-generate-001 |
| **质量** | 最高 | 高 |
| **生成速度** | 中等 | ⚡ 快速 |
| **分辨率** | 720p/1080p | 720p/1080p |
| **时长** | 4/6/8秒 | 4/6/8秒 |
| **配额使用** | 更多 | ✅ 更少 |
| **成本** | 更高 | ✅ 更低 |

---

## 🚀 现在可以做什么

### 立即测试
1. 访问测试页面：http://localhost:5173/veo-test
2. 点击"运行所有测试"
3. Veo 3.0 Fast 应该有独立的配额

### 对比测试（后续）
- ✅ 先用 Veo 3.0 Fast 测试功能
- 📊 对比生成效果
- 🔄 当 Veo 3.1 配额恢复后进行对比

---

## ✨ Veo 3.0 Fast 的优势

- ✅ **配额独立** - 有自己的配额限制
- ✅ **生成快速** - "Fast" 就是快速的意思
- ✅ **成本更低** - 按使用量计费更便宜
- ✅ **功能完整** - 支持同样的参数和配置
- ✅ **质量仍高** - Google 的先进模型

---

## 📋 日志输出显示

启动应用时，您会看到：
```
✅ Veo 视频服务初始化成功
📹 当前使用模型: Veo 3.0 Fast (veo-3.0-fast-generate-001)
```

---

## 🎯 下一步

### 立即
1. 刷新浏览器
2. 打开测试页面
3. 尝试运行测试

### 如果还是超限
- Veo 3.0 可能也共享配额
- 等待配额重置
- 或升级 API 配额

### 当 Veo 3.1 配额恢复
- 可以切换回 Veo 3.1 对比效果
- 代码中注释有快速切换方式

---

## 🔧 快速切换回 Veo 3.1

如果需要切换回 Veo 3.1（配额充足时）：

编辑 `src/services/veoVideoService.ts` 第 30 行：

```typescript
// 改为
private readonly VIDEO_MODEL = 'veo-2-exp';
```

然后刷新页面即可。

---

**现在开始测试吧！🎬**

访问：http://localhost:5173/veo-test
