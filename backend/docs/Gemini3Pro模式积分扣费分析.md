# Gemini 3 Pro 模式积分扣费分析

## 一、Gemini 3 Pro 模式概述

### 1. 模式标识
- **前端Provider标识**: `banana` 或 `gemini-pro`
- **后端模型名称**: `gemini-3-pro-image-preview`
- **服务类型 (ServiceType)**: `gemini-3-pro-image`

### 2. 模型特点
- 2代模型，品质最佳
- 支持 `aspectRatio` 和 `imageSize` (1K/2K/4K)
- 支持 `thinking_level` (high/low)
- 建议避开高峰时段使用
- 使用场景：高质量图像生成

## 二、积分扣费逻辑

### 1. 基础积分配置

**配置文件**: `backend/src/credits/credits.config.ts`

#### 图像生成
```typescript
'gemini-3-pro-image': {
  serviceName: 'Nano banana Pro 生图',
  provider: 'gemini',
  creditsPerCall: 30,  // ⭐ Pro模式基础积分：30积分
  description: '使用 Nano banana Pro 模型生成高质量图像',
}
```

#### 图像编辑
```typescript
'gemini-image-edit': {
  serviceName: 'Nano banana Pro 图像编辑',
  provider: 'gemini',
  creditsPerCall: 30,  // ⭐ Pro模式图像编辑：30积分
  description: '使用 Nano banana Pro 编辑图像',
}
```

#### 图像融合
```typescript
'gemini-image-blend': {
  serviceName: 'Nano banana Pro 融合',
  provider: 'gemini',
  creditsPerCall: 30,  // ⭐ Pro模式图像融合：30积分
  description: '使用 Nano banana Pro 融合多张图像',
}
```

#### 图像分析
```typescript
'gemini-image-analyze': {
  serviceName: 'Gemini 图像分析',
  provider: 'gemini',
  creditsPerCall: 20,  // ⭐ Pro模式图像分析：20积分
  description: '使用 Gemini 分析图像内容',
}
```

### 2. ServiceType 确定逻辑

**文件**: `backend/src/ai/ai.controller.ts`

```357:373:Tanva/backend/src/ai/ai.controller.ts
  private getImageGenerationServiceType(model?: string, provider?: string): ServiceType {
    // 根据 provider 和 model 确定服务类型
    if (provider === 'midjourney') {
      return 'midjourney-imagine';
    }

    if (model?.includes('gemini-3.1')) {
      return 'gemini-3.1-image';
    }

    // Gemini 模型
    if (model?.includes('gemini-3') || model?.includes('imagen-3')) {
      return 'gemini-3-pro-image';
    }

    return 'gemini-2.5-image';
  }
```

**逻辑流程**:
1. 用户选择 `banana` 或 `gemini-pro` provider
2. 系统解析模型为 `gemini-3-pro-image-preview`
3. `getImageGenerationServiceType()` 方法判断：
   - 如果模型包含 `gemini-3.1` → `gemini-3.1-image`
   - **如果模型包含 `gemini-3` 或 `imagen-3`** → `gemini-3-pro-image` ⭐
   - 否则 → `gemini-2.5-image`

### 3. 图像分析 ServiceType 确定

**文件**: `backend/src/ai/ai.controller.ts`

```1464:1465:Tanva/backend/src/ai/ai.controller.ts
    // 根据provider判断serviceType：Fast模式使用gemini-2.5-image-analyze
    const serviceType = providerName === 'banana-2.5' ? 'gemini-2.5-image-analyze' : 'gemini-image-analyze';
```

**逻辑**:
- 如果 `providerName === 'banana-2.5'` → `gemini-2.5-image-analyze` (20积分)
- **否则（包括Pro模式）** → `gemini-image-analyze` (20积分) ⭐

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
- **仅适用于图像生成服务** (`serviceType.endsWith('-image')`)
- 图像分析、编辑、融合**不受4K影响**（因为它们的serviceType不满足条件）
- Pro模式支持4K分辨率，选择4K时会覆盖扣费为 **60积分**

### 5. 积分扣费执行流程

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
1. 从 `CREDIT_PRICING_CONFIG` 获取基础积分
2. 调用 `resolveSoraModelCredits()` 处理Sora视频模型（Pro模式不涉及，返回原值）
3. **4K分辨率检查**（仅图像生成）：
   - 如果 `imageSize === '4K'` 且是图像生成服务 (`serviceType.endsWith('-image')`)
   - **覆盖扣费为 60积分** ⚠️

## 三、积分扣费总结表

| 功能 | ServiceType | 基础积分 | 4K覆盖 | 实际扣费（1K/2K） | 实际扣费（4K） | 说明 |
|------|-------------|----------|--------|------------------|----------------|------|
| **图像生成** | `gemini-3-pro-image` | 30 | 是 | **30积分** | **60积分** | 支持4K，4K时覆盖为60积分 |
| **图像编辑** | `gemini-image-edit` | 30 | 否 | **30积分** | **30积分** | 不支持4K，不受4K影响 |
| **图像融合** | `gemini-image-blend` | 30 | 否 | **30积分** | **30积分** | 不支持4K，不受4K影响 |
| **图像分析** | `gemini-image-analyze` | 20 | 否 | **20积分** | **20积分** | 不支持4K，不受4K影响 ⭐ |

### 关键说明

1. **图像分析**: 使用Pro模式时，图像分析扣费为 **20积分**，与Fast模式相同
2. **4K分辨率**: 仅图像生成支持4K，选择4K时会覆盖扣费为 **60积分**
3. **编辑/融合**: 无论分辨率如何，统一扣费 **30积分**
4. **图像分析**: 无论分辨率如何，统一扣费 **20积分**

## 四、相关代码位置

### 1. 积分配置
- **文件**: `backend/src/credits/credits.config.ts`
- **Pro模式配置**: 
  - 图像生成: 第4-9行
  - 图像编辑: 第22-27行
  - 图像融合: 第40-45行
  - 图像分析: 第58-63行

### 2. ServiceType确定
- **文件**: `backend/src/ai/ai.controller.ts`
- **方法**: `getImageGenerationServiceType()` (第357-373行)
- **图像分析**: `analyzeImage()` (第1464-1465行)

### 3. 积分扣费执行
- **文件**: `backend/src/credits/credits.service.ts`
- **方法**: `preDeductCredits()` (第333-425行)

### 4. 4K处理逻辑
- **文件**: `backend/src/credits/credits.service.ts`
- **位置**: 第352-358行

## 五、注意事项

1. **图像生成**: 
   - 1K/2K分辨率: **30积分/次**
   - 4K分辨率: **60积分/次**（覆盖）

2. **图像编辑**: **30积分/次**（不受分辨率影响）

3. **图像融合**: **30积分/次**（不受分辨率影响）

4. **图像分析**: **20积分/次**（不受分辨率影响，与Fast模式相同）

5. **4K限制**: 仅图像生成支持4K分辨率，其他功能不受4K影响

6. **平台无关**: 无论使用147 API还是Apimart API，积分扣费标准相同

