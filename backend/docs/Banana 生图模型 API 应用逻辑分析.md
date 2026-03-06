# Banana 生图模型 API 应用逻辑分析

## 一、模型节点类型概览

系统支持三种 Banana 生图模型节点：

### 1. Fast 节点 (banana-2.5)
- **模型名称**: `gemini-2.5-flash-image-preview`
- **特点**: 
  - 1代模型，高速稳定
  - 不支持 `aspectRatio` 和 `imageSize` 参数
  - 仅支持 1K 分辨率
- **使用场景**: 快速生成，对质量要求不高的场景

### 2. Pro 节点 (banana)
- **模型名称**: `gemini-3-pro-image-preview`
- **特点**:
  - 2代模型，品质最佳
  - 支持 `aspectRatio` 和 `imageSize` (1K/2K/4K)
  - 支持 `thinking_level` (high/low)
  - 建议避开高峰时段使用
- **使用场景**: 高质量图像生成

### 3. Ultra 节点 (banana-3.1)
- **模型名称**: `gemini-3.1-flash-image-preview`
- **特点**:
  - 最新模型，质量更高
  - 支持 `aspectRatio` 和 `imageSize` (0.5K/1K/2K/4K)
  - 支持 `thinking_level` (high/low)
- **使用场景**: 最高质量图像生成

## 二、后台管理切换逻辑

### 1. 系统设置键
- **设置键**: `banana_provider`
- **存储位置**: `SystemSetting` 表
- **管理界面**: `/admin` 页面的"系统设置"Tab

### 2. 支持的切换模式

```typescript
type BananaImageProvider = 
  | "auto"           // 自动切换（Apimart 优先）
  | "legacy_auto"     // 自动切换（147 优先）
  | "apimart"         // 强制使用 Apimart
  | "legacy"          // 强制使用 147 API
```

#### 模式说明：

**auto (自动切换 - Apimart 优先)**
- 优先尝试 Apimart API (`api.apimart.ai`)
- 失败后自动降级到 147 API (`api1.147ai.com`)
- 适合：希望使用最新 API，但需要降级保障

**legacy_auto (自动切换 - 147 优先)**
- 优先尝试 147 API (`api1.147ai.com`)
- 失败后自动降级到 Apimart API (`api.apimart.ai`)
- 适合：希望使用稳定 API，但需要新 API 作为备选

**apimart (强制 Apimart)**
- 仅使用 Apimart API
- 失败不降级，直接返回错误
- 适合：完全依赖 Apimart 的场景

**legacy (强制 147)**
- 仅使用 147 API
- 失败不降级，直接返回错误
- 适合：完全依赖 147 API 的场景

### 3. 切换逻辑实现

#### 后端实现位置
- **文件**: `backend/src/ai/providers/banana.provider.ts`
- **方法**: `getConfiguredImageProvider()` (第139-158行)

```typescript
private async getConfiguredImageProvider(): Promise<BananaImageProvider> {
  try {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: BANANA_PROVIDER_SETTING_KEY },
    });
    if (setting && ["auto", "legacy_auto", "apimart", "legacy"].includes(setting.value)) {
      return setting.value as BananaImageProvider;
    }
  } catch (error) {
    this.logger.warn(`读取 banana provider 设置失败: ${error.message}`);
  }
  return "auto"; // 默认值
}
```

#### 前端管理界面
- **文件**: `frontend/src/pages/Admin.tsx`
- **位置**: SettingsTab 组件 (第1967-2173行)

```typescript
const BANANA_PROVIDER_OPTIONS = [
  {
    value: "auto",
    label: "自动切换",
    description: "优先使用 Apimart，失败后自动切换到 147",
  },
  {
    value: "legacy_auto",
    label: "自动切换（147优先）",
    description: "优先使用 147，失败后自动切换到 Apimart",
  },
  {
    value: "apimart",
    label: "Apimart",
    description: "强制使用 Apimart (api.apimart.ai)",
  },
  {
    value: "legacy",
    label: "147",
    description: "强制使用 147 (api1.147ai.com)",
  },
];
```

## 三、节点应用逻辑

### 1. 前端节点类型判断

#### Generate4Node 组件
- **文件**: `frontend/src/components/flow/nodes/Generate4Node.tsx`
- **逻辑**: 根据 `aiProvider` 判断节点模式 (第181-193行)

```typescript
const providerMode = React.useMemo<"fast" | "pro" | "ultra" | "other">(() => {
  if (aiProvider === "banana-2.5") return "fast";
  if (aiProvider === "banana-3.1") return "ultra";
  if (aiProvider === "banana" || aiProvider === "gemini-pro") return "pro";
  return "other";
}, [aiProvider]);
```

#### 功能限制
- **Fast 模式**: 不显示 `aspectRatio` 和 `imageSize` 选择器
- **Pro/Ultra 模式**: 显示完整控制选项
- **Ultra 模式**: 额外支持 0.5K 分辨率

### 2. FlowOverlay 节点执行逻辑

#### 模型选择策略
- **文件**: `frontend/src/components/flow/FlowOverlay.tsx`
- **位置**: `runNode` 方法 (第8253-8261行)

```typescript
// 根据节点类型和全局模式选择模型
const nodeSpecificModel = (() => {
  // generatePro/generatePro4 始终使用 pro 模型
  if (node.type === "generatePro" || node.type === "generatePro4") {
    return "gemini-3-pro-image-preview";
  }
  // 其他节点（包括 generate/generate4/image 等）使用全局模型设置
  return imageModel;
})();
```

#### 参数处理
- **Fast 模式限制** (第8237-8251行):
  ```typescript
  const effectiveAspectRatio =
    node.type === "generate" && aiProvider === "banana-2.5"
      ? undefined  // Fast 模式不支持 aspectRatio
      : aspectRatioValue;
  
  const effectiveImageSize =
    node.type === "generate" && aiProvider === "banana-2.5"
      ? undefined  // Fast 模式不支持 imageSize
      : nodeSizeValue || imageSize || undefined;
  ```

### 3. 后端模型映射

#### 默认模型配置
- **文件**: `backend/src/ai/ai.controller.ts`
- **位置**: 第74-83行

```typescript
private readonly providerDefaultImageModels: Record<string, string> = {
  gemini: 'gemini-3-pro-image-preview',
  'gemini-pro': 'gemini-3-pro-image-preview',
  banana: 'gemini-3-pro-image-preview',           // Pro
  'banana-2.5': 'gemini-2.5-flash-image-preview',  // Fast
  'banana-3.1': 'gemini-3.1-flash-image-preview',  // Ultra
  runninghub: 'runninghub-su-effect',
  midjourney: 'midjourney-fast',
  nano2: 'gemini-3.1-flash-image-preview',
};
```

## 四、降级策略

### 1. 模型降级映射

- **文件**: `backend/src/ai/providers/banana.provider.ts`
- **位置**: 第92-100行

```typescript
private readonly FALLBACK_MODELS: Record<string, string> = {
  "gemini-3-pro-image-preview": "gemini-2.5-flash-image",        // Pro -> Fast
  "gemini-3.1-flash-image-preview": "gemini-3-pro-image-preview", // Ultra -> Pro
  "banana-gemini-3.1-flash-image-preview": "gemini-3-pro-image-preview",
  "gemini-3-pro-preview": "gemini-3-flash-preview",
  "banana-gemini-3-pro-preview": "gemini-3-flash-preview",
  "banana-gemini-3-pro-image-preview": "gemini-2.5-flash-image",
};
```

### 2. 降级触发条件

- **文件**: `backend/src/ai/providers/banana.provider.ts`
- **方法**: `shouldFallback()` (第195-210行)

触发降级的错误类型：
- 500系列服务器错误 (500, 502, 503, 504)
- 超时错误 (timeout)
- 模型不可用错误 (model not available)
- 速率限制错误 (rate limit, quota)
- 服务过载错误 (overloaded, capacity)

### 3. 降级执行流程

- **最大尝试次数**: `MAX_MODEL_ATTEMPTS = 3` (主模型 + 两级降级)
- **重试延迟**: `RETRY_DELAYS = [2000, 5000, 10000]` (递增延迟)

执行流程：
1. 尝试使用主模型
2. 如果失败且满足降级条件，降级到下一级模型
3. 最多尝试3次（主模型 + 2次降级）
4. 所有尝试失败后返回错误

## 五、API 调用流程

### 1. 147 API (Legacy) 调用流程

```
用户请求
  ↓
generateImageViaLegacy()
  ↓
normalizeLegacyImageModel()  // 模型名称规范化
  ↓
withRetry() + withTimeout()   // 重试和超时控制
  ↓
makeRequest()                 // 调用 147 API
  ↓
parseResponse()               // 解析响应
  ↓
返回结果或触发降级
```

### 2. Apimart API 调用流程

```
用户请求
  ↓
generateImageViaApimart()
  ↓
normalizeApimartImageModel()  // 模型名称规范化
  ↓
submitApimartTask()           // 提交任务
  ↓
waitForApimartTask()          // 轮询任务状态
  ├─ queryApimartTask()       // 查询任务状态
  └─ extractApimartImageUrl() // 提取图片URL
  ↓
返回结果
```

### 3. 自动切换流程

#### auto 模式 (Apimart 优先)
```
1. 尝试 Apimart API
   ├─ 成功 → 返回结果
   └─ 失败 → 降级到 147 API
       ├─ 成功 → 返回结果
       └─ 失败 → 返回错误
```

#### legacy_auto 模式 (147 优先)
```
1. 尝试 147 API
   ├─ 成功 → 返回结果
   └─ 失败 → 降级到 Apimart API
       ├─ 成功 → 返回结果
       └─ 失败 → 返回错误
```

## 六、关键配置参数

### 1. 超时设置
- **默认超时**: `DEFAULT_TIMEOUT = 300000` (5分钟)
- **适用场景**: 所有 API 调用

### 2. 重试设置
- **最大重试次数**: `MAX_RETRIES = 3`
- **重试延迟**: `[2000, 5000, 10000]` 毫秒

### 3. Apimart 轮询设置
- **初始延迟**: `APIMART_INITIAL_DELAY_MS = 8000` (8秒)
- **轮询间隔**: `APIMART_POLL_INTERVAL_MS = 3000` (3秒)
- **最大轮询次数**: `APIMART_POLL_MAX_ATTEMPTS = 120` (最多6分钟)

## 七、模型特性支持矩阵

| 特性 | Fast (2.5) | Pro (3.0) | Ultra (3.1) |
|------|-----------|-----------|-------------|
| aspectRatio | ❌ | ✅ | ✅ |
| imageSize | ❌ | ✅ (1K/2K/4K) | ✅ (0.5K/1K/2K/4K) |
| thinking_level | ❌ | ✅ | ✅ |
| 降级支持 | ✅ (作为降级目标) | ✅ (可降级到 Fast) | ✅ (可降级到 Pro) |

## 八、总结

### 架构特点
1. **三层模型体系**: Fast/Pro/Ultra 提供不同质量和速度选择
2. **双重 API 支持**: 147 API 和 Apimart API 可切换
3. **智能降级**: 模型降级和 API 降级双重保障
4. **灵活配置**: 后台可动态切换 API 供应商

### 最佳实践
1. **生产环境**: 使用 `auto` 模式，优先 Apimart，失败自动降级
2. **稳定优先**: 使用 `legacy_auto` 模式，优先 147，失败降级到 Apimart
3. **质量优先**: 使用 Ultra 节点，支持最高质量输出
4. **速度优先**: 使用 Fast 节点，快速生成基础图像

### 注意事项
1. Fast 模式不支持 `aspectRatio` 和 `imageSize`，前端会自动过滤
2. 模型降级会丢失部分特性（如 `thinking_level`）
3. Apimart API 使用异步任务模式，需要轮询等待结果
4. 147 API 使用同步模式，但可能遇到限流和超时

