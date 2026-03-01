# vidu&kling 补充视频生成服务 API 说明文档

本文档详细说明了 Kling 和 Vidu 两个视频生成服务的逻辑分支、请求格式及模型选择。

---

## 目录

1. [Kling 视频生成服务](#kling-视频生成服务)
2. [Vidu 视频生成服务](#vidu-视频生成服务)
3. [模式自动判断逻辑](#模式自动判断逻辑)

---

## Kling 视频生成服务

### 1. 模式自动判断逻辑

当用户未指定 `videoMode` 时，系统根据 `referenceImages` 数量自动判断：

| 图片数量 | 自动选择模式 | 说明 |
|---------|------------|------|
| 0 张 | `text2video` | 文生视频 |
| 1 张 | `image2video` | 单图生视频 |
| 2 张 | `image2video-tail` | 首尾帧模式 |
| 3+ 张 | `multi-image2video` | 多图参考生视频 |

### 2. 端点映射

| 模式 | API 端点 |
|------|---------|
| `text2video` | `https://models.kapon.cloud/kling/v1/videos/text2video` |
| `image2video` | `https://models.kapon.cloud/kling/v1/videos/image2video` |
| `image2video-tail` | `https://models.kapon.cloud/kling/v1/videos/image2video` |
| `multi-image2video` | `https://models.kapon.cloud/kling/v1/videos/multi-image2video` |

### 3. 模型配置

#### 默认配置（适用于大部分模式）

```json
{
  "model_name": "kling-v2-1",
  "mode": "pro",
  "duration": "5"
}
```

#### 特殊配置

- **多图参考模式** (`multi-image2video`)：使用 `kling-v1-6` 模型
  ```json
  {
    "model_name": "kling-v1-6",
    "mode": "pro",
    "duration": "5"
  }
  ```

### 4. 各模式详细说明

#### 4.1 文生视频 (text2video)

**必需参数：**
- `prompt`: 文本提示词（必填）

**请求示例：**
```json
{
  "model_name": "kling-v2-1",
  "mode": "pro",
  "duration": "5",
  "prompt": "一只猫在草地上奔跑",
  "aspect_ratio": "16:9"
}
```

**特点：**
- 不需要参考图片
- 必须提供 prompt
- 支持自定义宽高比

---

#### 4.2 单图生视频 (image2video)

**必需参数：**
- `image`: 参考图片 URL（必填）

**可选参数：**
- `prompt`: 文本提示词（可选）

**请求示例：**
```json
{
  "model_name": "kling-v2-1",
  "mode": "pro",
  "duration": "5",
  "image": "https://example.com/image.jpg",
  "prompt": "让图片中的人物挥手"
}
```

**特点：**
- 需要 1 张参考图片
- prompt 可选，不提供时模型会自动生成动画
- 图片会自动上传到 OSS（如果是 Base64）

---

#### 4.3 首尾帧模式 (image2video-tail)

**必需参数：**
- `image`: 首帧图片 URL（必填）
- `image_tail`: 尾帧图片 URL（必填）
- `prompt`: 文本提示词（必填，如未提供则使用默认值）

**请求示例：**
```json
{
  "model_name": "kling-v2-1",
  "mode": "pro",
  "duration": "5",
  "image": "https://example.com/start.jpg",
  "image_tail": "https://example.com/end.jpg",
  "prompt": "参考图片内容生成视频"
}
```

**特点：**
- 需要 2 张参考图片（首帧和尾帧）
- 必须提供 prompt（如未提供，自动使用默认值："参考图片内容生成视频"）
- 模型会生成两帧之间的过渡动画
- 使用 `kling-v2-1` + `pro` 模式以确保兼容性

---

#### 4.4 多图参考生视频 (multi-image2video)

**必需参数：**
- `image_list`: 图片列表（最多 4 张）
- `prompt`: 文本提示词（必填，如未提供则使用默认值）

**请求示例：**
```json
{
  "model_name": "kling-v1-6",
  "mode": "pro",
  "duration": "5",
  "image_list": [
    {"image": "https://example.com/img1.jpg"},
    {"image": "https://example.com/img2.jpg"},
    {"image": "https://example.com/img3.jpg"}
  ],
  "prompt": "参考图片内容生成视频"
}
```

**特点：**
- 需要 3+ 张参考图片（最多取前 4 张）
- 必须提供 prompt（如未提供，自动使用默认值）
- **特殊配置**：使用 `kling-v1-6` 模型（其他模式使用 `kling-v2-1`）
- 所有图片会自动上传到 OSS

---

### 5. 通用参数说明

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `model_name` | string | 是 | 根据模式 | `kling-v2-1` 或 `kling-v1-6` |
| `mode` | string | 否 | `pro` | 生成模式：`std` 或 `pro` |
| `duration` | string | 否 | `"5"` | 视频时长：`"5"` 或 `"10"` 秒 |
| `aspect_ratio` | string | 否 | - | 宽高比，如 `"16:9"` |
| `prompt` | string | 视模式而定 | - | 文本提示词 |

---

## Vidu 视频生成服务

### 1. 模式自动判断逻辑

当用户未指定 `videoMode` 时，系统根据 `referenceImages` 数量和 `prompt` 是否存在自动判断：

| 图片数量 | 有 Prompt | 无 Prompt | 自动选择模式 |
|---------|----------|----------|------------|
| 0 张 | ✅ | - | `text2video` |
| 1 张 | ✅ | ✅ | `reference2video` / `img2video` |
| 2 张 | ✅ | ✅ | `reference2video` / `start-end2video` |
| 3+ 张 | ✅ | ✅ | `reference2video` |

**判断规则：**
- 0 张图：文生视频 (`text2video`)
- 1 张图：有 prompt → 参考生视频 (`reference2video`)，无 prompt → 图生视频 (`img2video`)
- 2 张图：有 prompt → 参考生视频 (`reference2video`)，无 prompt → 首尾帧 (`start-end2video`)
- 3+ 张图：参考生视频 (`reference2video`)

### 2. 端点映射

| 模式 | API 端点 |
|------|---------|
| `text2video` | `https://models.kapon.cloud/vidu/ent/v2/text2video` |
| `img2video` | `https://models.kapon.cloud/vidu/ent/v2/img2video` |
| `start-end2video` | `https://models.kapon.cloud/vidu/ent/v2/start-end2video` |
| `reference2video` | `https://models.kapon.cloud/vidu/ent/v2/reference2video` |

### 3. 各模式详细说明

#### 3.1 文生视频 (text2video)

**模型配置：**
```json
{
  "model": "viduq2"
}
```

**必需参数：**
- `prompt`: 文本提示词（必填）

**请求示例：**
```json
{
  "model": "viduq2",
  "prompt": "一只猫在草地上奔跑",
  "duration": 5,
  "resolution": "720p",
  "style": "general",
  "off_peak": false
}
```

**特点：**
- 不需要参考图片
- 必须提供 prompt
- 使用 `viduq2` 模型

---

#### 3.2 图生视频 (img2video)

**模型配置：**
```json
{
  "model": "viduq2-turbo"
}
```

**必需参数：**
- `images`: 图片数组（1 张图片）

**请求示例：**
```json
{
  "model": "viduq2-turbo",
  "images": ["https://example.com/image.jpg"],
  "duration": 5,
  "resolution": "720p",
  "off_peak": false
}
```

**特点：**
- 需要 1 张参考图片
- 不需要 prompt（模型自动生成动画）
- 使用 `viduq2-turbo` 模型（更快）

---

#### 3.3 首尾帧模式 (start-end2video)

**模型配置：**
```json
{
  "model": "viduq2-turbo"
}
```

**必需参数：**
- `images`: 图片数组（2 张图片：首帧和尾帧）

**请求示例：**
```json
{
  "model": "viduq2-turbo",
  "images": [
    "https://example.com/start.jpg",
    "https://example.com/end.jpg"
  ],
  "duration": 5,
  "resolution": "720p"
}
```

**特点：**
- 需要 2 张参考图片（首帧和尾帧）
- 不需要 prompt
- 使用 `viduq2-turbo` 模型
- 模型会生成两帧之间的过渡动画

---

#### 3.4 参考生视频 (reference2video)

**模型配置：**
```json
{
  "model": "viduq2"
}
```

**必需参数：**
- `images`: 图片数组（最多 7 张）
- `prompt`: 文本提示词（必填）

**请求示例：**
```json
{
  "model": "viduq2",
  "images": [
    "https://example.com/img1.jpg",
    "https://example.com/img2.jpg",
    "https://example.com/img3.jpg"
  ],
  "prompt": "根据参考图片生成视频",
  "duration": 5,
  "resolution": "720p"
}
```

**特点：**
- 需要 1-7 张参考图片（最多取前 7 张）
- 必须提供 prompt
- 使用 `viduq2` 模型
- 适合多图参考生成

---

### 4. 通用参数说明

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `model` | string | 是 | 根据模式 | `viduq2` 或 `viduq2-turbo` |
| `prompt` | string | 视模式而定 | - | 文本提示词 |
| `images` | array | 视模式而定 | - | 参考图片数组 |
| `duration` | number | 否 | 5 | 视频时长（秒） |
| `resolution` | string | 否 | `"720p"` | 视频分辨率 |
| `style` | string | 否 | `"general"` | 视频风格（仅 text2video） |
| `off_peak` | boolean | 否 | false | 错峰生成 |

---

## 总结对比

### Kling vs Vidu 模式对比

| 功能 | Kling 模式 | Vidu 模式 |
|------|-----------|----------|
| 文生视频 | `text2video` | `text2video` |
| 单图生视频 | `image2video` | `img2video` |
| 首尾帧 | `image2video-tail` | `start-end2video` |
| 多图参考 | `multi-image2video` | `reference2video` |

### 模型选择对比

| 服务 | 模式 | 模型 | 说明 |
|------|------|------|------|
| **Kling** | text2video | kling-v2-1 | 文生视频 |
| **Kling** | image2video | kling-v2-1 | 单图生视频 |
| **Kling** | image2video-tail | kling-v2-1 | 首尾帧 |
| **Kling** | multi-image2video | kling-v1-6 | 多图参考（特殊） |
| **Vidu** | text2video | viduq2 | 文生视频 |
| **Vidu** | img2video | viduq2-turbo | 单图生视频（快速） |
| **Vidu** | start-end2video | viduq2-turbo | 首尾帧（快速） |
| **Vidu** | reference2video | viduq2 | 多图参考 |

### 关键要点

#### Kling 关键要点

1. **模型配置**
   - 默认使用 `kling-v2-1` + `pro` 模式
   - 多图参考模式特殊：使用 `kling-v1-6` 模型

2. **Prompt 要求**
   - `text2video`：必须提供 prompt
   - `image2video`：可选
   - `image2video-tail`：必须提供（自动补充默认值）
   - `multi-image2video`：必须提供（自动补充默认值）

3. **图片处理**
   - 自动上传 Base64 图片到 OSS
   - 支持直接使用 URL

4. **默认值**
   - 默认 prompt（首尾帧和多图参考）：`"参考图片内容生成视频"`
   - 默认时长：5 秒
   - 默认模式：`pro`

---

#### Vidu 关键要点

1. **模型配置**
   - `text2video` 和 `reference2video`：使用 `viduq2` 模型
   - `img2video` 和 `start-end2video`：使用 `viduq2-turbo` 模型（更快）

2. **Prompt 要求**
   - `text2video`：必须提供 prompt
   - `img2video`：不需要 prompt
   - `start-end2video`：不需要 prompt
   - `reference2video`：必须提供 prompt

3. **图片数量限制**
   - `img2video`：1 张图片
   - `start-end2video`：2 张图片
   - `reference2video`：最多 7 张图片

4. **默认值**
   - 默认时长：5 秒
   - 默认分辨率：`720p`
   - 默认风格：`general`（仅 text2video）
   - 默认错峰：`false`

---

## 注意事项

### 通用注意事项

1. **图片格式**
   - 支持 Base64 编码（自动上传到 OSS）
   - 支持 HTTP/HTTPS URL（直接使用）
   - Kling 会自动检测并处理

2. **模式自动判断**
   - 如果未指定 `videoMode`，系统会根据图片数量和 prompt 自动判断
   - 建议明确指定模式以避免歧义

3. **错误处理**
   - 所有 API 调用都有完整的错误日志
   - 失败时会自动退还积分

### Kling 特殊注意事项

1. **首尾帧模式限制**
   - `kling-v2-1` + `pro` 模式支持首尾帧
   - 必须提供 prompt（自动补充默认值）

2. **多图参考特殊配置**
   - 使用 `kling-v1-6` 模型（与其他模式不同）
   - 最多支持 4 张图片

### Vidu 特殊注意事项

1. **模型选择策略**
   - 需要 prompt 的模式使用 `viduq2`
   - 不需要 prompt 的模式使用 `viduq2-turbo`（更快）

2. **参考生视频**
   - 最多支持 7 张图片
   - 必须提供 prompt

---

## 使用示例

### 示例 1：Kling 首尾帧生成

```typescript
const options = {
  provider: 'kling',
  videoMode: 'image2video-tail',
  referenceImages: [
    'https://example.com/start.jpg',
    'https://example.com/end.jpg'
  ],
  prompt: '从儿童成长为成人',
  duration: 10
};
```

### 示例 2：Vidu 多图参考生成

```typescript
const options = {
  provider: 'vidu',
  videoMode: 'reference2video',
  referenceImages: [
    'https://example.com/img1.jpg',
    'https://example.com/img2.jpg',
    'https://example.com/img3.jpg'
  ],
  prompt: '根据参考图片生成连贯的视频',
  duration: 5,
  resolution: '720p'
};
```

### 示例 3：自动模式判断

```typescript
// 2 张图片 + 有 prompt → Kling 自动选择 image2video-tail
const options = {
  provider: 'kling',
  referenceImages: ['img1.jpg', 'img2.jpg'],
  prompt: '过渡动画',
  duration: 5
};

// 2 张图片 + 无 prompt → Vidu 自动选择 start-end2video
const options2 = {
  provider: 'vidu',
  referenceImages: ['img1.jpg', 'img2.jpg'],
  duration: 5
};
```

---

## 文档版本

- **版本**: 1.0
- **更新日期**: 2026-01-19
- **维护者**: Tanva Backend Team

