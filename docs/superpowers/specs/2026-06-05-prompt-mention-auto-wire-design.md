# Prompt @ 引用自动连线 / 建节点 设计

日期：2026-06-05
状态：已确认，待实现

## 背景

Prompt 节点（`TextPromptNode`）支持 `@` 引用图片功能，下拉框有三个来源 tab：

- `flow`：当前画布中、作为 Prompt 下游生成节点 **sibling** 的图片节点（由 `usePromptSiblingImages` 解析：找到 Prompt 的下游节点，再收集连到这些下游节点图片输入口的图片源）。`@图N` 的编号即来自这里。
- `project-library`：当前项目历史图片（`globalImageHistoryApi.list({ sourceProjectId })`），只有 url/historyId，画布上**不一定有对应节点**。
- `personal-library`：用户个人素材库（`personalLibraryApi.list('2d')`），同样只有 url/assetId。

现状：选中一个 `@` 候选时，只是往 textarea 插入 token 并把 `PromptImageMention` 写进节点 `data.mentions`，**不创建任何节点、不创建任何连线**。因此从 library 选的图、或下游还没接生成节点时，`@` 的图片并不会真正进入生成管线。

数据流拓扑（关键事实）：

- `ImageNode --(img out)--> GenerateNode (img/img1../image-2.. in)`
- `PromptNode --(text out)--> GenerateNode (text in)`
- Prompt 与 Image 是 **sibling**，都喂给同一个 generate 节点。Prompt 节点**自身没有图片输入 handle**（只有左 `text` 入、右 `text` 出）。

## 目标

用户使用 `@` 引用图片时，让被引用的图片**真正接入生成管线**：

1. 若被 `@` 的图片在画布上**没有对应节点**（来自 library，或 flow 节点已被删除）→ 在画布上新建一个 image 节点承载该图（图就是 `@` 的对象）。
2. 把该图片节点连到 Prompt 的下游生成节点的图片输入口。
3. 若 Prompt **下游没有任何生成节点** → 自动新建一个 `generate` 节点，并把 `Prompt(text)→generate(text)`、`image(img)→generate(img)` 都连上。

## 拓扑决策（已与用户确认）

- 连线方向：**图片 → 下游生成节点**（不给 Prompt 加图片输入口，不改 Prompt handle 结构）。
- 「不在当前项目」= **图片在当前画布上没有对应节点**。
- 无下游生成节点时：**自动新建 generate 节点并连接**（这是该拓扑下唯一能"连接"的方式）。
- Prompt 有多个下游生成节点时：连到**所有**带空闲图片输入口的下游生成节点，使 `@图N` 缩略图与实际 sibling 完全一致。

## 架构

所有节点/边的增改在本代码库统一集中于 `FlowOverlay`，通过 `flow:*` 自定义事件触发（如 `flow:createImageNode`、`flow:duplicateAndConnect`），每个都统一走 `historyService.commit(...)`。本特性遵循同一模式：

### 1. 触发：`TextPromptNode`

在 `insertMentionCandidate` 成功插入 mention（下拉点击 / 回车 / 缩略图条选中，最终都汇入此函数）后，派发新事件：

```ts
window.dispatchEvent(new CustomEvent('flow:wirePromptMention', {
  detail: { promptNodeId: id, mention /* 刚插入的 PromptImageMention */ }
}));
```

- 仅在**插入新 mention** 时触发；删除 token 不回收（见非目标）。
- 复用已存在的 mention 数据（`source`、`ref.nodeId`、`ref.url`、`label`、`mediaType`）。

### 2. 处理：`FlowOverlay` 新增监听 `flow:wirePromptMention`

handler 原子完成以下步骤（全部基于 `rf.getNodes()/getEdges()`、`setNodes/setEdges`）：

**Step 1 — 解析 / 创建图片节点**
- 若 `mention.source === 'flow'` 且 `mention.ref.nodeId` 在当前 nodes 中存在 → `imageNodeId = mention.ref.nodeId`（复用，不新建）。
- 否则 → 用 `mention.ref.url` 新建 `type:"image"` 节点：
  - `data: { imageUrl: url, label, imageName, boxW:260, boxH:240 }`（复用 `flow:createImageNode` 同款字段与 `recordImageHistoryEntry` 逻辑）。
  - 位置：**Prompt 节点附近**（左侧，如 `promptPos.x - 320`），多张时按已建数量垂直错开避免重叠。
  - 无 `url` 时（理论上不应出现）跳过，安全返回。

**Step 2 — 找 Prompt 下游生成节点**
- `downstream = edges.filter(e => e.source === promptNodeId && e.sourceHandle === 'text').map(e => e.target)`。
- 过滤出**带图片输入 handle** 的生成节点（generate / generate4 / generatePro / generateRef / imagePro / viewAngle / analysis / htmlPpt 等接受图片输入的类型）。

**Step 3 — 接线**
- **有下游生成节点**：对每个下游生成节点，
  - 若 `imageNodeId` 已连到它（任意图片 handle）→ 跳过（幂等）。
  - 否则新增边：`source=imageNodeId, sourceHandle='img', target=genNodeId, targetHandle=<第一个空闲图片输入 handle>`。
- **无下游生成节点**：
  - 新建一个 `generate` 节点，放在 Prompt 右侧。
  - 新增边：`Prompt(text out)→generate(text in)`、`image(img out)→generate(img in)`。

接线统一走与 `onConnect` 一致的冲突清理（同一图片 handle 互斥替换），并 `historyService.commit('flow-wire-prompt-mention')`、派发 `flow:edgesChange`。

### 3. 「第一个空闲图片输入 handle」helper

复用现有 handle 命名约定（见 `usePromptSiblingImages.isImgTargetHandle` 与 `QUICK_CONNECT_PRESETS.image`）：

- 单图生成节点（generate / generatePro …）：图片输入口为 `img`。
- 多图生成节点（generate4 / generatePro4）：`img1..img4`；generateRef：`image2..`；imageGrid：`images`。
- helper 根据目标节点类型给出候选图片输入 handle 列表，剔除已被占用的，返回第一个空闲项；都被占用时回退到主图片 handle（覆盖式替换，由冲突清理处理）。

## 数据 / 类型

- 无新增持久化字段。复用 `PromptImageMention`（`frontend/src/components/flow/types.ts`）。
- image 节点 `data` 复用现有 `ImageData`（`imageUrl` 优先）。
- 新事件 `flow:wirePromptMention` detail 类型：`{ promptNodeId: string; mention: PromptImageMention }`。

## 错误处理

- `mention.ref.url` 缺失且画布无对应节点 → 静默跳过（仅保留文本 token，等同现状）。
- 找不到 Prompt 节点位置 → 退回画布视口中心放置（复用现有定位回退）。
- 所有 OSS/history 记录失败走现有 `.catch(() => {})` 容错，不阻塞连线。

## 测试

- flow sibling 已连：`@` 它 → 不新建、不重复连（幂等）。
- project-library 图、Prompt 已接 generate：`@` 它 → 新建 image 节点 + 连到该 generate 的空闲图片口。
- personal-library 图、Prompt 无下游：`@` 它 → 新建 image 节点 + 新建 generate + 两条连线。
- Prompt 接多个 generate：`@` 一张 library 图 → 该 image 节点连到每个 generate 的空闲图片口。
- 多图生成节点（generate4）：连续 `@` 多张 → 依次占用 `img1..img4`。
- 删除 `@` token → 已建节点/边保持不变（非目标）。

## 非目标

- 删除 `@` token 不回收已建节点/连线。
- 不改 Prompt 节点 handle 结构（不加图片输入口）。
- 不处理 video / 非图片 mention（当前 mention `mediaType` 仅 `image`）。
- 不做新建节点的智能布局/避让算法（仅简单垂直错开）。

## 相关文件

| 作用 | 路径 |
|------|------|
| Prompt 节点（触发） | `frontend/src/components/flow/nodes/TextPromptNode.tsx` |
| 中央事件处理（建节点/连线） | `frontend/src/components/flow/FlowOverlay.tsx` |
| sibling 解析（handle 约定参考） | `frontend/src/components/flow/hooks/usePromptSiblingImages.ts` |
| image 节点 / handle | `frontend/src/components/flow/nodes/ImageNode.tsx` |
| 类型 | `frontend/src/components/flow/types.ts` |
| 既有建图事件参考 | `flow:createImageNode` handler（FlowOverlay ~14567） |
