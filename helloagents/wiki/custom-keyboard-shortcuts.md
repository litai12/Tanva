# 自定义快捷键

## 入口与行为

- 设置弹窗新增「快捷键」分类，支持搜索动作、按键录入、清除、单项恢复默认及全部恢复默认，适配中英文、明暗主题和移动布局。
- 覆盖现有通用、画布和节点快捷键：撤销、重做、保存、复制/导入 JSON、复制、粘贴、保留连线粘贴、全选、删除、临时平移、适合视图、分组与取消分组。
- 默认快捷键保持原行为；重新绑定替换该动作的全部默认组合，清除关闭所有默认别名。重复组合提示占用动作，不静默覆盖；单项恢复也检查冲突，全部恢复原子重置。
- `Mod` 同时兼容 Ctrl 与 Cmd，界面按平台显示。设置打开、录入中、输入框及输入法组合输入不会触发画布动作；Escape 先取消录入，再关闭设置。
- 配置自动保存到当前浏览器本地，不写入项目设计 JSON，不做账号云同步。聊天 Enter 发送方式仍由 AI 设置管理；媒体预览和专用编辑器的局部操作不纳入此页。

## 实现边界

- `frontend/src/utils/keyboardShortcuts.ts`：动作目录、键盘归一化、展示格式和冲突判断。
- `frontend/src/stores/shortcutStore.ts`：持久化覆盖配置、录入状态和运行期匹配。
- `frontend/src/components/layout/ShortcutSettings.tsx`：设置界面；`FloatingHeader.tsx` 提供入口和弹窗隔离。
- 全局 `KeyboardShortcuts.tsx`、画布 `DrawingController` / `useInteractionController` / 文本工具、`ZoomIndicator` 与 `FlowOverlay` 读取同一配置。保存继续调用原 `manualSaveService`，不复制持久化逻辑。
- `shortcutClipboard.ts` 将自定义粘贴接到系统剪贴板及原有粘贴处理；复制的纯文本与自定义 MIME 使用同一结构化数据，兼容原生复制后自定义粘贴。旧原生 C/V 失效时只阻断对应浏览器剪贴板事件，不影响重新分配的动作、文本输入或右键菜单。
- 新增动作必须先注册目录，再接入实际执行处理；不能仅展示可编辑键位却继续执行硬编码键位。

## 验证

浏览器回归入口：`cd frontend && node scripts/verifyCustomShortcutsBrowser.mjs`，验证真实设置入口、录入与冲突、取消、运行期新旧组合、输入保护、刷新恢复、清除默认别名和重置。

- `npx tsx --test src/utils/keyboardShortcuts.test.ts src/stores/shortcutStore.test.ts`：14 项通过。
- `node scripts/verifyCustomShortcutsBrowser.mjs`：通过，包括主题、中英文和移动布局。
- `node scripts/verifyShortcutFlowBrowser.mjs`：真实 Flow / DrawingController 场景通过分组、解组、节点/连线删除、输入与录入隔离、原生复制到自定义粘贴及旧键位失效检查。
- `npm run build` 通过；新增配置、UI、剪贴板辅助模块与核心测试定向 ESLint 通过。全量 `npm run lint` 仍有原有仓库问题（修改前 2559 个 error，本轮检查 2556 个 error），没有以忽略规则掩盖。

本次为本地实现，未部署。
