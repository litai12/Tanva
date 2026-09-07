# JZXZ 1.1.15 复刻对照

## 参考证据

目标安装包为 `jzxz_pc_1.1.15.exe`，SHA-256 为 `f9ea58a2ccfbe0177a4b42eb9e781d2d550c17bd2ada3c92d3ded5d108d9f187`。安装包中的 WebUI 位于 `app/WebUI/`，核心交互包含新建对话、报告配置、用户/AI 消息、附件、进度、选项和宿主消息回传。安装包同时包含 SketchUp、Rhino、Grasshopper、AutoCAD、Photoshop 相关设置，以及隔离 Node/Python 运行时。

## Tanva 已对齐能力

| 参考能力 | Tanva 入口 | 状态 |
| --- | --- | --- |
| 对话任务壳 | `DesktopApp` → `ElectroReplica` → `DesktopShell` | 已接入 |
| macOS Electron 打包运行 | `frontend/release/mac-arm64/Tanva.app` | 已通过 renderer-ready 冒烟检查，汇报工具面可实机打开并操作 |
| JZXZ 对话排版 | `jzxzDesktop.css` 作用于桌面线程和嵌入式聊天 | 已接入 |
| 新建对话并保留配置 | `DesktopTaskThread` 的“新建对话（保留已选技能）” | 已接入 |
| 修改助手配置 | `DesktopTaskThread` → `tanva:open-report-builder` | 已接入 |
| 作品汇报配置器 | “修改配置”打开 `tanva.report-builder`，素材/章节/展示形式/语言/风格/动画/演示者模式并提交生成；支持自定义排版/文字/色彩、多选动画、教程/示例、配置 JSON 和大纲 Markdown 下载；导入后读取图片尺寸/方向、视频尺寸/时长并给出效果图/图纸/分析图等内容角色提示，再进入生成提示词；生成时显示阶段进度 | 已接入 |
| 汇报生成模型与结构编辑 | 生成模型按会话保存并在提交时生效；按项目类型提供参考包对应的建筑 8 章、室内/景观/规划 7 章和通用结构，旧版五章会话自动迁移；切换项目类型会重置章节模板并清理素材的旧章节绑定；章节支持启停、改名、提示、上下移动和删除；示例在内嵌预览层打开 | 已接入 |
| 项目工作文件夹 | 选择本机工作文件夹后，小T 可列出/读取项目文件，并在确认后写入生成的文本交付 | 已接入 |
| AI 消息复制 / 复制 Markdown | `AIChatDialog` 消息操作条 | 已接入 |
| 技能选择与新会话继承 | 桌面任务头“选择技能”，设备级偏好随小T请求下发 | 已接入 |
| 本机应用发现/指定/启动 | `tanva.desktop-connectors` | 已接入 |
| 3ds Max / Revit / Illustrator / InDesign / Windows MCP | 同一连接器目录与 Capability Host | 已接入入口，真实桥接待 Windows 验收 |
| MCP 配置、连接、工具目录（stdio / HTTP / SSE） | Electron Capability Host | 已接入 |
| 本机 HTTP MCP 快速连接 | 连接器工具面地址输入；Grasshopper 默认 `http://127.0.0.1:26929/mcp` | 已接入 |
| 建筑计算与采购链 | 内置 `architecture` / `business` Capability Host：场地/面积/空间计划/BIM/装修房间与饰面工程量/材料清单/报价/预算/采购申请/订单/分批到货/拒收复验/退货补货/逐行对账/设计变更/应付交接/驳回重提/分次付款/财务收口，按项目任务隔离并幂等落盘 | 已接入 |
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

### 业务逻辑已补齐（Tanva 内置工程能力）

Electron 的 `architecture` 与 `business` 连接器现在由 Capability Host 内置承接，不依赖第三方 MCP 服务。建筑动作包含场地指标（面积、覆盖率、容积率）、空间计划、装修房间与地面/墙面/顶面饰面工程量、平面排布、建筑体量生成、剖面/立面线稿、从空间计划到工程量和材料清单的一键工作流、施工任务排程与依赖循环校验、施工进度回填与前置任务约束、现场质量检查、整改单创建/关闭与复验分流、工作流幂等重放与失败回滚、面积、显式项目规则校验、窗地比筛查、疏散/无障碍路线阈值检查、结构跨度与柱网筛查、机电负荷估算、BIM 构件版本更新、工程量提取、设计版本摘要、图纸集目录、图纸结构检查和交付包索引；供应链动作包含供应商登记、材料清单、供应商报价比较、预算、采购申请、采购订单、分批收货验收、拒收物料按数量复验为接收或退货、退货后补货、订单逐行对账、已完成订单关闭、应付交接单、应付审核、驳回或挂起后的资料修改重提、分次付款、财务交接关闭和设计变更单、变更审批。状态按现有 `projectId + accountId` 加密哈希文件原子保存，写入动作受任务绑定、版本冲突和输入几何/金额校验保护。

这些是可运行的业务逻辑与结构化结果，实际 PDF/DWG/IFC 导出、规范审查、日照模拟、真实 BIM 文件读写和专业软件桥接仍必须通过已连接的 SketchUp/Blender/Revit/Rhino/AutoCAD 等 MCP 完成，不能把结构化占位结果宣称为施工成果。

当前新增的 OBJ/IFC 导出会在 Electron 项目受控目录生成文件，并把文件加入当前项目工程状态；OBJ 可作为跨建模软件中间格式，IFC 为结构化构件交付。复杂 IFC 实体几何、属性集、签名和上传仍需专业 BIM 软件与项目资产服务完成。

建筑构件也支持 DXF 平面几何导出，便于 AutoCAD/Rhino/SketchUp 接续编辑；它输出轮廓实体，不代替专业软件中的三维实体、图框、图签和审图结果。

Blender MCP 现在支持批量接收平面房间多边形并按高度挤出网格，建筑方案结果可直接作为 Blender 的建模参数输入，减少手工重建几何的断点。

GLB 导出在没有 Blender 时也会写出合法的 glTF 2.0 二进制文件；渲染动作不会使用占位图片，必须由真实 Blender 渲染引擎执行。

工程状态同步接口为 `/api/projects/:id/engineering`，使用独立 `ProjectEngineeringState` 表、项目访问控制和乐观版本号；它不写入 `Project.contentJson`，因此不会破坏设计 JSON 的远程资源引用约束。
