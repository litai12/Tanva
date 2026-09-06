# JZXZ 1.1.15 复刻对照

## 参考证据

目标安装包为 `jzxz_pc_1.1.15.exe`，SHA-256 为 `f9ea58a2ccfbe0177a4b42eb9e781d2d550c17bd2ada3c92d3ded5d108d9f187`。安装包中的 WebUI 位于 `app/WebUI/`，核心交互包含新建对话、报告配置、用户/AI 消息、附件、进度、选项和宿主消息回传。安装包同时包含 SketchUp、Rhino、Grasshopper、AutoCAD、Photoshop 相关设置，以及隔离 Node/Python 运行时。

## Tanva 已对齐能力

| 参考能力 | Tanva 入口 | 状态 |
| --- | --- | --- |
| 对话任务壳 | `DesktopApp` → `ElectroReplica` → `DesktopShell` | 已接入 |
| JZXZ 对话排版 | `jzxzDesktop.css` 作用于桌面线程和嵌入式聊天 | 已接入 |
| 新建对话并保留配置 | `DesktopTaskThread` 的“新建对话（保留已选技能）” | 已接入 |
| 修改助手配置 | `DesktopTaskThread` → `tanva:open-report-builder` | 已接入 |
| 作品汇报配置器 | “修改配置”打开 `tanva.report-builder`，素材/章节/展示形式/语言/风格/动画/演示者模式并提交生成；支持配置 JSON 和大纲 Markdown 下载 | 已接入 |
| AI 消息复制 / 复制 Markdown | `AIChatDialog` 消息操作条 | 已接入 |
| 技能选择与新会话继承 | 桌面任务头“选择技能”，设备级偏好随小T请求下发 | 已接入 |
| 本机应用发现/指定/启动 | `tanva.desktop-connectors` | 已接入 |
| 3ds Max / Revit / Illustrator / InDesign / Windows MCP | 同一连接器目录与 Capability Host | 已接入入口，真实桥接待 Windows 验收 |
| MCP 配置、连接、工具目录（stdio / HTTP / SSE） | Electron Capability Host | 已接入 |
| 本机 HTTP MCP 快速连接 | 连接器工具面地址输入；Grasshopper 默认 `http://127.0.0.1:26929/mcp` | 已接入 |
| 参考包 MCP 配置导入 | 支持 `MCP.Servers` 与 `{BaseDir}/{PythonExe}/{NodeExe}` | 已接入 |
| 随包 Skill/runtime 目录 | `desktop-bundle/Settings` 资源槽位、参考包导入器与 launcher 模板 | 本机已用参考包导入并随目录包打入；正式发布仍需审计授权与 Windows 签名 |
| 工具查询 | `query_desktop_tools` | 已接入 |
| 执行过程时间线 | 小T消息内可折叠执行过程卡片，显示步骤状态与错误 | 已接入 |
| 工具执行确认 | `call_desktop_tool` → Electron Main 原生确认 | 已接入 |
| 消息链接/本地目标打开 | `tanva:open-target` → 系统浏览器或默认应用 | 已接入 |
| PPT/Excel 原生产物 | `tanva.artifacts` | 已接入 |
| 汇报网页 / PPT 产物分流 | 网页走 `design-presentation-web`；PPT 走 `pptx-generator` + `present_file` | 已接入提示与交付约束 |

## 验收

在 `frontend/` 执行：

```text
npm run build
npm run verify:desktop
```

Windows 机器准备好 `desktop-bundle/Settings` 后，可使用 `npm run pack:desktop:win` 生成 NSIS 安装包；macOS 只能生成 Tanva 宿主目录包，不能替代 Windows 专业软件联调。

桌面工具调用必须满足：工具先出现在连接器目录中；调用参数为对象；Electron Main 显示风险和参数摘要；用户拒绝后不产生 MCP 调用；用户允许后返回工具结果或错误。

## 尚未完成

参考安装包中的专业软件桥接 DLL、Windows Utility Process、代码签名和正式 Windows 端到端验收，仍需在 Windows 及对应专业软件环境中接入。当前本机已通过 `importDesktopBundle.mjs` 将参考包的隔离 Python/Node 与 MCP skill 依赖导入目录包；HTTP/SSE MCP 的受控连接、schema 校验和确认调用已经在 Tanva Capability Host 中完成。macOS 端只能验证 Tanva 侧 IPC、Capability Host 和界面行为，不能把“检测到应用”误报为专业软件桥接已完成。
