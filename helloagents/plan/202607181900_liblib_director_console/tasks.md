# 实施任务

- [x] 安装 Tencent BrowserSkill，并以 `bsk doctor` 验证 CLI、daemon、扩展和协议。
- [x] 使用用户现有登录态进入 Liblib 导演工作区，完成首轮无障碍树与交互结构取证。
- [x] 补齐目标导演台节点编辑态、场景树、属性栏、视角切换与底部工具条取证；工作区截图受 BrowserSkill 3D 页截图超时影响，已用 snapshot + HTML 样式证据替代。
- [ ] 审计 Tanva FlowOverlay、Canvas 工具列、节点添加面板及 directorConsole 的数据与事件边界。
- [ ] 提取导演工作区 shell 和视觉 token，完成默认画布壳层改版。
- [ ] 对齐顶部导航、工作流/故事板切换、同步/协作/Agent 区域。
- [ ] 对齐左侧工具列和添加节点面板的信息架构与交互。
- [x] 对齐导演台编辑态的双视角、帮助/关闭、默认机位/角色、属性栏与场景/时间线模式，保持旧 scene/timeline 数据兼容。
- [ ] 对齐素材库、角色库、历史记录、资产管理入口及其展开面板。
- [ ] 对齐小地图、连线、网格吸附和缩放控制。
- [ ] 添加固定示例数据与自动化测试；已用本地 BrowserSkill 完成双视角、场景/时间线和测试节点清理的首轮交互验收。
- [ ] 前端生产 build 已通过两次，改动文件定向 lint 已通过（`DirectorConsoleModal.tsx` 仍有既存 ts-nocheck/any 基线）；全仓 lint 被 2520 个存量错误阻断。待完成最终设计 JSON 审计。
- [ ] 同步 helloagents wiki、CHANGELOG 和相关 frontend/docs。
