# Kling 3.0 节点恢复「多图参考 + 分镜」能力（经 new-api 调用 kapon/tencent）

日期：2026-06-08

## 背景

「Kling 3.0」画布节点（`GenericVideoNode` 系，`klingModel: "kling-v3-0"`）当前在
`FlowOverlay.tsx:18460` 被强制发 `provider: "kling-o3"`，后端
`video-provider.service.ts:1383` 解析成 apimart `kling-v3-omni`。迁移到 new-api 时，
历史在 kapon / tencent 渠道上做过的两项 Kling 能力丢失了：

1. **多图 / 多主体参考**（3–7 张参考图）
2. **分镜 storyboard**（智能 / 自定义多镜头）

此外 kapon 直连路径 `generateKling26` 把时长写死 `=== 10 ? "10" : "5"`，这是 v2 时代的
旧限制，对 v3 是错误的（官方 v3 支持 3–15）。

## 目标

在 **new-api 路由**上恢复上述两项历史能力，并修正时长。new-api 通过其 channel 配置
把请求落到 **kapon**（普通线）或 **tencent**（尊享线）上游——channel 配置与上游字段映射
属 new-api 仓库工作（"让 new-api 补全对应逻辑"）；本仓库（Tanva）负责节点 UI、参数透传、
线路标记。

### 明确不做（历史从未实现，按"没做过先不做"剔除）

`negative_prompt`、`cfg_scale`、`camera_control` 运镜、运动笔刷(dynamic/static mask)、
`4k` 模式、`element_list` 命名 @ 引用。kapon 的 `generateKling26` / `generateKlingO1` 全程
未发过这些；不在本次范围。

### 范围边界

- 参考视频 / 视频编辑（omni `video_list`）仍归 **Kling O3 节点**（`KlingO3VideoNode`），
  本次不动；Kling 3.0 节点专注 文生 / 单图 / 首尾帧 / 多图 / 分镜。
- 不复活后端直连 `generateKlingViaTencent` 路径（它仍被 `shouldRouteVideoToManagedTencent`
  对 kling 关闭）；tencent 仅经 new-api channel 到达。本次只是让 Kling 3.0 节点能"标记走
  尊享线"，由 new-api 落到 tencent channel。

## 历史能力 × 渠道支持矩阵（基于本仓库历史代码实证）

| 能力 | kapon（可灵官方代理） | tencent（腾讯 VOD AIGC） |
|---|---|---|
| 文生 / 单图首帧 / 首尾帧 / 声音 | ✅ `generateKling26` | ✅ `generateKlingViaTencent` |
| 多图 / 多主体参考 | ✅ `image_list`（标准≤4 / omni≤7 可标 first/end_frame） | ✅ `fileInfos` usage=Reference |
| 分镜 storyboard（智能/自定义） | ❌ **无** | ✅ 仅 3.0 家族（`extInfo.AdditionalParameters`） |

→ **分镜只有 tencent 支持**，故分镜能力仅在"尊享线"开放。

## 时长（按模型版本，非按渠道；修正旧硬编码）

官方可灵规则按版本：v1/v2.x（含 v2-6）只有 5/10；**v3 为 3–15 秒**（整数），多镜头总时长≤15、
每段≥3。Kling 3.0 = v3，**两条线路都应是 3–15**。需修掉 kapon 路径对 v3 的 5/10 硬编码。

约束：
- 连参考视频时收窄到 3–10（本节点不涉参考视频，omni 节点另管）。
- 自定义分镜：各段时长之和 = 总时长；段数 1–6；每段 prompt ≤512 字。

## 设计

### 1. 线路选择（普通 kapon / 尊享 tencent）

- 复用现有 `managedRoutes / vendors` 基建（`frontend/src/components/flow/managedRoutePricing.ts`），
  为 Kling 3.0 节点重新放开 tencent vendor 作为"尊享线"选项；默认普通线（kapon）。
- 节点统一走 new-api；所选线路经 `vendorKey` / `platformKey` 标记下发，new-api 据此选 channel。
- **分镜控件仅在选「尊享线」时渲染并生效**；普通线隐藏分镜（满足"只在 tencent 开启"）。

### 2. 多图 / 多主体参考（两条线路都支持）

- 前端：Kling 3.0 节点允许 image 桩连接 3–7 张参考图；沿用现有「按图片数量自动判模式」
  （1 图=首帧、2 图=首尾帧、≥3 图=多图参考），加数量上限提示（>7 警告）。
- 后端 `createNewApiVideoTask` / `buildKlingApimartParams`：≥3 图时以多图参考意图下发
  `image_list`（而非仅 image/images 首尾帧），由 new-api 映射到上游（kapon `image_list` /
  tencent `fileInfos` Reference）。具体上游映射属 new-api。

### 3. 分镜 storyboard（仅尊享线 tencent）

- 复用既有 DTO 字段 `klingStoryboardMode`（single/intelligence/customize）与
  `klingStoryboardScript`（自定义脚本 JSON），无需新增 DTO 字段。
- 复用既有校验 `parseTencentKlingCustomStoryboardShots`（1–6 段、index 递增、duration≥1、
  总时长=任务时长）与 `buildTencentKlingStoryboardExtInfo` 的语义；输出经 metadata 下发到
  new-api（`multi_shot` / `shot_type` / `multi_prompt`），由 new-api 映射成 tencent
  `extInfo.AdditionalParameters`。
- 前端：分镜编辑器（仅尊享线显示）：
  - 模式：单镜头 / 智能分镜 / 自定义分镜。
  - 自定义：分镜脚本编辑（数组：序号 / 提示词 / 时长），实时校验各段之和=总时长。

### 4. 时长修正

- `resolveNewApiDuration` 对 kling-v3 放开到 3–15。
- 修掉 kapon `generateKling26` 对 v3 的 `=== 10 ? "10" : "5"` 硬编码（v3 走 3–15；v2-6 保持 5/10）。
- 前端时长选项：Kling 3.0 给 3–15 整数（不再 5/10）。

### 5. 涉及文件

- 前端：`GenericVideoNode.tsx`（线路选择、多图提示、时长 3–15、分镜编辑器）、
  `FlowOverlay.tsx`（provider/vendor 标记与新字段下发）、`videoProviderAPI.ts`（请求类型）、
  `managedRoutePricing.ts`（放开 Kling 3.0 的 tencent vendor）。
- 后端：`video-provider.service.ts`（`createNewApiVideoTask` 多图 image_list / 分镜 metadata /
  时长；kapon 路径时长修正）、`video-provider.dto.ts`（无需新增，复用现有字段）。

### 6. 路由切换（关键）

- `FlowOverlay.tsx:18460`：Kling 3.0（kling30/klingVideo 节点 + `klingModel==="kling-v3-0"`）
  不再无条件发 `provider:"kling-o3"`；改为按线路：普通线发能解析成标准 Kling 的 provider，
  尊享线带 tencent vendor 标记。具体 provider/vendor 取值在实现期对照 `resolveNewApiVideoModel`
  与计费 `resolveVideoBillingChannel` 确定，确保：(a) 命中正确上游能力；(b) 计费按
  `managedModelKey:"kling-3.0"` 取价不变。

## 依赖（new-api 侧，非本仓库）

- new-api 需有 **kapon Kling channel**（多图）与 **tencent Kling 3.0 channel**（分镜），
  并把本仓库下发的 `image_list` / `multi_shot`·`shot_type`·`multi_prompt` 映射到各上游请求体。

## 风险 / 待验证

1. **多图（无命名）在各上游的真实落地**：kapon `image_list` / tencent `fileInfos` 均支持，
   但 new-api 适配是否就绪需联调确认；我们按 image_list 意图发，落地由 new-api 补。
2. **线路标记如何让 new-api 选 tencent**：依赖 new-api channel 配置（model-key 或 vendor 维度），
   实现期需与 new-api 配置对齐；若暂无可用 tencent Kling channel，则分镜先灰度关闭、多图先上。
3. **计费不回归**：切换 provider/vendor 后须确认 `kling-3.0` 计费仍按 modelKey 取价。

## 验证

- 后端 build / 前端 `tsc -b` 通过。
- 普通线：文生 / 单图 / 首尾帧 / 多图（3–7）/ 时长 3–15 各发一单，确认 new-api 透传。
- 尊享线：上述 + 智能分镜 + 自定义分镜（含总时长=各段之和校验），确认落到 tencent。
- 计费预览与实际扣费一致（modelKey kling-3.0）。
