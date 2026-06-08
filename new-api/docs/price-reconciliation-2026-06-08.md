# new-api 模型价格 ↔ backend 积分口径对账（2026-06-08）

## 换算锚点

- backend 积分定价：`100 积分 = ¥1`（`CreditPricing.creditsPerCall`，**按每次调用**计积分）。
- new-api：`¥:$ = 1:1`。
- ⇒ 某模型 new-api 目标价(USD) = backend `creditsPerCall / 100`。

## 真值源 / 价格源

- **backend 真值源**：
  - `backend/prisma/schema.prisma` `model CreditPricing { serviceType @unique, creditsPerCall, provider, ... }`（DB 表，运行时可被迁移/后台改写）。
  - 默认种子：`backend/src/credits/credits.config.ts` `CREDIT_PRICING_CONFIG`。
  - **真正决定 new-api 上游模型名 ↔ 积分** 的桥接表：
    `backend/src/ai/services/model-routing.service.ts` `DEFAULT_MODEL_PROVIDER_MAPPING_V2.models[].vendors[]`
    （每个 vendor 带 `modelName`=new-api 上游模型名、`creditsPerCall`、`priceYuan`）。
- **new-api 价格源**：
  - 默认值：`new-api/setting/ratio_setting/model_ratio.go` `defaultModelPrice`（按次固定价 USD，`ModelPrice`）/ `defaultModelRatio`（按 token 倍率）。
  - **运行时生效值**：DB `options` 表 `key='ModelPrice'`（JSON），启动时 `UpdateModelPriceByJSONString` 合并覆盖默认值。
    ⇒ 线上改价**必须**改 `options.ModelPrice`（patch SQL），改 Go 默认值只影响全新安装。
  - 查找链：`GetModelPrice(name)`（`model_ratio.go`）按 `FormatMatchingModelName` 后查 `modelPriceMap`；查不到则回落 `GetModelRatio`（37.5 兜底倍率，按 token）。

## 路由事实（决定 new-api 是否真的对该模型计费）

- **图像模型**（`gemini-*-image`、`gpt-image-2`、`doubao-seedream-5-*`）：`defaultVendor='new_api'`，
  走 new-api `/v1/images/generations`，new-api **会**对网关令牌计费（best-effort，真实扣费在 backend）。
- **视频模型**（vidu/kling/seedance）：`VideoProviderService.NEW_API_VIDEO_MODEL_KEYS` 显示
  `vidu-q2/vidu-q3/kling-2.6/kling-3.0/kling-o3/seedance-1.5/seedance-2.0` **全部走 new-api `/v1/videos`**，
  由 new-api distributor 选线路（apimart / ark / 其自带 tencent-vod channel）。new-api 对网关令牌计费。
  - 这些视频模型 backend 是**动态计费**（按秒/分辨率/有无声音/std-pro），单一 `ModelPrice` 无法精确表达，
    只能取「典型档」当 best-effort 兜底。
- backend 才是用户真实扣费方；new-api 的 `ModelPrice` 是网关侧令牌额度的近似兜底。

## 对账表

backend 上游模型名取自 `model-routing.service.ts` 的 vendor.modelName（new-api 实际收到的模型名）。
new-api 当前价 = `defaultModelPrice`（Go 默认）∪ 已有 patch（`patches/2026-06-08/001-*` 写入了
`options.ModelPrice` 的 `vidu-q2/vidu-q3/viduq2-pro/viduq3-pro = 6`）。

### A. 图像模型（走 new-api，按次，映射明确）

| backend serviceType / modelKey | new-api 上游模型名 | backend creditsPerCall | 目标 USD | new-api 当前价 | 差异 | 动作 |
|---|---|---|---|---|---|---|
| gemini-2.5-image | gemini-2.5-flash-image-preview | 20 (1K) | 0.20 | 0.20 | 一致 | 无需改 |
| gemini-3-pro-image | gemini-3-pro → 别名 gemini-3-pro-image-preview | 40 (1K) | 0.40 | 0.40 | 一致 | 无需改 |
| gemini-image-blend | gemini-2.5-flash-image-preview | 40 (1K) | 0.40 | 0.20 | 差 0.20 | **待人工**：与 gemini-2.5-image 共用同一上游模型名，new-api 单 key 只能定一个价。backend 按 serviceType 区分计费，new-api 无法区分 → 不擅改（改了会连带影响 gemini-2.5-image 兜底）。 |
| gemini-2.5-image-analyze | gemini-2.5-pro | 10 | 0.10 | ModelRatio 0.625（按 token） | 机制不同 | **待人工**：分析走 chat 模型按 token 计费，非按次 ModelPrice。backend 按次 10 积分，new-api 按 token，结构性差异。 |
| gpt-image-2 | gpt-image-2 | 40 (默认) | 0.40 | 0.40 | 一致 | 无需改 |
| doubao-seedream-5-0-260128 | doubao-seedream-5-0-260128 | 30 (1K/2K) / 60 (4K) | 0.30–0.60 | 0.60 | base 差 0.30 | **待人工**：backend 按分辨率（1K/2K=30，4K=60），new-api 单一 ModelPrice 取了 4K 档 0.60（保守高估兜底）。真实扣费在 backend，不擅改。 |

注：`gemini-3-pro-image` backend 发 `gemini-3-pro`，被 `NewApiProvider.MODEL_ALIAS_MAP` 规整为
`gemini-3-pro-image-preview` 后才到 new-api，new-api 按 `gemini-3-pro-image-preview`=0.4 计费，与目标一致。
极速/尊享线（`-ultra` / `-vip` / `-apimart` 后缀）由 new-api 按分组键切换，backend 另有 `credits.service.ts`
路由感知逻辑覆盖，属独立轨，不在本次按次对齐范围内（见「待人工 §C」）。

### B. 视频模型（走 new-api /v1/videos，backend 动态计费，单一 ModelPrice 仅兜底）

| backend modelKey | new-api 上游模型名 | backend 典型 creditsPerCall | 目标 USD（典型） | new-api 当前价 | 差异 | 动作 |
|---|---|---|---|---|---|---|
| vidu-q2 | vidu-q2 | 600 | 6.00 | 6（patch 001 已写 options） | 一致 | 无需改 |
| vidu-q3 | vidu-q3 | 125 (turbo fallback) / 600 | 1.25 | 1.25（Go 默认） | 一致 | 无需改 |
| kling-2.6 | kling-v2-6 | 150 (base, 无声 std 5s) | 1.50 | 1.5 | 一致 | 无需改（动态价 backend 决定） |
| kling-3.0 | kling-v3 | 300 (base, 无声 std 5s) | 3.00 | 3.0 | 一致 | 无需改 |
| kling-o3 (Omni) | kling-v3-omni | 600 (flat, 无 dynamicPricing 表) | 6.00 | 3.0 | 差 3.00 | **待人工**：backend `kling-o3-video` 平价 600 积分，无动态档；new-api `kling-v3-omni`=3.0 偏低。但 O3 历史上多走腾讯线、且与 Kling 3.0 共线，可能有运营原因；保守不擅改，标人工确认。 |
| seedance-1.5 | doubao-seedance-1-5-pro-251215 | 600 | 6.00 | 无 ModelPrice（回落 ratio 按 token） | 机制不同 | **待人工**：new-api 未登记 ModelPrice，按 token ratio 计费；backend 按次 600。若要兜底按次，需新增 ModelPrice，但 backend 实为动态价，宜由运营确认典型档。 |
| seedance-2.0 | doubao-seedance-2-0-260128 / -fast-260128 | 限时折扣动态（`SEEDANCE20_DISCOUNT_*`） | 动态 | 无 ModelPrice（按 token） | 机制不同 | **待人工**：限时免费/折扣开关（`SEEDANCE20_FREE`）+ 动态按秒，单一 ModelPrice 无法表达，不擅改。 |

## 本次改了哪些 / 生效机制

**本次未改任何价格。**

理由（遵守保守铁律）：
1. 所有「映射明确且按次」的图像模型（gemini-2.5-image / gemini-3-pro-image / gpt-image-2）new-api 当前价**已与 backend 目标一致**，无需改。
2. 其余差异项要么是**结构性机制差异**（按 token vs 按次：image-analyze、seedance）、要么是**共用上游模型名无法区分**（gemini-image-blend）、要么是**动态计费无法用单一 ModelPrice 精确表达**（kling-o3、seedance、seedream 分辨率档）。这些都可能有业务/运营原因，按要求一律放「待人工确认」，不擅自改。
3. 真实扣费在 backend；new-api ModelPrice 仅为网关令牌额度兜底，过度对齐反而可能引入回归。

**若将来要改某条**：按既有约定写 patch SQL 合并 `options.ModelPrice`（运行时生效），范式见
`new-api/patches/2026-06-08/001-add-kapon-vidu-q2-channel.sql` Step 4：

```sql
INSERT INTO options (key, value) VALUES ('ModelPrice', '{"<model>": <usd>}')
ON CONFLICT (key) DO UPDATE
SET value = (options.value::jsonb || EXCLUDED.value::jsonb)::text;
```

同时（可选）同步改 `new-api/setting/ratio_setting/model_ratio.go` `defaultModelPrice` 默认值，仅影响全新安装。
两处都改才能让「现有实例（DB options）」与「新装实例（Go 默认）」一致。

## 待人工确认（汇总）

- **C1. gemini-image-blend vs gemini-2.5-image 共用 `gemini-2.5-flash-image-preview`**：
  backend 对 blend 收 40 积分、对 2.5-image 收 20 积分，但二者发同一个 new-api 上游模型名，
  new-api 无法按 serviceType 区分计费（当前 0.20）。是否需要在 new-api 侧拆分模型名（如加 `-blend` 别名渠道）由运营决定。
- **C2. gemini-2.5-image-analyze（→ gemini-2.5-pro）按 token vs backend 按次 10 积分**：结构性差异，是否需要补按次 ModelPrice 待确认。
- **C3. doubao-seedream-5-0-260128 分辨率分档**：new-api 单价 0.60 取了 4K 档，1K/2K 实为 0.30。是否需要下调或保留高位兜底待确认。
- **C4. kling-v3-omni**：new-api 0.30 vs backend kling-o3 平价 6.00（差 3.00）。是否提价到 6 待运营确认（涉及 O3/3.0 共线与腾讯线）。
- **C5. seedance-1.5 / seedance-2.0**：new-api 未登记 ModelPrice，按 token ratio 兜底；backend 为动态按秒价（含限时折扣开关）。是否补「典型档」ModelPrice 待确认。
- **C6. 极速/尊享线**（`gemini-*-preview-ultra/-vip/-apimart`、`gpt-image-2-tencent-*`）：new-api 已有分档价，backend 由 `credits.service.ts` 路由感知逻辑（`BANANA_ULTRA_RESOLUTION_PRICING` 等）独立覆盖，本次按次对齐未覆盖此独立轨，是否需逐档对账待确认。
