# Bio-Auth Group 持久化与历史复用设计

**日期：** 2026-04-25  
**状态：** 已确认，待实现

---

## 背景

生物认证（真人 H5 活体检测）成功后，火山引擎会创建一个 `LivenessFace` 类型的 Asset Group（`groupId`）。当前实现将 groupId 仅存于内存 Map，服务重启即丢失，且后续上传同一用户素材时必须重新做活体检测。

目标：持久化 groupId，让用户可在历史已认证的 Group 中选择并直接上传素材，跳过 H5 活体流程。同时修复 `assetId` 未回传前端的断层问题。

---

## 数据层

### 新增 Prisma 模型

```prisma
model BioAuthGroup {
  id        String   @id @default(uuid())
  userId    String
  groupId   String   @unique   // Volcengine LivenessFace GroupId
  imageUrl  String             // bio-auth 基准图 URL（用于历史缩略图）
  createdAt DateTime @default(now())

  @@index([userId, createdAt])
}
```

- `groupId` 唯一索引：同一 Group 不会重复入库。
- `imageUrl`：触发认证时节点的图片 URL，供历史列表展示缩略图。

### 状态接口响应扩展

```ts
// bio-auth.dto.ts
export interface BioAuthStatusResponse {
  status: BioAuthStatus;
  errorMessage?: string;
  assetId?: string;   // status === 'active' 时填充
  groupId?: string;   // status === 'active' 时填充
}
```

---

## 后端 API

### 现有接口改动

**`handleCallback`**：在 `CreateAsset` 成功、拿到 groupId 后，持久化到 DB：

```ts
await this.prisma.bioAuthGroup.upsert({
  where: { groupId },
  create: { userId: task.userId, groupId, imageUrl: task.imageUrl },
  update: {},  // 已存在不覆盖
});
```

**`getStatus`**：返回值新增 `assetId` 和 `groupId`（从内存 task record 读取）。

### 新增接口

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| `GET` | `/api/bio-auth/groups` | ApiKeyOrJwt | 返回当前用户近 30 天的认证 Group 列表 |
| `POST` | `/api/bio-auth/asset` | ApiKeyOrJwt | 在已有 Group 中直接创建素材，跳过 H5 |

**`GET /api/bio-auth/groups` 响应：**

```ts
{
  groups: Array<{
    groupId: string;
    imageUrl: string;
    createdAt: string; // ISO 8601
  }>
}
```

查询条件：`userId === 当前用户 AND createdAt >= now - 30天`，按 `createdAt DESC` 排序。

**`POST /api/bio-auth/asset` 请求体：**

```ts
{ groupId: string; imageUrl: string }
```

后端校验 `groupId` 属于当前 `userId`（防越权），通过后：
1. 调用 `CreateAsset(groupId, imageUrl, 'Image')`
2. 将 assetId 作为 taskId 存入内存 task record（status: 'processing'）
3. 启动 `pollAsset`
4. 返回 `{ taskId: assetId }`

前端复用现有 `/api/bio-auth/:taskId/status` 轮询，无需新增轮询接口。

---

## 前端 Modal 流程

### WizardStep 扩展

```ts
type WizardStep = "history" | "consent" | "verifying" | "waiting" | "result";
```

- `history`：展示历史认证列表（新增）
- `waiting`：复用 group 后等待素材审核（新增，无二维码）
- `consent` / `verifying` / `result`：现有步骤，不变

### 流程图

```
打开 Modal
  └─ 拉取 GET /bio-auth/groups
       ├─ 有历史记录 → [history 步]
       │     ├─ 选择某条 → POST /bio-auth/asset → [waiting 步] → 轮询 → [result 步]
       │     └─ 点"重新认证" → [consent 步] → 原有 H5 流程
       └─ 无历史记录（或拉取失败） → 直接 [consent 步]
```

拉取失败静默降级到 `consent` 步，不阻塞主流程。

### `history` 步 UI

- 标题：「选择已认证身份」
- 列表每行：左侧 40×40 px 圆形缩略图 + 右侧认证时间（`YYYY-MM-DD HH:mm`）+ 右箭头
- 底部：「重新认证 →」文字按钮
- 加载中：spinner；空列表不出现（直接跳 consent）

### `waiting` 步 UI

- spinner + 「素材审核中，请稍候…」
- 无二维码，无复制链接按钮
- 轮询逻辑与现有 `verifying` 步完全一致

### `onSuccess` 回调扩展

```ts
onSuccess: (taskId: string, assetId: string, groupId: string) => void
```

**H5 流程**：`BioAuthModal` 内 `useBioAuthPolling` 的 `onUpdate` 在收到 `status === 'active'` 时，同时拿到响应中的 `assetId` 和 `groupId`，传给 `onSuccess`。

**复用 Group 流程**：`POST /asset` 返回 `taskId`，同样走 `useBioAuthPolling`，轮询到 `active` 时同理拿到 `assetId` / `groupId`。

`ImageNode` 收到后同时写入节点，关闭 assetId 断层：

```ts
patchNode({
  bioAuthStatus: "active",
  bioAuthId: taskId,
  bioAuthDate: new Date().toISOString(),
  volcAssetId: assetId,
  volcAssetStatus: "active",
  volcReviewDate: new Date().toISOString(),
});
```

---

## 新增 API 函数（`bioAuthAPI.ts`）

```ts
export async function listBioAuthGroups(): Promise<{
  groups: Array<{ groupId: string; imageUrl: string; createdAt: string }>;
}>

export async function createAssetInGroup(
  groupId: string,
  imageUrl: string
): Promise<{ taskId: string }>
```

---

## 错误处理

| 场景 | 处理方式 |
|------|------|
| `GET /groups` 失败 | 静默降级到 `consent` 步 |
| `POST /asset` 越权（groupId 不属于该用户） | 后端返回 403，前端显示错误并停留在 `history` 步 |
| `POST /asset` 面部不一致（火山审核 Failed） | 轮询到 `failed`，`result` 步展示失败原因，提供重试 |
| `POST /asset` 超时（2 分钟） | 同上，显示「素材审核超时」 |

---

## 不在本次范围内

- 删除 / 管理历史 Group（用户无法主动删除）
- 超过 30 天的 Group 清理（由查询条件自动过滤，不做 DB 删除）
- 将内存 task Map 持久化到 DB（服务重启后进行中的任务丢失，可接受）
