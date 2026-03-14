# 豆包 Seedream 5.0 图像生成接入文档

## 📋 目录
- [概述](#概述)
- [API 密钥配置](#api-密钥配置)
- [接口规范](#接口规范)
- [使用场景](#使用场景)
- [参数详解](#参数详解)
- [节点设计方案](#节点设计方案)
- [请求示例](#请求示例)
- [响应格式](#响应格式)
- [错误处理](#错误处理)

---

## 概述

豆包 Seedream 5.0 是火山引擎推出的图像生成模型，支持文生图和图生图两大类共 6 种使用场景。

### 基本信息
- **服务商**: 火山引擎 (Volcengine)
- **模型名称**: `doubao-seedream-5-0-260128`
- **API 端点**: `https://ark.cn-beijing.volces.com/api/v3/images/generations`
- **接口类型**: 图像生成 (Image Generation)

---

## API 密钥配置

### 1. 获取 API 密钥

访问火山引擎控制台获取以下信息：

| 字段名 | 说明 | 示例 | 必填 |
|--------|------|------|------|
| `ARK_API_KEY` | API 密钥 | `ac5fae84-f299-4db4-8d7e-3f7fc355c6ac` | ✅ 是 |
| `endpoint` | API 端点 | `https://ark.cn-beijing.volces.com` | ✅ 是 |

### 2. 配置环境变量

```bash
# 火山引擎 Seedream API 配置
ARK_API_KEY=ac5fae84-f299-4db4-8d7e-3f7fc355c6ac
ARK_ENDPOINT=https://ark.cn-beijing.volces.com
```

### 3. 请求头配置

```http
Authorization: Bearer $ARK_API_KEY
Content-Type: application/json
```

---

## 使用场景

Seedream 5.0 支持 6 种使用场景，通过参数组合实现：

| 场景 | 输入图片 | 生成数量 | 核心参数 |
|------|----------|----------|----------|
| **文生图·单张** | 无 | 1 张 | `sequential_image_generation: "disabled"` |
| **文生图·一组** | 无 | 多张 | `sequential_image_generation: "auto"` |
| **图生图·单图生单图** | 1 张 | 1 张 | `image: "url"` + `disabled` |
| **图生图·单图生一组** | 1 张 | 多张 | `image: "url"` + `auto` |
| **图生图·多图生单图** | 多张 | 1 张 | `image: ["url1", "url2"]` + `disabled` |
| **图生图·多图生一组** | 多张 | 多张 | `image: ["url1", "url2"]` + `auto` |

---

## 参数详解

### 核心参数

#### 1. 基础参数

| 参数 | 类型 | 说明 | 必填 | 默认值 |
|------|------|------|------|--------|
| `model` | string | 模型名称 | ✅ | `doubao-seedream-5-0-260128` |
| `prompt` | string | 提示词描述 | ✅ | - |
| `response_format` | string | 响应格式 | ❌ | `url` |
| `stream` | boolean | 是否流式返回 | ❌ | `false` |
| `watermark` | boolean | 是否添加水印 | ❌ | `true` |

#### 2. 图像输入参数

| 参数 | 类型 | 说明 | 使用场景 |
|------|------|------|----------|
| `image` | string | 单张参考图 URL | 图生图·单图 |
| `image` | string[] | 多张参考图 URL 数组 | 图生图·多图 |

**注意**:
- 文生图场景不需要 `image` 参数
- 图生图场景必须提供 `image` 参数，可以有text也可没有text

#### 3. 生成控制参数

| 参数 | 类型 | 可选值 | 说明 |
|------|------|--------|------|
| `sequential_image_generation` | string | `disabled` / `auto` | 生成模式 |
| `sequential_image_generation_options` | object | - | 生成选项（仅 `auto` 模式） |
| `sequential_image_generation_options.max_images` | number | `2-10` | 最大生成数量 |

**生成模式说明**:
- `disabled`: 生成单张图片
- `auto`: 生成一组图片（需配合 `max_images`）

#### 4. 尺寸参数

| 参数 | 类型 | 可选值 | 说明 |
|------|------|--------|------|
| `size` | string | `1K` / `2K` / `4K` | 图像分辨率 |

**分辨率说明**:
- `1K`: 1024x1024 或相近尺寸
- `2K`: 2048x2048 或相近尺寸
- `4K`: 4096x4096 或相近尺寸

---

## 节点设计方案

### 产品逻辑设计

#### 节点名称
**Seedream 5.0 图像生成**

#### 用户交互流程

```
1. 选择生成模式
   ├─ 文生图
   │  ├─ 生成单张
   │  └─ 生成一组（需设置数量）
   └─ 图生图
      ├─ 单图输入
      │  ├─ 生成单张
      │  └─ 生成一组（需设置数量）
      └─ 多图输入
         ├─ 生成单张
         └─ 生成一组（需设置数量）

2. 输入提示词（必填）

3. 上传参考图（图生图模式）
   ├─ 单图模式：上传 1 张
   └─ 多图模式：上传 2-5 张

4. 设置可选参数
   ├─ 图像尺寸（1K/2K/4K）
   ├─ 生成数量（一组模式：2-10 张）
   ├─ 是否添加水印
   └─ 是否流式返回

5. 执行生成
```

#### 节点参数配置

```typescript
interface Seedream5NodeConfig {
  // 第一步：选择模式
  generationMode: 'text2image' | 'image2image';

  // 第二步：选择输出类型
  outputType: 'single' | 'batch';

  // 第三步：输入内容
  prompt: string;                    // 提示词（必填）
  referenceImages?: string[];        // 参考图列表（图生图必填）

  // 第四步：可选参数
  size?: '1K' | '2K' | '4K';        // 图像尺寸
  maxImages?: number;                // 生成数量（batch 模式）
  watermark?: boolean;               // 是否水印
  stream?: boolean;                  // 是否流式
}
```

#### UI 设计建议

**模式选择区**:
```
┌─────────────────────────────────┐
│ 生成模式                         │
│ ○ 文生图  ● 图生图               │
│                                  │
│ 输出类型                         │
│ ● 单张图  ○ 一组图               │
└─────────────────────────────────┘
```

**参考图上传区**（图生图模式显示）:
```
┌─────────────────────────────────┐
│ 参考图片 (最多 5 张)             │
│ ┌───┐ ┌───┐ ┌───┐              │
│ │ + │ │img│ │img│              │
│ └───┘ └───┘ └───┘              │
└─────────────────────────────────┘
```

**提示词输入区**:
```
┌─────────────────────────────────┐
│ 提示词 *                         │
│ ┌─────────────────────────────┐ │
│ │ 描述你想生成的图像...        │ │
│ │                             │ │
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
```

**参数设置区**:
```
┌─────────────────────────────────┐
│ 图像尺寸                         │
│ ○ 1K  ● 2K  ○ 4K                │
│                                  │
│ 生成数量 (一组模式)              │
│ ┌───┐                           │
│ │ 4 │ 张 (2-10)                 │
│ └───┘                           │
│                                  │
│ ☑ 添加水印                       │
│ ☐ 流式返回                       │
└─────────────────────────────────┘
```

---

## 请求示例

### 场景 1: 文生图·生成单张图

```json
{
  "model": "doubao-seedream-5-0-260128",
  "prompt": "星际穿越，黑洞，黑洞里冲出一辆快支离破碎的复古列车",
  "sequential_image_generation": "disabled",
  "response_format": "url",
  "size": "2K",
  "stream": false,
  "watermark": true
}
```

### 场景 2: 文生图·生成一组图

```json
{
  "model": "doubao-seedream-5-0-260128",
  "prompt": "生成一组共4张连贯插画，核心为同一庭院一角的四季变迁",
  "sequential_image_generation": "auto",
  "sequential_image_generation_options": {
    "max_images": 4
  },
  "response_format": "url",
  "size": "2K",
  "stream": true,
  "watermark": true
}
```

### 场景 3: 图生图·单张图生成单张图

```json
{
  "model": "doubao-seedream-5-0-260128",
  "prompt": "生成狗狗趴在草地上的近景画面",
  "image": "https://example.com/dog.png",
  "sequential_image_generation": "disabled",
  "response_format": "url",
  "size": "2K",
  "stream": false,
  "watermark": true
}
```

### 场景 4: 图生图·单张图生成一组图

```json
{
  "model": "doubao-seedream-5-0-260128",
  "prompt": "参考这个LOGO，做一套户外运动品牌视觉设计",
  "image": "https://example.com/logo.png",
  "sequential_image_generation": "auto",
  "sequential_image_generation_options": {
    "max_images": 5
  },
  "response_format": "url",
  "size": "2K",
  "stream": true,
  "watermark": true
}
```

### 场景 5: 图生图·多张参考图生成单张图

```json
{
  "model": "doubao-seedream-5-0-260128",
  "prompt": "将图1的服装换为图2的服装",
  "image": [
    "https://example.com/person.png",
    "https://example.com/clothes.png"
  ],
  "sequential_image_generation": "disabled",
  "response_format": "url",
  "size": "2K",
  "stream": false,
  "watermark": true
}
```

### 场景 6: 图生图·多张参考图生成一组图

```json
{
  "model": "doubao-seedream-5-0-260128",
  "prompt": "生成3张女孩和奶牛玩偶在游乐园开心地坐过山车的图片",
  "image": [
    "https://example.com/girl.png",
    "https://example.com/toy.png"
  ],
  "sequential_image_generation": "auto",
  "sequential_image_generation_options": {
    "max_images": 3
  },
  "response_format": "url",
  "size": "2K",
  "stream": true,
  "watermark": true
}
```

---

## 响应格式

### 非流式响应（stream: false）

```json
{
  "created": 1710396000,
  "data": [
    {
      "url": "https://ark-project.tos-cn-beijing.volces.com/result/image1.png",
      "index": 0
    }
  ]
}
```

### 流式响应（stream: true）

每次返回一张图片：

```json
data: {"created":1710396000,"data":[{"url":"https://...image1.png","index":0}]}

data: {"created":1710396001,"data":[{"url":"https://...image2.png","index":1}]}

data: [DONE]
```

---

## 错误处理

### 常见错误码

| 错误码 | 说明 | 解决方案 |
|--------|------|----------|
| `400` | 参数错误 | 检查必填参数和参数格式 |
| `401` | 认证失败 | 检查 API Key 是否正确 |
| `403` | 权限不足 | 确认服务已开通 |
| `429` | 请求过于频繁 | 降低请求频率 |
| `500` | 服务器错误 | 稍后重试 |

### 参数验证规则

```typescript
// 验证逻辑
function validateSeedreamParams(config: Seedream5NodeConfig): string[] {
  const errors: string[] = [];

  // 1. 提示词必填
  if (!config.prompt || config.prompt.trim() === '') {
    errors.push('提示词不能为空');
  }

  // 2. 图生图模式必须有参考图
  if (config.generationMode === 'image2image') {
    if (!config.referenceImages || config.referenceImages.length === 0) {
      errors.push('图生图模式需要至少 1 张参考图');
    }
    if (config.referenceImages && config.referenceImages.length > 5) {
      errors.push('参考图最多 5 张');
    }
  }

  // 3. 一组模式必须设置数量
  if (config.outputType === 'batch') {
    if (!config.maxImages || config.maxImages < 2 || config.maxImages > 10) {
      errors.push('一组模式生成数量必须在 2-10 之间');
    }
  }

  return errors;
}
```

---

## 积分计费

### 计费规则

| 场景 | 积分消耗 | 说明 |
|------|----------|------|
| 文生图·单张 | 30 积分 | 1K/2K 分辨率 |
| 文生图·单张 | 60 积分 | 4K 分辨率 |
| 文生图·一组 | 30 × N 积分 | N 为生成数量 |
| 图生图·单张 | 40 积分 | 1K/2K 分辨率 |
| 图生图·单张 | 80 积分 | 4K 分辨率 |
| 图生图·一组 | 40 × N 积分 | N 为生成数量 |

---

## 使用指南

### 新手快速上手

#### 步骤 1: 选择你的需求

**我想做什么？**
- 只用文字描述生成图片 → 选择「文生图」
- 基于现有图片生成新图片 → 选择「图生图」

**我要生成几张？**
- 只要 1 张 → 选择「单张图」
- 要多张（2-10 张）→ 选择「一组图」

#### 步骤 2: 准备内容

**文生图模式**:
- 写一段详细的描述（提示词）
- 例如："一只可爱的橘猫坐在窗台上，夕阳光线，温暖氛围"

**图生图模式**:
- 上传 1-5 张参考图
- 写一段描述你想要的变化
- 例如："将图1的服装换成图2的风格"

#### 步骤 3: 调整参数

**推荐设置**:
- 尺寸：2K（平衡质量和速度）
- 水印：开启（避免版权问题）
- 流式：关闭（新手推荐）

**高级设置**:
- 4K 尺寸：需要更高质量时使用
- 流式返回：生成多张图时实时查看

#### 步骤 4: 执行生成

点击「生成」按钮，等待结果：
- 单张图：约 10-30 秒
- 一组图：约 30-120 秒（取决于数量）

---

## 最佳实践

### 提示词优化建议

**好的提示词**:
```
✅ 一只金毛犬在海边奔跑，夕阳背景，暖色调，电影感，景深效果
✅ 现代简约风格客厅，白色主色调，木质家具，大落地窗，自然光
```

**不好的提示词**:
```
❌ 狗
❌ 好看的房间
```

### 参考图使用技巧

**单图输入**:
- 适合：风格迁移、图像变体、局部修改
- 示例：将照片转为油画风格

**多图输入**:
- 适合：元素融合、服装替换、场景组合
- 示例：将人物 A 的服装换成图片 B 的款式

### 性能优化

1. **批量生成优化**:
   - 使用「一组图」模式比多次调用「单张图」更高效
   - 建议一次生成 4-6 张

2. **流式返回**:
   - 生成多张图时开启流式，提升用户体验
   - 单张图无需开启

3. **尺寸选择**:
   - 预览/草图：1K
   - 常规使用：2K
   - 最终输出：4K

---

## 技术实现参考

### TypeScript 完整类型定义

```typescript
// 生成模式
export type GenerationMode = 'text2image' | 'image2image';

// 输出类型
export type OutputType = 'single' | 'batch';

// 图像尺寸
export type ImageSize = '1K' | '2K' | '4K';

// 节点配置接口
export interface Seedream5NodeConfig {
  generationMode: GenerationMode;
  outputType: OutputType;
  prompt: string;
  referenceImages?: string[];
  size?: ImageSize;
  maxImages?: number;
  watermark?: boolean;
  stream?: boolean;
}

// API 请求接口
export interface Seedream5ApiRequest {
  model: string;
  prompt: string;
  image?: string | string[];
  sequential_image_generation: 'disabled' | 'auto';
  sequential_image_generation_options?: {
    max_images: number;
  };
  response_format: 'url';
  size: ImageSize;
  stream: boolean;
  watermark: boolean;
}

// 构建请求体
export function buildSeedream5Request(
  config: Seedream5NodeConfig
): Seedream5ApiRequest {
  const request: Seedream5ApiRequest = {
    model: 'doubao-seedream-5-0-260128',
    prompt: config.prompt,
    sequential_image_generation: config.outputType === 'single' ? 'disabled' : 'auto',
    response_format: 'url',
    size: config.size || '2K',
    stream: config.stream || false,
    watermark: config.watermark !== false,
  };

  // 图生图模式添加参考图
  if (config.generationMode === 'image2image' && config.referenceImages) {
    request.image = config.referenceImages.length === 1
      ? config.referenceImages[0]
      : config.referenceImages;
  }

  // 一组模式添加数量配置
  if (config.outputType === 'batch' && config.maxImages) {
    request.sequential_image_generation_options = {
      max_images: config.maxImages,
    };
  }

  return request;
}
```

---

## 附录

### 参数快速参考

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `model` | string | ✅ | - | 固定为 `doubao-seedream-5-0-260128` |
| `prompt` | string | ✅ | - | 提示词描述 |
| `image` | string/array | ❌ | - | 参考图（图生图必填） |
| `sequential_image_generation` | string | ✅ | `disabled` | `disabled` 或 `auto` |
| `max_images` | number | ❌ | - | 2-10（auto 模式必填） |
| `size` | string | ❌ | `2K` | `1K`/`2K`/`4K` |
| `watermark` | boolean | ❌ | `true` | 是否添加水印 |
| `stream` | boolean | ❌ | `false` | 是否流式返回 |

### 场景选择决策树

```
需要生成图片
├─ 有参考图吗？
│  ├─ 没有 → 文生图
│  │  ├─ 要几张？
│  │  │  ├─ 1 张 → 场景 1
│  │  │  └─ 多张 → 场景 2
│  └─ 有 → 图生图
│     ├─ 几张参考图？
│     │  ├─ 1 张
│     │  │  ├─ 要几张？
│     │  │  │  ├─ 1 张 → 场景 3
│     │  │  │  └─ 多张 → 场景 4
│     │  └─ 多张
│     │     ├─ 要几张？
│     │     │  ├─ 1 张 → 场景 5
│     │     │  └─ 多张 → 场景 6
```

---

## 更新日志

- **2026-03-14**: 初始版本，支持 Seedream 5.0 全部 6 种场景

---

## 联系支持

- **火山引擎文档**: https://www.volcengine.com/docs
- **技术支持**: 通过火山引擎控制台工单系统
