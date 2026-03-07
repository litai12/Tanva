# Fast模式积分扣费分析

## 一、Fast模式概述

### 1. 模式标识
- **前端Provider标识**: `banana-2.5`
- **后端模型名称**: `gemini-2.5-flash-image-preview`
- **服务类型 (ServiceType)**: `gemini-2.5-image`

### 2. 模型特点
- 1代模型，高速稳定
- **不支持** `aspectRatio` 和 `imageSize` 参数
- **仅支持** 1K 分辨率
- 使用场景：快速生成，对质量要求不高的场景

## 二、积分扣费逻辑

### 1. 基础积分配置

**配置文件**: `backend/src/credits/credits.config.ts`

```typescript
'gemini-2.5-image': {
  serviceName: 'Nano banana 生图',
  provider: 'gemini',
  creditsPerCall: 20,  // ⭐ Fast模式基础积分：20积分
  description: '使用 Nano banana 模型生成图像',
}
```

**基础扣费**: **20积分/次**

### 2. ServiceType 确定逻辑

**文件**: `backend/src/ai/ai.controller.ts`

```372:372:Tanva/backend/src/ai/ai.controller.ts
    return 'gemini-2.5-image';
```

**逻辑流程**:
1. 用户选择 `banana-2.5` provider
2. 系统解析模型为 `gemini-2.5-flash-image-preview`
3. `getImageGenerationServiceType()` 方法判断：
   - 如果模型包含 `gemini-3.1` → `gemini-3.1-image`
   - 如果模型包含 `gemini-3` 或 `imagen-3` → `gemini-3-pro-image`
   - **否则（Fast模式）** → `gemini-2.5-image` ⭐

### 3. 积分扣费执行流程

**文件**: `backend/src/credits/credits.service.ts`

```333:358:Tanva/backend/src/credits/credits.service.ts
  async preDeductCredits(params: ApiUsageParams): Promise<DeductCreditsResult> {
    const { userId, serviceType, model, inputTokens, outputTokens, inputImageCount, outputImageCount, requestParams, ipAddress, userAgent } = params;
    const requestedProvider = typeof requestParams?.aiProvider === 'string'
      ? requestParams.aiProvider.trim().toLowerCase()
      : '';

    const pricing = CREDIT_PRICING_CONFIG[serviceType];
    if (!pricing) {
      throw new BadRequestException(`未知的服务类型: ${serviceType}`);
    }

    let creditsToDeduct: number = pricing.creditsPerCall;
    creditsToDeduct = this.resolveSoraModelCredits(
      serviceType,
      creditsToDeduct,
      requestParams,
      model,
    );

    const requestedImageSize = params?.requestParams?.imageSize;
    const isImageGeneration =
      serviceType !== 'midjourney-imagine' && serviceType.endsWith('-image');
    const is4KBilling = requestedImageSize === '4K' && isImageGeneration;
    if (is4KBilling) {
      creditsToDeduct = 60;
    }
```

**扣费步骤**:
1. 从 `CREDIT_PRICING_CONFIG` 获取基础积分：**20积分**
2. 调用 `resolveSoraModelCredits()` 处理Sora视频模型（Fast模式不涉及，返回原值）
3. **4K分辨率检查**：
   - 如果 `imageSize === '4K'` 且是图像生成服务
   - **覆盖扣费为 60积分** ⚠️
   - **注意**: Fast模式前端已限制不支持4K，但后端逻辑仍会检查

### 4. 4K分辨率特殊处理

**代码位置**: `backend/src/credits/credits.service.ts:352-358`

```typescript
const requestedImageSize = params?.requestParams?.imageSize;
const isImageGeneration =
  serviceType !== 'midjourney-imagine' && serviceType.endsWith('-image');
const is4KBilling = requestedImageSize === '4K' && isImageGeneration;
if (is4KBilling) {
  creditsToDeduct = 60;  // ⚠️ 4K模式扣费60积分
}
```

**说明**:
- Fast模式理论上不应该出现4K请求（前端已限制）
- 但如果后端收到4K请求，会按 **60积分** 扣费
- 这是系统级的保护机制，防止绕过前端限制

## 三、平台与API通道

### 1. 平台切换配置

**配置键**: `banana_provider` (SystemSetting表)

**支持的平台模式**:
- `auto`: 自动切换（Apimart 优先，失败降级到147）
- `legacy_auto`: 自动切换（147 优先，失败降级到Apimart）
- `apimart`: 强制使用 Apimart API (`api.apimart.ai`)
- `legacy`: 强制使用 147 API (`api1.147ai.com`)

### 2. 平台识别逻辑

**文件**: `backend/src/credits/credits.service.ts:126-155`

```typescript
private extractChannelFromApiUsage(apiUsage?: {
  provider?: string | null;
  model?: string | null;
  requestParams?: Prisma.JsonValue | null;
} | null): string | null {
  // 从 requestParams 中提取 channel 信息
  // 从 model 名称中识别（包含 '147' 或 'banana' → '147'）
  // 从 provider 中识别（'nano2' → 'apimart', 'banana' → '147'）
}
```

**积分扣费与平台无关**:
- 无论使用哪个平台（147或Apimart），积分扣费标准相同
- Fast模式统一扣费：**20积分/次**（非4K）或 **60积分/次**（4K，理论上不应发生）

## 四、图像分析功能

### 1. Fast模式图像分析

**ServiceType**: `gemini-2.5-image-analyze`

**配置文件**: `backend/src/credits/credits.config.ts`

```typescript
'gemini-2.5-image-analyze': {
  serviceName: 'Nano banana 图像分析',
  provider: 'gemini',
  creditsPerCall: 20,
  description: '使用 Nano banana 模型分析图像内容',
}
```

**实现逻辑**:
- **文件**: `backend/src/ai/ai.controller.ts`
- **方法**: `analyzeImage()` (第1455-1484行)
- 当 `providerName === 'banana-2.5'` 时，使用 `gemini-2.5-image-analyze` serviceType
- **模型**: 使用 `gemini-2.5-flash-image-preview` 进行图像分析

**Provider实现**:
- **文件**: `backend/src/ai/providers/banana.provider.ts`
- **方法**: `analyzeImage()` (第1506-1579行)
- 根据传入的model判断，如果包含 `2.5` 则使用 `gemini-2.5-flash-image-preview`
- 否则使用 `gemini-3-pro-image-preview`

## 五、积分扣费总结表

| 场景 | ServiceType | 基础积分 | 4K覆盖 | 实际扣费 | 说明 |
|------|-------------|----------|--------|----------|------|
| Fast模式（1K） | `gemini-2.5-image` | 20 | 否 | **20积分** | 正常情况 |
| Fast模式（4K）* | `gemini-2.5-image` | 20 | 是 | **60积分** | 理论上不应发生，前端已限制 |
| Fast模式图像编辑 | `gemini-2.5-image-edit` | 30 | 否 | **30积分** | 编辑功能 |
| Fast模式图像融合 | `gemini-2.5-image-blend` | 30 | 否 | **30积分** | 融合功能 |
| Fast模式图像分析 | `gemini-2.5-image-analyze` | 20 | 否 | **20积分** | 图像分析功能 ⭐ |

*注：Fast模式不支持4K，但后端有保护机制

## 六、相关代码位置

### 1. 积分配置
- **文件**: `backend/src/credits/credits.config.ts`
- **Fast模式配置**: 第16-21行

### 2. ServiceType确定
- **文件**: `backend/src/ai/ai.controller.ts`
- **方法**: `getImageGenerationServiceType()` (第357-373行)

### 3. 积分扣费执行
- **文件**: `backend/src/credits/credits.service.ts`
- **方法**: `preDeductCredits()` (第333-425行)

### 4. 前端限制
- **文件**: `frontend/src/components/chat/AIChatDialog.tsx`
- **Fast模式判断**: 第493行 `const isFastMode = aiProvider === "banana-2.5"`
- **4K限制**: 第7299行检查并提示不支持4K

## 七、注意事项

1. **Fast模式默认扣费**: 20积分/次（图像生成和图像分析）
2. **不支持4K**: 前端已限制，但后端有保护机制（如收到4K请求会扣60积分）
3. **平台无关**: 无论使用147 API还是Apimart API，积分扣费标准相同
4. **编辑/融合功能**: 使用Fast模式进行图像编辑或融合时，扣费为30积分（非20积分）
5. **图像分析**: Fast模式下图像分析使用2.5模型，扣费20积分，与图像生成一致

