# 图片对比节点

## 来源与行为

本地复用 `TapCanvas-pro/apps/web/src/canvas/imageCompare/` 的图片对比能力，适配 Tanva React Flow 节点、主题和中英文界面。

- 节点类型 `imageCompare`，单输入 `images` 支持多条图片入边，无输出、无需运行、零积分。
- `compareMode`: `side`（默认并排，最多四列）、`slider`（滑动分割）、`overlay`（透明度叠加）、`toggle`（按住/固定图 2）。非并排模式使用前两张输入。
- 默认 `splitPercent=50`、`overlayOpacity=50`、`boxW=480`、`boxH=320`。
- 添加面板、图片快速连接和多选工具栏可创建节点。多选入口保留原节点，创建新对比节点并连线。
- 使用共享图片解析读取上游当前资源：支持单图、多图指定输出、抽帧、image 透传、ImageSplit 裁剪。删除连线或更新上游立即反映到预览。

## 持久化与目录

节点不保存输入图片副本，只保存展示参数和尺寸；远程引用与裁剪参数仍属于原图片节点。裁剪预览产生的临时 Blob URL 仅在组件内使用、释放，不写设计 JSON。节点经统一错误边界注册。

前端 fallback 和后端初始化/同步目录均声明免费 `imageCompare`；旧后端没有该配置时，画布会补齐本地非模型节点目录。小T能力协议声明多图输入及无需运行，不纳入媒体生成节点集合。

## 验证与交付

- `npm run test:image-compare`：13 项共享图片/比较输入解析测试通过，覆盖裁剪、多图句柄、ImagePro 当前资源和历史分割端口。
- `node --test src/services/agentCanvasProtocolContext.test.ts`：8 项既有能力协议回归通过。
- `npm run verify:image-compare`：真实 React Flow 组件的四模式、指针/键盘、上游更新、裁剪像素、主题、参数刷新恢复及断线空态通过。修复初次测量宽高为 0 导致节点不可见。
- 前后端构建通过；新增文件局部 ESLint 通过。全量前端 lint 仍有既有错误（2561 errors / 199 warnings）；FlowOverlay 与 HEAD 单独比较均 674 errors / 19 warnings，本改动未增加该文件告警。
- 参数结束操作通过 `flow:updateNodeData.historyLabel` 在宿主合并后记录撤销快照；聚焦复用 `flow:focus-node` 与 CanvasStore 同步。多选创建与撤销集成经过代码审查，组件验证未挂载完整 FlowOverlay/项目自动保存服务。
- 项目约定的 `~/.codex/Skills/ai-metadata-sync/scripts/sync-repo.mjs` 本机不存在，未执行该元数据同步脚本。

仅本地代码修改，未部署。
