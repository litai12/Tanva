# Gemini Function Calling 智能工具选择实现文档

## 概述

成功实现了基于 Google Gemini API 的 Function Calling 功能，让 AI 能够智能选择合适的工具来处理用户请求。

## 核心功能

### 1. 智能工具选择
- **AI 驱动选择**：使用 Gemini 2.0 Flash 模型分析用户意图
- **降级处理**：当 AI 选择失败时，使用规则引擎作为备选方案
- **多模态支持**：根据是否有图片智能判断处理方式

### 2. 支持的工具类型

#### 图像生成 (generateImage)
- **触发关键词**：画、生成、创建、制作、设计、draw、create、generate
- **功能**：根据文本描述生成新图像
- **参数**：提示词、宽高比（自动检测）

#### 图像编辑 (editImage)  
- **触发条件**：有单张图片 + 编辑意图
- **功能**：修改现有图像
- **参数**：编辑指令、源图像数据

#### 图像融合 (blendImages)
- **触发条件**：有2张或更多图片
- **功能**：融合多张图像
- **参数**：融合指令、多张源图像数据

#### 图像分析 (analyzeImage)
- **触发关键词**：什么、分析、描述、识别、看看、what、analyze
- **功能**：分析图像内容，提供详细描述
- **参数**：分析问题（可选）、源图像数据

#### 文本对话 (chatResponse)
- **触发条件**：数学问题、知识问答、日常对话
- **功能**：进行文本对话和问答
- **参数**：用户问题或对话内容

## 技术实现

### 1. 类型定义扩展 (`src/types/ai.ts`)
```typescript
// 新增类型
- AIImageAnalyzeRequest
- AIImageAnalysisResult  
- AITextChatRequest
- AITextChatResult
- AITool
- ToolSelectionRequest
- ToolSelectionResult
```

### 2. 服务层增强 (`src/services/aiImageService.ts`)
```typescript
// 新增方法
- selectTool(): 智能工具选择
- analyzeImage(): 图像分析
- generateTextResponse(): 文本对话
- parseToolSelection(): 解析AI选择结果
- fallbackToolSelection(): 降级工具选择
```

### 3. 状态管理优化 (`src/stores/aiChatStore.ts`)
```typescript
// 新增状态
- sourceImageForAnalysis: 分析图像状态

// 新增方法  
- processUserInput(): 统一智能处理入口
- analyzeImage(): 图像分析功能
- generateTextResponse(): 文本对话功能
- setSourceImageForAnalysis(): 分析图像状态管理
```

### 4. UI 组件更新 (`src/components/chat/AIChatDialog.tsx`)
```typescript
// 主要更新
- 使用 processUserInput() 替代原有的 switch 逻辑
- 支持分析图像的显示和管理
- 智能提示文字根据模式动态调整
- 进度显示文字更准确
```

## 工具选择逻辑

### AI 选择流程
1. **构建系统提示**：包含用户输入、图像状态、可用工具信息
2. **调用 Gemini API**：使用 gemini-2.0-flash 进行工具选择
3. **解析响应**：提取工具名称和选择理由
4. **验证选择**：确保选择的工具存在且可用
5. **执行操作**：调用相应的工具方法

### 降级规则引擎
当 AI 选择失败时，使用以下规则：
- 2张或更多图像 → blendImages
- 1张图像 + 分析关键词 → analyzeImage  
- 1张图像 + 其他 → editImage
- 无图像 + 生图关键词 → generateImage
- 数学表达式 → chatResponse
- 默认 → chatResponse

## 用户体验

### 智能交互示例

1. **文本对话**
   ```
   用户输入: "1+1等于几？"
   AI选择: chatResponse
   结果: "1+1等于2"
   ```

2. **图像生成**
   ```
   用户输入: "画一只可爱的小猫"
   AI选择: generateImage
   结果: 生成小猫图像
   ```

3. **图像分析**
   ```
   用户上传图片 + 输入: "这是什么？"
   AI选择: analyzeImage
   结果: 详细分析图片内容
   ```

4. **图像编辑**
   ```
   用户上传图片 + 输入: "把背景改成蓝天"
   AI选择: editImage
   结果: 编辑后的图像
   ```

## 优势特点

### 1. 智能化
- AI 自动判断用户意图，无需手动选择模式
- 支持自然语言交互
- 上下文感知（基于图像状态）

### 2. 可靠性
- 双重保障：AI 选择 + 规则引擎降级
- 错误处理完善
- 用户友好的错误提示

### 3. 扩展性
- 易于添加新工具
- 工具定义标准化
- 参数自动推断

### 4. 用户体验
- 统一的交互入口
- 智能提示文字
- 实时进度显示
- 开发模式下显示 AI 选择理由

## 配置说明

### 环境变量
```
VITE_GOOGLE_GEMINI_API_KEY=你的API密钥
```

### 模型使用
- **工具选择**：gemini-2.0-flash（文本模型，快速且经济）
- **图像生成/编辑**：gemini-2.5-flash-image-preview（Nano Banana）
- **图像分析**：gemini-2.0-flash（支持多模态）
- **文本对话**：gemini-2.0-flash

### API 调用格式
根据 [Gemini 官方文档](https://ai.google.dev/gemini-api/docs/text-generation)，正确的调用格式：
```javascript
// ✅ 正确格式
await genAI.models.generateContent({
  model: 'gemini-2.0-flash',
  contents: prompt  // 直接传字符串
});

// ❌ 错误格式（不要使用）
await genAI.models.generateContent({
  model: 'gemini-2.0-flash',
  contents: [{ text: prompt }]  // 数组格式在某些情况下不工作
});
```

## 测试建议

### 基本功能测试
1. 纯文本对话：数学计算、知识问答
2. 图像生成：各种描述性提示
3. 图像分析：上传图片并询问内容
4. 图像编辑：上传图片并要求修改
5. 图像融合：上传多张图片并要求融合

### 边界情况测试
1. 模糊意图：看 AI 如何选择
2. 错误输入：测试错误处理
3. 网络异常：测试降级机制
4. API 限制：测试配额处理

## 性能考虑

### 成本优化
- 工具选择使用经济的 gemini-2.0-flash
- 避免不必要的 API 调用
- 智能缓存和重用

### 响应速度
- 工具选择通常在 1-2 秒内完成
- 并行处理用户输入和工具选择
- 进度指示器提升用户体验

## 已知问题修复记录

### 1. API 调用格式问题（已修复）
**问题描述**：Gemini API 调用时 `contents` 参数格式错误
- ❌ 错误格式：`contents: [{ text: prompt }]`
- ✅ 正确格式：`contents: prompt` （直接传字符串）
- **影响范围**：`generateTextResponse`、`selectTool`、`testConnection`
- **修复方案**：根据官方文档更新所有 API 调用格式

### 2. 状态管理冲突（已修复）
**问题描述**：`processUserInput` 和子方法重复设置 `isGenerating` 状态
- **症状**：`generateTextResponse` 因为状态检查而被跳过
- **原因**：`processUserInput` 设置 `isGenerating: true` 后，子方法再次检查导致提前返回
- **修复方案**：
  - 移除子方法中的 `isGenerating` 检查
  - 子方法只更新 `progress` 和 `stage`，保持 `isGenerating` 状态

### 3. 调试增强
- 添加详细的控制台日志
- 在关键执行点记录状态
- API 请求和响应的完整日志

## 后续优化方向

1. **学习机制**：记录用户选择偏好，优化工具选择准确性
2. **批量处理**：支持一次处理多个任务
3. **工具链**：支持工具之间的组合调用
4. **自定义工具**：允许用户定义自己的工具
5. **性能监控**：添加工具选择准确性和性能指标

## 总结

通过实现 Gemini Function Calling 功能，系统现在能够：
- 智能理解用户意图
- 自动选择合适的工具
- 提供统一的交互体验
- 支持文本和图像的多模态处理

这大大提升了用户体验，让用户可以用自然语言与系统交互，而无需了解具体的功能划分。
