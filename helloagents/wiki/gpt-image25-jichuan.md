# GPT-Image-2.5 Jichuan synchronization (2026-09-09)

User contract: sync TapCanvas's jichuan image channel to Tanva; keep Tanva prices independent of quality; expose quality selection in the existing GPT-Image-2.5 node.

## Integration

- Source: 101 TapCanvas new-api channel `jichuan-image` (id 295), type 1, https://jichuan.pro, model `gpt-image-2.5`. Only this image channel was copied; video channels and source tiered pricing were not copied.
- The shared gptImage25 palette now has Flare, Sunburst, Jichuan options. Jichuan quality options: low/high/xhigh/max, default low on selection. Both the model and quality persist in node data. Reference limit is one for Jichuan, and its 4K pixel contract is independent of GPT-Image-2's narrower 4K aspect-ratio set.
- Imported the TapCanvas pixel-normalization contract, adapted to this repository's DTO. Generation uses JSON; remote reference image requests use /v1/images/edits with an image string. Multiple references or non-HTTP(S) references are rejected before upstream. No source price-by-quality configuration was copied.
- Tanva credits: 1K=20, 2K=30, 4K=40 for every quality, even with a stable route hint. Gateway public pricing: CNY 0.2/0.3/0.4, with resolution-only specs. Stored ModelPrice copies the existing Flare entry to preserve current gateway charging conventions.
- Reusable server-local registration: new-api/patches/2026-09-09/sync-jichuan-image25.py. Credentials remain in subprocess memory, never printed or stored in source. Backups are private on 101 under /opt/tanva-backups/jichuan-image25-20260909.

## Verification and deployment

- Frontend/backend builds passed. Go DTO, OpenAI adaptor and model tests passed. A 12-case quality/resolution test verifies wire quality, URL reference handling, edits endpoint and identical token metadata across quality settings.
- Backend price checks cover all four qualities at all three resolutions with normal/stable hints. Existing-catalog upgrade and explicit-disable checks passed with all three GPT-Image-2.5 model options.
- 101 source and web assets updated; new-api rebuilt/recreated and tanvas-api reloaded. Live public node configuration includes all three models. Live gateway pricing confirms only the three resolution tiers. Live frontend bundle contains Jichuan and quality selector options.
- No paid upstream image generation was submitted; verification covers configuration, build, local request conversion/billing tests and live published assets/catalogs.

## Local revision: default max, no low (not deployed)

Per user request, Jichuan now exposes high/xhigh/max only and defaults to max. Switching to Jichuan selects max; old low/auto/missing values resolve to max in both the canvas execution path and gateway normalization. Other models keep their existing quality behavior. The registration utility now updates the Jichuan catalog quality enum/default without changing prices. This revision is local only; no server changes or Git commit were performed.

## Local revision: single frontend model (not deployed)

The GPT-Image-2.5 canvas node now uses only gpt-image-2.5 (Jichuan), with no model selector. The palette metadata and agent manifest expose only this 2.5 model. Quality remains high/xhigh/max, default max, at unchanged prices. Saved Flare/Sunburst nodes normalize to gpt-image-2.5 for both rendering and execution, including the one-reference limit. The old GPT-Image-2 node remains separate. Backend gateway channel records for the old variants are retained; no server mutation or deployment performed.

## Local fix: HTTP quality validation (2026-09-09, not deployed)

An HTTP 400 for quality=max exposed a runtime DTO mismatch: the TypeScript quality union included xhigh/max, but GptImage2Quality still accepted only auto/low/medium/high. The extra values had accidentally been added to ThinkingLevel. Move them into GptImage2Quality and restore ThinkingLevel to high/low. The shared GenerateImageDto now accepts the frontend's high/xhigh/max for both synchronous and asynchronous generation; legacy GPT-Image-2 values remain compatible. Quality choices/defaults and resolution-only pricing are unchanged.

Regression: `cd backend && npm run test:image-generation-dto` exercises the actual Nest ValidationPipe with a remote-reference image request, all three 2.5 qualities, legacy values, invalid quality rejection and thinking-level validation. Deploy by rebuilding and restarting the Tanva Nest backend; rebuilding only the new-api Docker Compose services does not update this DTO. No production request or server change was performed for this fix.

## Local revision: multiple reference images (2026-09-09, not deployed)

Removed the previously imposed one-reference limit per user correction. GPT-Image-2.5 connection checks and execution ignore stale reference limits on saved nodes; metadata uses null for no application count limit, and the node no longer displays a numeric limit. The gateway validates every remote URL, preserves order and all references, and forwards multiple references as an image array to /v1/images/edits (single references retain the string format). Quality/default and pricing are unchanged. Local tests cover 20 references through image_urls and image arrays, plus invalid remote references. Actual Jichuan multi-image acceptance still requires upstream verification; no paid generation or deployment was performed.

Validation: frontend and backend builds, catalog regression and TestJichuan gateway tests passed. Full frontend lint failed with 2,563 errors and 200 warnings across the repository (including the unrelated binary tmp_head_aiChatStore.ts); not a clean lint baseline.

## curl 实测与节点模型切换（2026-09-10）

- 使用 101 Tanva 网关及其现有普通 token，以 curl 调用 `/v1/images/generations`，模型 `gpt-image-2.5`、`size=1:1`、`resolution=1K`、`quality=max`、`n=1`、URL 响应。文生图 HTTP 200，35.960 秒，返回 1254×1254 红色陶瓷杯。
- 图生图通过相同入口传 `image_urls=[文生图远程URL]`，提示仅将杯子改为钴蓝色。HTTP 200，37.984 秒，返回 1254×1254 图片；目视确认颜色变化且杯型、桌面、构图基本保留。图像输入 usage 为 2465 tokens。两次真实生成，无自动重投。
- 文生图结果：`https://chat.velapi.cc/images/2026/09/10/1789008483_d0271fe7003907e8166617c3f5e1f08c.png`；图生图结果：`https://chat.velapi.cc/images/2026/09/10/1789008539_825b5be88c1d1440f2432f47b1dfa965.png`。服务端脱敏请求/响应保存在 `/tmp/tanva-gpt25-curl-20260910/`，凭据仅通过 curl stdin 配置传递。
- 本地 4458 尚无 Jichuan 模型渠道，返回 503 `model_not_found`；以上成功证据来自 101 网关，不代表本地渠道已同步，也不代表 Nest 异步任务端到端验收。此次仅验证 1K/Max/单参考图，不外推多图或其他质量、分辨率。
- 前端 GPT 图片节点新增 GPT Image 2 / 2.5 下拉，选项来自当前节点目录；运行中不能切换，下线型号不能选择或运行。切换同步更新 model、managedModelKey、nodeConfigKey、元数据、供应商与积分预览配置；2.5 默认 Max，切回 2 默认 Auto，清除旧参考图上限，保留已有提示词、连线与结果图。旧 Flare/Sunburst 继续归一到 Jichuan。
- 4 项回归覆盖旧节点切回 2 后的执行型号、切回 2.5 的质量与参考限制、禁用项拒绝、历史别名兼容。前端生产构建通过；全库 lint 仍为既有 2563 errors / 200 warnings。本机缺少 SSOT 要求的 AI Metadata 同步脚本。本次前端修改未发布。
- 浏览器交互验收未完成：内置浏览器连接连续超时，本地 Nest 后端未运行；不将构建或单元回归描述成浏览器端到端通过。临时启动的 Vite 已停止。

## 配套审查与 101 发布范围（2026-09-10）

- 只读比对 101 与本地的 Nest 图片 DTO、节点目录、NewApiProvider，以及 new-api Jichuan DTO、OpenAI adapter、渠道同步脚本，六个文件 SHA-256 均一致。101 公开目录当前为 `gptImage2/gptImage25` 两项正常，2.5 单型号为 `gpt-image-2.5`、默认 Max、参考图数量元数据为 null；2 的目录基础积分为 40，2.5 为 20，前端切换从各自目录取值。
- 网关 `go test ./dto ./relay/channel/openai ./model` 全部通过，覆盖尺寸归一、high/xhigh/max 与分辨率独立、远程参考转 edits、20 张参考完整转发、非法内联引用拒绝及计价。没有发现本次型号切换需要修改的 new-api 运行代码。
- 后端 `test:image-generation-dto`、`test:new-api-image-response-format`、`verify:gpt-image25-catalog`、`verify:image-pricing` 及生产构建通过。补充 Jichuan 本型号的 high/xhigh/max 文生/多 URL 图生请求、stable/ultra 均使用普通 token、非法 data URL 拒绝测试；这些是无上游收费的契约回归，不等于实际多图出图验收。
- 改动前后两个前端组件的 ESLint 规则/消息计数一致（FlowOverlay 693、Nano2Node 7），无新增问题；模型切换工具及其测试文件 lint 为 0。
- 本次配套补充仅涉及测试和文档，生产运行改动集中在前端。101 已有 Jichuan 渠道，本次不需要重跑迁移、复制渠道、重建 new-api 或重启 Nest。实际 Nginx 静态根目录为 `/www/wwwroot/tanvas.cn/frontend/dist`，网关 Compose 为 `backend/docker-compose.yml` 中的 `new-api`，Nest 进程名为 `tanvas-api`，后两者本次无需操作。
- 用户同步提交至 101 后，按现有发布流程备份静态文件，并在 `/www/wwwroot/tanvas.cn/frontend` 执行 `npm run build` 更新 dist；刷新页面验证同一节点可 2→2.5→2，2.5 默认 Max、2 默认 Auto，提示词/连线/已有结果保留。此次未替用户提交或部署。


## 最终修复：三个真实型号切换（2026-09-10，覆盖此前仅发布前端结论）

用户实际需要在 2.5 的 Flare/Sunburst/基础型号间切换。此前 2/2.5 切换误解及单型号归一方案已废止。现在选项显示 `gpt-image-2.5`、`gpt-image-2.5-flare`、`gpt-image-2.5-sunburst`，不展示 Jichuan 品牌，GPT Image 2 仍可选择。

- 显式保存型号不被节点键覆盖；只有型号缺失时才用旧 gptImage25Flare/gptImage25Sunburst 恢复对应型号。保存 JSON 再恢复仍保持真实型号。
- 前后端目录恢复三型号；公开目录在启停判定前升级旧 singleton modelKeys，再按后台独立 enabled 标志过滤，全部禁用时隐藏节点。各型号提供独立 managedRoutesByModel，预览与切换不再借用基础型号路由。
- Flare/Sunburst 隐藏基础型号质量控件，前端执行与后端 Provider 都省略质量，防止历史 max/xhigh 泄漏。基础型号仍为 high/xhigh/max，默认 Max。2.5 三型号不再误用 GPT Image 2 的 4K 宽高比限制；远程参考完整保留。
- curl 在 101 对 Flare 文生/图生、Sunburst 文生/图生各调用一次，全部 HTTP 200，分别 37.956 / 42.926 / 43.123 / 53.478 秒。请求均为 1K、1:1、n=1，图生使用此前红杯远程 URL。未自动重投。响应记录 `/tmp/tanva-gpt25-variants-20260910/`。
- Flare 文生结果 `https://files.toapis.cn/images/tsk_img_01M24M98GDAWKNGKBCBZD1E52M/1789009401_559fd5d8.png`；图生 `https://files.toapis.cn/images/tsk_img_01M24M98AE1B8NFSQ2DPCMWF72/1789009407_caad7696.png`。
- Sunburst 文生结果 `https://files.toapis.cn/images/tsk_img_01M24M98A6MMFSMV9A28HX4WGM/1789009406_3962d0ae.png`；图生 `https://files.toapis.cn/images/tsk_img_01M24M98JXQH69VG72DC40KNXN/1789009418_97472630.png`。
- 六项前端回归通过：切回 2、切回基础 2.5、禁用拒绝、Flare/Sunburst JSON 保存恢复、旧节点缺失型号恢复、三个精确标签及独立路由。后端目录回归覆盖旧 singleton 升级、单型号禁用、仅 Sunburst 可用、全禁用；Provider 回归覆盖真实型号保留、质量剥离、远程输入和普通 token，DTO/价格回归通过。

**发布必须包含前端和 Nest 后端**：用户提交并同步 101 后，分别在 backend 和 frontend 执行 `npm run build`，后端执行 `pm2 reload tanvas-api --update-env`。新版本后端公开目录会兼容旧记录，启动初始化也更新节点默认目录；无需新增 SQL 或重跑渠道迁移。new-api 四次实测通过，此次未改其源码，不需重建容器。此前“只发布前端”仅适用于已废止的 2/2.5 切换方案，不适用于本次修复。浏览器交互未验收，部署后检查三个型号切换及刷新保留。提交与部署由用户执行。


最终验证补充：前端模型回归与小T图片补丁合同合计 14 项通过；Nest 构建通过。全库 lint 为 2563 errors / 200 warnings，与既有数量一致。Flare/Sunburst 图生结果已目视确认均为蓝色杯子、原背景与构图基本保留。执行入口也校验最新目录可用型号，组运行/小T调用不会绕过按钮禁用；不可用时明确失败，不静默切换。此次未完成浏览器交互验收，未提交或部署 101。

前端最终 `npm run build` 成功（Vite 35.49 秒，保留既有大包提示），`git diff --check` 通过。


## 选择器样式对齐（2026-09-10）

GPT 模型菜单复用 `NodeSelect`，与 Seedance 模式/分辨率共用主题、圆角、选中标记和 Radix 弹层。新增可选 disabled/onOpenChange；生成中禁止开启/切换，打开模型菜单关闭已有宽高比/分辨率/质量菜单。保留原型号、下线提示及切换逻辑。

验证：前端生产构建通过，6 项模型切换回归通过；NodeSelect 的 lint 为 0，Nano2Node 保持既有 7 项且无新增规则/消息；git diff --check 通过。此次样式调整仅需更新前端，未提交或部署。
