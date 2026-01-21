# 变更提案: 画布与对话框 JSON 复制/导入

## 需求背景
当前画布内容与 AI 对话内容只能通过保存项目来持久化，缺少“跨项目/跨环境”的轻量复制与导入能力，影响模板复用与问题排查。需要提供快捷复制/粘贴 JSON 能力，并确保与后端存储格式一致（仅持久化远程引用）。

## 变更内容
1. 画布支持复制/导入项目内容 JSON（Project.contentJson）并追加到当前项目。
2. AI 对话框支持复制对话 JSON/文本，并导入对话 JSON 追加到当前项目会话。
3. 复制/导入过程严格遵守设计 JSON 约束，避免 data/blob/base64 落库。

## 影响范围
- **模块:** 前端画布、对话框、剪贴板/快捷键、项目内容存储
- **文件:** `frontend/src/components/canvas/DrawingController.tsx`, `frontend/src/components/chat/AIChatDialog.tsx`, `frontend/src/components/KeyboardShortcuts.tsx`, `frontend/src/services/*`, `frontend/src/utils/projectContentValidation.ts`
- **API:** 无新增 API
- **数据:** `Project.contentJson`（导入追加逻辑）

## 核心场景

### 需求: 画布内容 JSON 复制/导入
**模块:** 画布
用户可通过快捷键或右键菜单复制当前项目内容 JSON，并将其他项目的 JSON 粘贴导入为新增内容。

#### 场景: 复制画布 JSON
画布可获取最新可持久化快照，并写入系统剪贴板。
- 复制内容与后端存储结构保持一致
- 若存在不可持久化引用，自动清理并提示

#### 场景: 导入画布 JSON
用户粘贴 JSON 后追加到当前项目。
- 画布图层/元素追加，不替换现有内容
- Flow/会话等附属数据按规则合并

### 需求: 对话内容 JSON/文本 复制/导入
**模块:** AI 对话框
对话区域支持右键/快捷键复制 JSON 或文本，并支持粘贴 JSON 追加会话。

#### 场景: 复制对话 JSON/文本
复制当前会话 JSON 或纯文本摘要。
- JSON 字段与后端存储一致（仅持久化引用）
- 文本便于外部分享/排查

#### 场景: 导入对话 JSON
从剪贴板导入对话 JSON，追加到项目会话中。
- 新会话不覆盖已有会话
- 会话冲突时自动生成新 sessionId

## 风险评估
- **风险:** 导入 JSON 可能包含不可持久化引用导致存储不一致。
  **缓解:** 统一走 sanitize 流程，严格剔除 data/blob/base64。
- **风险:** ID 冲突导致层/节点覆盖。
  **缓解:** 导入时做 ID 重映射与去重策略。
