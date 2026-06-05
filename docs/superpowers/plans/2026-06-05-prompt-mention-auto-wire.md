# Prompt @ 引用自动连线 / 建节点 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户在 Prompt 节点用 `@` 引用图片时，自动把该图片接入下游生成管线——画布上没有对应节点就新建 image 节点，下游没有生成节点就新建 generate 节点，并连好线。

**Architecture:** `TextPromptNode` 在插入 mention 后派发 `flow:wirePromptMention` 事件；`FlowOverlay` 集中监听该事件，复用既有 `createNodeAtWorldCenter` 建节点、`onConnect` 连线（自带冲突清理 + history commit）。连线决策（哪些下游节点、哪个空闲图片 handle）抽到纯函数模块便于阅读。

**Tech Stack:** React + ReactFlow（自定义画布），TypeScript。前端无测试框架，验证用 `npx tsc -b`（类型门禁）+ 跑 dev 手动验证。

> **测试说明：** 本仓库前端**零测试基础设施**（无 vitest/jest）。经确认，本特性不引入测试框架；每个任务的"验证"步骤为 `npx tsc -b` 类型检查，整体功能用 Task 5 的手动验证清单确认。

---

### Task 1: 纯函数模块——图片输入 handle 决策

**Files:**
- Create: `frontend/src/components/flow/utils/promptMentionWiring.ts`

各生成类节点的"图片输入 handle"集合来自实测（`grep id='img...'` 各节点组件）与 `QUICK_CONNECT_PRESETS.image`：
- `generate` / `generatePro` / `generatePro4` / `imagePro` / `viewAngle` / `analysis` / `htmlPpt` / `imageSplit` / `imageCompress`: `['img']`
- `generate4`: `['img1','img2','img3','img4']`（`img` 为合并/输出口，排除）
- `generateRef`: `['image1','image2']`（`img` 为输出口，排除）
- `imageGrid`: `['images']`
- `happyhorseR2V`: `['image-1']`

- [ ] **Step 1: 写模块**

```ts
// frontend/src/components/flow/utils/promptMentionWiring.ts
import type { PromptImageMention } from '../types';

/** flow:wirePromptMention 事件的 detail 形状 */
export type WirePromptMentionDetail = {
  promptNodeId: string;
  mention: PromptImageMention;
};

/**
 * 各「可接收图片输入」的生成类节点 -> 其图片输入 target handle 的有序列表。
 * handle id 来自各节点组件实测；纯输出口/合并口已排除。
 */
export const IMAGE_INPUT_HANDLES_BY_TYPE: Record<string, string[]> = {
  generate: ['img'],
  generatePro: ['img'],
  generatePro4: ['img'],
  generate4: ['img1', 'img2', 'img3', 'img4'],
  generateRef: ['image1', 'image2'],
  imageGrid: ['images'],
  imagePro: ['img'],
  viewAngle: ['img'],
  analysis: ['img'],
  htmlPpt: ['img'],
  imageSplit: ['img'],
  imageCompress: ['img'],
  happyhorseR2V: ['image-1'],
};

/** 能接收图片输入、可作为 Prompt 下游连接目标的节点类型集合。 */
export const IMAGE_INPUT_CAPABLE_TYPES: Set<string> = new Set(
  Object.keys(IMAGE_INPUT_HANDLES_BY_TYPE),
);

/** 返回某类型节点的图片输入 handle 列表（未知类型回退 ['img']）。 */
export function getImageInputHandles(nodeType: string | undefined): string[] {
  if (!nodeType) return ['img'];
  return IMAGE_INPUT_HANDLES_BY_TYPE[nodeType] ?? ['img'];
}

/**
 * 在目标节点的图片输入 handle 中挑第一个未被占用的；全被占用返回 null（调用方应跳过，避免覆盖已有图片）。
 */
export function pickFreeImageInputHandle(
  nodeType: string | undefined,
  occupiedHandles: Set<string>,
): string | null {
  for (const handle of getImageInputHandles(nodeType)) {
    if (!occupiedHandles.has(handle)) return handle;
  }
  return null;
}
```

- [ ] **Step 2: 类型检查**

Run: `cd frontend && npx tsc -b`
Expected: PASS（无新增报错）

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/flow/utils/promptMentionWiring.ts
git commit -m "feat(flow): add prompt-mention wiring helper (image-input handle picker)"
```

---

### Task 2: FlowOverlay 监听 `flow:wirePromptMention`，建节点+连线

**Files:**
- Modify: `frontend/src/components/flow/FlowOverlay.tsx`

放置参考：现有 `flow:createImageNode` handler（约 14567）与 quick-connect 的「建节点后 `onConnect`」模式（约 13848）。复用 `createNodeAtWorldCenter(rawType, worldCenter, paletteDefaultData?)`（返回 node id，`paletteDefaultData` 会覆盖 baseData）与 `onConnect(connection)`（自带冲突清理 + `historyService.commit` + 派发 `flow:edgesChange`）。

- [ ] **Step 1: 在 FlowOverlay 顶部 import 区加入 helper 与类型**

在 FlowOverlay.tsx 现有 import 区追加：

```ts
import {
  IMAGE_INPUT_CAPABLE_TYPES,
  pickFreeImageInputHandle,
  type WirePromptMentionDetail,
} from './utils/promptMentionWiring';
import type { PromptImageMention } from './types';
```

（若 `PromptImageMention` / `Connection` 已在文件中 import，则不重复添加；`Connection` 来自 `reactflow`，文件已使用。）

- [ ] **Step 2: 在 `flow:createImageNode` 的 useEffect 之后，新增 useEffect handler**

紧跟现有 `flow:createImageNode` handler 的 `}, [rf, setNodes]);`（约 14694）之后插入：

```ts
  // @ 引用自动接线：建 image 节点 / 建 generate 节点 / 连线
  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | WirePromptMentionDetail
        | undefined;
      const promptNodeId = detail?.promptNodeId;
      const mention = detail?.mention as PromptImageMention | undefined;
      if (!promptNodeId || !mention || mention.mediaType !== 'image') return;

      const nodes = rf.getNodes();
      const edges = rf.getEdges();
      const promptNode = nodes.find((n) => n.id === promptNodeId);
      if (!promptNode) return;

      // Step 1: 解析/创建图片节点
      const refNodeId =
        mention.source === 'flow' && mention.ref?.nodeId
          ? mention.ref.nodeId
          : null;
      const reuseNodeId =
        refNodeId && nodes.some((n) => n.id === refNodeId) ? refNodeId : null;
      const url =
        typeof mention.ref?.url === 'string' ? mention.ref.url.trim() : '';

      const px = promptNode.position?.x ?? 0;
      const py = promptNode.position?.y ?? 0;

      let imageNodeId = reuseNodeId;
      if (!imageNodeId) {
        if (!url) return; // 画布无对应节点且无 url，无法承载
        // 左侧一列垂直错开，避免重叠
        const colNodes = nodes.filter(
          (n) => Math.abs((n.position?.x ?? 0) - (px - 360)) < 100,
        );
        const world = { x: px - 360, y: py + colNodes.length * 260 };
        const created = createNodeAtWorldCenter('image', world, {
          imageUrl: url,
          label: mention.label || 'Image',
          imageName: mention.label || undefined,
        });
        if (!created) return;
        imageNodeId = created;
      }

      // Step 2: 找 Prompt 下游、可接收图片输入的生成节点
      const downstreamGenIds = new Set<string>();
      for (const e of edges) {
        if (e.source !== promptNodeId || e.sourceHandle !== 'text') continue;
        const target = nodes.find((n) => n.id === e.target);
        if (target?.type && IMAGE_INPUT_CAPABLE_TYPES.has(target.type)) {
          downstreamGenIds.add(e.target);
        }
      }

      // Step 3: 计算连线
      const connections: Connection[] = [];
      if (downstreamGenIds.size > 0) {
        for (const genId of downstreamGenIds) {
          if (edges.some((e) => e.source === imageNodeId && e.target === genId)) {
            continue; // 幂等：已连
          }
          const genNode = nodes.find((n) => n.id === genId);
          const occupied = new Set<string>();
          for (const e of edges) {
            if (e.target === genId && e.targetHandle) occupied.add(e.targetHandle);
          }
          const handle = pickFreeImageInputHandle(genNode?.type, occupied);
          if (!handle) continue; // 无空闲图片口，跳过（不覆盖已有图）
          connections.push({
            source: imageNodeId,
            sourceHandle: 'img',
            target: genId,
            targetHandle: handle,
          } as Connection);
        }
      } else {
        // 无下游生成节点：新建 generate 并连 prompt+image
        const genId = createNodeAtWorldCenter('generate', {
          x: px + 420,
          y: py + 120,
        });
        if (genId) {
          connections.push({
            source: promptNodeId,
            sourceHandle: 'text',
            target: genId,
            targetHandle: 'text',
          } as Connection);
          connections.push({
            source: imageNodeId,
            sourceHandle: 'img',
            target: genId,
            targetHandle: 'img',
          } as Connection);
        }
      }

      if (connections.length === 0) return;
      // rAF 确保新建节点已进入 state 再连线
      window.requestAnimationFrame(() => {
        for (const c of connections) onConnect(c);
      });
    };
    window.addEventListener('flow:wirePromptMention', handler as EventListener);
    return () =>
      window.removeEventListener(
        'flow:wirePromptMention',
        handler as EventListener,
      );
  }, [rf, onConnect, createNodeAtWorldCenter]);
```

- [ ] **Step 3: 类型检查**

Run: `cd frontend && npx tsc -b`
Expected: PASS。若报 `onConnect`/`createNodeAtWorldCenter` 在 useEffect 闭包外未定义，确认两者均为组件内 `React.useCallback`（`onConnect` 约 12889 上下文、`createNodeAtWorldCenter` 10228）且新 useEffect 位于其后。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/flow/FlowOverlay.tsx
git commit -m "feat(flow): wire @-mentioned image into pipeline on flow:wirePromptMention"
```

---

### Task 3: TextPromptNode 插入 mention 后派发事件

**Files:**
- Modify: `frontend/src/components/flow/nodes/TextPromptNode.tsx`（`insertMentionCandidate`，约 864-891）

`insertMentionCandidate` 是所有 @ 选择（下拉点击 `handleMentionSelect`、缩略图条 `handleFlowStripSelect`、回车）的唯一汇入点，单点埋设即可覆盖全部。`id` 为节点 id（组件 props 内可用）。

- [ ] **Step 1: 在 `insertMentionCandidate` 的 `commitValue(next, nextMentions);` 之后加派发**

把（约 884 行）：

```ts
    setValue(next);
    commitValue(next, nextMentions);
    setAtMention(null);
```

改为：

```ts
    setValue(next);
    commitValue(next, nextMentions);
    try {
      window.dispatchEvent(
        new CustomEvent('flow:wirePromptMention', {
          detail: { promptNodeId: id, mention },
        }),
      );
    } catch {}
    setAtMention(null);
```

（`mention` 为本函数上文 `createMentionFromCandidate(candidate, value)` 的返回值，作用域内可用。）

- [ ] **Step 2: 类型检查**

Run: `cd frontend && npx tsc -b`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/flow/nodes/TextPromptNode.tsx
git commit -m "feat(flow): dispatch flow:wirePromptMention when a prompt @-mention is inserted"
```

---

### Task 4: 全量类型检查 + lint

**Files:** 无（验证任务）

- [ ] **Step 1: 类型检查**

Run: `cd frontend && npx tsc -b`
Expected: PASS（无报错）

- [ ] **Step 2: lint 仅新增/改动文件**

Run: `cd frontend && npx eslint src/components/flow/utils/promptMentionWiring.ts src/components/flow/FlowOverlay.tsx src/components/flow/nodes/TextPromptNode.tsx`
Expected: 无 error（既有 warning 可忽略）

---

### Task 5: 手动验证清单（dev）

**Files:** 无（手动验证）

- [ ] **Step 1: 起 dev**

Run: `cd frontend && npm run dev`（按项目实际启动方式）

- [ ] **Step 2: 逐条验证**

- [ ] **flow sibling 已连**：Prompt 已接 generate，generate 已接一张图。在 Prompt `@` 该图（flow tab）→ 不新建、不重复连（幂等，画布无变化）。
- [ ] **project-library 图 + Prompt 已接 generate**：`@` 一张项目库图 → 画布 Prompt 左侧新建 image 节点（显示该图），并连到 generate 的空闲图片口（`img`）。
- [ ] **personal-library 图 + Prompt 无下游**：`@` 一张个人库图 → 新建 image 节点 + Prompt 右侧新建 generate 节点 + 两条连线（Prompt→gen text、image→gen img）。
- [ ] **Prompt 接多个 generate**：`@` 一张库图 → 该 image 节点连到**每个** generate 的空闲图片口。
- [ ] **generate4 多图**：Prompt 接一个 generate4，连续 `@` 4 张库图 → 依次占用 `img1..img4`；第 5 张 → image 节点仍创建，但因无空闲口不连（不覆盖）。
- [ ] **删除 `@` token**：删掉一个已连的 `@` token → 已建节点/边保持不变（非目标，预期不回收）。
- [ ] **`@图N` 缩略图一致**：连线建立后，Prompt 缩略图条与实际 sibling 图片一致。

---

## Self-Review

- **Spec coverage：** 建 image 节点（Task2 Step1✓）、连下游（Task2 Step3✓）、无下游建 generate（Task2 Step3 else✓）、多下游全连（✓）、Prompt 不加 handle（未改 handle✓）、触发点单一（Task3✓）、helper handle 约定（Task1✓）、非目标不回收（Task5 验证项✓）。全部覆盖。
- **Placeholder：** 无 TBD/TODO；所有代码步骤含完整代码。
- **类型一致：** `WirePromptMentionDetail`、`pickFreeImageInputHandle`、`IMAGE_INPUT_CAPABLE_TYPES` 在 Task1 定义，Task2 引用一致；事件名 `flow:wirePromptMention` 在 Task2 监听 / Task3 派发一致；detail 形状 `{ promptNodeId, mention }` 两侧一致。
