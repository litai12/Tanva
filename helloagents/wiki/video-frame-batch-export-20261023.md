# 视频抽帧批量导出与 Markdown 分镜表

## 行为

- 视频抽帧节点在已有抽帧结果下提供“下载全部帧 ZIP”和“展开为 Image 节点”。两项均遵循“输出选择”：全部、指定单帧或包含起止帧的范围，并显示实际数量。
- “全部帧”指按抽帧间隔提取并上传的全部图片，不表示逐视频编码帧解码。下载与展开均使用 `frames[].imageUrl` 原图引用，不使用预览缩略图。
- ZIP 按帧号与毫秒时间戳命名，保留图片原始字节和格式。下载显示逐帧进度并防止重复受理；任一帧读取失败时不下载残缺 ZIP，提示具体失败帧。临时下载 Object URL 在点击后释放；ZIP 在浏览器内存中组装，不人为截断帧数。
- 展开将当前选择一次创建为多个独立 `image` 节点，以四列网格放在抽帧节点右侧并避让已有节点，节点名包含帧号和时间戳。保留独立原图远程引用与来源元数据，改变抽帧节点当前选择不会替换已展开图片；无需重新上传或生成图片。批量操作沿用项目保存、新节点协作广播和单次撤销。
- 多帧 `images` / `images-range` 仍可连接 `ImageGrid`；需要多张独立图片时使用展开按钮。`Image` 的单图输入和单帧 `image` 连线合同保持一致。

## 分镜表修复

- `parseStoryboardAnalysis` 在没有原有结构化镜头块时识别真实 Markdown 表头与分隔线，忽略前置说明、围栏和重复表头，支持动态列、转义竖线与 `<br>` 单元格换行。
- `TextPromptNode` 使用 `resolveStoryboardPromptTable` 在本地恢复明确属于旧版误解析的缓存（竖线伪列或单个“分析结果”降级列）。正常缓存与手动编辑仍优先，原文字保留，不重新调用视频分析模型。

## 实现与验证

- `VideoFrameExtractNode.tsx`：导出/展开入口、下载状态。
- `videoFrameSelection.ts`：统一选择规则；使用真实帧号归一化无效、反向及过期范围，不依赖可能过期的 `totalFrames`。
- `videoFrameDownload.ts`：读取原图字节、构建 ZIP 与下载资源回收。
- `videoFrameImageNodes.ts` / `FlowOverlay.tsx`：批量快照、避让布局、持久化与历史接入。先归一化并校验所有帧引用，禁止把运行期内联资源写入设计 JSON。
- 单元回归：`cd frontend && npm run test:video-frames && npm run test:storyboard-prompt-table`。
- 浏览器回归：`cd frontend && npm run verify:video-frames`，使用隔离项目与本地图片夹具，不调用付费接口。
- 验证结果：15 项帧选择/ZIP/布局测试与 13 项分镜表测试通过。完整生产 `FlowOverlay` 浏览器回归通过，覆盖全部六帧、范围 2–5 与单帧 6 的 ZIP 原始字节、真实 Image 创建、项目内容保存与重载、一次撤销/重做、网络失败提示及成功重试，无页面异常。
- 浏览器验证发现新帧节点的初始尺寸测量会额外写撤销快照；现仅对帧快照节点跳过纯观察器测量的历史提交，明确的用户尺寸调整仍记录历史。稳定后验证批量展开只产生一条历史。
- 前端生产构建通过；仓库全量 ESLint 存在既有错误，新增辅助模块及测试定向 ESLint 通过。

## 101 发布

- 代码提交 `354ae09c1f925b3c7f2054ed55d2c3fc6755994c` 已在 origin/main 与 101 源码中核对一致。2026-10-23 01:22（America/Los_Angeles；UTC 08:22）完成前端静态发布。
- 使用 `git archive` 提取该提交创建隔离源码，以 `GITHUB_SHA` 构建正式发布包；28 项单元测试、完整生产 FlowOverlay 浏览器回归及 TypeScript/Vite 构建均通过。
- 发布目录 `/opt/tanva-releases/video-frames-20261023-354ae09c/`，旧版备份 `/opt/tanva-backups/video-frames-20261023-354ae09c/frontend-dist/`。发布锁内核对线上旧版本与源码，校验全部 48 个文件 SHA-256 后逐文件原子替换，最后切换页面与版本入口，保留旧 hash 资源。
- 本机与 101 分别验证公网 `https://tanvas.cn/`、`/assets/index-2WLA9fCZ.js`、`/assets/index-B9xCGxLI.css`、`/version.json` 与发布包哈希一致；`commitSha=354ae09c1f92`，内外网 `/api/health.status=ok`，旧 `/assets/index-Bfg0uJCg.js` 仍可访问。
- 发布目录保存构建包、清单、`deployment.json` 与 `public-acceptance.json`。功能验收使用隔离源码与本地夹具，线上验收为静态资源、版本与健康核验。本次未重启后端、修改数据库或重跑用户生成任务。
