# AI 左侧 AI 面板设计

该设计说明如何在画布左侧绘制一个与 `LayerPanel` 相同视觉体系的面板，用于承载全部 AI 对话功能，并与底部的 `AIChatDialog` 实现互斥显示。

## 目标体验
- 左侧弹出的「AI 工作台」与 `LayerPanel` 的玻璃拟态样式和阴影保持一致，宽度固定在 320~360px，顶部有标题与模式切换。
- 面板展开后，底部的 `AIChatDialog` 自动隐藏；当面板关闭时，`AIChatDialog` 自动恢复之前的可见状态。
- 同一套 AI 会话/输入逻辑既可以在左侧面板中渲染，也可以继续复用在底部对话框（保证功能一致）。
- 面板未来可以扩展标签页（提示词库、历史、设置），但默认展示当前会话列表与聊天区域。

## 现状参考
- `LayerPanel`（`frontend/src/components/panels/LayerPanel.tsx:965` 起）已经提供了固定在左上角的面板结构，可复用其容器样式与关闭按钮交互。
- `AIChatDialog`（`frontend/src/components/chat/AIChatDialog.tsx:1-190`）内既包含状态读取，也包含具体 UI；目前所有 AI 相关能力只出现在底部弹窗，且由 `useAIChatStore` 提供状态。
- UI 全局状态由 `useUIStore`（`frontend/src/stores/uiStore.ts:5-160`）维护，尚未区分「AI 面板」的显隐。

## 状态与切换
1. **新增 UI 状态**  
   - 在 `useUIStore` 中增加 `showAIChatPanel`、`toggleAIChatPanel` 以及 `setShowAIChatPanel`，并参与本地持久化。
   - 在 `LayerPanel` 一侧复用 `showLayerPanel` 的动画逻辑——`className` 中已有 `translate-x` 处理（`LayerPanel.tsx:965-987`），可以抽到一个共用的 `PanelContainer` 组件，也可以在 `AIChatPanel` 中复制核心结构。

2. **互斥显示控制**  
   - `AIChatDialog` 内部新增一个派生状态：`const aiPanelVisible = useUIStore((s) => s.showAIChatPanel);`，当 `aiPanelVisible` 为 `true` 时，该组件直接返回 `null`（不渲染 DOM），同时保留其 `useEffect` 等副作用。
   - 独立封装 `useAIPanelVisibility` hook：当 `showAIChatPanel` 从 `false` -> `true` 时调用 `useAIChatStore.getState().hideDialog()`，并缓存之前的 `isVisible`；当面板收起时若之前对话框是可见的就自动调用 `showDialog()`，避免覆盖用户手动关闭的状态。

## 结构拆分
1. **抽离内容层**  
   - 将 `AIChatDialog` 中「消息列表 + 右侧工具 + 输入区域」抽出到新的 `AIChatSurface` 组件（例如 `frontend/src/components/chat/AIChatSurface.tsx`），负责渲染核心 UI，但不关心容器是“底部弹窗”还是“左侧面板”。
   - `AIChatDialog` 仅负责浮层位置、圆角、拖拽、遮罩等；新的 `AIChatPanel` 则负责左侧面板骨架（标题、关闭按钮、tabs 切换）。

2. **AIChatPanel 布局**  
   - 组件位置固定在 `fixed top-0 left-0 h-full w-[340px]`，层级与 `LayerPanel` 一致（`z-[1000]`）。若需要与 `LayerPanel` 共存，可在 `Canvas` 中根据 `showLayerPanel`/`showAIChatPanel` 渲染不同的 X 偏移（例如层叠或折叠成 tabs）。
   - Header：左侧「AI 面板」标题 + 模式标签（对话/历史/模板），右侧放置 `X` 图标关闭按钮，通过 `setShowAIChatPanel(false)` 收起。
   - 内容区：`AIChatSurface`（消息 + 输入）占据大部分高度，下方可预留 48px 的 footer 投放未来功能。

## 交互入口
1. **顶部导航入口**  
   - 在 `FloatingHeader` 的 Workspace 区域添加一个 "AI 工作台" 切换按钮，点击后调用 `toggleAIChatPanel()`，默认快捷键可沿用 `Cmd + Shift + A`（需在 `KeyboardShortcuts` 内注册）。
2. **AI 对话框入口**  
   - 在 `AIChatDialog` 的顶部或侧边增加“展开面板”按钮，点击后触发 `setShowAIChatPanel(true)` 并立即隐藏原对话框，让用户知道两种形态互通。

## 实施步骤
1. 扩展 `useUIStore`：新增字段、切换方法和持久化字段。
2. 拆分 `AIChatDialog`，输出 `AIChatSurface` 并让旧对话框复用它，保证功能不回归。
3. 新建 `AIChatPanel` 组件，复制 `LayerPanel` 的容器结构（固定位置、背景、阴影）。在 `Canvas`（`frontend/src/pages/Canvas.tsx`）中与 `LayerPanel`、`AIChatDialog` 同级渲染。
4. 在 `AIChatDialog` 内引用 `useUIStore`，当 `showAIChatPanel` 为 `true` 时 return `null`。同时实现 `useAIPanelVisibility`，在 `AIChatPanel` 的 `useEffect` 中负责与 `showDialog/hideDialog` 联动。
5. 添加入口按钮/快捷键，并在 UI 布局中预留 space。
6. 验证：  
   - 面板开关是否持久化；  
   - 面板与对话框是否互斥显示；  
   - 切换过程中 `useAIChatStore` 会话、输入框状态保持不变。

## 后续扩展
- 将 `AIChatSurface` 的布局响应式化（panel 模式采用纵向滚动，dialog 模式保留底部固定输入）。
- 在面板 header 添加 session 列表/搜索，可直接调用 `sessions` 数据（`AIChatDialog.tsx:166-190`）。
- 可以利用 `PanelContainer` 组件统一管理阴影、拖动、resizable 行为，方便后续复用到素材库/属性面板。
