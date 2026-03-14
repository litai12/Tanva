# 阿里云 Midjourney v7 和 Niji 7 接入文档

## 📋 目录
- [概述](#概述)
- [API 密钥配置](#api-密钥配置)
- [接口规范](#接口规范)
- [模型说明](#模型说明)
- [参数详解](#参数详解)
- [请求示例](#请求示例)
- [响应格式](#响应格式)
- [错误处理](#错误处理)
- [积分计费](#积分计费)

---

## 概述

本文档详细说明如何接入阿里云悠船大模型平台 API 的 Midjourney v7 和 Niji 7 两个图像生成模型。

### 基本信息
- **服务商**: 阿里云悠船大模型平台 (Youchuan)
- **API 文档**: https://tob.youchuan.cn/docs/apis/api_list#文生图-diffusion
- **参数文档**: https://help.aliyun.com/zh/marketplace/youchuan-api-parameter-details
- **接口类型**: 文生图 (Text-to-Image)
- **支持模型**: Midjourney v7, Niji 7

---

## API 密钥配置

### 1. 获取 API 密钥

访问阿里云市场购买有川 API 服务后，你将获得以下信息：

| 字段名 | 说明 | 示例 | 必填 |
|--------|------|------|------|
| `x-youchuan-app` | 应用id | `y01kkn4r1w7ebe9m159ec6y5atq` | ✅ 是 |
| `x-youchuan-secret` | 授权码 | `tbNEcj17UN3fzxSJRODhJcDlS4nPakk7QLHdV5t9Dks` | ✅ 是 |
| `endpoint` | API 端点地址 | `https://api.youchuan.cn` | ✅ 是 |

### 2. 配置环境变量

在项目的 `.env` 文件中添加：

```bash
# 阿里云有川 API 配置
YOUCHUAN_APPCODE=your_appcode_here
YOUCHUAN_ENDPOINT=https://api.youchuan.cn
```

### 3. 请求头配置

所有请求需要在 HTTP Header 中携带：

```http
Authorization: APPCODE {your_appcode}
Content-Type: application/json
```

---

## 接口规范

### 基本信息
- **接口路径**: `/api/youchuan/diffusion`
- **请求方法**: `POST`
- **Content-Type**: `application/json`
- **超时时间**: 建议 120 秒

### 请求体结构

```typescript
interface MidjourneyRequest {
  text: string;           // 提示词 + 参数（必填）
  webhook_url?: string;   // 回调地址（可选）
  task_id?: string;       // 自定义任务ID（可选）
}
```

---

## 模型说明

### Midjourney v7
- **模型标识**: `--v 7`
- **特点**: 最新版本，图像质量更高，细节更丰富
- **适用场景**: 通用图像生成、写实风格、概念艺术
- **推荐积分**: 60 积分/次

### Niji 7
- **模型标识**: `--niji 7`
- **特点**: 专注动漫风格，二次元画风
- **适用场景**: 动漫角色、插画、漫画风格
- **推荐积分**: 60 积分/次

---

## 参数详解

### 核心参数

#### 1. 模型版本参数

| 参数 | 说明 | 可选值 | 示例 |
|------|------|--------|------|
| `--v` | Midjourney 版本 | `7` | `--v 7` |
| `--niji` | Niji 动漫模型版本 | `7` | `--niji 7` |

**注意**: `--v` 和 `--niji` 互斥，只能选择其中一个。

---

#### 2. 宽高比参数 (Aspect Ratio)

| 参数 | 说明 | 可选值 | 示例 |
|------|------|--------|------|
| `--ar` | 图像宽高比 | 见下表 | `--ar 16:9` |

**常用宽高比**:

| 比例 | 说明 | 适用场景 |
|------|------|----------|
| `1:1` | 正方形 | 社交媒体头像、Instagram |
| `16:9` | 横向宽屏 | 桌面壁纸、YouTube 封面 |
| `9:16` | 竖向 | 手机壁纸、Stories |
| `4:3` | 传统横向 | 演示文稿 |
| `3:4` | 传统竖向 | 海报 |
| `21:9` | 超宽屏 | 电影画幅 |
| `2:3` | 竖向 | 书籍封面 |
| `3:2` | 横向 | 摄影作品 |

---

#### 3. 风格化参数 (Stylize)

| 参数 | 说明 | 取值范围 | 默认值 | 示例 |
|------|------|----------|--------|------|
| `--s` | 风格化强度 | `0-1000` | `100` | `--s 750` |

**风格化程度说明**:
- `0-50`: 低风格化，更贴近提示词字面意思
- `100`: 默认平衡
- `200-500`: 中等风格化，艺术感增强
- `600-1000`: 高风格化，更具艺术创意

---

#### 4. 混乱度参数 (Chaos)

| 参数 | 说明 | 取值范围 | 默认值 | 示例 |
|------|------|----------|--------|------|
| `--c` | 结果多样性 | `0-100` | `0` | `--c 50` |

**混乱度说明**:
- `0`: 结果一致性高，4张图相似
- `25-50`: 中等变化
- `75-100`: 高度变化，4张图差异大

---

#### 5. 质量参数 (Quality)

| 参数 | 说明 | 可选值 | 默认值 | 示例 |
|------|------|--------|--------|------|
| `--q` | 渲染质量 | `0.25`, `0.5`, `1`, `2` | `1` | `--q 2` |

**质量等级说明**:
- `0.25`: 快速草图，低质量
- `0.5`: 标准质量，速度较快
- `1`: 默认质量（推荐）
- `2`: 高质量，渲染时间更长

---

#### 6. 风格模式参数

| 参数 | 说明 | 可选值 | 示例 |
|------|------|--------|------|
| `--style` | 风格模式 | `raw`, `expressive`, `cute` | `--style raw` |

**风格模式说明**:
- `raw`: 原始风格，更真实
- `expressive`: 表现力强，艺术感
- `cute`: 可爱风格（Niji 专用）

---

#### 7. 其他参数

| 参数 | 说明 | 可选值 | 示例 |
|------|------|--------|------|
| `--seed` | 随机种子 | `0-4294967295` | `--seed 12345` |
| `--tile` | 平铺模式 | 无值 | `--tile` |
| `--no` | 排除元素 | 任意文本 | `--no people` |
| `--iw` | 图像权重 | `0-2` | `--iw 1.5` |

---

## 请求示例

### 示例 1: Midjourney v7 基础请求

```json
{
  "text": "a cute cat sitting on a windowsill, sunset lighting --v 7"
}
```

### 示例 2: Midjourney v7 完整参数

```json
{
  "text": "a futuristic city with flying cars, cyberpunk style, neon lights --v 7 --ar 16:9 --s 750 --c 30 --q 1"
}
```

### 示例 3: Niji 7 动漫风格

```json
{
  "text": "anime girl with blue hair, school uniform, cherry blossoms --niji 7 --ar 2:3 --style cute"
}
```

### 示例 4: Niji 7 高风格化

```json
{
  "text": "samurai warrior in traditional armor, dramatic pose --niji 7 --ar 9:16 --s 850 --c 50 --q 2"
}
```

### 示例 5: 排除特定元素

```json
{
  "text": "beautiful landscape with mountains and lake --v 7 --ar 21:9 --no people, buildings"
}
```

### 示例 6: 平铺纹理

```json
{
  "text": "seamless floral pattern, watercolor style --v 7 --tile --ar 1:1"
}
```

---

## 响应格式

### 成功响应

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "task_id": "1234567890abcdef",
    "status": "processing",
    "created_at": "2026-03-14T05:55:36Z"
  }
}
```

### 查询结果

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "task_id": "1234567890abcdef",
    "status": "completed",
    "images": [
      {
        "url": "https://cdn.youchuan.cn/images/xxx1.png",
        "index": 1
      },
      {
        "url": "https://cdn.youchuan.cn/images/xxx2.png",
        "index": 2
      },
      {
        "url": "https://cdn.youchuan.cn/images/xxx3.png",
        "index": 3
      },
      {
        "url": "https://cdn.youchuan.cn/images/xxx4.png",
        "index": 4
      }
    ],
    "seed": 12345678,
    "created_at": "2026-03-14T05:55:36Z",
    "completed_at": "2026-03-14T05:57:12Z"
  }
}
```

### 状态说明

| 状态 | 说明 |
|------|------|
| `pending` | 排队中 |
| `processing` | 生成中 |
| `completed` | 已完成 |
| `failed` | 失败 |

---

## 错误处理

### 常见错误码

| 错误码 | 说明 | 解决方案 |
|--------|------|----------|
| `400` | 参数错误 | 检查 text 参数格式 |
| `401` | 认证失败 | 检查 APPCODE 是否正确 |
| `403` | 权限不足 | 确认服务已购买并激活 |
| `429` | 请求过于频繁 | 降低请求频率 |
| `500` | 服务器错误 | 稍后重试 |

### 错误响应示例

```json
{
  "code": 400,
  "message": "Invalid parameter: text is required",
  "data": null
}
```

---

## 积分计费

### 计费规则

| 服务 | 积分消耗 | 说明 |
|------|----------|------|
| Midjourney v7 | 60 积分/次 | 生成 4 张图片 |
| Niji 7 | 60 积分/次 | 生成 4 张图片 |

### 影响计费的因素

1. **质量参数**: `--q 2` 可能消耗更多积分
2. **图像尺寸**: 更大的宽高比可能增加消耗
3. **重试次数**: 每次请求都会计费

---

## 最佳实践

### 1. 提示词优化
- 使用清晰、具体的描述
- 避免过于复杂的句子
- 使用英文提示词效果更好

### 2. 参数组合建议

**快速预览**:
```
--q 0.5 --s 100
```

**标准质量**:
```
--q 1 --s 100
```

**高质量输出**:
```
--q 2 --s 750 --c 20
```

**艺术创作**:
```
--s 850 --c 50
```

### 3. 性能优化
- 使用 webhook 异步处理
- 实现请求队列避免并发过高
- 缓存常用结果

---

## 技术实现参考

### TypeScript 类型定义

```typescript
// 模型类型
export type MidjourneyModel = 'v7' | 'niji7';

// 宽高比类型
export type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '21:9' | '2:3' | '3:2';

// 风格模式
export type StyleMode = 'raw' | 'expressive' | 'cute';

// 质量等级
export type QualityLevel = 0.25 | 0.5 | 1 | 2;

// 请求参数接口
export interface MidjourneyRequestDto {
  model: MidjourneyModel;           // 模型选择
  prompt: string;                   // 提示词
  aspectRatio?: AspectRatio;        // 宽高比
  stylize?: number;                 // 风格化 (0-1000)
  chaos?: number;                   // 混乱度 (0-100)
  quality?: QualityLevel;           // 质量
  style?: StyleMode;                // 风格模式
  seed?: number;                    // 随机种子
  tile?: boolean;                   // 平铺模式
  noElements?: string[];            // 排除元素
  imageWeight?: number;             // 图像权重 (0-2)
}

// 构建 text 参数的函数
export function buildMidjourneyText(dto: MidjourneyRequestDto): string {
  let text = dto.prompt;

  // 添加模型参数
  if (dto.model === 'v7') {
    text += ' --v 7';
  } else if (dto.model === 'niji7') {
    text += ' --niji 7';
  }

  // 添加可选参数
  if (dto.aspectRatio) text += ` --ar ${dto.aspectRatio}`;
  if (dto.stylize !== undefined) text += ` --s ${dto.stylize}`;
  if (dto.chaos !== undefined) text += ` --c ${dto.chaos}`;
  if (dto.quality !== undefined) text += ` --q ${dto.quality}`;
  if (dto.style) text += ` --style ${dto.style}`;
  if (dto.seed !== undefined) text += ` --seed ${dto.seed}`;
  if (dto.tile) text += ' --tile';
  if (dto.noElements && dto.noElements.length > 0) {
    text += ` --no ${dto.noElements.join(', ')}`;
  }
  if (dto.imageWeight !== undefined) text += ` --iw ${dto.imageWeight}`;

  return text;
}
```

---

## 附录

### 参数快速参考表

| 参数 | 简写 | 类型 | 范围/选项 | 默认值 |
|------|------|------|-----------|--------|
| 模型版本 | `--v` | 数字 | `7` | - |
| Niji模型 | `--niji` | 数字 | `7` | - |
| 宽高比 | `--ar` | 比例 | `1:1`, `16:9`, 等 | `1:1` |
| 风格化 | `--s` | 数字 | `0-1000` | `100` |
| 混乱度 | `--c` | 数字 | `0-100` | `0` |
| 质量 | `--q` | 小数 | `0.25`, `0.5`, `1`, `2` | `1` |
| 风格 | `--style` | 文本 | `raw`, `expressive`, `cute` | - |
| 种子 | `--seed` | 整数 | `0-4294967295` | 随机 |
| 平铺 | `--tile` | 布尔 | - | `false` |
| 排除 | `--no` | 文本 | 任意 | - |
| 图像权重 | `--iw` | 小数 | `0-2` | `1` |

---

## 更新日志

- **2026-03-14**: 初始版本，支持 v7 和 Niji 7
- 后续更新将在此记录

---

## 联系支持

- **阿里云有川文档**: https://tob.youchuan.cn/docs
- **技术支持**: 通过阿里云工单系统
