## v8.1 模型指南

v8.1 是悠船平台最新的全面升级版本，在图像连贯性、细节丰富度和提示词遵循能力上均有显著提升，同时生成速度较前代提升约 5 倍。

## 核心亮点

-   **精准的提示词遵循**：显著增强对详细描述的理解与执行能力，能更准确地呈现复杂场景和细节要求。
    
-   **更高的图像质量**：生成图像更加连贯、细节更丰富，整体美学水准大幅提升。
    
-   **文本渲染增强**：在提示词中使用引号包裹的文本（如 `"Hello World"`）可获得更精准的文字渲染效果。
    
-   **原生高清模式（**`--hd`）：支持原生 2K 分辨率渲染，无需后期放大即可获得高清图像。
    
-   **约 5 倍速度提升**：相比前代模型，生成速度大幅加快。
    
-   **风格系统兼容**：完全兼容 v7 的个性化配置、风格参考和 Moodboard，可无缝迁移已有风格资产。
    

* * *

## 支持的接口

| 接口  | 路径  | 支持状态 | 备注  |
| --- | --- | --- | --- |
| 图像生成 | `POST /v1/tob/diffusion` | ✅   |     |
| 变化  | `POST /v1/tob/variation` | ✅   | 强烈与微妙 |
| 高清  | `POST /v1/tob/upscale` | ⚠️  | 等同于文生图 + `--hd --seed xxx` ，见下方说明 |
| 延展  | `POST /v1/tob/pan` | ❌   |     |
| 扩图  | `POST /v1/tob/outpaint` | ❌   |     |
| 区域重绘 | `POST /v1/tob/inpaint` | ❌   |     |
| 重塑  | `POST /v1/tob/remix` | ✅   |     |
| 编辑  | `POST /v1/tob/edit` | ✅   | 同 v7 |
| 高级编辑 | `POST /v1/tob/upload-paint` | ✅   | 同 v7 |
| 转绘  | `POST /v1/tob/retexture` | ✅   |     |
| 移除背景 | `POST /v1/tob/remove-background` | ✅   |     |
| 增强  | `POST /v1/tob/enhance` | ❌   | v8.1 无 draft 模式，因而不支持增强接口 |
| Moodboard | `POST /v1/tob/moodboard` | ✅   |     |
| 图生视频 | `POST /v1/tob/video-diffusion` | ✅   |     |
| 视频延长 | `POST /v1/tob/extend-video` | ✅   |     |
| 视频高清 | `POST /v1/tob/video-upscale` | ✅   |     |

> **说明**

> v8 系列的"高清"不再使用传统高清接口，而是通过文生图 + `--hd --seed xxx` 方式实现，一次任务直接生成 4 张高清图片。

* * *

## 完整参数表

| 参数  | 取值范围 | 默认值 | 说明  |
| --- | --- | --- | --- |
| `--ar` | 正整数比值 | 1:1 | 宽高比 |
| `--raw` | —   | —   | 原始模式，不采用MJ 的默认美化 |
| `--hd` | —   | —   | 原生 2K 高清渲染 |
| `--chaos` | 0-100 | 0   | 结果多样性 |
| `--seed` | 0-4294967295 | 随机  | 随机种子 |
| `--stylize` | 0-1000 | 100 | 艺术风格强度 |
| `--quality` | 1, 4 | 1   | 图像细节程度。`4` 为高质量模式 |
| `--iw` | 0-3 | 1   | 图像提示权重（详见「图片提示词」文档） |
| `--no` | 文本  | —   | 否定提示 |
| `--sref` | URL（最多 20 个） | —   | 风格参考 |
| `--sw` | 0-1000 | 100 | 风格参考权重 |
| `--sv` | 6   | 6   | 风格算法版本（仅支持 6） |
| `--exp` | 0-100 | 0   | 实验参数，增加画面动态感 |
| `--personalize` | —   | —   | 个性化配置 |
| `--draft` | ❌   | —   | 不支持草图模式 |
| `--fast` | —   | —   | 快速模式（默认） |
| `--turbo` | ❌   | —   | 不支持极速模式（2 倍费用） |

* * *

## 特有能力详解

### 原生高清模式（`--hd`）

全新引入的原生 2K 分辨率渲染参数。与传统的"先生成 → 再放大"流程不同，`--hd` 在生成阶段即以高分辨率渲染，画面质量和细节均优于后期放大。

**使用方式：**

```
import requests

url = "https://ali.youchuan.cn/v1/tob/diffusion"
headers = {
    "x-youchuan-app": "YOUR_APP_ID",
    "x-youchuan-secret": "YOUR_SECRET_KEY"
}
data = {
    "text": "A beautiful sunset over the mountains --v 8.1 --hd",
    "callback": "https://your-callback-url.com"
}

response = requests.post(url, headers=headers, json=data)
print(response.json())
```

* * *

## 限制与验证规则

| 限制项 | 说明  |
| --- | --- |
| 多提示词 `::` | 不支持 |
| 停止 `--stop` | 不支持 |
| 怪异 `--weird` | 不支持 |
| 平铺 `--tile` | 不支持 |
| 角色参考 `--cref` | 不支持，请改用 `--oref` |
| `--cw` | 不支持 |
| 批次数量 `--bs` | 不支持 |
| 风格版本 `--sv` | 仅支持值 `6` |
| `--oref` 多图 | 仅支持 1 张参考图 |
| 风格参考 `--sref` | 最多 20 个 URL |
| 图片提示词 | 最多 20 张垫图 |

* * *

## 效果展示

以下 10 组示例展示了 v8.1 对比 v7 在不同应用场景下的生成效果。所有 v8.1 示例均使用 `--raw --hd` 参数组合，输出原生 2K 高清图像。

### 01 人物绘画

![01](https://help-static-aliyun-doc.aliyuncs.com/assets/img/zh-CN/4154809771/p1074239.png)

```
young elven hunter with moss-woven armor, antler headdress, intricate leather straps and bone ornaments, freckled skin, holding a carved wooden bow, soft forest light, detailed character portrait --ar 2:3 --raw --v 8.1 --hd
```

**场景说明**：奇幻角色肖像，展示 v8.1 对复杂装备细节（苔藓纹理、皮革编织、骨饰）和人物皮肤质感的精准渲染能力。

* * *

### 02 空间艺术

![02](https://help-static-aliyun-doc.aliyuncs.com/assets/img/zh-CN/4154809771/p1074240.png)

```
一个超现实主义的城市购物中心，现代的、弯曲的建筑风格类似于扎哈·哈迪德的风格，四面都有大玻璃窗。外部由白色金属的流动曲线组成，暖色调反射光线。一个热闹的街景展示了人们在室外走动，被自然光照亮。前面有一块空地，供高速行驶的汽车使用。 --ar 2:3 --raw --v 8.1 --hd
```

**场景说明**：建筑概念设计，展示 v8.1 对中文长提示词的精准遵循能力和复杂建筑结构的连贯生成。

* * *

### 03 美食摄影

![03](https://help-static-aliyun-doc.aliyuncs.com/assets/img/zh-CN/4154809771/p1074241.png)

```
Close angled serving shot of one rhubarb scone with glaze, crumb and rhubarb pieces visible, soft background blur, realistic brunch-style food photography --ar 2:3 --raw --v 8.1 --hd
```

**场景说明**：商业级美食摄影，展示 v8.1 对食物质感（釉面光泽、碎屑颗粒）和专业级景深的模拟能力。

* * *

### 04 视觉UI

![04](https://help-static-aliyun-doc.aliyuncs.com/assets/img/zh-CN/4154809771/p1074242.png)

```
iOS app discovery page UI design, soft pink gradient background, cute cat theme, top shows "Discover" with cat ear decoration, below shows a 30-day check-in card with cat paw and streak count, next to it a lucky wheel icon with cat face, below that a two-column grid of feature cards: "Food Recs" with cat eating icon, "Travel Recs" with cat suitcase, "Restaurant Check-in" with cat paw pin, "Random Picker" with cat question mark, bottom has "Daily Sign-in" banner with prize box and cat, frosted glass effect, rounded corners, soft pink shadows, minimalist, modern feminine aesthetic, cute but not childish, clean iOS style, no extra text --ar 2:3 --raw --v 8.1 --hd
```

**场景说明**：APP UI 设计稿，展示 v8.1 对复杂布局描述的精准还原能力和文本渲染效果（"Discover"等 UI 文字）。

* * *

### 05 游戏美术

![05](https://help-static-aliyun-doc.aliyuncs.com/assets/img/zh-CN/4154809771/p1074243.png)

```
A towering mechanical hybrid beast, fusing a Wolf and a Gundam, standing tall in the middle Futuristic Cyber city. Its design blends the muscular form of a Wolf with sleek Gundam-style armor, glowing neon stripes etched across metallic plating, sharp cybernetic claws, and an armored tail. The head shows a fierce Wolf snarl merged with a mech helmet, glowing eyes radiating power. cinematic sky. Futuristic war machine aesthetic, ultra-detailed, hyper-realistic textures --ar 2:3 --raw --hd
```

**场景说明**：游戏概念原画，展示 v8.1 对"融合概念"（生物 × 机甲）的创造性理解和超高细节纹理的生成能力。

* * *

### 06 电商展示

![06](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=)

```
A person's manicured hands holding a rectangular clear glass perfume bottle with a thick base and a gold sprayer. The bottle has a large, simple gold label with the word "BRAND" in a bold. The person is also holding the bottle's cap, which is a translucent brown cube with a gold accent. The background is a clean, bright, and soft-focused white. The lighting is bright and even, creating a high-end product photography look. --ar 2:3 --raw --v 8.1 --hd
```

**场景说明**：电商产品图，展示 v8.1 对透明材质（玻璃瓶身）、金属质感和专业布光的精准模拟能力。

* * *

### 07 自然景观

![07](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=)

```
national geographic photography, beautiful thailand beach, bright, no boats in the image --ar 2:3 --raw --v 8.1 --hd
```

**场景说明**：极简提示词的高质量风景生成，展示 v8.1 即使在短提示词下也能输出国家地理级别的摄影品质。

* * *

### 08 插画漫画

![08](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=)

```
充满活力的外滩景观插图，包括标志性建筑，繁华的街道和充满活力的文化符号。包括复古的巴洛克建筑，人们在长椅上晒日光浴等，都以清晰的字体设计成带有文字的上海信息地图。卡通插画，高品质，细节齐全。浅粉色调，注重建筑细节 --ar 2:3 --raw --v 8.1 --hd
```

**场景说明**：信息图式城市插画，展示 v8.1 对中文语境下复杂场景构图和多元素组合的理解力。

* * *

### 09 文字海报

![09](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=)

```
Modern premium motivational poster, ultra high CTR, 4:5 aspect ratio, clean flat 2D cartoon illustration. Background: smooth gradient midnight purple (#140A2E) to electric blue (#0A84FF), no texture/noise/grain. Main concept: "WORK" formed by ONE single continuous rope - fully connected letters, smooth flowing curves, consistent thickness, clean vector style, highly readable. Text layout: Top (small, bold, white sans serif): "SILENT" | Center (rope typography): "WORK" | Bottom (medium large, bold, white): "LOUD RESULTS". Pure white (#FFFFFF), strong contrast, no heavy glow. Fuse: rope IS the fuse; spark starts exactly at TOP RIGHT TIP of "K", attached to rope - flat 2D spark, bright white yellow core, sharp rays, minimal glow, burns right to left. Dynamite: large bundle of 3 cartoon sticks (#D72638), tied with rope, horizontal UNDER "WORK", slightly tilted, ~70 80% word width, flat shading, not covering text. Rope from "W" flows down into bundle. Smoke: ONLY at spark near "K" - minimal, soft 2D, white with slight blue tint. Style: flat vector, Dribbble/Apple minimalism, clean edges, no realism/clutter. Priority: 1) WORK rope word 2) spark at K 3) dynamite underneath 4) clean readable text. --ar 2:3 --raw --profile 26b72fx --v 8.1 --hd
```

**场景说明**：创意文字海报设计，展示 v8.1 的文本渲染增强能力和对极其复杂布局指令（颜色代码、精确位置、元素优先级）的遵循。注意此示例还使用了 `--profile` 个性化参数。

* * *

### 10 产品造型

![10](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=)

```
Modern, large, over-ear headphones reminiscent of Apple AirPods. Soft orange highlights on the surface, orange backlighting. Ultra-low-angle shot. Three-quarter angle. Light gray neutral background. Photorealistic render. Studio shot with soft accent lighting and subtle shadows. Ultra-high detail, 4K, shallow depth of field, three-quarter angle, clean, modern aesthetic. No logos. --ar 2:3 --raw --v 8.1 --hd
```

**场景说明**：工业产品渲染，展示 v8.1 对精确摄影参数（超低角度、浅景深、三点布光）的理解和产品材质还原能力。

* * *

## 最佳实践

-   **高清出图**：优先使用 `--hd` 获取4 张原生 2k 高清图，避免后期放大的质量损失。
    
-   **文字海报**：利用文本渲染增强功能，用引号包裹需要显示的文字。
    
-   **风格迁移**：v8.1 完全兼容 v7 的 sref 和 Moodboard，已有风格资产可直接使用。
    
-   **提示词详尽**：充分利用 v8.1 增强的提示词遵循能力，可以写更详细的场景描述。
    
-   **质量优先**：使用 `--q 4` 获取最高细节度，适合最终交付品质的图像。
    
-   **角色一致**：使用 `--oref` 实现跨场景的角色/物体一致性。