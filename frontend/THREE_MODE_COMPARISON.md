# Generate/Edit/Blend 三个模式流程不一致性分析

## 发现的不一致问题

### 1. 初始化阶段
- ✅ **generateImage**: 有 `generatingImageCount++` (2451行) 和 `generatingImageCount--` (3070行)
- ❌ **editImage**: 没有计数
- ❌ **blendImages**: 没有计数

### 2. 占位符位置计算
- ✅ **generateImage**: 
  - 支持并行模式的横向排列逻辑 (2540-2570行)
  - 有 `offsetVertical` (2520行)
  - 有完整的并行布局逻辑
- ❌ **editImage**: 
  - 没有并行模式的横向排列逻辑
  - 没有 `offsetVertical`
  - 有 `selectedImageBounds` 逻辑 (3180-3216行)
- ❌ **blendImages**: 
  - 没有并行模式的横向排列逻辑
  - 没有 `offsetVertical`
  - 没有 `selectedImageBounds` 逻辑

### 3. 占位符 dispatchPlaceholderEvent 参数
- ✅ **generateImage**: 有 `groupId`, `groupIndex`, `groupTotal`, `preferHorizontal`, `groupAnchor` (2613-2617行)
- ✅ **editImage**: 有 `groupId`, `groupIndex`, `groupTotal`, `preferHorizontal`, `groupAnchor` (3234-3238行)，还有 `sourceImageId` (3232行)
- ❌ **blendImages**: 缺少 `groupId`, `groupIndex`, `groupTotal`, `preferHorizontal`, `groupAnchor` (3831-3840行)

### 4. 消息状态更新时机
- ❌ **generateImage**: 
  - 在消息更新时设置 `generationStatus: { isGenerating: false, progress: 100 }` (2743-2747行)
  - 然后又单独调用 `updateMessageStatus` (2786-2790行) - **重复更新**
- ✅ **editImage**: 
  - 在消息更新时设置 `generationStatus: { isGenerating: false, progress: 100 }` (3402-3406行)
  - 在最后调用 `updateMessageStatus` (3603-3607行) - **重复更新**
- ✅ **blendImages**: 
  - 在消息更新时设置 `generationStatus: { isGenerating: false, progress: 100 }` (3924-3928行)
  - 在最后调用 `updateMessageStatus` (4118-4122行) - **重复更新**

### 5. 日志记录
- ✅ **generateImage**: 有详细的步骤日志 (2809-2811行, 2870-2872行, 2893-2896行)
- ❌ **editImage**: 缺少步骤日志
- ❌ **blendImages**: 缺少步骤日志

### 6. 画布添加逻辑
- ✅ **generateImage**: `addImageToCanvas` 有 `isParallel` 参数 (2820行)
- ❌ **editImage**: `addImageToCanvas` 没有 `isParallel` 参数 (3455行)
- ❌ **blendImages**: `addImageToCanvas` 没有 `isParallel` 参数 (3977行)

### 7. 上传历史记录后的处理
- ✅ **generateImage**: 上传成功后打印日志 (2893-2896行)
- ❌ **editImage**: 没有上传成功日志
- ❌ **blendImages**: 没有上传成功日志

### 8. 自动下载功能
- ✅ **generateImage**: 有 `downloadImageData` 函数和自动下载逻辑 (2988-3034行)
- ❌ **editImage**: 没有自动下载功能
- ❌ **blendImages**: 没有自动下载功能

### 9. refreshSessions 调用位置
- ✅ **generateImage**: 在步骤4之后调用 (2984行)
- ✅ **editImage**: 在步骤4之后调用 (3599行)
- ✅ **blendImages**: 在步骤4之后调用 (4114行)
- **一致**

### 10. registerMessageImageHistory 中的 nodeType
- ❌ **所有模式**: `nodeType` 被硬编码为 `"generate"` (1911行, 1941行)
- 应该使用 `operationType` 或保持为 "generate"（因为历史记录统一归类）

## 修复优先级

### 高优先级（影响功能一致性）
1. 统一占位符位置计算逻辑（特别是并行模式支持）
2. 统一占位符 dispatchPlaceholderEvent 参数
3. 移除重复的消息状态更新
4. 统一画布添加逻辑参数

### 中优先级（影响用户体验）
5. 统一日志记录
6. 统一上传成功后的日志

### 低优先级（可选功能）
7. 统一自动下载功能（或明确说明为什么只有 generate 有）
8. 统一初始化计数（或明确说明为什么只有 generate 有）

