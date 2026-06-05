# Prompt @mention → @图N 索引对齐 设计文档

- 日期：2026-06-05
- 状态：待实现
- 相关文件：`frontend/src/components/flow/FlowOverlay.tsx`、`frontend/src/components/flow/types.ts`、`frontend/src/components/flow/nodes/TextPromptNode.tsx`

## 背景与问题

画布的 Prompt 节点文本里可用 `@mention` 引用图片，token 形如 `@图1`、`@某节点名`、`@图-2`——它只是给人看的**唯一标识**，与最终发送的图片数组位置无必然对应关系。

发请求前，前端会把 mention 解析成真实图片 URL，与 `img` 连线图片去重拼成图片数组：
- **图片生成节点**（`generate`/`generate4`/`generatePro`/`generatePro4`）：`resolveEdgesAsDataUrls` 收 `img` 连线图 → `resolvePromptMentionImagesForNode` 收 mention 图 → `dedupeImageRefs` 去重 → `slice` 截断成 `imageUrls[]`。
- **视频生成节点**（`klingVideo`/`viduVideo`/`doubaoVideo`/`seedVideo` 等）：只收 `image`/`image-2`/`elementImg` 连线图，**完全不收 mention 图**，`referenceImages` 经 OSS 上传/归一化（顺序保留）。

两类节点的 **prompt 文本里的 `@token` 都是原样发给后端的**。图片/视频大模型只认 “图1 图2” 这类自然语言，看不懂 `@某节点名`，导致文本里的“名字”与图片数组的“位置”对不上。

## 目标

发送前把 prompt 文本里每个 `@token` 替换为 `@图N`，其中 **N = 该 mention 解析出的图片在最终发送图片数组里的下标 + 1**（图1 = 下标 0）。

- 保留 `@` 前缀（输出 `@图N`，非 `图N`）。
- 编号基准为**最终发送数组的全局位置**（含 `img`/`image` 连线带进来的图）。
- 图片生成节点与视频生成节点都要支持。

## 非目标

- 不改后端：后端继续接收 `prompt` + 图片数组，不解析 mention。
- 不改 mention 的录入/展示/存储交互（`TextPromptNode` 的 `@` 下拉、缩略图预览条等保持不变）。
- 不引入“连线图也能被 `@` 引用”等新交互——`@token` 只来自结构化 `mentions`。

## 核心设计：图片引用对象贯穿流水线

**关键决策（采纳 codex 评审）**：不采用“先拼 URL 数组、事后用 URL 字符串反查 index”的做法。因为 mention 解析出的 ref 可能是 dataURL / asset key / 代理 URL，之后会被上传/归一化成 OSS URL（改名），事后拿原 URL 去最终数组反查会大量匹配不上。

改为引入中间对象，从收集一路带到最终发送：

```ts
type RuntimeImageRef = {
  source: 'edge' | 'mention';
  promptNodeId?: string;   // mention 来自哪个 Prompt 节点（用于 {promptNodeId, token} 反查）
  token?: string;          // mention 的 @token（如 "@图1"/"@某名"）
  sourceEdge?: Edge;       // edge 来源（视频审核状态等按对象关联，而非 index）
  resolvedRef: string;     // 解析出的原始 ref（dataURL/key/url）
  finalUrl?: string;       // 上传/归一化后真正发送的 URL
};
```

统一流程：
1. 收集 edge refs + mention refs（mention 复用现有解析逻辑，扩展为返回带 token 的对象）。
2. 合并：**edge 在前，mention 追加**（保护首尾帧/模式判定语义，见“视频节点”）。
3. 上传/归一化，填 `finalUrl`。
4. 基于对象列表做 dedupe + slice（URL 归一化仅作 dedupe 辅助，**不作唯一身份**）。
5. 从“活下来的对象”直接得到 `{promptNodeId, token} → 最终 index` 的反查表（不靠 URL 比较）。
6. 按 prompt 片段重写文本，再合并发送。

`图N` 永远 = 该对象在最终发送数组里的真实下标 + 1。

## 文本重写规则

实现为纯函数（便于单测），输入：每个 prompt 片段的 `{promptNodeId, promptText, mentions}` 与反查表。

- **按 prompt 片段重写**：映射 key 用 `{promptNodeId, token}` 而非全局 token。两个 Prompt 节点都可能用 `@图1` 但指向不同图——这是比“替换后串台”更危险的坑。每个 text 边各自用自己的 `mentions` 重写后再 join。
- **两阶段替换防串台**：先把每个 token 全局替换成唯一 UUID sentinel，再把 sentinel 替换成 `@图N`。避免新值 `@图3` 与另一个原 token `@图3` 二次串台。sentinel 须保证不可能出现在用户文本中。
- **token 边界**：复用 / 对齐现有 `hasPromptMentionTokenInText()` 的语义；正则匹配前对 token 做 escape；避免 `@图1` 误命中 `@图10`；token 按长度降序处理。
- **只替换**确实出现在该片段文本里、且结构化 `mentions` 中存在的 token。

## 视频节点特殊处理

- 视频节点补上 mention 图收集（复用统一解析逻辑），但 **mention 图只能追加在 `image`/`image-2`/`elementImg` 连线图之后**，绝不抢首帧/尾帧角色：
  - Kling 首尾帧、Vidu `img2video`/`start-end2video`、Seedance 模式判定均依赖前若干张图的位置语义。
- **Seedance 2.0 审核状态**：现有 `referenceImageSourceEdges[idx]` 按 index 关联 edge 读写火山审核状态（`volcAssetId` 等）。加入 mention 图后升级为联合类型数组 `referenceImageSources[]`，元素为 `{type:'edge', edge}` | `{type:'mention', mention}`，避免 index 错位导致审核状态/payload 错乱。

## 边界情况与错误处理（产品决策已定）

- **被 maxImages 上限截掉**（引用图超出模型可接收数）：**报错/提示，不发送**。提示用户“引用图超过模型上限，@xxx 未发送”，由用户调整后重试。不静默丢弃。
- **mention 图解析/上传失败**（系统没拿到用户明确引用的资源）：**中断请求并报错**。不静默跳过。
- **同一张图既被连线又被 `@mention` 引用**：dedupe 后只占一个位置，mention 命中较早出现（连线图）的 index。
- **token 指向的 mention 实际未出现在文本中**：按现有逻辑跳过，不进数组、不替换。

## 受影响的关键位置（实现参考）

- `resolvePromptMentionImagesForNode`（`FlowOverlay.tsx` ~15673-15737）：扩展为返回带 token/promptNodeId 的对象；保留 / 兼容现有 `string[]` 调用点。
- 图片节点组装（`FlowOverlay.tsx` ~21310-21383）：改为对象流水线，dedupe+slice 后产出反查表并重写 prompt。
- 视频节点组装（`FlowOverlay.tsx` ~18147-19635，payload ~19256-19349）：新增 mention 收集 + `referenceImageSources[]` + 重写；重写发生在 OSS 上传/归一化后、payload 组装前。
- 新增纯函数 `rewritePromptImageTokens(...)`（建议放 `types.ts` 或新 util 文件）。
- 图片节点多 text 输入：跨多个 prompt 源节点收集，按片段重写后合并。

## 测试用例（必须覆盖）

1. `@图1 → @图3`，同时另一个 token 本身是 `@图3`（防二次串台）。
2. `@图1` 与 `@图10` 同时存在（边界不误命中）。
3. 同一张图既连线又 mention，mention 指向连线图的较早 index。
4. mention 被 maxImages 截掉 → 报错不发。
5. dataURL mention 上传成 OSS URL 后仍能正确映射（对象贯穿，非 URL 反查）。
6. 两个 Prompt 节点都有 `@图1` 但指向不同图（按 `{promptNodeId, token}` 区分）。
7. 视频节点 connected image + mention image 的顺序与模式判定不变。
8. Seedance 2.0 mention 图参与审核时 index 不错位。
9. 解析/上传失败 → 中断报错。
