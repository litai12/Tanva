# HappyHorse 1.0 R2V 视频生成 — 接入设计

**日期：** 2026-04-27
**范围：** 在现有视频生成框架内新增独立的 `happyhorseR2V` 流程节点，对接阿里云百炼 `happyhorse-1.0-r2v` 模型，实现按分辨率 × 时长动态扣费
**官方文档：** https://bailian.console.aliyun.com/cn-beijing/?tab=api#/api/?type=model&url=3030778

---

## 1. 背景与目标

阿里云百炼上线了新视频生成模型 `happyhorse-1.0-r2v`（彩马参考视频）。它和已接入的 `wan2.6-r2v` 共用 DashScope 的视频合成 endpoint，但**输入形态不同**：

| 维度 | `wan2.6-r2v`（已接入） | `happyhorse-1.0-r2v`（本次新增） |
|---|---|---|
| 输入素材 | 参考视频 `input.reference_video_urls: string[]` | 参考图片 `input.media: [{ type: "reference_image", url }]` |
| 素材数量 | 上限 3 | 1 ~ 9 |
| 关键参数 | `size`、`duration`、`shot_type` | `resolution`、`ratio`、`duration`（不带 shot_type） |
| 计费 | 整次定额 600 credits（¥6/调用） | 按分辨率 × 时长动态扣费 |

因此本次接入采用**全新独立节点 + 独立 controller endpoint + 独立计费 service-type** 的方式，不试图复用 `wan2R2V` 的节点 / 路由。

---

## 2. 上游 API（DashScope）

### 2.1 创建任务

```
POST https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis
Authorization: Bearer $DASHSCOPE_API_KEY
X-DashScope-Async: enable
Content-Type: application/json

{
  "model": "happyhorse-1.0-r2v",
  "input": {
    "prompt": "...（支持 character1/character2 占位指代 media 顺序）",
    "media": [
      { "type": "reference_image", "url": "https://..." },
      ...                                     // 1 ~ 9 张
    ]
  },
  "parameters": {
    "resolution": "720P" | "1080P",           // 默认 1080P
    "ratio": "16:9" | "9:16" | "1:1" | "4:3" | "3:4",   // 默认 16:9
    "duration": 3..15,                        // 整数秒，默认 5
    "watermark": true | false,                // 默认 true，本系统强制 false
    "seed": 0..2147483647                     // 可选
  }
}
```

### 2.2 任务查询

复用现有 `wan2.6-r2v` controller 的轮询逻辑：
- 状态 endpoint：`GET https://dashscope.aliyuncs.com/api/v1/tasks/{taskId}`
- 状态字段映射：`output.task_status` → `succeeded` / `failed`
- 视频地址字段映射：`output.video_url`
- 轮询参数：每 15s 一次，最多 40 次（共 10 分钟）

### 2.3 素材限制

- 图片格式：JPEG / JPG / PNG / WEBP
- 短边 ≥ 400px
- 文件大小 ≤ 10MB
- URL 必须公网可访问

---

## 3. 后端实现

### 3.1 Controller endpoint

新增 `POST /ai/dashscope/generate-happyhorse-r2v`，位于 `backend/src/ai/ai.controller.ts`，紧邻 `generateWan26R2VViaDashscope`。

**做法 — 抽取共享 helper：**

将现有 `generateWan26R2VViaDashscope` 中的轮询/状态解析逻辑抽成 private 方法 `pollDashScopeVideoTask(taskId, ctx)`，被 wan2.6-r2v / wan2.7-i2v / happyhorse-r2v 三个 endpoint 共用。

> 范围控制：本次设计**只抽取轮询函数**，不动 wan26-t2v / wan26-i2v / wan27-i2v 的现有调用结构（避免连带改动）。

```ts
@Post('dashscope/generate-happyhorse-r2v')
async generateHappyhorseR2VViaDashscope(@Body() body: any, @Req() req: any) {
  return this.withCredits(req, 'happyhorse-r2v-video', 'happyhorse-1.0-r2v', async () => {
    // 1. 校验 DASHSCOPE_API_KEY
    // 2. normalizeHappyhorseR2VBodyForUpstream(body)：
    //    - input.media[].url 走 normalizeImageUrlForUpstream
    //    - parameters.watermark 强制设为 false
    //    - 其他参数透传
    // 3. POST 创建任务，提取 taskId
    // 4. 调用共享轮询函数 pollDashScopeVideoTask
  }, undefined, undefined, undefined, this.buildHappyhorseCreditRequestParams(body), {
    treatReturnedFailureAsError: true,
  });
}
```

### 3.2 Body 归一化

新增 `normalizeHappyhorseR2VBodyForUpstream`：

```ts
private normalizeHappyhorseR2VBodyForUpstream(body: any): any {
  if (!body || typeof body !== 'object') return body;
  const next: any = { ...body };
  if (!next.input || typeof next.input !== 'object') return next;

  next.input = { ...next.input };
  const rawMedia = next.input.media;
  if (Array.isArray(rawMedia)) {
    next.input.media = rawMedia
      .map((item: any) => {
        if (!item || typeof item !== 'object') return null;
        const mediaItem: any = { ...item };
        if (typeof mediaItem.type !== 'string' || !mediaItem.type.trim()) {
          mediaItem.type = 'reference_image';        // 兜底
        }
        if (typeof mediaItem.url === 'string' && mediaItem.url.trim()) {
          mediaItem.url = this.normalizeImageUrlForUpstream(mediaItem.url);
        }
        return mediaItem;
      })
      .filter((value: any) => value && typeof value.url === 'string' && value.url.trim());
  }

  // 强制不打水印
  next.parameters = { ...(next.parameters || {}), watermark: false };

  return next;
}
```

### 3.3 计费参数构造

```ts
private buildHappyhorseCreditRequestParams(body: any): Record<string, any> {
  const parameters = body?.parameters && typeof body.parameters === 'object' ? body.parameters : {};
  const resolution =
    typeof parameters.resolution === 'string' && parameters.resolution.trim()
      ? parameters.resolution.trim().toUpperCase()
      : '1080P';   // 与官方默认一致
  const durationRaw = Number(parameters.duration);
  const duration = Number.isFinite(durationRaw) && durationRaw > 0
    ? Math.min(15, Math.max(3, Math.round(durationRaw)))
    : 5;

  const mediaCount = Array.isArray(body?.input?.media) ? body.input.media.length : 0;
  const referenceImageUrls = Array.isArray(body?.input?.media)
    ? body.input.media.map((m: any) => m?.url).filter((u: any) => typeof u === 'string')
    : [];

  return {
    managedModelKey: 'happyhorse-1.0-r2v',
    modelKey: 'happyhorse-1.0-r2v',
    vendorKey: 'dashscope',
    platformKey: 'dashscope',
    aiProvider: 'dashscope',
    generationMode: 'r2v',
    resolution,
    duration,
    durationSec: duration,
    referenceImageCount: mediaCount,
    ...this.buildRequestPromptAndImageParams(body?.input?.prompt, referenceImageUrls),
  };
}
```

### 3.4 计费配置

`backend/src/credits/credits.config.ts` 新增：

```ts
'happyhorse-r2v-video': {
  serviceName: 'HappyHorse 参考视频',
  provider: 'dashscope',
  creditsPerCall: 1000,        // fallback：5s × 200 credits/s（1080P）
  description: '使用 HappyHorse 1.0 R2V 参考图生成视频',
  dynamicPricing: {
    perSecondByResolution: { '720P': 120, '1080P': 200 },
  },
}
```

定价依据（1 credit = ¥0.01）：

| 分辨率 | 上游价 | 我方价 | 加价幅度 | credits/秒 |
|---|---|---|---|---|
| 720P | ¥0.9/s | ¥1.2/s | +33% | 120 |
| 1080P | ¥1.6/s | ¥2.0/s | +25% | 200 |

> 注：用户提的"溢价 20%"是大致目标，实际给出的卖价反推后是 +33% / +25%。本设计严格按用户给出的卖价（¥1.2/¥2.0）落地，不再做百分比换算。

### 3.5 计费引擎扩展

`backend/src/credits/credits.service.ts` 现有 `dynamicPricing` 路径仅识别 `noSound/withSound` × `std/pro` × `duration` 矩阵（kling 风格，`resolveKlingModelCredits` 函数 line 795）。

按现有 `resolveSoraModelCredits` / `resolveKlingModelCredits` / `resolveImageResolutionCredits` 的扩展模式，新增 `resolveHappyhorseR2VCredits`，并在 `resolveCreditConsumePolicy`（line 441 起的 resolver 链）中调用：

```ts
private resolveHappyhorseR2VCredits(
  serviceType: ServiceType,
  defaultCredits: number,
  requestParams: any,
): number {
  if (serviceType !== 'happyhorse-r2v-video') return defaultCredits;
  const pricing = (CREDIT_PRICING_CONFIG as Record<string, any>)[serviceType];
  const matrix = pricing?.dynamicPricing?.perSecondByResolution as Record<string, number> | undefined;
  if (!matrix) return defaultCredits;
  const resolution = (requestParams?.resolution || '').toString().toUpperCase();
  const rate = matrix[resolution];
  const duration = Number(requestParams?.duration);
  if (rate && Number.isFinite(duration) && duration > 0) {
    return Math.round(rate * duration);
  }
  return defaultCredits;
}

// resolveCreditConsumePolicy 内追加：
creditsToDeduct = this.resolveHappyhorseR2VCredits(
  params.serviceType,
  creditsToDeduct,
  effectiveRequestParams,
);
```

同时在 `resolveManagedVideoServiceName`（line 846）追加分支，让账单备注能体现 "HappyHorse 视频（720P / 5秒）" 这类标签。

### 3.6 Service-type 注册

`backend/src/credits/credits.service.ts` 中：
- `VIDEO_SERVICE_TYPES` 列表（line ~93）追加 `'happyhorse-r2v-video'`
- 视频判定列表（line ~111）追加 `'happyhorse-r2v-video'`
- `resolveBillingModelLabel` / `buildBillingRemark` 的"视频服务"判断（line 1656~1660、1719~1723）追加 `'happyhorse-r2v-video'`

### 3.7 Admin 节点配置

`backend/src/admin/services/node-config.service.ts` 中存在两份 `defaultConfigs` 数组（一份在 `initializeDefaultConfigs` line 839 起，一份在重置流程的 `getDefaultConfigs`），两处都要追加同样的条目，**插入在 `wan27Video` 之后**（不动任何已有节点的 sortOrder）：

```ts
{
  nodeKey: 'happyhorseR2V',
  nameZh: '彩马参考视频',
  nameEn: 'HappyHorse R2V',
  category: 'video',
  sortOrder: 36,         // wan27Video=35，happyhorseR2V 紧随其后
  creditsPerCall: 1000,  // fallback；实际按 perSecondByResolution 动态计算
  serviceType: 'happyhorse-r2v-video',
  priceYuan: 10,         // 5s/1080P 的对应价 ¥10
  description: '阿里 HappyHorse 1.0 R2V 参考图视频生成',
  metadata: {
    ...buildVodNodeMetadata(
      {
        type: 'happyhorseR2V',
        provider: 'dashscope',
        supportedModels: ['happyhorse-1.0-r2v'],
        defaultData: {
          resolution: '1080P',
          ratio: '16:9',
          duration: 5,
          watermark: false,
        },
      },
      {
        label: 'DashScope HappyHorse 1.0 R2V',
        modelName: 'HappyHorse',
        modelVersion: '1.0-r2v',
        outputConfig: {
          durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
          resolutions: ['720P', '1080P'],
          ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
        },
        inputModes: ['reference_image_1_to_9'],
        notes: ['1~9 张参考图，prompt 用 character1/character2... 占位指代'],
      },
      {
        nodeKind: 'dashscope_video_generation',
        upstreamDomain: 'dashscope.aliyuncs.com',
      },
    ),
  },
},
```

**关于 sortOrder**：实际类目排序由 FlowOverlay 的分类菜单决定，sortOrder 主要是初始化排序参考；`36` 与现有 `wan27Video=35` 不冲突，且后续视频节点（如 sora2、kling 等）已有 sortOrder ≥ 31 的均不冲突，可放心使用。

---

## 4. 前端实现

### 4.1 新增节点组件

新建 `frontend/src/components/flow/nodes/HappyhorseR2VNode.tsx`：

**视觉模板：** 参照 `Wan2R2VNode.tsx` 的整体布局（Run/分享/下载头部、参数下拉、视频预览、历史记录、错误展示），改动：

- 左侧 handle：
  - `prompt`（text 输入，固定 1 个）
  - `image-1` ~ `image-N`（image 输入，N 由 `data.referenceCount` 控制，默认 1，最大 9）
  - 节点上方加一组 +/- 控件用于调整 referenceCount（最少 1，最多 9）
  - 删除某 image 时，对应连线由 FlowOverlay 统一回收
- 参数下拉：
  - **画幅 ratio** — 5 个选项 `16:9 / 9:16 / 1:1 / 4:3 / 3:4`，默认 `16:9`
  - **分辨率 resolution** — `720P / 1080P`，默认 `1080P`
  - **时长 duration** — 13 个选项 `3 / 4 / 5 / ... / 15`（横向 chip group），默认 `5`
- `useBackendCreditsPreview` 入参：
  ```ts
  serviceType: 'happyhorse-r2v-video',
  model: 'happyhorse-1.0-r2v',
  requestParams: {
    managedModelKey: 'happyhorse-1.0-r2v',
    modelKey: 'happyhorse-1.0-r2v',
    vendorKey: 'dashscope',
    platformKey: 'dashscope',
    aiProvider: 'dashscope',
    generationMode: 'r2v',
    resolution: data.resolution,
    duration: data.duration,
    durationSec: data.duration,
  }
  ```
  Run 按钮的角标会随 resolution / duration 实时更新

### 4.2 API client

`frontend/src/services/aiBackendAPI.ts` 新增：

```ts
export async function generateHappyhorseR2VViaAPI(request: {
  prompt: string;
  referenceImageUrls: string[];   // 1 ~ 9
  parameters?: {
    resolution?: '720P' | '1080P';
    ratio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
    duration?: number;            // 3 ~ 15
  };
}): Promise<AIServiceResponse<any>> {
  const dashscopeRequest = {
    model: 'happyhorse-1.0-r2v',
    input: {
      prompt: request.prompt,
      media: request.referenceImageUrls.map(url => ({ type: 'reference_image', url })),
    },
    parameters: request.parameters || {},
  };
  // 余下 fetch / logApiTiming / 错误处理：完全照搬 generateWan26R2VViaAPI
}
```

### 4.3 流程注册（FlowOverlay.tsx）

参照 `wan2R2V` 在 `FlowOverlay.tsx` 中的所有出现处，给 `happyhorseR2V` 加一份：

| 位置 | 改动 |
|---|---|
| nodeTypes 映射 | `happyhorseR2V: HappyhorseR2VNode` |
| 视频节点类型数组（共 ~15 处） | 在 `'wan2R2V'` 后追加 `'happyhorseR2V'` |
| nodeCreditsMap | `happyhorseR2V: 1000` |
| 节点目录 categoryItems | `{ key: "happyhorseR2V", zh: "彩马 R2V", en: "HappyHorse R2V", category: "video" }` |
| nodeCategories | `happyhorseR2V: "video"` |
| nodeSizeMap | `happyhorseR2V: { w: 300, h: 400 }`（比 wan2R2V 多一行 resolution） |
| 视频识别合集（多处 in/source 判定） | 追加 `happyhorseR2V` |
| 视频源类型校验 `["video", "sora2Video", ...]` | 追加 `happyhorseR2V` |
| 输入校验（接什么类型）| 与 `wan2R2V` 不同：`happyhorseR2V` 接 image 类型源（不接 video） |

**关键差异提示：** `Wan2R2VNode` 的左侧 handle 接 video 源；`HappyhorseR2VNode` 接 **image 源**（imageOutput / banana / nano2 / 等图片产出节点）。`FlowOverlay.tsx` 中 wan2R2V 在多个位置参与"视频源 → 视频节点"的连线规则，`happyhorseR2V` 不能直接抄；它需要按"图片源 → 视频节点"的规则注册。

具体改造点：
- 在 `image-N` handle 的连线校验里，按现有 image-input 节点（如 `i2vVideo`、`nano2`）的连线规则注册
- 在视频节点的 categoryItems / sizeMap / nodeCreditsMap 里照常注册
- `wan2R2V` 出现在"视频输出列表"的地方，`happyhorseR2V` 也加进去（它输出 video）

### 4.4 Admin 页面

`frontend/src/pages/Admin.tsx` 追加：
- 节点类型选项（line ~1961）：`{ value: "happyhorseR2V", label: "彩马 R2V 节点", category: "video" }`
- managedModel → flowNode 映射（line ~1992）：`if (modelKey === "happyhorse-1.0-r2v") return "happyhorseR2V";`
- 模型默认配置（line ~2982 附近）：追加默认行
- managedModelKey 映射表（line ~4072）：`"happyhorse-1.0-r2v": ["happyhorse-1.0-r2v"]`
- managedModelKey → serviceType 映射（line ~4100）：`"happyhorse-1.0-r2v": "happyhorse-r2v-video"`

### 4.5 Run 触发逻辑

在 `FlowOverlay.tsx` 中 wan2R2V 的 Run 处理代码段附近（搜索 `generateWan26R2VViaAPI`），加一段对 `happyhorseR2V` 的处理：

```ts
if (node.type === 'happyhorseR2V') {
  // 1. 收集所有连接的 image-N 输入源 → URLs
  // 2. 收集 prompt（text 输入）
  // 3. 调 generateHappyhorseR2VViaAPI
  // 4. 成功后写回 videoUrl / thumbnail / videoVersion
  // 5. 失败后写 error
}
```

---

## 5. 数据流

```
[image 节点 ×1~9]                       [text 节点]
       │                                       │
       ▼ image url                              ▼ prompt
       └────────────► HappyhorseR2VNode ◄──────┘
                            │
                            │ generateHappyhorseR2VViaAPI
                            ▼
                  Backend POST /ai/dashscope/generate-happyhorse-r2v
                            │
                            │ withCredits('happyhorse-r2v-video',
                            │              'happyhorse-1.0-r2v',
                            │              { resolution, duration })
                            │   ↓
                            │   credits.service: dynamicPricing.perSecondByResolution
                            │       → 720P × 5s = 600 credits
                            │       → 1080P × 10s = 2000 credits
                            │
                            ▼
                  DashScope POST video-synthesis
                            │ (X-DashScope-Async)
                            ▼
                  task_id → 轮询 GET /tasks/{taskId} (15s × 40 次)
                            │
                            ▼
                  succeeded: video_url 写回前端节点
                  failed:    扣费回滚 + 错误展示
```

---

## 6. 边界与异常

| 场景 | 处理 |
|---|---|
| 用户未连接任何 image 输入 | 前端 Run 校验：报"请至少连接 1 张参考图"，不调后端 |
| 用户连接 > 9 张 image | 节点 UI 限制最多 9 个 image-N handle，前端连线时拦截 |
| 用户输入空 prompt | 前端 Run 校验：报"请输入提示词"，不调后端 |
| 上游图片格式不支持 / 文件过大 | DashScope 返回 400，后端透传错误信息到前端 |
| 上游任务超时（>10 分钟） | 与现有 wan2.6-r2v 一致：返回 polling timeout 错误，credits 回滚 |
| 用户改 resolution / duration 但 Run 已发起 | 由现有 withCredits 机制保证：扣费按发起时刻的请求体计算 |
| 用户余额不足 | withCredits 阻断在前置校验，返回积分不足错误 |
| `referenceCount` 默认值 | 节点首次创建时 referenceCount=1（最简启动），用户用 +/- 调整 |

---

## 7. 不在范围内（YAGNI）

- 不暴露 `seed` / `watermark` 给用户（后端固定 watermark=false，seed 不传）
- 不做 prompt 字数实时校验（依赖上游截断）
- 不为 happyhorse 创建独立的 Admin "视频供应商" 配置项（暂复用 dashscope 平台 key）
- 不优化 `wan2.6-r2v` 现有代码（除抽取 `pollDashScopeVideoTask` 共享函数外，不做其他调整）
- 不接入官方"角色一致性最佳实践提示"等高级文案（节点上 1 行帮助提示即可）

---

## 8. 测试计划

### 8.1 后端单测（如有 jest 覆盖）
- `buildHappyhorseCreditRequestParams`：极端 duration 取值（0、负数、>15）的兜底
- `normalizeHappyhorseR2VBodyForUpstream`：媒体数组为空 / 无 type / 多余字段时的归一化
- `credits.service.resolveCreditAmount`：720P × 5s = 600、1080P × 10s = 2000、缺 resolution 时回落 1000

### 8.2 联调
- 真实 DASHSCOPE_API_KEY 下，通过新 endpoint 提交 720P/5s 任务，等待出片
- 1080P/10s 大任务，验证轮询能正确等到出片或超时
- 故意提交不存在的图片 URL，验证错误能透传

### 8.3 端到端（前端）
- 新建 happyhorseR2V 节点，连 1 张 image + prompt，Run，验证扣费 600
- 切换 1080P，验证扣费角标变 1000
- 加到 9 张 image，验证不能再加；移除时连线被回收
- 与 imageNode、bananaNode 等图片源节点正常连线

---

## 9. 上线步骤

1. 后端：credits.config.ts → credits.service.ts → ai.controller.ts → node-config.service.ts
2. 前端：HappyhorseR2VNode.tsx → aiBackendAPI.ts → FlowOverlay.tsx → Admin.tsx
3. 数据：触发 `node-config` 重新 seed（或手工执行 admin 接口写入新节点）
4. 联调：先在 staging 用小额账号跑一遍 720P/5s + 1080P/10s
5. 上线：merge 到 main，前后端同步发布

---

## 10. 待确认（在审阅本 spec 时）

- 节点中文名 "**彩马参考视频**" 是否合适？或更倾向 "彩马 R2V" / "HappyHorse R2V" / "参考视频(彩马)"？
- 节点首次落地默认 `referenceCount = 1` 还是 `3`？
  - 1：最简启动，用户按需 +
  - 3：第一眼看更直观、与 wan2R2V 对齐，但浪费视觉空间
- 加价比例 +33% / +25% 与"约 20%"有差异，是否调整卖价（例如 720P = ¥1.1/s，1080P = ¥1.95/s）以更接近 +20%？
