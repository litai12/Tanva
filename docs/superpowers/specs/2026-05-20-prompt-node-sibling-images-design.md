# Prompt 节点同级图片上下文 & 缩略图预览

**日期**: 2026-05-20  
**状态**: 待实现

## 目标

改造 `TextPromptNode`（及 `PromptOptimizeNode`），使其能：
1. 自动发现通过下游节点关联的同级图片/视频节点
2. 在节点底部展示缩略图 strip（含序号徽章）
3. 点击缩略图将 `@图1` / `@图2` 插入 textarea 光标处

## 背景 & 数据流

Prompt 节点不直接连图片，而是与图片节点共同连向同一个下游节点（如 generate）：

```
[图片节点A] --img-->
                    [generate 节点] <--text-- [TextPromptNode]
[图片节点B] --img-->
```

`@图1` 对应下游节点第一个非文本输入边的图片，`@图2` 对应第二个，顺序与请求体 `images[]` 数组下标一致。

## 新增文件

### `usePromptSiblingImages.ts`

```
frontend/src/components/flow/hooks/usePromptSiblingImages.ts
```

- 输入：`nodeId: string`
- 使用 `useEdges()` + `useNodes()` 订阅图状态
- 逻辑：
  1. 找 `edge.source === nodeId` 的所有边 → 得到下游节点 ID 列表
  2. 对每个下游节点，找 `edge.target === downstreamId && edge.sourceHandle !== 'text'` 的边，按边 `id` 字典序（即创建顺序）排序
  3. 从源节点 `data` 里取 active image URL：`imageResults[data.selectedIndex ?? 0]?.url`，视频节点取 `videoResults[0]?.url`
  4. 过滤掉无 URL 的，1-based 编号
- 输出：`SiblingImage[]`

```ts
type SiblingImage = {
  index: number    // 1-based，@图1 = index 1
  url: string
  isVideo: boolean
  nodeId: string
}
```

### `PromptImageStrip.tsx`

```
frontend/src/components/flow/nodes/PromptImageStrip.tsx
```

- Props：`images: SiblingImage[]`, `onInsert: (text: string) => void`
- 当 `images.length === 0` 时渲染 `null`（不占空间）
- 布局：横向 flex，每项 38×38px 缩略图 + 左下角序号徽章（`图1`）
- 视频节点：缩略图上加播放图标覆盖层
- 点击任意缩略图：调用 `onInsert('@图' + image.index)`

## 修改文件

### `TextPromptNode.tsx`

- 引入 `usePromptSiblingImages(id)`
- 引入 `PromptImageStrip`
- 在 textarea 下方渲染 `<PromptImageStrip images={siblingImages} onInsert={handleInsert} />`
- `handleInsert(text)`：在 textarea `ref` 光标位置插入文字，触发 `onChange`

### `PromptOptimizeNode.tsx`

- 同上，引入 strip（PromptOptimizeNode 也会把 prompt 发给 AI，用户可能需要引用图片）

### `flow.css`

新增 strip 相关样式（参考 TapCanvas-pro `UpstreamReferenceStrip` 样式规格）：

```css
.prompt-image-strip { /* 横向 flex 容器，gap 6px, padding 6px 8px */ }
.prompt-image-strip__card { /* 38×38px, rounded-md, overflow-hidden, relative, cursor-pointer */ }
.prompt-image-strip__img { /* object-fit: cover, width/height 100% */ }
.prompt-image-strip__badge { /* 左下角绝对定位，10px 字号，背景半透明黑，白字 */ }
.prompt-image-strip__video-icon { /* 居中覆盖播放三角 */ }
```

## 不改动的部分

- `FlowOverlay` 里请求体图片 URL 数组的收集逻辑：已按边顺序排列，与 hook 排序一致，无需修改
- `resolveTextFromSourceNode`：仅处理文本，与本功能无关
- 任何持久化逻辑：同级图片是派生状态，不写入 `data`

## 成功标准

1. Prompt 节点底部出现缩略图，连接/断开时自动更新
2. 点击 `图1` 徽章后，textarea 插入 `@图1` 文字
3. PromptOptimizeNode 同样支持
4. 没有图片连接时 strip 不显示，节点高度不变
