# 旧画布过期拦截保存 + 强制刷新（Stale-Canvas Guard）设计

日期：2026-07-15
分支：feature/director-console-full-port（后续可拆独立分支）

## 背景与线上问题

线上出现**旧画布项目覆盖了新内容**：一个落后版本的画布触发保存，把别的标签页刚保存的新内容覆盖掉。

**主要场景**：同一用户在**同一浏览器开同一项目的多个相同 tab**。tab A 保存把版本从 N 推到 N+1，tab B 仍持有版本 N；tab B 的自动/手动保存以落后的 baseVersion 写回，覆盖 A 的新内容。多 tab 均为**非协作**（`collabCanvasBridge.connected` 恒为 false，实时协作是团队功能），因此正好落在本方案的“非协作落后 → 拒绝写入”护栏内。跨设备/断线回来的落后会话为次要场景，由同一后端护栏覆盖。

根因不在“没有版本号”，版本号一直存在（`Project.contentVersion`，前端 `projectContentStore.version` 作为 baseVersion 回传）。根因是**后端的版本落后分支不是拒绝，而是合并**：

- `backend/src/projects/projects.service.ts:382-407`：当 `version < currentContentVersion` 时，执行 `mergeProjectSnapshots(remote, incoming)`。
- `backend/src/projects/merge-project-snapshots.ts:135-179`：union-by-id，**同 id 冲突取 incoming（当前用户胜）**；且所有标量字段（画布视口、`activeLayerId`、`layers` 顺序、`meta`、`updatedAt` 等）在 `{ ...incoming }` 处**恒取 incoming**。

结果：远端“只新增的项”会保留，但远端做的**修改与删除会被落后客户端整体覆盖**。这个合并对**实时协作**（多个在线编辑者）是正确且必要的；对一个只是落后的**非协作旧标签页**是错误的。

## 目标

1. 当前画布内容落后于最新版本时，**旧画布不得把内容写回**（从根上避免覆盖，而不是覆盖后再补救）。
2. 检测到过期后，前端**冻结自动保存与手动保存**，弹出**全屏蒙层强制刷新**弹窗（参考截图样式），用户唯一出口是刷新页面。
3. **多 tab 即时冻结**：同浏览器另一个 tab 保存推进版本后，落后的 tab 立刻弹窗冻结，不必等它自己保存被拒（避免用户继续在废弃 tab 上做活、刷新后丢失）。
4. **不破坏实时协作**：活跃协作会话（`collabCanvasBridge.connected`）下的落后保存仍走原有合并逻辑。

## 核心规则

> 一个 baseVersion 落后于服务器的保存请求：**仅当客户端处于活跃实时协作会话时才合并**（`collabCanvasBridge.connected === true`）；否则服务器**不写入并返回过期标记**，客户端**冻结并强制刷新**。

用 `connected` 这一个判据，干净地把“合法并发编辑”与“落后的幽灵标签页”区分开。

## 两层实现

### Layer 1 — 后端护栏（真正的止血，无竞态）

保存请求新增字段 `allowMerge: boolean`（前端取 `collabCanvasBridge.connected`）。

在 `updateContent` 现有的 `version < currentContentVersion` 分支（`projects.service.ts:382`）内按标记分流：

- `allowMerge === true` → 走现有 `mergeProjectSnapshots` 合并（协作路径**完全不变**）。
- 否则（含**字段缺失**）→ **不写入**，直接返回过期结果 `{ stale: true, latestVersion: currentContentVersion }`，不推进 `contentVersion`、不写 OSS、不写 DB。

因为整段在 `runProjectSaveSerialized(id, ...)` 串行锁内执行，落后写入永远落不了地——**无 TOCTOU 竞态，第一次覆盖都不会发生**。

**回落/兼容策略（已确认）**：字段缺失一律按 `allowMerge:false` 拒绝。旧缓存 JS 的非协作旧标签页会被强制刷新加载新 JS 而自愈；代价是上线瞬间正在活跃协作、但仍跑旧 JS 的协作端会被弹一次刷新（刷新即加载新版本并重连，可接受）。

DTO 变更：`UpdateProjectContentDto` 增加可选 `allowMerge?: boolean`。控制器 `projects.controller.ts:62-80` 透传到 `updateContent`。

### Layer 2 — 前端冻结 + 强制刷新弹窗

**Store（`frontend/src/stores/projectContentStore.ts`）**
- 新增字段 `staleContent: boolean`（初值 `false`）与 `setStaleContent(v)`。
- 语义：**永久性**保存 kill-switch，仅靠整页刷新清除（刷新即重建 store）。区别于 `cacheValidationPending`（有自己的清除时机）。

**保存网关（复用现有 gating 位点）**
现有所有保存路径已统一判断 `dirty && !saving && !cacheValidationPending && content`（`useProjectAutosave.ts:86,258,282,304`、`ManualSaveButton.tsx:28-34`）。在同位点补一个 `!staleContent`，一处生效全路径冻结（interval / debounce / manual 全停）。

**过期检测触发点**
1. **保存响应（主）**：`projectApi.saveContent` 识别后端 `stale: true`，向调用方返回过期标记。`useProjectAutosave.performSave` 与 `ManualSaveButton` 收到后：`setStaleContent(true)`、**跳过 `markSaved`**、不弹常规错误 toast、挂载弹窗。
   - 请求侧：两处保存都带 `allowMerge: collabCanvasBridge.connected`。
   - 协作端（`connected === true`）本就不会命中拒绝（后端会合并），维持现有 `tanva:adopt-merged-content` 流程不变。
2. **加载期（补）**：复用 `ProjectAutosaveManager.tsx:458-475` 现有“远端更新 + 本地已基于旧缓存改动”检测，把当前仅 `setWarning(...)` 的分支升级为同样 `setStaleContent(true)` + 弹窗（同时保留 `cacheValidationPending` 以防御旧路径）。

**弹窗组件 `frontend/src/components/collab/ProjectContentStaleModal.tsx`**
- 镜像现有 `CurrentProjectDeletedModal.tsx` 的挂载/层级方式。
- 样式**逐字对齐参考截图**：全屏毛玻璃蒙层（backdrop blur + 暗色遮罩）、居中暗色卡片、⚠ 橙色圆形图标、蓝色主按钮。
- 文案（按截图风格，去掉“协作”字样以适配个人多 tab）：
  - 标题 **「项目内容已过期」**
  - 正文第一行 **「此项目已在其他标签页打开」**
  - 正文第二行 **「请刷新页面以继续编辑」**
  - 按钮 **「刷新页面」**（`window.location.reload()`）
- **无关闭、无遮罩点击关闭、无 ESC**：刷新是唯一出口。
- 由 `staleContent === true` 驱动显示，挂在项目工作区顶层（与 `CurrentProjectDeletedModal` 同处）。

### Layer 3 — 同浏览器跨 tab 即时通知（多 tab 场景的主动冻结）

用 `BroadcastChannel`（同源同浏览器）让落后的 tab 无需等到自己保存就冻结：
- 频道名如 `tanva:project-version`。每次**本 tab 保存成功**（`markSaved` 后，拿到新 `version`）广播 `{ projectId, version }`。
- 其他 tab 收到后：若 `msg.projectId === store.projectId && msg.version > store.version` → 该 tab 已落后 → `setStaleContent(true)` + 弹窗。
- 封装为 `frontend/src/services/projectVersionChannel.ts`（`postSaved(projectId, version)` + `onRemoteSaved(cb)`），在 `ProjectAutosaveManager` 挂载时订阅、卸载时关闭。
- 仅覆盖同浏览器多 tab（主要场景）；跨设备/跨浏览器仍由 Layer 1 后端护栏在保存时兜底。`BroadcastChannel` 不可用时静默降级（不影响 Layer 1/2）。

## 数据流

```
旧画布触发保存
  └─ saveContent({ content, version(落后), allowMerge = connected })
       └─ 后端 updateContent（串行锁内）
            version < currentContentVersion ?
              ├─ 否 → 正常写入，version+1（不受影响）
              └─ 是 →
                   allowMerge === true（协作）→ 合并写入（现状不变）
                   否 / 缺失（非协作）→ 不写入，返回 { stale:true, latestVersion }
                                        └─ 前端 setStaleContent(true)
                                             ├─ 所有保存路径冻结（!staleContent 门）
                                             └─ 挂载 ProjectContentStaleModal → 用户点「刷新页面」
```

## 边界与取舍

- **协作端瞬断误报**：协作 socket 短暂断开时 `connected` 变 false，该窗口内的保存会被当非协作拒绝→弹刷新。可接受：断线期间该端内容本就可能落后，刷新即重载最新并重连。
- **第一次覆盖**：仅靠前端“保存后发现 merged 再冻结”会放过第一次覆盖，故止血必须在后端护栏（Layer 1）。前端 Layer 2 负责冻结与 UX。
- **协作合并保留**：Layer 1 只改非协作分支，`mergeProjectSnapshots` 与协作 `allowMerge:true` 路径逐字不变。
- **legacy 409 死代码**：`projectApi.ts:202-210` 的旧 `version_conflict` 分支与本方案无关，保持不动。

## 影响文件

后端：
- `backend/src/projects/dto/*`（`UpdateProjectContentDto` 增 `allowMerge?`）
- `backend/src/projects/projects.controller.ts`（透传）
- `backend/src/projects/projects.service.ts`（`updateContent` 落后分支按 `allowMerge` 分流 + 返回 `stale`）

前端：
- `frontend/src/services/projectApi.ts`（保存带 `allowMerge`；解析 `stale`）
- `frontend/src/stores/projectContentStore.ts`（`staleContent` + setter）
- `frontend/src/hooks/useProjectAutosave.ts`（gating 补 `!staleContent`；响应处理 `stale`）
- `frontend/src/components/autosave/ManualSaveButton.tsx`（同上）
- `frontend/src/components/autosave/ProjectAutosaveManager.tsx`（加载期检测升级为弹窗；挂载弹窗；订阅跨 tab 频道）
- `frontend/src/components/collab/ProjectContentStaleModal.tsx`（新增，弹窗）
- `frontend/src/services/projectVersionChannel.ts`（新增，BroadcastChannel 跨 tab 版本广播）

## 非目标（YAGNI）

- 不做“合并我的改动”按钮（用户已确认强制刷新，不保留旧改动）。
- 不做主动轮询探测过期（落后客户端只有在保存时才会造成危害，检测在保存点即可，无需轮询）。
- 不改协作实时补丁逻辑与 `mergeProjectSnapshots` 合并语义。

## 测试

- 后端单测：`version < currentContentVersion` 且 `allowMerge:false`/缺失 → 不写入、返回 `stale:true`、`contentVersion` 不变；`allowMerge:true` → 仍合并、version+1。
- 前端：收到 `stale:true` → `staleContent=true`、`markSaved` 未被调用、后续 autosave/manual 均被冻结、弹窗出现且只有刷新出口。
- 手动 E2E（主场景）：同浏览器两个 tab 开同一项目，A 保存推进版本 → B **立即**弹「项目内容已过期」并冻结（Layer 3）；即便 B 未收到广播、直接触发保存，也被后端拒绝且服务器内容未被 B 覆盖（Layer 1）。
- 跨 tab 频道单测：`onRemoteSaved` 在 `version > store.version` 时置 `staleContent`，等于/小于时不触发；`projectId` 不匹配时忽略。
