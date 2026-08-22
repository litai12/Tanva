# JZXZ 能力拆解与 Tanva 映射

> 分析对象：`jzxz_pc_1.1.11.exe`（建筑学长电脑版 1.1.11）  
> SHA-256：`6e4a19c6d21d28f04827914a473aed3fa39569f08c71c348fee2b4c79bab5868`  
> 分析日期：2026-08-21  
> 原则：只做静态架构与公开能力研究，不复制安装包中的代码、资源、品牌或密钥。

## 1. 结论

JZXZ 的主要价值不是一组文档工具，也不是它的 Windows 外壳，而是一套“桌面 AI 编排器 + 专业软件桥接 + 隔离运行时 + 动态 Skills + 本地知识库”的能力系统。Tanva 应吸收其能力分层，由小T继续作为唯一 AI 核心，由统一插件工具面呈现状态和结果；不能引入第二套聊天、第二套项目系统或第二套画布。

公开产品页面也支持这一判断：建筑学长把桌面助手描述为可操作 Rhino、CAD、SketchUp 和 Office 文件，并把建筑、室内、景观、规划的图片、视频、3D 与无限画布工作流作为同一产品能力。参考：[官方桌面 App](https://www.jianzhuxuezhang.com/app)、[官方产品介绍](https://www.jianzhuxuezhang.com/introduce/aboutUs)、[官方无限画布](https://www.jianzhuxuezhang.com/canvas/home)。

## 2. 安装包内可验证的架构事实

### 2.1 外壳与运行时

- Windows 原生 `.NET 8 + WPF + WebView2` 外壳，而非 Electron；核心程序集包括 `Desktop.Shell`、`Runtime.Core`、`Runtime.Shared` 和 `Workspace.Canvas`。
- 同包携带隔离 Node 与 Python 3.11 运行时；Python 环境包含 FastMCP/MCP、Uvicorn、Pillow、pywin32 等组件。
- 包含 Microsoft Agents AI、Model Context Protocol、Semantic Kernel SQLite Vector、ONNX Runtime DirectML、Hugging Face Tokenizers 等依赖。
- 包含 CAD/3D 查看能力，前端资源中存在 DXF、LibreDWG 和 MText worker，同时包含 HelixToolkit/SharpDX、SketchUp API 等程序集。

### 2.2 MCP 与专业软件桥接

安装配置声明了以下本机能力：

| 能力 | 传输 | 本机桥接事实 |
|---|---|---|
| SketchUp | stdio → Python → TCP | 默认连接本机 `9876` 端口 |
| Rhino | stdio → Python → TCP | 默认连接 `127.0.0.1:1999` |
| Grasshopper | SSE/MCP | 默认连接 `127.0.0.1:26929/mcp` |
| AutoCAD | stdio → Python | 独立 launcher 与专业绘图/恢复规则 |
| Photoshop | stdio → Node | 独立服务、用户数据目录与禁用遥测配置 |
| Windows | stdio → Python | 操作系统级能力，连接超时显著高于普通工具 |

这说明“插件”必须分为两个层次：Renderer 中的工具面只负责交互；真正接触外部进程、文件和专业软件 API 的部分必须位于受控 Capability Host，不能给 React 插件直接开放 Node 或 Shell。

### 2.3 Skills 与本地知识库

- `Settings/Skills` 支持动态加载，安装包包含 CAD、Rhino、Grasshopper、SketchUp、Photoshop、Windows、PPT、DOCX、PDF、XLSX、网页汇报等 Skill 目录。
- RAG 使用 `multilingual-e5-small` 本地嵌入模型与 SQLite 向量库；配置为父块最多 500 字符、重叠 80、子窗口 3、步长 2、初检 TopK 15、最终上下文 5。
- 会话具备上下文压缩与近期消息保留策略，说明长任务的稳定运行依赖摘要、证据和状态持久化，不只是扩大模型上下文。

## 3. Tanva 的采用与不采用

| JZXZ 做法 | Tanva 决策 | 原因 |
|---|---|---|
| 原生 WPF 产品外壳 | 不采用；继续 Electron + React | 复用现有 Tanva UI、画布与前端团队能力 |
| 独立 AI 助手 | 不采用 | 小T是唯一 AI 对话与编排核心 |
| 专业软件 MCP | 采用能力模型 | 是第一批本地能力的核心价值 |
| 隔离 Node/Python | 分阶段采用 | 需要版本锁、签名、完整性与资源治理 |
| 动态 Skills | 采用协议，不复制内容 | Skills 应进入小T现有知识与能力治理体系 |
| 本地 RAG | 采用 | 项目私有资料、离线检索和证据引用价值高 |
| 独立无限画布 | 不采用 | Tanva 画布已经是唯一项目与产物事实面 |
| 更新通道 | 采用机制，不采用其服务 | Tanva 必须拥有自己的签名、发布与回滚体系 |

## 4. 开源替代路线

不能因为安装包可解压就直接再分发其中的桥接代码。首选可审计的上游开源项目，并在锁定版本、许可证清单、SBOM、签名与回归测试完成后才进入 Tanva 分发包。

| 方向 | 候选 | 当前判断 |
|---|---|---|
| SketchUp | [zinin/sketchup-mcp2](https://github.com/zinin/sketchup-mcp2) | MIT；Python MCP + Ruby 扩展，默认回环端口；任意 Ruby 执行必须保持关闭并逐次授权 |
| Rhino/Grasshopper | [EaseHee/rhino-mcp](https://github.com/easehee/rhino-mcp) | MIT；支持无头 `rhino3dm` 与 Rhino 8 C# Bridge 两种模式，适合作为跨平台优先候选 |
| AutoCAD | [beiming183-cloud/AutoCAD-MCP](https://github.com/beiming183-cloud/AutoCAD-MCP) | MIT；同时覆盖 Windows 原生 AutoCAD 与跨平台无头 DXF，强调事务与交付证据 |
| Photoshop | [ajfonthemove/photoshop-mcp](https://github.com/ajfonthemove/photoshop-mcp) | 本机 stdio，macOS AppleScript / Windows COM；工具参数可能执行脚本，必须增加审批和输出目录约束 |

开源许可证允许使用不等于可以直接上线。每个候选仍需完成：commit 固定、许可证复核、依赖漏洞检查、网络与文件权限审计、危险工具禁用、真实应用版本矩阵和最终分发法务确认。

## 5. Tanva 分阶段实现

### 已落地：桌面连接基础

- `tanva.desktop-connectors` 作为第二个可信内置插件注册；
- Electron Main 通过白名单 IPC 检测、手动指定并启动 SketchUp、Rhino、Grasshopper、AutoCAD、Photoshop；
- 配置保存在 Electron `userData/connectors.json`，Renderer 不获得文件系统或任意 Shell；
- 小T获得 `open_desktop_connectors` 宿主工具，只能打开管理工具面，不能静默启动外部应用；
- UI 把“应用已找到”和“MCP 已连接”分开；用户可导入无密钥 stdio 配置，Main 使用官方 MCP Client 完成握手并展示真实工具；
- 小T通过 `query_desktop_tools` 按需读取真实工具名、风险和 schema，再用 `call_desktop_tool` 请求执行；Main 每次显示原生确认，用户取消时绝不调用；
- 工具结果只回传受限文本；二进制、内联 URL、长 base64 和超长结果被清除或截断；
- “扩展”中只有需要配置的连接器提供一个“管理”入口，Tanva 画布继续只由小T按需唤起。

### 已落地的 Capability Host 基础与下一步

1. 已实现 stdio 生命周期、工具发现、四级风险分类和逐次确认；下一步补 Streamable HTTP，旧 SSE 仅作兼容；
2. 为每个连接器固定来源、版本、哈希、命令、环境变量白名单与输出根目录；
3. 把当前通用结果文本升级为结构化回执：目标文档、前后版本、输出资产、日志和重试语义；
4. 将 Main 内的 host 迁移到 Utility Process，外部服务崩溃不得影响窗口生命周期；
5. 产物进入当前任务绑定的 Tanva 项目，图片/视频/设计 JSON 仍只保存远程引用；
6. 为真实专业软件建立只读、写入、撤销、保存和导出的版本矩阵验收。

### 后续：本地 RAG 与运行时

- 项目级知识库，索引按用户、团队、项目隔离；
- 本地嵌入与向量库可选，云端同步需显式授权；
- Node/Python 运行时独立于 Electron Renderer，按插件版本锁定并可完整卸载；
- 安装、升级、回滚、崩溃、资源占用和工具调用统一进入审计记录。

## 6. 完成定义

“拥有 JZXZ 能力”不能以显示五个软件图标为完成标准。至少要同时满足：

1. 真实连接并列出工具；
2. 小T可在当前任务中请求工具，但未经授权不能执行高风险动作；
3. 写入动作可定位目标文档并返回可验证证据；
4. 失败可诊断、可重试、不重复执行或扣费；
5. 外部进程崩溃不拖垮小T、画布或主窗口；
6. 安装包有许可证清单、SBOM、签名、版本锁和撤销机制；
7. 所有结果回到当前 Tanva 项目，不产生第二套项目事实。
