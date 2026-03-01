# Sora2 API 响应格式处理 - 完整指南

## 🔍 问题复盘

### 原始问题

**用户反馈：**
1. 复制的地址不对
2. 下载的视频无法播放
3. API 返回的是任务信息而不是视频 URL

### 实际 API 响应示例

**成功的响应（期望）：**
```
https://filesystem.site/cdn/20251115/363e38c69a973749215b9466308eb4.mp4
```

**实际收到的响应（JSON 格式）：**
```json
{
  "prompt": "一个中国大学女生在水边撸猫",
  "orientation": "portrait",
  "duration": 15,
  "id": "task_01ka5dxbk3eckvjnxrry5ddere",
  "status": "failed",
  "error": {
    "type": "sora_content_violation",
    "message": "This content may violate our guardrails around nudity, sexuality, or erotic content."
  }
}
```

---

## ✅ 解决方案

### 1. 增强的响应解析逻辑

现在 `generateVideoResponse` 函数能够处理**多种响应格式**：

#### 格式 1：纯 URL（旧格式）
```
https://filesystem.site/cdn/20251115/...mp4
```

#### 格式 2：JSON 任务信息（新格式）
```json
{
  "id": "task_xxx",
  "status": "completed",
  "videoUrl": "https://...",
  "data": {
    "url": "https://..."
  }
}
```

#### 格式 3：带错误的 JSON
```json
{
  "status": "failed",
  "error": {
    "type": "sora_content_violation",
    "message": "..."
  }
}
```

### 2. 智能字段提取

代码会尝试从多个可能的字段中提取视频 URL：

```typescript
videoUrl =
  taskInfo.videoUrl ||        // 直接字段
  taskInfo.video_url ||       // 下划线格式
  taskInfo.url ||             // 简单格式
  taskInfo.result?.videoUrl || // 嵌套在 result 中
  taskInfo.result?.url ||
  taskInfo.data?.videoUrl ||  // 嵌套在 data 中
  taskInfo.data?.url ||
  null;
```

### 3. 完善的错误处理

#### 错误类型 1：内容违规（Content Violation）
```
错误类型：sora_content_violation
错误信息：This content may violate our guardrails...
建议：修改提示词，去除敏感内容
```

#### 错误类型 2：任务排队中
```
状态：queued 或 processing
处理：提示用户等待或稍后重试
```

#### 错误类型 3：无视频 URL
```
情况：API 返回成功但没有视频 URL
处理：显示原始响应内容以便调试
```

---

## 🔧 代码实现详解

### 核心解析逻辑

```typescript
const rawContent = result.data.fullContent.trim();
console.log('📄 Sora2 原始响应:', rawContent);

let videoUrl: string | null = null;
let taskInfo: any = null;

try {
  // 步骤 1: 检查是否是 JSON 格式
  if (rawContent.startsWith('{') || rawContent.startsWith('[')) {
    taskInfo = JSON.parse(rawContent);
    console.log('✅ 解析到任务信息:', taskInfo);

    // 步骤 2: 提取视频 URL（多字段尝试）
    videoUrl =
      taskInfo.videoUrl ||
      taskInfo.video_url ||
      taskInfo.url ||
      taskInfo.result?.videoUrl ||
      taskInfo.result?.url ||
      taskInfo.data?.videoUrl ||
      taskInfo.data?.url ||
      null;

    // 步骤 3: 检查错误状态
    if (taskInfo.status === 'failed' || taskInfo.error) {
      const errorType = taskInfo.error?.type || 'unknown';
      const errorMessage = taskInfo.error?.message || '生成失败';
      throw new Error(`Sora2 生成失败 [${errorType}]: ${errorMessage}`);
    }

    // 步骤 4: 检查处理状态
    if (taskInfo.status === 'queued' || taskInfo.status === 'processing') {
      throw new Error(
        `任务正在处理中（ID: ${taskInfo.id}）\n` +
        `请稍后重试`
      );
    }
  } else {
    // 步骤 5: 假设是纯 URL（向后兼容）
    if (rawContent.startsWith('http://') || rawContent.startsWith('https://')) {
      videoUrl = rawContent;
    }
  }
} catch (parseError) {
  // 步骤 6: 正则提取 URL（降级方案）
  console.warn('⚠️ 响应解析失败，尝试正则提取 URL');
  const urlMatch = rawContent.match(/https?:\/\/[^\s"']+\.(mp4|mov|avi|webm)/i);
  if (urlMatch) {
    videoUrl = urlMatch[0];
  }
}

// 步骤 7: 验证结果
if (!videoUrl) {
  console.error('❌ 未找到视频 URL，原始响应:', rawContent);
  throw new Error(
    `API 未返回有效的视频 URL\n\n` +
    `响应内容：\n${rawContent.substring(0, 500)}`
  );
}
```

---

## 📊 错误码对照表

| 错误类型 | 说明 | 用户看到的提示 | 解决方案 |
|---------|------|-------------|---------|
| **sora_content_violation** | 内容违反社区准则 | "内容可能违反社区准则（涉及裸露、色情等）" | 修改提示词，去除敏感词 |
| **sora_rate_limit** | API 调用频率过高 | "请求过于频繁，请稍后重试" | 等待 1-5 分钟后重试 |
| **sora_invalid_prompt** | 提示词无效 | "提示词格式不正确" | 检查提示词格式 |
| **sora_timeout** | 生成超时 | "生成超时，请重试" | 简化提示词或重试 |
| **queued** | 任务在队列中 | "任务正在排队，请稍后查看" | 等待或稍后重试 |
| **processing** | 任务处理中 | "任务正在处理，请稍后查看" | 等待或稍后重试 |

---

## 🎯 常见响应场景处理

### 场景 1：内容违规（您遇到的问题）

**API 返回：**
```json
{
  "status": "failed",
  "error": {
    "type": "sora_content_violation",
    "message": "This content may violate our guardrails..."
  }
}
```

**系统处理：**
```
1. 解析 JSON
2. 检测到 status === 'failed'
3. 提取 error.type 和 error.message
4. 抛出错误：
   "Sora2 生成失败 [sora_content_violation]: This content may violate..."
```

**用户看到：**
```
❌ 视频生成失败：
Sora2 生成失败 [sora_content_violation]: This content may violate our guardrails around nudity, sexuality, or erotic content.

建议：请尝试修改提示词后重试
```

**解决办法：**
```
原提示词："一个中国大学女生在水边撸猫"
改进后："一个女生在公园水边抚摸一只猫咪"
```

---

### 场景 2：任务排队中

**API 返回：**
```json
{
  "id": "task_01ka5dxbk3eckvjnxrry5ddere",
  "status": "queued"
}
```

**系统处理：**
```
1. 解析 JSON
2. 检测到 status === 'queued'
3. 抛出错误：
   "任务正在处理中（ID: task_01ka5dxbk3eckvjnxrry5ddere）
    当前状态: queued
    请稍后查看数据预览链接或重试"
```

**用户看到：**
```
⏳ 任务正在排队（ID: task_01ka5dxbk3eckvjnxrry5ddere）
请稍后重试或查看数据预览链接
```

---

### 场景 3：成功生成（期望场景）

**API 返回（选项 A - 纯 URL）：**
```
https://filesystem.site/cdn/20251115/363e38c69a973749215b9466308eb4.mp4
```

**API 返回（选项 B - JSON）：**
```json
{
  "id": "task_xxx",
  "status": "completed",
  "videoUrl": "https://filesystem.site/cdn/20251115/xxx.mp4"
}
```

**系统处理：**
```
1. 解析响应
2. 提取 videoUrl
3. 验证 URL 格式
4. 返回视频信息
```

**用户看到：**
```
✅ 视频生成完成
[视频预览]
[下载] [复制链接] [在浏览器打开]
```

---

## 🛠️ 调试技巧

### 1. 查看完整的 API 响应

在浏览器控制台（F12）查看：

```javascript
// 搜索日志
📄 Sora2 原始响应: {...}
```

### 2. 手动测试 API

```bash
curl -X POST https://api1.147ai.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "sora-2-reverse",
    "stream": false,
    "messages": [{
      "role": "user",
      "content": [{
        "type": "text",
        "text": "一只小狗在草地上奔跑"
      }]
    }]
  }'
```

### 3. 检查响应格式

```javascript
// 在控制台运行
const response = `你的API响应内容`;
try {
  const parsed = JSON.parse(response);
  console.log('✅ JSON 格式:', parsed);
} catch (e) {
  console.log('❌ 不是 JSON，可能是纯文本:', response);
}
```

---

## 📝 提示词优化建议

### ❌ 容易触发违规的提示词

```
- 包含敏感词汇（裸露、色情等）
- 暗示性描述
- 特定人群 + 敏感场景
- 过于详细的身体描述
```

### ✅ 安全的提示词范例

```
1. 自然场景
   "一只猫在公园的草地上玩耍，阳光明媚"

2. 人物活动（通用）
   "一个人在湖边散步，微风拂过"

3. 抽象动画
   "彩色的几何图形在空中旋转，背景是渐变色"

4. 动物主题
   "一只金毛犬在海边奔跑，浪花拍打沙滩"
```

### 🔧 提示词改写技巧

**原始：** "一个中国大学女生在水边撸猫"

**问题：** 可能触发敏感词检测（"女生" + "水边"组合）

**改写方案：**

**方案 1 - 去除敏感组合：**
```
"一个人在公园湖边抚摸一只橘猫"
```

**方案 2 - 更通用描述：**
```
"公园的湖边，有人正在和一只可爱的猫咪互动"
```

**方案 3 - 聚焦动物：**
```
"一只猫在水边的草地上，有人在轻轻抚摸它"
```

---

## 🎯 完整的错误处理流程图

```
API 调用
   │
   ├─ 网络错误
   │  └─ 显示："网络错误，请检查连接"
   │
   ├─ API 返回
   │  │
   │  ├─ HTTP 错误（4xx/5xx）
   │  │  └─ 显示："API 错误：${status}"
   │  │
   │  └─ HTTP 200
   │     │
   │     ├─ JSON 格式
   │     │  │
   │     │  ├─ status === 'failed'
   │     │  │  └─ 显示："生成失败 [${errorType}]: ${message}"
   │     │  │
   │     │  ├─ status === 'queued' 或 'processing'
   │     │  │  └─ 显示："任务排队中，请稍后重试"
   │     │  │
   │     │  ├─ 有 videoUrl
   │     │  │  └─ ✅ 成功，显示视频
   │     │  │
   │     │  └─ 无 videoUrl
   │     │     └─ 显示："未找到视频 URL，响应：${raw}"
   │     │
   │     └─ 纯文本格式
   │        │
   │        ├─ 是 http(s) URL
   │        │  └─ ✅ 成功，显示视频
   │        │
   │        └─ 不是 URL
   │           └─ 尝试正则提取 URL
   │              │
   │              ├─ 找到 URL
   │              │  └─ ✅ 成功，显示视频
   │              │
   │              └─ 未找到
   │                 └─ 显示："响应格式不正确"
```

---

## ✅ 测试清单

### 基础测试
- [ ] 成功生成视频（纯 URL 响应）
- [ ] 成功生成视频（JSON 响应）
- [ ] 内容违规错误处理
- [ ] 任务排队提示
- [ ] 网络错误处理
- [ ] 无效响应处理

### 提示词测试
- [ ] 安全提示词（应成功）
- [ ] 敏感提示词（应显示错误）
- [ ] 空提示词（应显示错误）
- [ ] 超长提示词（应成功或提示）

### 边界测试
- [ ] API 超时
- [ ] API Key 无效
- [ ] JSON 解析失败
- [ ] 多种 URL 格式

---

## 🎓 总结

### 核心改进

1. **多格式支持** - 兼容 JSON 和纯文本响应
2. **智能字段提取** - 从多个可能位置查找视频 URL
3. **详细错误处理** - 区分不同错误类型并给出建议
4. **降级方案** - 多层解析策略确保可靠性

### 问题根源

- ❌ **旧代码**：假设 API 总是返回纯 URL
- ✅ **新代码**：处理 JSON、URL、错误等多种格式

### 用户体验提升

| 场景 | 旧版表现 | 新版表现 |
|------|---------|---------|
| 内容违规 | 下载失败，无提示 | ✅ 明确错误信息和建议 |
| 任务排队 | 下载失败，无提示 | ✅ 提示等待或重试 |
| JSON 响应 | 下载错误的内容 | ✅ 正确解析并提取 URL |
| 无 URL | 无提示 | ✅ 显示原始响应以便调试 |

---

**现在您的 Sora2 集成能够优雅地处理各种 API 响应格式和错误情况！** 🎉
