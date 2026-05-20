# Prompt Node Sibling Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an image thumbnail strip to TextPromptNode and PromptOptimizeNode that shows sibling images connected to the same downstream node, and lets users click to insert `@图1`/`@图2` at the textarea cursor.

**Architecture:** A shared hook (`usePromptSiblingImages`) subscribes to ReactFlow store state and derives sibling images from graph topology. A shared display component (`PromptImageStrip`) renders the strip and fires an insert callback on click. Both prompt node types wire these in with a textarea ref for cursor-position insertion.

**Tech Stack:** React 18, ReactFlow (reactflow package), TypeScript, CSS class-based styling (flow.css)

---

## File Map

| Action | Path |
|--------|------|
| Create | `frontend/src/components/flow/hooks/usePromptSiblingImages.ts` |
| Create | `frontend/src/components/flow/nodes/PromptImageStrip.tsx` |
| Modify | `frontend/src/components/flow/nodes/TextPromptNode.tsx` |
| Modify | `frontend/src/components/flow/nodes/PromptOptimizeNode.tsx` |
| Modify | `frontend/src/components/flow/flow.css` |

---

### Task 1: Create `usePromptSiblingImages` hook

**Files:**
- Create: `frontend/src/components/flow/hooks/usePromptSiblingImages.ts`

This hook watches the ReactFlow store and derives the ordered list of sibling images connected to the same downstream node(s) as the given prompt node.

- [ ] **Step 1: Create the hook file**

Create `frontend/src/components/flow/hooks/usePromptSiblingImages.ts` with this exact content:

```ts
import React from 'react';
import { useStore, type ReactFlowState, type Node as FlowNode } from 'reactflow';

export type SiblingImage = {
  index: number;   // 1-based: @图1 = index 1
  url: string;
  isVideo: boolean;
  nodeId: string;
};

function parseHandleIndex(sourceHandle: string | null | undefined): number {
  if (!sourceHandle) return 0;
  // "images-2" → 2, "img3" → 2 (0-based), "images" → 0
  const dashMatch = /^[a-z]+-(\d+)$/i.exec(sourceHandle);
  if (dashMatch) return Number(dashMatch[1]);
  const trailMatch = /(\d+)$/.exec(sourceHandle);
  if (trailMatch) return Number(trailMatch[1]) - 1; // img1 → index 0
  return 0;
}

function resolveActiveImageUrl(
  node: FlowNode,
  sourceHandle: string | null | undefined
): { url: string; isVideo: boolean } | null {
  const d = (node.data ?? {}) as Record<string, unknown>;
  const isVideo =
    typeof node.type === 'string' &&
    (node.type.toLowerCase().includes('video') || node.type.toLowerCase().includes('sora'));

  if (isVideo) {
    const url =
      (typeof d.thumbnailUrl === 'string' ? d.thumbnailUrl : null) ??
      (typeof d.videoUrl === 'string' ? d.videoUrl : null);
    return url ? { url, isVideo: true } : null;
  }

  const idx = parseHandleIndex(sourceHandle);
  const getAt = (field: unknown): string | null => {
    if (!Array.isArray(field)) return null;
    const v = field[idx];
    return typeof v === 'string' && v ? v : null;
  };

  const url =
    getAt(d.imageUrls) ??
    getAt(d.images) ??
    getAt(d.thumbnails) ??
    (typeof d.imageData === 'string' && d.imageData ? d.imageData : null) ??
    (typeof d.imageUrl === 'string' && d.imageUrl ? d.imageUrl : null) ??
    (typeof d.outputImage === 'string' && d.outputImage ? d.outputImage : null) ??
    (typeof d.inputImageUrl === 'string' && d.inputImageUrl ? d.inputImageUrl : null);

  return url ? { url, isVideo: false } : null;
}

const EMPTY: SiblingImage[] = [];

export function usePromptSiblingImages(nodeId: string): SiblingImage[] {
  return useStore(
    React.useCallback(
      (state: ReactFlowState) => {
        const edges = state.edges;

        // 1. Find downstream node IDs (where this prompt node outputs to)
        const downstreamIds = new Set<string>();
        for (const edge of edges) {
          if (edge.source === nodeId) {
            downstreamIds.add(edge.target);
          }
        }
        if (downstreamIds.size === 0) return EMPTY;

        // 2. Resolve node lookup (supports both ReactFlow v11 nodeLookup and v10 nodes array)
        const nodeLookup = (
          state as ReactFlowState & { nodeLookup?: Map<string, FlowNode> }
        ).nodeLookup;
        const hasNodeLookup = nodeLookup && typeof nodeLookup.get === 'function';
        const fallbackNodes: FlowNode[] = hasNodeLookup
          ? []
          : ((state as ReactFlowState & { nodes?: FlowNode[] }).nodes || state.getNodes());
        const fallbackById = hasNodeLookup
          ? null
          : new Map(fallbackNodes.map((n) => [n.id, n]));
        const getNode = (id: string): FlowNode | undefined =>
          hasNodeLookup ? nodeLookup!.get(id) : fallbackById!.get(id);

        // 3. Collect sibling image edges: connected to any downstream node, not a text input
        //    Preserve order by edges array position.
        const result: SiblingImage[] = [];
        let idx = 1;

        for (let i = 0; i < edges.length; i++) {
          const edge = edges[i];
          if (!downstreamIds.has(edge.target)) continue;
          if (edge.source === nodeId) continue; // skip our own edge
          if (edge.targetHandle === 'text') continue; // skip text inputs

          const sourceNode = getNode(edge.source);
          if (!sourceNode) continue;

          const resolved = resolveActiveImageUrl(sourceNode, edge.sourceHandle);
          if (!resolved) continue;

          result.push({
            index: idx++,
            url: resolved.url,
            isVideo: resolved.isVideo,
            nodeId: edge.source,
          });
        }

        return result.length === 0 ? EMPTY : result;
      },
      [nodeId]
    )
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/libiqiang/business/Tanva/frontend && npx tsc -b --noEmit 2>&1 | grep -E "usePromptSiblingImages|error TS" | head -20
```

Expected: no errors related to `usePromptSiblingImages`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/flow/hooks/usePromptSiblingImages.ts
git commit -m "feat: usePromptSiblingImages hook - derives sibling image context from downstream graph topology"
```

---

### Task 2: Create `PromptImageStrip` component and CSS

**Files:**
- Create: `frontend/src/components/flow/nodes/PromptImageStrip.tsx`
- Modify: `frontend/src/components/flow/flow.css`

- [ ] **Step 1: Create the component**

Create `frontend/src/components/flow/nodes/PromptImageStrip.tsx`:

```tsx
import React from 'react';
import type { SiblingImage } from '../hooks/usePromptSiblingImages';

type Props = {
  images: SiblingImage[];
  onInsert: (text: string) => void;
};

export default function PromptImageStrip({ images, onInsert }: Props) {
  if (images.length === 0) return null;

  return (
    <div className="prompt-image-strip nodrag nopan">
      {images.map((img) => (
        <button
          key={img.nodeId + img.index}
          className="prompt-image-strip__card"
          title={`点击插入 @图${img.index}`}
          onPointerDownCapture={(e) => { e.stopPropagation(); }}
          onMouseDownCapture={(e) => { e.stopPropagation(); }}
          onClick={(e) => {
            e.stopPropagation();
            onInsert(`@图${img.index}`);
          }}
        >
          <img
            src={img.url}
            alt={`图${img.index}`}
            className="prompt-image-strip__img"
            draggable={false}
          />
          {img.isVideo && (
            <span className="prompt-image-strip__video-icon" aria-hidden>▶</span>
          )}
          <span className="prompt-image-strip__badge">图{img.index}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Append CSS to flow.css**

Add to the end of `frontend/src/components/flow/flow.css`:

```css
/* PromptImageStrip */
.prompt-image-strip {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 0 2px;
}

.prompt-image-strip__card {
  position: relative;
  width: 38px;
  height: 38px;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  border: 1px solid #e5e7eb;
  background: #f3f4f6;
  padding: 0;
  flex-shrink: 0;
  transition: border-color 0.12s ease;
}

.prompt-image-strip__card:hover {
  border-color: #2563eb;
}

.prompt-image-strip__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.prompt-image-strip__badge {
  position: absolute;
  bottom: 1px;
  left: 2px;
  font-size: 9px;
  font-weight: 600;
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  border-radius: 3px;
  padding: 0 2px;
  line-height: 14px;
  pointer-events: none;
}

.prompt-image-strip__video-icon {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
  pointer-events: none;
}
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/libiqiang/business/Tanva/frontend && npx tsc -b --noEmit 2>&1 | grep -E "PromptImageStrip|error TS" | head -20
```

Expected: no errors related to `PromptImageStrip`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/flow/nodes/PromptImageStrip.tsx frontend/src/components/flow/flow.css
git commit -m "feat: PromptImageStrip component and CSS - thumbnail strip for sibling image context"
```

---

### Task 3: Wire into `TextPromptNode`

**Files:**
- Modify: `frontend/src/components/flow/nodes/TextPromptNode.tsx`

Three changes: (a) add `textareaRef`, (b) call hook, (c) render strip with insert handler.

- [ ] **Step 1: Add import lines**

In `TextPromptNode.tsx`, find the existing imports block (lines 1-7) and add two new imports after line 3:

Find:
```tsx
import useNodeInternalsSync from '../hooks/useNodeInternalsSync';
```

Replace with:
```tsx
import useNodeInternalsSync from '../hooks/useNodeInternalsSync';
import { usePromptSiblingImages } from '../hooks/usePromptSiblingImages';
import PromptImageStrip from './PromptImageStrip';
```

- [ ] **Step 2: Add textarea ref and sibling images**

In `TextPromptNodeInner`, find the existing `titleInputRef` declaration:

```tsx
const titleInputRef = React.useRef<HTMLInputElement>(null);
```

Add immediately after it:

```tsx
const textareaRef = React.useRef<HTMLTextAreaElement>(null);
const siblingImages = usePromptSiblingImages(id);
```

- [ ] **Step 3: Add handleInsert callback**

Find the `cancelTitleEditing` callback (around line 209):

```tsx
  const cancelTitleEditing = React.useCallback(() => {
```

Add a new callback before it:

```tsx
  const handleInsert = React.useCallback((text: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + text + el.value.slice(end);
    setValue(next);
    commitValue(next);
    // Restore focus and move cursor after inserted text
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  }, [commitValue]);

```

- [ ] **Step 4: Attach ref to textarea**

Find the `<textarea` element (around line 440). Change:

```tsx
      <textarea
        className="nodrag nopan nowheel"
        value={value}
        onChange={handleValueChange}
```

To:

```tsx
      <textarea
        ref={textareaRef}
        className="nodrag nopan nowheel"
        value={value}
        onChange={handleValueChange}
```

- [ ] **Step 5: Render PromptImageStrip below textarea**

Find the closing of the textarea element (line 479 area) and the `<Handle` that follows:

```tsx
        />
      <Handle
        type="target"
        position={Position.Left}
        id="text"
```

Add the strip between them:

```tsx
        />
      <PromptImageStrip images={siblingImages} onInsert={handleInsert} />
      <Handle
        type="target"
        position={Position.Left}
        id="text"
```

- [ ] **Step 6: Type-check**

```bash
cd /Users/libiqiang/business/Tanva/frontend && npx tsc -b --noEmit 2>&1 | grep -E "TextPromptNode|error TS" | head -20
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/flow/nodes/TextPromptNode.tsx
git commit -m "feat(TextPromptNode): sibling image strip with @图X cursor insertion"
```

---

### Task 4: Wire into `PromptOptimizeNode`

**Files:**
- Modify: `frontend/src/components/flow/nodes/PromptOptimizeNode.tsx`

PromptOptimizeNode's user-editable content is the `expandedText` preview textarea. The strip goes below it so the user can insert `@图X` into the optimized result.

- [ ] **Step 1: Add imports**

Find the existing import from `resolveTextFromSourceNode`:

```tsx
import { resolveTextFromSourceNode } from '../utils/textSource';
```

Add two new imports after it:

```tsx
import { resolveTextFromSourceNode } from '../utils/textSource';
import { usePromptSiblingImages } from '../hooks/usePromptSiblingImages';
import PromptImageStrip from './PromptImageStrip';
```

- [ ] **Step 2: Add ref and hook call**

Find the existing `isComposingRef` declaration (around line 38):

```tsx
  const isComposingRef = React.useRef(false);
```

Add immediately after it:

```tsx
  const expandedTextareaRef = React.useRef<HTMLTextAreaElement>(null);
  const siblingImages = usePromptSiblingImages(id);
```

- [ ] **Step 3: Add handleInsert callback**

Find the `stopNodeDrag` callback (around line 143):

```tsx
  const stopNodeDrag = React.useCallback((event: React.SyntheticEvent) => {
```

Add before it:

```tsx
  const handleInsert = React.useCallback((text: string) => {
    const el = expandedTextareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + text + el.value.slice(end);
    setExpandedText(next);
    commitExpandedText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  }, [commitExpandedText]);

```

- [ ] **Step 4: Attach ref to the expandedText textarea**

Find the preview textarea (around line 415):

```tsx
          <textarea
            className="nodrag nopan nowheel"
            value={loading ? '' : expandedText}
            onChange={handlePreviewChange}
```

Change to:

```tsx
          <textarea
            ref={expandedTextareaRef}
            className="nodrag nopan nowheel"
            value={loading ? '' : expandedText}
            onChange={handlePreviewChange}
```

- [ ] **Step 5: Render strip below the preview section**

Find the closing of the preview `<div>` block and the error display that follows (around line 465):

```tsx
      </div>

      {/* 错误显示 */}
      {error && (
```

Add the strip between them:

```tsx
      </div>

      <PromptImageStrip images={siblingImages} onInsert={handleInsert} />

      {/* 错误显示 */}
      {error && (
```

- [ ] **Step 6: Type-check**

```bash
cd /Users/libiqiang/business/Tanva/frontend && npx tsc -b --noEmit 2>&1 | grep -E "PromptOptimizeNode|error TS" | head -20
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/flow/nodes/PromptOptimizeNode.tsx
git commit -m "feat(PromptOptimizeNode): sibling image strip with @图X cursor insertion"
```

---

### Task 5: Manual verification

- [ ] **Step 1: Start dev server**

```bash
cd /Users/libiqiang/business/Tanva/frontend && npm run dev
```

- [ ] **Step 2: Verify golden path**

In the flow canvas:
1. Create a `TextPromptNode`
2. Create a `GenerateNode` (or any image-producing node)
3. Connect an image source node's image output → GenerateNode's image input
4. Connect TextPromptNode's text output → GenerateNode's text input
5. **Expected:** TextPromptNode shows a 38×38px thumbnail at its bottom with badge "图1"
6. Click the thumbnail → **Expected:** `@图1` appears at cursor position in the textarea

- [ ] **Step 3: Verify zero-images state**

Disconnect the image source from GenerateNode.
**Expected:** Strip disappears, node height unchanged.

- [ ] **Step 4: Verify two images**

Connect two different image source nodes to the same GenerateNode.
**Expected:** Strip shows two thumbnails: "图1" and "图2" in edge-array order.

- [ ] **Step 5: Verify PromptOptimizeNode**

Replace TextPromptNode with PromptOptimizeNode in the same topology.
**Expected:** Strip appears below the "Optimized preview" textarea; clicking inserts `@图1` into that textarea.
