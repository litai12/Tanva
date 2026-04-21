# 火山方舟 Seedance 2.0 私域素材库接入设计

- 日期：2026-04-21
- 目标范围：`ImageNode` + Seedance 2.0 / Seedance 2.0 Fast 视频生成
- 不涉及：VideoNode / AudioNode、其他视频模型、DB 表新增

## 1. 背景与目标

火山方舟 Seedance 2.0 系列模型提供「私域虚拟人像素材资产库」能力：用户把虚拟人像（图片）通过 `CreateAsset` 上传入库，拿到 `asset://<id>` URI 后，在视频生成请求中替代 HTTPS URL 使用，可获得更稳定的一致性并降低合规风险。

本项目在现有流程中接入该能力：

- 给 `ImageNode` 加「审核」图标，用户手动触发上传。
- 上传成功且状态为 `Active` 的图片，当流入 `seedance-2.0` / `seedance-2.0-fast` 节点生成时，后端将 `image_url` 的 `url` 字段替换为 `asset://<asset_id>`。
- 其他模型（Kling / Vidu / Wan / Sora2 等）保持原逻辑，不感知 asset。

## 2. 关键决策

| 决策点 | 选择 | 理由 |
| --- | --- | --- |
| AK/SK 鉴权来源 | 单组服务端 AK/SK（env 配置） | 与现有 `ARK_API_KEY` 同账号，最简 |
| Asset Group 策略 | 每用户一个 Group，首次上传自动创建 | 隔离清晰，符合多租户语义 |
| Asset 持久化 | 仅节点 `data` 字段，随 project 序列化落盘 | 不新增 DB 表，重开项目状态保持 |
| 跨节点去重 | 不做，同一图多节点需分别审核 | 实现简单；用户已接受该代价 |
| sd2 fallback | 宽松模式：active 用 `asset://`，其它状态 fallback HTTPS URL | 符合用户"优先使用"的表述 |
| 范围 | 仅图片节点，不做视频/音频 | YAGNI，首版收敛 |

## 3. 环境变量（新增 5 条，前 2 条已写入 `.env`）

```env
VOLC_ARK_ACCESS_KEY=<填入>
VOLC_ARK_SECRET_KEY=<填入>
VOLC_ARK_REGION=cn-beijing
VOLC_ARK_PROJECT_NAME=default      # 必须与 ARK_API_KEY 所属 Project 一致
VOLC_ARK_API_HOST=open.volcengineapi.com
```

⚠️ `VOLC_ARK_PROJECT_NAME` 与现有 `ARK_API_KEY` 同 Project，否则 sd2 生成阶段会报错。默认假设 `default`。

## 4. 后端设计

### 4.1 新模块 `backend/src/volc-asset/`

```
volc-asset/
├── volc-asset.module.ts
├── volc-asset.service.ts      # 核心服务
├── volc-asset.controller.ts   # HTTP 端点
├── volc-asset.dto.ts          # DTO
└── volc-sign.util.ts          # Volcengine VolcSign V4 签名（AK/SK）
```

`VolcSign V4` 是火山引擎的标准签名算法，与现有 `ARK_API_KEY` Bearer 鉴权方式不同，需独立实现（和 `tencent-vod-aigc.service.ts` 里的 TC3 签名类似，但算法是火山的 HMAC-SHA256 + 规范请求）。

### 4.2 Service 接口

```ts
class VolcAssetService {
  // 内存 Map 缓存 userId → groupId，命中直接返回；未命中调 CreateAssetGroup
  private groupCache = new Map<string, string>();

  ensureUserGroup(userId: string): Promise<string>;

  // 调 CreateAsset，返回 assetId + 初始状态（通常是 Processing）
  uploadAsset(userId: string, sourceUrl: string, assetType: 'Image'): Promise<{
    assetId: string;
    status: 'Processing' | 'Active' | 'Failed';
  }>;

  // 调 GetAsset 查询最新状态
  getAssetStatus(assetId: string): Promise<{
    status: 'Processing' | 'Active' | 'Failed';
    errorMessage?: string;
  }>;
}
```

### 4.3 HTTP 端点（挂在现有 JWT 认证守卫下）

| 方法 | 路径 | 请求体/参数 | 返回 |
| --- | --- | --- | --- |
| POST | `/api/volc-asset/upload` | `{ sourceUrl: string, assetType: "image" }` | `{ assetId, status }` |
| GET | `/api/volc-asset/:assetId/status` | — | `{ status, errorMessage? }` |

限流：`CreateAsset` Volcengine 侧 300 QPM，`GetAsset` 100 QPS；本期直接透传，暂不加我方节流。

### 4.4 sd2 请求拼接改造

`backend/src/ai/services/video-provider.service.ts` 构建 sd2 `content[]` 的段（当前 ~line 1105）：

**当前**
```ts
for (const imageUrl of referenceImages) {
  content.push({
    type: "image_url",
    image_url: { url: imageUrl },
    role: "reference_image",
  });
}
```

**改造后**
- `referenceImages` 的数据形态从 `string[]` 扩展为 `Array<{ url: string; volcAssetId?: string; volcAssetStatus?: 'processing' | 'active' | 'failed' }>`。
- 判定是否可替换：`(modelKey === 'seedance-2.0' || modelKey === 'seedance-2.0-fast') && volcAssetStatus === 'active' && volcAssetId`。
- 替换规则：命中则 `url = "asset://" + volcAssetId`，否则保持原 HTTPS URL。
- 其他模型（Kling、Vidu、Wan、Sora2 等）即便带了字段也忽略。

### 4.5 错误处理

- `CreateAsset` / `GetAsset` 非 2xx 或网络错 → HTTP 502，前端据此把节点置 `failed`，错误信息透传。
- sd2 生成阶段 Volcengine 侧报 "asset not found" / "project mismatch" → **不自动 fallback 到 HTTPS URL**，将错误原样抛回前端（fallback 会掩盖 asset 配置错误，误导用户）。
- 用户级 Group 缓存：`Group not found` 错误（例：手动删除）→ 清 memo，下次调用重建。

## 5. 前端设计

### 5.1 ImageNode 节点 data 扩展

新增 3 个字段：

```ts
type ImageNodeData = {
  // ...existing...
  volcAssetId?: string;
  volcAssetStatus?: 'processing' | 'active' | 'failed';
  volcAssetError?: string;
};
```

### 5.2 审核图标 UI

位置：`ImageNode.tsx` 右上角 Send icon 旁（同一组操作区）。

| 状态 | 图标 | 颜色 | 可点击 | Tooltip |
| --- | --- | --- | --- | --- |
| 无（默认） | `Shield` | 灰色 | ✅ 触发上传 | "点击上传到方舟素材库" |
| processing | `Loader2` 旋转 | 琥珀色 | ❌ | "审核中…" |
| active | `ShieldCheck` | 绿色 | ❌ | "已通过审核，sd2 将使用 asset://" |
| failed | `ShieldAlert` | 红色 | ✅ 重试 | `volcAssetError` |

### 5.3 触发上传逻辑

```
用户点击未审核/失败状态
  ↓
立即把节点 volcAssetStatus 置为 'processing'（乐观 UI）
  ↓
POST /api/volc-asset/upload { sourceUrl, assetType: 'image' }
  ↓
写回 volcAssetId + 初始 status
  ↓
若 status='processing' → 启动轮询
若 status='active'     → 停在已通过态
若 status='failed'     → 停在失败态 + 错误信息
```

### 5.4 轮询 Hook `useVolcAssetPolling`

职责：
- 订阅节点 data 变化，当 `volcAssetStatus === 'processing'` 时开启轮询。
- 频率：每 5 秒 `GET /api/volc-asset/:id/status`。
- 上限：2 分钟（24 次）未拿到 terminal 状态 → 强制置 `failed`，`error="审核超时，请重试"`（真实状态会在下次手动点击时被刷新）。
- 节点卸载、状态变为 terminal、组件卸载时清理 timer。
- 页面刷新后：若节点 data 存在 `status=processing`，`useEffect` 自动恢复轮询。

### 5.5 source URL 变化清状态

`ImageNode` 已有监听源图替换的能力。补丁：当 source URL 变化（上传新图、替换、历史回滚等）→ 清掉 `volcAssetId/Status/Error`，因 asset 和旧图强绑定。

### 5.6 AI 请求字段扩展

在 `GenericVideoNode.tsx`（或其收集参考图的调用点）构建 `referenceImages` 载荷处：

- 当前传 `string[]`（URL 数组）。
- 改为 `Array<{ url: string; volcAssetId?: string; volcAssetStatus?: string }>`。
- 仅当目标节点是 sd2/sd2-fast 时附加 `volcAssetId/Status`；其他模型只带 `url`。

### 5.7 多图场景

sd2 节点连多张参考图：逐图判断。Active 的走 `asset://`，未审核/processing/failed 的走 HTTPS URL（宽松 fallback）。

## 6. 数据流示例（happy path）

```
ImageNode (source=https://oss/x.jpg, volcAssetId=null)
   │
   ├─ 用户点击审核图标
   │   → POST /api/volc-asset/upload { sourceUrl: "https://oss/x.jpg", assetType: "image" }
   │   ← { assetId: "asset-2026...-abc", status: "processing" }
   │   节点 data 更新：volcAssetId=asset-2026...-abc, status=processing
   │
   ├─ 轮询 5s 后
   │   → GET /api/volc-asset/asset-2026...-abc/status
   │   ← { status: "active" }
   │   节点 data 更新：status=active
   │
   └─ 用户连 Seedance 2.0 节点并触发生成
       → 前端 payload.referenceImages = [{
           url: "https://oss/x.jpg",
           volcAssetId: "asset-2026...-abc",
           volcAssetStatus: "active"
         }]
       → 后端 video-provider.service.ts
         判定 isSd2 + active → 替换
         content.push({
           type: "image_url",
           image_url: { url: "asset://asset-2026...-abc" },
           role: "reference_image"
         })
       → Volcengine 用素材库资产生成视频
```

## 7. 不做（YAGNI）

- 不新建 DB 表（Asset 状态仅存节点 data）。
- 不做跨节点/跨用户 asset 去重缓存。
- 不做视频/音频节点的 asset 上传。
- 不做 IAM 多用户精细化权限，单服务端 AK/SK。
- 不做 Asset 手动删除/管理 UI（方舟控制台可管理）。
- 不做批量上传队列；节点逐个触发。
- 不做强校验/阻塞模式，sd2 未审核图仍可生成（走 HTTPS URL）。

## 8. 测试策略

**单元测试**
- `volc-sign.util.ts`：固定输入对照 Volcengine 官方文档示例签名串。
- `VolcAssetService.ensureUserGroup`：命中 / 未命中 / Group 失效重建。
- `video-provider.service.ts` 的 sd2 拼接逻辑：5 张图混合状态 → 正确逐图替换；非 sd2 模型 → 不替换。

**集成/手动测试**
1. 单图审核成功 → sd2 生成，后端日志确认 `image_url.url` 是 `asset://...`。
2. 单图审核成功 → sd2-fast 生成，同上确认。
3. 未审核 → sd2 生成，走 HTTPS URL。
4. 审核 failed → sd2 生成，走 HTTPS URL。
5. 多图混合状态 → 逐图正确替换。
6. 非 sd2 节点（Kling）+ 已审核图 → 仍用 HTTPS URL。
7. 审核中刷新页面 → 轮询自动恢复。
8. 替换图片 → volcAssetId 清空。

## 9. 交付顺序

1. 后端 `volc-asset` 模块（sign util + service + controller + module + DTO）。
2. 后端 `video-provider.service.ts` 的 `referenceImages` 结构升级 + sd2 分支替换逻辑。
3. 前端 AI 请求层扩展 payload（`GenericVideoNode` 或 service 层）。
4. 前端 `ImageNode.tsx` 加 icon + 4 状态 + 触发逻辑。
5. 前端 `useVolcAssetPolling` hook。
6. 手动跑通 9 条集成用例。

## 10. 风险与回滚

- **风险 1：ProjectName 不匹配**。若 `ARK_API_KEY` 不在 `default` 项目，`VOLC_ARK_PROJECT_NAME` 需同步修正，否则生成 400。→ 部署前确认。
- **风险 2：Volcengine 限流**。CreateAsset 300 QPM，若多人同时审核可能限流 → 错误透传，用户重试即可，不做复杂退避。
- **风险 3：asset 被 Volcengine 删除后 nodeData 残留**。→ 生成阶段错误不自动 fallback，用户手动重新审核。
- **回滚**：前端下掉审核 icon + 后端 `video-provider` 分支移除，即可完全回到现状，节点 data 里的字段是向前兼容的多余字段。

## 11. 未决事项

- `VOLC_ARK_PROJECT_NAME` 是否 `default`：待部署前与运维核对。
- 审核超时时长：本设计取 2 分钟；若 Volcengine 实际处理经常超时，需要上调。
