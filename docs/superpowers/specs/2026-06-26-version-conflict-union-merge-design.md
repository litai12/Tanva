# 版本冲突 → 取并集合并（current-user-wins）

**日期:** 2026-06-26
**状态:** 设计待评审

## 背景与问题

项目内容保存采用乐观并发：客户端携带加载时的 `baseVersion`。当 `version < currentContentVersion`（期间他人/他端已保存过）时，`projects.service.ts` 抛出 `ConflictException({ error: 'version_conflict' })`，前端 `saveContent` 把 409 转成 `version_conflict` 错误。

现状有两个问题：

1. **硬失败暴露给用户**：UI 顶部出现 `保存失败: version_conflict`（见用户反馈截图），保存被禁止。
2. **autosave 的"对齐重试"实际会覆盖对方改动**：`useProjectAutosave.ts` 捕获冲突后只是把本地 `version` 对齐到服务端最新版本，然后用**本地内容**重存。这在实时协作下"看似正常"（实时 patch 已让两端内容收敛），但对真正分叉的两份快照（如同一用户多 Tab/多端离线编辑）会**静默丢失另一方的改动**。

**目标**：版本冲突时不再禁止保存，而是**比对两份快照取并集**，并在**同一 id 冲突时以当前用户（incoming）的数据为准**，保证任何一端的新增都不丢。

## 设计决策（已与用户确认）

- 合并语义：**按 id 取并集**；同 id 冲突 → **incoming（当前正在保存这一方）胜出**。
- `paperJson`：**按 `data.id` 做画布条目级并集**（真并集），而非整块取一方。
- 合并形式：**后端算并集（唯一权威）+ 前端 adopt 重画**。合并算法只在后端实现一处，避免两套实现走斜；前端只负责把后端合并后的快照重新 import 到画布。

## 快照结构（`ProjectContentSnapshot`）

| 字段 | 形态 | 并集方式 |
|---|---|---|
| `flow.nodes` / `flow.edges` | `TemplateNode[]` / `TemplateEdge[]`，带 `id` | 按 `id` 并集，同 id → incoming |
| `assets.images/models/texts/videos` | 各自数组，元素带 `id` | 按 `id` 并集，同 id → incoming |
| `layers` | `LayerMeta[]`，带 `id` | 按 `id` 并集，同 id → incoming，保留 incoming 顺序，remote-only 追加 |
| `aiChatSessions` | 数组，带会话 `id` | 按 `id` 并集，同 id → incoming |
| `canvas`（zoom/pan）、`activeLayerId`、`meta`、`updatedAt` | 标量 | 取 incoming（当前用户视口/时间戳） |
| `paperJson` | Paper.js `exportJSON` 序列化字符串；条目 `data.id` 部分存在 | 见下 |

**关键观察**：图片/模型/文本/视频/flow 节点/图层全部带稳定 `id`，可无损并集。图片甚至被双轨记录（既在 `assets.images[]`，也作为 paper `Raster` 带 `data.id`）。唯一模糊点是 `paperJson` 中的**手绘矢量路径可能没有稳定 `data.id`**。

## 架构

### 后端（权威合并）— `projects.service.ts::updateContent`

把现有的冲突分支：

```ts
if (typeof version === 'number' && version > 0 && version < currentContentVersion) {
  throw new ConflictException({ error: 'version_conflict', ... });
}
```

改为**读取当前远端快照并合并**：

1. 读取远端当前内容：`const remote = await this.oss.getJSON(mainKey)`（仅冲突这一稀有路径才多一次 OSS 读；`getJSON` 失败返回 null 时回退为"无远端可并"，直接用 incoming）。
2. `const merged = mergeProjectSnapshots(remote, incomingSanitizedContent)`。
3. 用 `merged` 走原有落盘流程（OSS putJSON + DB update，`contentVersion = currentContentVersion + 1`）。
4. 返回值在原 `{ version, updatedAt, mainUrl, thumbnailUrl }` 基础上**附加 `merged: true` 与合并后的 `content: merged`**，供前端 adopt。非冲突路径不带这两个字段。

> 这样**任何**客户端（移动端、其他 Tab、未实现合并的简单保存方）都受保护，服务端永不 409、永不丢结构化数据。

### 合并函数 — `mergeProjectSnapshots(remote, incoming)`（后端新模块）

纯函数，输入两份 `ProjectContentSnapshot`，输出合并结果。逐字段规则见上表。实现要点：

- 通用 `unionById(remoteArr, incomingArr)`：以 incoming 为基底建 `Map<id, item>`，遍历 remote，`id` 不在 map 中才追加。→ 同 id incoming 胜，remote-only 追加，incoming-only 保留。
- `paperJson` 并集 `mergePaperJson(remoteJson, incomingJson)`：
  - `JSON.parse` 两侧（Paper 的 `exportJSON` 是 `[[type, props], ...]` 嵌套数组，`props.children` 递归，叶子 `props.data?.id`）。
  - 收集 incoming 全部条目的 `data.id` 集合；遍历 remote，把 `data.id` 存在且**不在** incoming 集合中的条目，追加到结果对应图层。
  - incoming 的全部条目（含无 `data.id` 的手绘矢量）原样保留。
  - **Fallback**：任意解析/遍历异常 → 整块返回 incoming 的 `paperJson`（current-user-wins），绝不抛错。

### 前端（adopt 运行时，按场景分流）

- `projectApi.ts::saveContent`：返回类型扩展为可选 `merged?: boolean` 与 `content?: ProjectContentSnapshot`，从响应透传。
- `useProjectAutosave.ts`：
  - **移除**原"冲突 → 仅对齐 version → 盲重试"分支（它会覆盖对方改动）。保留对老服务端 409 的兜底，但**不再**盲对齐版本后重存。
  - 保存返回 `merged === true` 时：`markSaved(result.version)` 对齐版本，把 **本地缓存/快照基线**改为合并后的 `result.content`（否则缓存/下次保存基线仍是旧的 incoming），并派发 `window` 事件 `tanva:adopt-merged-content`（带 `content`/`version`）。
- `ProjectAutosaveManager.tsx`：监听 `tanva:adopt-merged-content`，按场景分流（见下）。

#### 为什么 adopt 必须落到「运行时」

合并结果落在服务端，但前端画布(paper)与 flow 节点(FlowOverlay 的 React Flow 状态)是**独立于内容快照的运行时**。若不把并集补进运行时，当前用户**下一次保存**会用运行时(缺远端新增)重新序列化、且版本已对齐 → 不再冲突 → 把刚并进来的远端项**永久覆盖丢掉**（服务端也丢）。所以 adopt 落运行时是正确性要求，不只是 UX。

#### adopt 分流（`ProjectAutosaveManager` 的事件处理）

- **活跃实时协作（`collabCanvasBridge.connected === true`）→ 跳过重载**：运行时已由 `node_patch`/`canvas_patch` 实时收敛，下次保存自然含远端项；重载只会打断会话（光标/选区/在编/锁）。版本已对齐即可。
- **非协作 + 不脏（store 非 dirty/saving）→ `reconcileMergedRuntime`**：以合并快照 `hydrate` 内容 store（FlowOverlay 既有的 flow-hydrate effect 监听 `content.flow` 变化，会据此把节点并集补进 React Flow，对已存在 id 保留本地、仅补新增）+ 清空并重新 `importJSON` 合并后的 `paperJson` + 重灌 layers/AI 会话。视口取 incoming，不跳动。
- **非协作 + 脏（保存往返期间用户又改了）→ 不重载、版本回退**：重载会冲掉在编内容；改为把基线版本退回到合并版本之前，迫使下次自动保存再次命中冲突、由服务端重新并集（远端新增永不丢），待空闲(不脏)时再展示。

## 实时协作（长连接 / WebSocket）兼容

合并方案与 M1 团队版的实时 patch 通道**职责互补、不打架**：

- **职责划分**：实时 `node_patch`（flow 节点/边）与 `canvas_patch`（带 `imageId` 的图片对象）在 WS 长连接上**逐条增量收敛**；手绘笔迹无逐笔 id、不走实时通道。全量保存的并集合并，正是为实时通道**覆盖不到的部分**（手绘笔迹、断线/分叉期的改动）兜底。
- **用「是否连着长连接」分流，避免打断会话**：adopt 只在 `collabCanvasBridge.connected === false`（非活跃协作：个人项目/离线/单端多 Tab）时才重载运行时——此时没有实时 patch，运行时确实分叉，需要重载才能展示并集且不丢。活跃协作时运行时已被实时 patch 收敛，**直接跳过重载**，光标/选区/在编/锁都不受扰。
- **活跃协作下不丢的依据**：协作端的 flow/图片改动已先经实时 patch 进入对方运行时，故全量保存命中冲突时，下次保存序列化的运行时本就含远端项 → 不会覆盖丢失，无需重载。手绘笔迹两端本就不实时同步（既有限制），合并按 current-user-wins，与现状一致。
- **不依赖 `contentVersion` 做实时**：实时 patch 的 `seq`/`connId` 机制与 `contentVersion` 解耦；合并只 bump `contentVersion`，不影响实时通道。

## 已知限制

无 `data.id` 的手绘矢量路径，**在两端真正离线分叉、同时手绘**的罕见场景下无法安全去重，故以当前用户的笔迹为准，对方该次的无 id 笔迹让位。图片/模型/文本/视频/flow 节点均带稳定 id，无损并集——仅原始笔迹、且仅在真分叉时受影响。

未来加固（**本次范围外**）：导出时给每个 paper item 赋稳定 `data.id`，使矢量笔迹也可无损并集。

## 测试

后端对 `mergeProjectSnapshots` 的单测：

1. flow 节点不相交 → 两侧都在。
2. 同 `id` flow 节点 → incoming 胜出。
3. remote-only 图片 → 保留。
4. incoming-only 资产 → 保留。
5. `paperJson` 条目级并集：remote 新 `data.id` 条目被追加，同 `data.id` 取 incoming。
6. 畸形 / 不可解析 `paperJson` → 回退为 incoming 整块，不抛错。
7. 空 / 缺失集合（`flow`、`assets`、`layers` 为 undefined）→ 不崩。
8. `remote` 为 null（OSS 读失败）→ 直接返回 incoming。

前端/协作行为（手动验证或轻量测试）：

9. `merged: true` 回包 → adopt 只补 remote-only 条目，不重置视口、不替换在编同 id 节点。
10. 协作两端在线时人为制造冲突保存 → 不出现 `保存失败`，双方最终看到并集；adopt 期间不回发 `node_patch`/`canvas_patch`（`applyingRemote` 抑制生效）。

## 影响文件（实际落地）

- 新增 `backend/src/projects/merge-project-snapshots.ts`（纯函数 `mergeProjectSnapshots` / `mergePaperJson`）
- 新增 `backend/scripts/verify-merge-snapshots.ts`（后端无 jest，用 ts-node 跑 12 条断言：`npx ts-node scripts/verify-merge-snapshots.ts`）
- 改 `backend/src/projects/projects.service.ts`（冲突分支 → 读远端快照并集合并；`sanitizedContent`/hash 改 `let` 并合并后重算；返回值在冲突时附加 `merged:true`/`content`；移除未用的 `ConflictException` 导入）
- 改 `frontend/src/services/projectApi.ts`（`saveContent` 返回类型透传 `merged`/`content`）
- 改 `frontend/src/hooks/useProjectAutosave.ts`（移除盲重试覆盖；`merged` 时以合并快照为缓存/快照基线并派发 `tanva:adopt-merged-content`）
- 改 `frontend/src/components/autosave/ProjectAutosaveManager.tsx`（监听 adopt 事件 → `reconcileMergedRuntime`，按"连着长连接 / 是否脏"分流）
