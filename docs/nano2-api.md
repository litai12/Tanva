# Nano2 (Gemini-3.1-Flash-Image-preview) API 文档

> - 支持文生图和图生图，最高 4K 分辨率输出
> - 最多 14 张参考图片用于风格/角色一致性
> - 支持极端宽高比 (1:4, 4:1, 1:8, 8:1)
> - 集成 Google 搜索增强，生成更真实的图像

## API 端点

**Base URL:** `https://api.apimart.ai/v1/images/generations`

---

## 1. 创建图像生成任务 (POST)

### 请求示例

```bash
curl --request POST \
  --url https://api.apimart.ai/v1/images/generations \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "gemini-3.1-flash-image-preview",
    "prompt": "Cyberpunk cityscape at night with neon lights",
    "size": "16:9",
    "resolution": "2K",
    "n": 1
  }'
```

### 请求参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| model | string | 是 | - | 模型名称，固定为 `gemini-3.1-flash-image-preview` |
| prompt | string | 是 | - | 图像生成的文本描述 |
| size | string | 否 | - | 图像宽高比 |
| resolution | string | 否 | 1K | 输出分辨率 |
| n | integer | 否 | 1 | 生成图片数量 |
| image_urls | array | 否 | - | 参考图片 URL 列表 |
| google_search | boolean | 否 | false | 启用 Google 文本搜索增强 |
| google_image_search | boolean | 否 | false | 启用 Google 图片搜索增强 |

### size 支持的宽高比

| 值 | 用途 |
|----|------|
| `1:1` | 正方形，头像，社交媒体 |
| `3:2` / `2:3` | 标准照片 |
| `4:3` / `3:4` | 传统显示比例 |
| `16:9` / `9:16` | 宽屏 / 竖屏视频封面 |
| `5:4` / `4:5` | Instagram 图片 |
| `21:9` | 超宽横幅 |
| `1:4` / `4:1` | 长海报 / 横幅 |
| `1:8` / `8:1` | 极长图片 / 横幅广告 |

### resolution 支持的分辨率

| 值 | 说明 |
|----|------|
| `0.5K` | ~512px，低分辨率预览 |
| `1K` | ~1024px，标准分辨率（默认） |
| `2K` | ~2048px，高分辨率 |
| `4K` | ~4096px，超高分辨率 |

> **注意:** 不同分辨率价格不同，4K 比 1K 更贵。

### image_urls 参考图片格式

支持两种格式：

**1. 完整图片 URL**
- 公开可访问的图片 URL (http:// 或 https://)
- 示例: `https://example.com/image.jpg`

**2. Base64 编码格式**
- 必须使用完整的 Data URI 格式
- 格式: `data:image/{format};base64,{base64data}`
- 支持的图片格式: jpeg, png, webp
- 示例: `data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABg...`

**限制:**
- 最多 14 张参考图片（建议：最多 10 张物体参考 + 4 张角色参考）
- 单张图片大小不超过 10MB
- 支持格式: jpeg, png, webp

### 成功响应 (200)

```json
{
  "code": 200,
  "data": [
    {
      "status": "submitted",
      "task_id": "task_01K8SGYNNNVBQTXNR4MM964S7K"
    }
  ]
}
```

### 错误响应

| 状态码 | 说明 |
|--------|------|
| 400 | 无效的请求参数 |
| 401 | 认证凭据无效 |
| 402 | 余额不足，请充值 |
| 403 | 访问被禁止，无权限 |
| 429 | 超出速率限制 |
| 500 | 服务器内部错误 |
| 502 | 网关错误，服务暂时不可用 |

---

## 2. 查询任务状态 (GET)

### 请求示例

```bash
curl --request GET \
  --url https://api.apimart.ai/v1/images/generations/{task_id} \
  --header 'Authorization: Bearer <token>'
```

### 响应示例

```json
{
  "code": 200,
  "data": {
    "status": "succeeded",
    "image_url": "https://..."
  }
}
```

### status 状态值

| 值 | 说明 |
|----|------|
| `submitted` | 已提交 |
| `processing` | 处理中 |
| `succeeded` | 成功 |
| `failed` | 失败 |

---

## 认证

所有 API 端点都需要 Bearer Token 认证。

获取 API Key: [API Key 管理页面](https://apimart.ai/console/token)

添加到请求头:
```
Authorization: Bearer YOUR_API_KEY
```
