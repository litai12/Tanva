# lt-dev9 → lt-dev10 选择性迁移说明

## 目标

继续把 `lt-dev9` 里适合的功能优化，**选择性**迁移到 `lt-dev10`。不要整分支 merge。`lt-dev10` 是基于 `main` 的画布性能方案作为底座，重点保留 `main` / `lt-dev10` 的流畅度，再把 `lt-dev9` 里相对独立、低风险的功能补回来。

## 仓库与分支

| 项 | 值 |
|----|-----|
| 仓库 | `/Users/litai/Documents/Development/tanvas_2026/Tanva` |
| 当前分支 | `lt-dev10` |

## 重要原则

- 保留 `main` / `lt-dev10` 的画布性能，不要把 `lt-dev9` 里可能拖慢画布的实现整体搬过来。
- 只迁移清晰、独立、低风险的功能。
- **不要碰高风险保存链路**，除非单独评估：
  - `paperSaveService`
  - `DrawingController`
  - `objectUrlRegistry`
  - 项目懒预览 / `imagePreviewAssetService`
  - 设计 JSON 保存/持久化逻辑
- 设计 JSON 只能持久化远程 URL / key / path，不能保存 `data:`、`blob:`、裸 base64。
- 不要 revert 用户已有改动。

## 已完成并提交过的内容

- `fac143d9` — `fix(frontend): harden canvas viewport updates and flow node perf`
- `f44864b1` — `feat(flow): panel search, hydrate skip, Analyze skills, Text Chat prompt`

## 一批已完成但未提交的迁移（摘要）

### 1. `TextChatNode.tsx`

- 增加 `textChatSkillId`
- 增加技能预设：`custom`、`shotSplit`、`promptOptimize`、`translate`
- 预设模式使用内置 prompt 并追加上游输入
- `custom` 模式使用上游输入 + 手动输入
- 监听 `flow:updateNodeData`，读取上游最新文本
- 保留 `lt-dev10` 的自动高度、resize、Web Search 等现有能力

### 2. `StoryboardSplitNode.tsx`

- 增加 `splitFormat`
- 支持自定义分镜格式，例如 `分镜1`、`#1`、`|**1**|`
- 自动根据解析结果确定输出数量，最多 50
- 重新拆分后清理旧的 `promptN` 字段和多余 prompt 边
- 使用最新上游文本，避免 stale state

### 3. `PromptOptimizeNode.tsx`

- 运行前读取最新上游文本
- 监听上游节点数据更新，避免拿旧 prompt 优化

### 4. 图片参考数量限制

- 文件：`frontend/src/utils/flowModelProvider.ts`
- 增加限制：Fast 3、Pro 11、Ultra 14
- 增加 `getFlowImageReferenceLimit` / `resolveFlowImageReferenceLimit`
- `GenerateNode`、`GenerateProNode`、`Generate4Node` 使用 provider 对应的参考图数量

### 5. `Generate4Node.tsx`

- 修复 hook 顺序问题
- `effectiveProvider` / `maxInputPreviews` 在 `connectedInputImages` 之前声明

### 6. `VideoAnalyzeNode.tsx`

- 默认 prompt 本地化：
  - zh: `分析这个视频，描述场景、动作和关键信息。`
  - en: `Analyze this video and describe the scenes, actions, and key information.`
- 默认 prompt 仍是默认值时跟随语言同步
- 请求里带上 `bananaImageRoute`、`channelHint`、provider route options
- run 时使用 `promptInput`

### 7. `FlowOverlay.tsx`

- 新建 `textChat` 节点默认数据增加 `textChatSkillId: "custom"`

### 8. 类型和文档已同步

- `frontend/src/components/flow/types.ts`
- `frontend/docs/06-变更日志.md`
- `helloagents/CHANGELOG.md`
- `helloagents/wiki/modules/frontend-flow.md`

### 涉及文件列表（未提交批次）

- `frontend/docs/06-变更日志.md`
- `frontend/src/components/flow/FlowOverlay.tsx`
- `frontend/src/components/flow/nodes/Generate4Node.tsx`
- `frontend/src/components/flow/nodes/GenerateNode.tsx`
- `frontend/src/components/flow/nodes/GenerateProNode.tsx`
- `frontend/src/components/flow/nodes/PromptOptimizeNode.tsx`
- `frontend/src/components/flow/nodes/StoryboardSplitNode.tsx`
- `frontend/src/components/flow/nodes/TextChatNode.tsx`
- `frontend/src/components/flow/nodes/VideoAnalyzeNode.tsx`
- `frontend/src/components/flow/types.ts`
- `frontend/src/utils/flowModelProvider.ts`
- `helloagents/CHANGELOG.md`
- `helloagents/wiki/modules/frontend-flow.md`

## 已验证

- `git diff --check` 通过
- `cd frontend && npm run build` 通过
- `ai-metadata-sync` 未跑通：本地脚本缺失  
  `/Users/litai/.codex/Skills/ai-metadata-sync/scripts/sync-repo.mjs`

## 2026-05-04 继续迁移

### 已完成

- `GenerationProgressBar` 进度稳定性：
  - 支持 `startedAt` / `runKey`
  - 各生成/视频节点传入节点 `id` 作为 `runKey`
  - 模拟进度按同一运行 key 计算，避免节点重渲染后回到起始进度
  - 未新增设计 JSON 持久化字段
- `NodeGroupNode` 组停止按钮：
  - 分组运行中按钮从 Play 切换为 Square
  - 点击后调用 `FlowOverlay.stopGroupRun`
  - 当前子节点完成后不继续运行后续组内节点
  - `groupRunning/groupStopping` 注入绕过普通节点缓存，避免按钮状态滞后

### 本轮涉及文件

- `frontend/src/components/flow/FlowOverlay.tsx`
- `frontend/src/components/flow/nodes/GenerationProgressBar.tsx`
- `frontend/src/components/flow/nodes/NodeGroupNode.tsx`
- `frontend/src/components/flow/nodes/*`（仅补充 `GenerationProgressBar.runKey`）
- `frontend/docs/06-变更日志.md`
- `helloagents/CHANGELOG.md`
- `helloagents/wiki/modules/frontend-flow.md`

### 本轮验证

- `git diff --check` 通过
- `cd frontend && npm run build` 通过（仅现有 Vite chunk / dynamic import 警告）
- `cd frontend && npm run lint` 未通过：全仓既有 ESLint 债务仍存在（大量 `no-explicit-any`、未使用变量、旧 `@ts-nocheck`、`frontend/tmp_head_aiChatStore.ts` 二进制解析等），非本轮新增的可构建错误
- `ai-metadata-sync` 未跑通：本地脚本仍缺失  
  `/Users/litai/.codex/Skills/ai-metadata-sync/scripts/sync-repo.mjs`

## 建议下一步

1. 检查当前工作区：

   ```bash
   git status --short --branch
   ```

2. 建议先把当前这批已验证的改动提交掉，避免后续迁移混在一起。

3. 继续从 `lt-dev9` 对比挑低风险功能：

   ```bash
   git diff --name-status lt-dev10..lt-dev9 -- \
     frontend/src/components/flow \
     frontend/src/services \
     frontend/src/stores \
     frontend/src/utils
   ```

## 优先候选（后续迁移）

- global history 相关媒体体验优化：
  - `global-history/historyMedia.ts`
  - `GlobalImageHistoryPage`
  - detail modal
  - `imageHistoryService`

## 暂时不要迁移

- Banana web-search 旧后端 route（后端/API 耦合较高）
- 保存、画布持久化、object URL、项目预览资产链路
- 后端积分 / provider route 大改（除非用户明确要求）
