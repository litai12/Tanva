# Vector 代码生成 vs Gemini Pro 文本对话 - 详细对比分析

## 📊 三种实现方式对比

### 1. Vector 代码生成 (`generatePaperJSCode`)

**文件位置：** `backend/src/ai/image-generation.service.ts` (lines 872-966)

#### 模型配置
```typescript
const model = request.model || 'gemini-3-pro-preview';
```
- **默认模型：** `gemini-3-pro-preview`
- **可覆盖：** 支持通过 `request.model` 参数覆盖

#### 系统提示词
```typescript
const systemPrompt = `你是一个paper.js代码专家，请根据我的需求帮我生成纯净的paper.js代码，不用其他解释或无效代码，确保使用view.center作为中心，并围绕中心绘图`;
```
- **传递方式：** ✅ 使用 `systemInstruction` 参数单独传递
- **API 调用：**
```typescript
const response = await client.models.generateContent({
  model,
  contents: [{ text: userPrompt }], // 只传用户提示词
  systemInstruction: { text: systemPrompt }, // 系统提示词单独传递
  config: apiConfig,
} as any);
```

#### 用户提示词
```typescript
const userPrompt = request.prompt; // 直接使用用户输入，无额外包装
```
- **内容：** 仅包含用户对话框中的原始输入
- **无额外信息：** 不包含画布尺寸、语言指令等

#### API 调用方式
- **流式/非流式：** ❌ **非流式** (`generateContent`)
- **重试机制：** 2 次重试，1 秒延迟
- **超时时间：** `DEFAULT_TIMEOUT` (120秒)

#### 特殊配置
- **thinkingLevel：** 支持 `high` 模式
- **代码清理：** 自动移除 markdown 代码块包装

---

### 2. Gemini Pro Provider 文本生成 (`generateText`)

**文件位置：** `backend/src/ai/providers/gemini-pro.provider.ts` (lines 585-684)

**使用场景：** 当 `aiProvider === 'gemini-pro'` 时调用

#### 模型配置
```typescript
model: 'gemini-3-pro-preview' // 硬编码，不可配置
```
- **固定模型：** `gemini-3-pro-preview`
- **不可覆盖：** 模型名称硬编码在代码中

#### 系统提示词
- **系统提示词：** ❌ **无系统提示词**
- **传递方式：** 不适用

#### 用户提示词
```typescript
const finalPrompt = request.prompt; // 直接使用，无任何包装
```
- **内容：** 直接使用 `request.prompt`，无任何前缀或包装
- **无语言指令：** 不添加 "Please respond in Chinese" 等指令

#### API 调用方式
- **流式/非流式：** ✅ **非流式优先，失败后降级到流式**
  - 首先尝试：`generateContent` (非流式)
  - 失败后降级：`generateContentStream` (流式)
- **重试机制：** 5 次重试
- **超时时间：** `DEFAULT_TIMEOUT` (120秒)

#### 特殊配置
- **thinkingLevel：** 支持通过 `generationConfig.thinking_level` 配置
- **Web Search：** 支持启用联网搜索工具

---

### 3. ImageGenerationService 文本生成 (`generateTextResponse`)

**文件位置：** `backend/src/ai/image-generation.service.ts` (lines 808-867)

**使用场景：** 默认 gemini 服务（当 `aiProvider !== 'gemini-pro'` 时）

#### 模型配置
```typescript
const model = request.model || 'gemini-2.0-flash';
```
- **默认模型：** `gemini-2.0-flash`
- **可覆盖：** 支持通过 `request.model` 参数覆盖

#### 系统提示词
- **系统提示词：** ❌ **无系统提示词**
- **传递方式：** 不适用

#### 用户提示词
```typescript
const finalPrompt = `Please respond in Chinese:\n\n${request.prompt}`;
```
- **内容：** 用户输入 + 语言指令前缀
- **语言指令：** 自动添加 "Please respond in Chinese:\n\n"

#### API 调用方式
- **流式/非流式：** ✅ **流式** (`generateContentStream`)
- **重试机制：** 无重试机制（仅一次尝试）
- **超时时间：** `DEFAULT_TIMEOUT` (120秒)

#### 特殊配置
- **Web Search：** 支持启用联网搜索工具
- **无 thinkingLevel：** 不支持思考模式配置

---

## 🔍 关键差异总结

| 特性 | Vector 代码生成 | Gemini Pro 文本 | 默认 Gemini 文本 |
|------|----------------|-----------------|------------------|
| **默认模型** | `gemini-3-pro-preview` | `gemini-3-pro-preview` | `gemini-2.0-flash` |
| **系统提示词** | ✅ 有（通过 systemInstruction） | ❌ 无 | ❌ 无 |
| **用户提示词** | 纯用户输入 | 纯用户输入 | 用户输入 + 语言指令 |
| **API 方式** | 非流式 | 非流式优先，失败降级流式 | 流式 |
| **重试次数** | 2 次 | 5 次 | 0 次 |
| **thinkingLevel** | ✅ 支持 | ✅ 支持 | ❌ 不支持 |
| **代码清理** | ✅ 自动清理 markdown | ❌ 无 | ❌ 无 |

---

## 🎯 为什么 Vector 流程可能失败？

### 潜在问题分析

1. **systemInstruction 参数支持问题**
   - 虽然使用了 `systemInstruction` 参数，但使用了 `as any` 类型断言
   - 如果 Gemini SDK 版本不支持此参数，可能导致 API 调用失败
   - **建议：** 验证 SDK 版本是否支持 `systemInstruction`

2. **模型差异**
   - Vector 使用 `gemini-3-pro-preview`（与 Gemini Pro 文本一致）
   - 但默认 Gemini 文本使用 `gemini-2.0-flash`
   - **当前状态：** ✅ 已统一为 `gemini-3-pro-preview`

3. **API 调用方式差异**
   - Vector：仅非流式，无降级机制
   - Gemini Pro 文本：非流式优先，有流式降级
   - **潜在问题：** 如果非流式 API 不稳定，Vector 可能更容易失败

4. **重试机制差异**
   - Vector：仅 2 次重试
   - Gemini Pro 文本：5 次重试
   - **潜在问题：** Vector 重试次数较少，可能无法应对临时网络问题

---

## 💡 建议优化方案

### 方案 1：添加流式降级机制（推荐）

```typescript
try {
  // 首先尝试非流式
  const response = await client.models.generateContent({
    model,
    contents: [{ text: userPrompt }],
    systemInstruction: { text: systemPrompt },
    config: apiConfig,
  } as any);
  // ...
} catch (nonStreamError) {
  // 失败后降级到流式
  const stream = await client.models.generateContentStream({
    model,
    contents: [{ text: userPrompt }],
    systemInstruction: { text: systemPrompt },
    config: apiConfig,
  } as any);
  // ...
}
```

### 方案 2：增加重试次数

```typescript
// 从 2 次增加到 5 次，与 Gemini Pro 文本保持一致
maxRetries: 5
```

### 方案 3：验证 systemInstruction 支持

如果 `systemInstruction` 不支持，可以回退到多轮对话方式：

```typescript
contents: [
  { role: 'user', text: systemPrompt },
  { role: 'model', text: '我理解了，我将作为 Paper.js 代码专家为您生成代码。' },
  { role: 'user', text: userPrompt }
]
```

---

## 📝 当前实现状态

✅ **已完成：**
- 模型统一为 `gemini-3-pro-preview`
- 用户提示词简化为纯用户输入
- 使用 `systemInstruction` 参数传递系统提示词

⚠️ **待验证：**
- `systemInstruction` 参数是否被 Gemini API 正确识别
- 非流式 API 的稳定性
- 是否需要添加流式降级机制

