# 设计：vidu/kling 视频去除前端固定腾讯渠道，跟随令牌走 new-api

日期：2026-06-03

## 目标

vidu、kling 之类视频模型不再在前端把渠道固定为腾讯（`tencent_vod`），改为自动跟随令牌：请求走到 new-api，由 **new-api 自带的渠道选择按线路调用对应上游**（apimart / ark / tencent-vod channel）。

## 背景（已验证的代码事实）

- 后端 `backend/src/ai/services/video-provider.service.ts` 的 `generateVideo()` 调用 `shouldRouteVideoToManagedTencent()`：
  仅当请求显式带 `vendorKey/platformKey === "tencent_vod"` 时，vidu/kling 才走腾讯 VOD 直连 (`generateVideoLegacy` → `generateKlingViaTencent`/`generateManagedVidu` → `TencentVodAigcService`)；否则一律走 `createNewApiVideoTask()` → `POST /v1/videos`，由 new-api 的分发器自行按令牌选渠道。
- 因此"固定腾讯"完全来自**前端**把 `vendorKey/platformKey` 置为 `tencent_vod`。来源：
  1. 前端 `managedRoutes`（admin 配置，含 `tencent_vod` vendor + `defaultVendor`）；
  2. `GenericVideoNode.tsx` 自动选路 effect（1503-1527）把 `defaultVendor` 写入 `data.vendorKey`；
  3. `KlingO3VideoNode.tsx` 的 `isTencentRoute`（353-356）在无 vendorKey 时**默认 true**；
  4. `FlowOverlay.tsx` 节点创建时 `getManagedRouteOption`（10642-10653）把 vendor 写入 `data`。
- 腾讯专属耦合功能：
  - kling-o3 **分镜 storyboard**：仅 `generateKlingViaTencent` 有 `buildTencentKlingStoryboardExtInfo`，new-api `/v1/videos` 无对应能力；
  - kling-2.6 **首尾帧第二张图**：`canUseKlingImage2Input = isKling26Model && (isProMode || isTencentKling26Route)`；
  - kling-o3 **时长**：腾讯 15s / new-api 10s。

## 用户决策

- **完全移除腾讯线路**：vidu + kling-2.6/3.0 + kling-o3 全部走 new-api 自动选渠道。
- kling-o3 **舍弃分镜 storyboard**。
- kling-2.6 首尾帧 **解除腾讯门控，保留"仅 pro 模式可用"逻辑**：`canUseKlingImage2Input = isKling26Model && isProMode`。

## 方案

### 前端（主改动）

1. **统一清洗器** `sanitizeVideoManagedRoutes`（新增于 `frontend/src/components/flow/managedRoutePricing.ts`）：
   - 过滤掉 `vendorKey === "tencent_vod"` 的 vendor；
   - 若 `defaultVendor` 被过滤，改写为剩余首个 vendor；
   - 节点数据里的 `vendorKey/platformKey === "tencent_vod"` 一律按空处理；
   - 0 vendor 时返回 `null`（回退到 `data.creditsPerCall`/后端积分预览），但清空陈旧 tencent vendorKey 以免命中旧腾讯计价。
   - 所有消费点统一调用，避免散落删字段。

2. **`GenericVideoNode.tsx`**：
   - 选路/计价/预览统一经清洗器（不自动选、不展示、不发送腾讯）；
   - 移除 `isTencentKling26Route`；`canUseKlingImage2Input` 改为 `isKling26Model && isProMode`；
   - 修正 2662-2673 依赖该变量的 UI 文案为非腾讯文案。

3. **`KlingO3VideoNode.tsx`**：
   - 移除 `isTencentRoute`（含默认 true 分支）；
   - **删除**整套 storyboard 面板 / 上传 handler / state / 运行时校验；
   - **容忍**老项目水合时存在 `klingStoryboard*` / `uploadedStoryboard*` 字段（忽略、不崩溃，不参与请求）；
   - `hasVideoInput` 不再含 storyboard 视频；时长上限 15s → 10s。

4. **`FlowOverlay.tsx`**：
   - 节点创建 seeding（10642-10653）、`managedRoutePayload`（19049-19065）、时长计算（18331-18343/18358）三处统一用清洗结果，绝不写入/发送 `tencent_vod`；
   - 删除 `isTencentKlingO3Route` / `isTencentKling26Route` 及 storyboard 校验块（19083-19202）与 storyboard payload（19314-19320）；
   - 简化 sound 逻辑（移除腾讯分支）。

### 后端（防御性，确保"完全移除"）

5. **`video-provider.service.ts`** `shouldRouteVideoToManagedTencent`：
   - 对 `NEW_API_VIDEO_MODEL_KEYS` 内所有模型一律 `return false`（删 vidu/kling `explicitTencent` 例外），使即便有陈旧 `tencent_vod` 节点数据也始终走 new-api；
   - **保留** `generateVideoLegacy`/`generateKlingViaTencent` 及 `model-routing` 腾讯配置——它们仍被 `/internal/tencent-vod`（new-api 的 tencent-vod channel 回调，`createViaTencentVod` 直接调用，绕过 `generateVideo()`）与 kling-o3 任务查询依赖，**不可删**。

### 不改动

- `Admin.tsx` / `node-config.service.ts` / `model-routing.service.ts` 仍可产出 `tencent_vod` 配置（它是 new-api tencent-vod channel 的来源）；用户侧前端清洗即可。
- `creditBillingRemark.ts` 作为被动格式化器保持原样（渠道标签自然反映 new-api 实际所选渠道）。

## 影响范围

- vidu / kling-2.6 / kling-3.0 / kling-o3 用户侧不再固定腾讯，由 new-api 按令牌选渠道。
- kling-o3 丢失分镜 storyboard 与 15s 时长（降为 10s）。
- kling-2.6 首尾帧仅 pro 模式可用（同原非腾讯逻辑）。
- seedance 本就走 new-api，无变化。

## 验证

- 前端类型检查：`tsc -b`（project refs）。
- 手验：创建 vidu / kling-2.6 / kling-3.0 / kling-o3 节点，确认请求 payload 不含 `vendorKey/platformKey: tencent_vod`，且任务经 `/v1/videos` 创建。
- 老项目水合不崩溃（含遗留 storyboard 字段的旧 kling-o3 节点）。
