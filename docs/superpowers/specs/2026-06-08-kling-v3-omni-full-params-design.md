# Kling v3 Omni 全参数补全（画布节点 → 后端 → new-api/apimart）

日期：2026-06-08

## 背景与目标

照着 apimart `kling-v3-omni` 文档（https://docs.apimart.ai/cn/api-reference/videos/kling-v3-omni/generation），
把画布上 omni 对应节点（`KlingO3VideoNode.tsx`，provider `kling-o3`）的能力补全到文档的全部参数与模式，
并保证这些参数一路下发到 new-api（apimart adaptor）。

apimart 普通线路视频统一走 new-api `/v1/videos` → apimart adaptor。new-api 的 `TaskSubmitReq.UnmarshalJSON`
只解析固定顶层字段，**未知顶层字段会被静默丢弃**；apimart `payload.go` 会把所有非 internal 的 `metadata`
键经 Extras 透传成上游 body 顶层字段。所以 omni 的高级参数**必须走 `metadata`**。

## 文档参数 vs 现状（差距）

已支持：`prompt` / `image_urls`(image,images) / `aspect_ratio` / `duration` / `mode`(std,pro) /
`image_with_roles`(first_frame,last_frame) / `video_list` / `audio`。

需补：
1. `negative_prompt`
2. `duration` 上限 15（现 omni 前端封顶 10）
3. `mode: "4k"`（现前端仅 std/pro）
4. `image_with_roles` 的 `reference` 角色（现参考图走裸 `image_urls`，未打 role）
5. `multi_shot` / `shot_type` / `multi_prompt`（仅 Tencent 历史路径有，omni 链路没有）
6. `element_list`（命名角色 @name，**后端历史从未真正实现**，需按 apimart 文档新做）

注：`watermark` 经评估后**不做**——产品方明确不要水印（2026-06-08 用户决定）。

计费：omni（`kling-o3-video`）为固定 600 积分（`resolveKlingModelCredits` 对 kling-o3 直接返回默认值，
无 dynamicPricing）。故 4K / 15s / 多分镜均不影响计价，**本次不动计费**。

## 关键事实（调研结论）

- 现 omni 后端集中在 `video-provider.service.ts`：`buildKlingApimartParams()`（构造 kling 专属字段）+
  `createNewApiVideoTask()`（拼 payload，metadata 合并）。
- omni 是固定 600 计费，4k/15s/多分镜不需要新增计费档（与 kling-3.0 不同）。
- `multi_prompt` 历史逻辑：`parseTencentKlingCustomStoryboardShots()`（1~6 镜、index 递增、duration≥1、
  总时长=任务时长校验）+ `buildTencentKlingStoryboardExtInfo()`（single/intelligence/customize → multi_shot/
  shot_type/multi_prompt）。可复用校验，输出改写进 omni metadata。
- `element_list` 后端全仓无实现；前端 `elementImg` 桩存在但仅并进参考图。
- omni 节点（`KlingO3VideoNode`）已自动判模式：text / image(首尾帧) / reference(≥3图或 elementImg) / video。

## 设计

### 后端

`VideoProviderRequestDto` 新增字段：
- `negativePrompt?: string`
- `elementName?: string` / `elementDescription?: string`（最小单角色 UI 用）
- 复用已存在的 `klingStoryboardMode` / `klingStoryboardScript`
- `mode` 类型放开到 `'std' | 'pro' | '4k'`

`buildKlingApimartParams()`（omni 分支）输出 metadata 扩展：
- `negative_prompt`：来自 `options.negativePrompt`（trim 非空才发）。
- `mode`：放开接受 `4k`（仍由顶层 `mode` 字段下发，omni 已知字段）。
- `image_with_roles` 的 reference 角色：当判定为参考图模式（`videoMode` 非 frame 且 `image` 图 ≥1，
  或显式 reference）时，把这些图标 `{url, role:"reference"}` 经 `image_with_roles` 下发，并清空顶层
  `image/images`（与 image_urls 互斥）。首尾帧模式仍用 first_frame/last_frame（不变）。
- `element_list`：当 `elementImg` 角色图存在时，输出 `[{name, description, element_input_urls:[...角色图]}]`。
  最小实现单角色：`name=options.elementName||"role1"`、`description=options.elementDescription||""`、
  图为全部 elementImg。**注意**：角色图与普通 image 桩分离——element_list 用 elementImg 桩，
  image_with_roles 用 image 桩，互不混用。
- `multi_shot`/`shot_type`/`multi_prompt`：复用 storyboard 解析：
  - `single` → `multi_shot=false`
  - `intelligence` → `multi_shot=true, shot_type="intelligence"`（需 prompt 非空）
  - `customize` → 解析 `klingStoryboardScript`（复用 `parseTencentKlingCustomStoryboardShots`，
    总时长须等于 omni `duration`）→ `multi_shot=true, shot_type="customize", multi_prompt=[...]`
  - 全部写进 metadata。

`createNewApiVideoTask()`：
- omni 时把 elementImg 图从 referenceImages 拆出（前端用独立字段传，见前端段）。
- `resolveNewApiDuration()`：omni（kling-v3-omni）上限放到 15。

互斥/兜底（沿用文档约束，fail-closed）：
- `image_urls` XOR `image_with_roles`：用 image_with_roles 时清顶层 image/images。
- `video_list` XOR `audio`：连参考视频时强关 audio（已有）。
- element_list 与首尾帧/参考视频的组合按上游约束兜底（冲突时优先保留已选模式，记 warn）。

### 前端（`KlingO3VideoNode.tsx` + `FlowOverlay.tsx` + `videoProviderAPI.ts` 类型）

`videoProviderAPI.ts` `VideoGenerationRequest`：
- `negativePrompt?`, `elementName?`, `elementDescription?`，`mode` 放开 `'std'|'pro'|'4k'`。

`KlingO3VideoNode.tsx` 新增控件：
- 负向提示词输入框。
- 时长选项：参考图/视频参考场景扩到 15s（文/首帧仍 5/10 由上游约束决定，保持现状）。
- 画质模式：std / pro / 4K 三档（无图/有图均可选，4K 仅 omni）。
- 分镜（storyboard）：模式下拉（单镜头 single / 智能分镜 intelligence / 自定义 customize），
  customize 显示 JSON 脚本框（沿用 Tencent 历史最小 UI，占位示例 `[{"index":1,"prompt":"...","duration":2}]`）。
- 角色（element_list）：elementImg 连图时显示「角色名 + 角色描述」两个输入框（单角色）。

`FlowOverlay.tsx` 发送 kling-o3 请求时带上：`negativePrompt`、`mode`(含 4k)、
`klingStoryboardMode`、`klingStoryboardScript`、`elementName`、`elementDescription`，
并把 elementImg 连接的图作为独立角色图集合下发（与 image 桩参考图分开）。

## 不做（YAGNI / 本次范围外）
- 多角色 element_list 编辑器（先单角色；后端结构按数组留口，未来可扩多角色）。
- 4K/15s/分镜的差异化计费（omni 固定 600，业务未要求）。
- Kapon / Tencent 老链路改造（已弃用，仅作为字段契约参考）。

## 验证
- 后端 `tsc -b`（或后端 build）通过；前端 `tsc -b` 通过。
- 真机各模式各发一单确认 new-api 透传：negative_prompt / 4k / 15s / reference 角色 /
  intelligence 分镜 / customize 分镜 / 单角色 element_list。
