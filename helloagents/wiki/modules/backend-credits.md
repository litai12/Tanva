# 后端模块：积分系统（backend-credits）

## 2026-08-17 用户消费运营策略

- 托管厂商定价书可配置 `consumerPolicies`。策略与刊例 `matchingRules/evaluators` 分离，只在 `resolveEffectiveCreditsQuote` 得到最终刊例积分后影响用户实扣；个人与团队预扣共用同一路径，上游成本、请求参数和 catalog 刊例价不变。
- 策略条件复用定价维度；空条件表示整条节点线路，也可按型号、分辨率等规格筛选。可用性与折扣分别取当前时间窗内、命中条件的最高优先级策略，因此模型级活动可被更高优先级规格策略覆盖。
- 时间窗为 `[startsAt, endsAt)`。开始前和结束时刻起自动按原刊例积分；无需定时任务写回配置。审计 `pricingSnapshot.consumerCharge` 记录刊例积分、折扣倍率、精确金额与实际扣减积分。
- Seedance 2.5 1080P 默认策略在 `2026-08-14 14:00` 至 `2026-09-17 14:00`（Asia/Taipei）按 `0.72` 倍计费。5 秒刊例金额 `28.125 元 / 2813 积分` 先按金额打折为 `20.25 元`，实扣 `2025 积分`；结束后恢复 `2813`。4K 当前命中不可用策略并返回 HTTP 400“暂未开放”。

## 2026-08-11 Tanvas 图片积分定价

- 普通线路按 Tanvas 1.5 倍积分列计费：Gemini 2.5 Fast 固定 `20`；Gemini 3 Pro 的 1K/2K/4K 为 `60/70/85`；Gemini 3.1 Flash（Nano Banana 2）的 0.5K/1K/2K/4K 为 `40/40/50/70`。
- 腾讯尊享线路：Gemini 2.5 Fast 固定 `40`；Gemini 3 Pro 的 1K/2K/4K 为 `130/130/240`；Gemini 3.1 Flash 的 0.5K/1K/2K/4K 为 `45/65/100/155`。
- GPT Image 2 普通线路 1K/2K/4K 仍为 `20/30/40`；腾讯尊享 Low=`30/40/50`、Medium=`60/120/190`、High=`230/460/760`，每张实际参考图继续追加 `10` 积分。
- 同一 Pro / Nano Banana 2 矩阵覆盖生成、编辑与融合服务；`POST /credits/preview` 和实际预扣共用同一解析器。极速 `ultra/beqlee` 暂停开放，前端历史偏好与请求边界迁回普通线路，后端旧矩阵只作历史兼容。

## 2026-08-10 GPT Image 2 参数与画布报价一致性

- `POST /api/credits/preview` 与实际 `withCredits` 预扣共同使用 `resolveEffectiveCreditsQuote`；画布运行按钮优先消费该报价，不再让模型线路的旧静态价格决定实际显示。
- GPT Image 2 普通路线按分辨率为 `1K/2K/4K = 20/30/40`。腾讯尊享路线按质量与分辨率计价：`auto/low = 30/40/50`、`medium = 60/120/190`、`high = 230/460/760`；在此基础上，每张实际参考图额外收取 `10` 积分（`0.1` 元）。
- `quality` 与 `resolution` 不互相推导：`auto` 在腾讯路线归一为 `low`，网关只用 `quality` 选择 `image2_low/medium/high`，同时把 `resolution` 原样写入腾讯 `OutputConfig`。
- Tanva 同步生图与异步生图都透传 GPT Image 2 的质量、背景、审核、输出格式/压缩、蒙版和官方回退参数；new-api 的腾讯/APIMart 适配器必须从 `ImageRequest` 正式字段读取这些值，不能假设它们位于 `Extra`。
- 画布审计同时校正 Seed 3D（显示/报价/实扣均为当前 `convert-2d-to-3d` 价格 200）、文本节点普通/尊享兜底价、Audio Studio 模型切换价格、Sora/Seedream 添加面板区间。视频分析节点将线路提示同时交给报价与实际请求，且 Run 价只使用后端报价。
- Banana 极速路线使用 `ultra/beqlee` 双别名；前端请求封装、后端报价和真实执行必须保留同一条路线。极速图片兜底矩阵与后端一致：Fast 为 20，Pro 为 `100/100/100/179`，Ultra 模型为 `50/50/75/113`（依次为 0.5K/1K/2K/4K）。
- GPT Image 2 尊享参考图附加费由服务端实际 `inputImageCount` 覆盖客户端提示值，避免只在 preview 增价、实际预扣遗漏，或通过伪造 `referenceImageCount=0` 少扣；积分流水 remark 同时记录参考图数量和单张附加费。

## 2026-08-02 小T 对话固定计费
- `xiaot-agent` 每个完整成功的对话回合固定扣 `2` 积分，Fast/Pro/Ultra/DeepSeek V4 Flash 不再按模型或上游 usage 区分价格。
- 上游 `usage.total_tokens` 仅作账单审计数据保存，不再乘汇率或直接作为扣费值，避免将 `4800+` 的 usage 误扣为对话积分。
- 小T 触发的生图、视频、识图和其他画布节点任务依然进入原有宿主计费链路，产生独立用量记录，不与对话的 `2` 积分合并。

## 2026-07-31 Seedance 2.5 按时长计费
- 2.5 与 Seedance 2.0 共用 `modelKey=seedance-2.0` 的统一定价书，通过 `seedanceModel=seedance-2.5` 命中独立规则；账单服务名与模型标签分别显示为 `Seedance 2.5视频生成`、`Seedance 2.5`。
- 标准 2.0 当前画布商业单价为 480P `1.25 元/秒`、720P `1.50 元/秒`、1080P `3.75 元/秒`、4K `7.50 元/秒`；2.5 按对应档位的 `1.5x` 计为 480P `1.875 元/秒`、720P `2.25 元/秒`、1080P `5.625 元/秒`、4K `11.25 元/秒`，按 `100 积分 = 1 元` 对任务总价向上取整。仅输出 5 秒时分别为 `938`、`1125`、`2813`、`5625` 积分。
- 若有参考视频，规则中的 `duration` 使用 `billingDurationSec = outputDurationSec + inputVideoDurationSec`。例如 720P 输出 5 秒并输入唯一参考视频 5 秒，2.5 按 10 秒计 `2250` 积分。
- `SEEDANCE20_FREE` 仍只控制 Seedance 2.0 / Fast / Mini；Seedance 2.5 是独立付费 SKU，不随该活动开关归零。

## 2026-07-27 Flow 视频同步直出兼容
- 部分视频供应商会在创建接口直接返回 `videoUrl`，不返回异步 `taskId`；后端对此类结果会直接完成积分结算。
- 前端视频响应校验与 Flow Run 已兼容该同步结果：直接写回视频节点与视频历史，不进入轮询；仅有异步任务时才保存 `taskId/apiUsageId` 并保持 `pending`。
- 视频节点支持单节点停止/重置后重新生成；最近一次 Run 按节点记录，10 秒内再次 Run 会被前端拦截，避免取消后立即重复提交。

## 2026-06-19 Admin API credit audit filters
- `GET /api/admin/api-usage/filter-options` returns provider and model filter choices for the admin API usage records page.
- The options are sourced from `CreditTransaction.apiUsageId -> ApiUsageRecord.provider/model`, matching the provider/model data shown in credit details. Recent API usage is used only as a fallback when no linked credit transactions exist.
- Record queries accept `provider`, `model`, day/month date ranges, and return a filtered credit summary from `GET /api/admin/api-usage/records`.

## 2026-04-15 Update
- Image analysis deduction mapping is fixed to: Fast (gemini-2.5-image-analyze) = 10, Pro (gemini-image-analyze) = 30, Ultra (gemini-3.1-image-analyze) = 20.
- POST /api/ai/analyze-image serviceType routing now follows provider tier (banana-2.5 / banana / banana-3.1|nano2) for consistent billing.

## 2026-04-19 Recharge policy simplification
- `GET /api/payment/packages` returns fixed recharge tiers for all users (no VIP first-top-up x2 logic).
- Current base tiers: `25=2500`, `50=5000`, `100=10000`, `500=50000`, `1000=100000`, `5000=500000`; the former `200` tier is no longer sold.
- Backend enforcement:
  - Recharge order credits are still recalculated server-side in `PaymentService.createOrder` from amount.
  - Client-provided `credits` does not control final recharge grant.

## 2026-08-11 Qualified recharge 20% permanent bonus
- 普通用户的个人独立积分充值保持固定档位原价；最高档年卡 `8 折` 已移除。当前价格档位为 `25 / 50 / 100 / 500 / 1000 / 5000` 元，原 `200` 元档下架，基础兑换仍为 `1 元 = 100 积分`。仅超级管理员（`User.role = admin`）可提交按同一兑换比例计算的非固定档位自定义充值，服务端创建订单时会查询数据库中的实时角色；`normal_admin` 不具备该权限。普通用户总到账依次为 `2500 / 5000 / 10000 / 50000 / 100000 / 500000`；有效最高档年卡会员及白名单中开启“充值到账 120%”的用户总到账为 `3000 / 6000 / 12000 / 60000 / 120000 / 600000`。
- 新订单在 `PaymentOrder.metadata` 固化 bonus policy version、资格来源、基础积分、赠送积分和总积分；`PaymentOrder.credits` 记录总到账积分。付款后的资格变化不得改变既有订单到账，历史订单没有该快照时保持原订单积分语义，不追溯加赠。
- 支付成功后基础积分与 20% 充值赠送都创建 `sourceType=recharge` 批次；赠送部分仍以独立 `validityType=permanent + expiresAt=null` 批次记录，不参与每日衰减、到期清理或会员到期回收。`gift` 专用于免费、可衰减积分。两批次和两条 EARN 流水位于同一事务，回调/查询/补单以条件更新原子抢占 PAID 状态，避免并发重复赠送。
- 原水印白名单现为统一白名单，权益可分别开启“去水印 / 最高档年卡权益 / 充值到账 120%”。最高档年卡权益通过有效套餐解析提供功能能力，但不创建 `UserMembershipSubscription`，因此不会进入首期、月度刷新或年付分期积分发放任务。

## 作用
- 维护用户积分余额、交易流水、API 使用记录与服务定价。
- 提供每日奖励领取与管理员加/扣积分接口。

## 关键文件
- `backend/src/credits/credits.controller.ts`：`/credits/*`
- `backend/src/credits/credits.service.ts`：积分/定价/流水/使用记录逻辑（Prisma）
- `backend/src/credits/dto/credits.dto.ts`：DTO

## 图像计费规则（当前）
- 生图：按线路和 `resolutionPricing` 区分；普通 Pro 1K/2K/4K=`60/70/85`，普通 Nano Banana 2 0.5K/1K/2K/4K=`40/40/50/70`。
- 图像编辑：
  - Pro（`gemini-image-edit`）普通 1K/2K/4K=`60/70/85`，尊享=`130/130/240`。
  - Nano Banana 2（`gemini-3.1-image-edit`）普通 0.5K/1K/2K/4K=`40/40/50/70`，尊享=`45/65/100/155`。
- 图像融合：
  - Pro（`gemini-image-blend`）与同线路、同分辨率的 Pro 生图价格一致。
  - Nano Banana 2（`gemini-3.1-image-blend`）与同线路、同分辨率的 Nano Banana 2 生图价格一致。
- 账单流水中的 `description` 由后端生成，格式为 `使用 {serviceName}（{imageSize}）`，前端直接展示。

## API（前缀 `/api/credits`，节选）
- `GET balance`
- `GET daily-reward/status` / `POST daily-reward/claim`
- `GET pricing`
- `GET transactions`：返回流水基础字段 + `channel`（渠道）、`provider`、`model`、`apiResponseStatus`、`processingTime`
- `GET usage`
- `POST admin/add` / `POST admin/deduct`（需要管理员角色）

## 免费用户生成配额（按“用户是否已付费/白名单”判定）
- 适用对象：普通免费用户受限。
- 以下用户不走免费生图/生视频配额限制：
  - 任意存在 `paymentOrder.status=paid` 的用户
  - 活跃会员
  - 白名单用户（`user.noWatermark=true`）
  - `admin/normal_admin`
- 生图上限：
  - 每天最多 `20` 张（UTC 日）
  - 每月最多 `100` 张（UTC 月）
- 视频上限：
  - 每天最多 `3` 个（UTC 日）
  - 每月最多 `10` 个（UTC 月）
- 计数口径：统计 `ApiUsageRecord` 中 `responseStatus in (pending, success)` 的记录，避免并发重复下单绕过配额。
- 可通过环境变量覆盖默认值：
  - `FREE_USER_DAILY_IMAGE_LIMIT`
  - `FREE_USER_MONTHLY_IMAGE_LIMIT`
  - `FREE_USER_DAILY_VIDEO_LIMIT`
  - `FREE_USER_MONTHLY_VIDEO_LIMIT`

## 渠道与模型追踪（图像分析）
- 通用 2D 转 3D 固定记录为 `provider=hunyuan-3d`、`model=3.1`；历史配置中的 `runninghub` 仅为旧错误标记，不代表真实执行渠道。异步任务以 `clientRequestId` 同时约束任务创建和积分预扣，恢复轮询不得产生第二笔用量记录。
- `POST /api/ai/analyze-image` 的计费请求参数会写入 `aiProvider/channelHint`，用于在积分流水中识别执行渠道。
- 流水列表前端可直接展示“渠道 + 模型”，用于核对“使用了哪个渠道、哪个模型”。
- 视频模型管理线路若在 `model_provider_mapping_v2.models[].vendors[]` 配置了 `creditsPerCall`，后端预扣积分会优先使用该线路价格，而不是节点管理/静态服务价。
- 若 `model_provider_mapping_v2.models[].vendors[].metadata.specPricing` 配置了规格积分规则，后端会按数组顺序匹配第一条命中的 `match/when` 条件，再回退到厂商级 `creditsPerCall`：
  - 规则格式示例：`{ "match": { "resolution": "720P", "duration": 10 }, "creditsPerCall": 900 }`
  - 常用匹配字段可直接复用请求参数，如 `resolution`、`duration`、`aspectRatio`、`mode`、`sound`、`modelVersion`。
- 新定价结构优先：
  - `model_provider_mapping_v2.models[].vendors[].pricing.defaults`：厂商默认价
  - `model_provider_mapping_v2.models[].vendors[].pricing.rules[]`：规格组合价
  - 命中模型管理价格时，后端会把 `pricingSnapshot` 写入 `ApiUsageRecord.requestParams`，用于审计规则来源、命中 ruleKey 和最终价格快照。
- `POST /api/ai/generate-video-provider` 现在会在解析出模型管理线路后，将该线路 `pricing.displayConfig.defaultSelections` 用作缺失规格的计费默认值；例如对话框 Seedance 2.0 未显式选择分辨率/时长时，按模型管理默认 `720P / 5s` 参与规格定价，避免回退到静态 `doubao-video` 价格。
- Seedance 2.0 (`seedance-2.0`) 当前画布规格定价按原 `x1.2` 单价整体乘 `1.5/1.2`，并按 `100 积分 = 1 元` 折算：Fast/Mini 480P `1.0075` 元/秒、Fast/Mini 720P `1.2075` 元/秒、标准 480P `1.25` 元/秒、标准 720P `1.50` 元/秒、标准 1080P `3.75` 元/秒、标准 4K `7.50` 元/秒；标准默认 `720P / 5s` 为 `750` 积分。2.5 的 480P/720P/1080P/4K 对应档位均再乘 `1.5`。
- 新增只读接口 `GET /api/credits/pricing/models`：
  - 面向画布右上角“定价一览”弹层。
  - 支持通过 `modelKey` 查询单模型，未传时返回全部模型。
  - 返回模型 / 厂商默认价 / 规格规则 / 计费维度；线性与矩阵等 evaluator 会带公式描述，便于直接展示。
- Wan 系列（2026-04-14）：
  - `wan-2.6`、`wan-2.6-r2v`、`wan-2.7` 已升级为按 `resolution × durationSec` 线性计费。
  - 当前系统定价在阿里云百炼基线之上做了“每秒 +20 积分”上浮，对应 `720P = 0.8 元/秒`、`1080P = 1.2 元/秒`；系统按当前积分汇率自动折算为 `80 / 120 积分每秒`。
  - DashScope 直连接口必须携带 `managedModelKey + vendorKey + generationMode + resolution + durationSec`，否则会回退到静态服务价。

## pending 收敛与自动退款
- 异步视频链路支持前端回写成功：`POST /api/ai/video-task-success` 将 `ApiUsageRecord.responseStatus` 从 `pending` 更新为 `success`；Hailuo 查询到供应商终态时，后端也会按当前用户与持久化 taskId 自动幂等确认，前端不再是唯一结算触发方。
- 异步任务失败可调用 `POST /api/ai/video-task-refund`：先标记 `failed` 再退款；退款交易按 `apiUsageId` 幂等。
- 状态机保护：`updateApiUsageStatus` 禁止 `failed -> success` 与 `success -> failed` 的反向回写，避免“已退款后又标记成功”或“已成功后又标记失败”的状态/账务不一致。
- 定时任务每 5 分钟扫描超时 `pending` 并自动退款：
  - 图像类：`CREDITS_PENDING_TIMEOUT_MINUTES`（默认 15 分钟）
  - 视频类：`CREDITS_PENDING_VIDEO_TIMEOUT_MINUTES`（默认 30 分钟）
- Hailuo H3 使用 new-api 实际回报积分，但异步创建阶段保持 `pending`；创建响应必须带回 `apiUsageId` 并持久化上游 `taskId`，查询终态可按 taskId 找回同一 pending 记录并自动确认/退款，前端回写仅作快速路径。`hailuo-video` 已纳入视频超时自动退款范围。
- 视频类自动退款默认带分界线：仅处理 `createdAt >= 2026-03-28T00:00:00.000Z` 的记录，避免历史 `pending` 上线后集中退款。
  - 可通过 `CREDITS_PENDING_VIDEO_REFUND_CUTOVER_AT` 覆盖时间点；
  - 设置为 `off/none/0` 可关闭分界线过滤。

## 数据模型关联
- `CreditAccount`、`CreditTransaction`、`ApiUsageRecord`、`CreditPricing`、`CreditPackage`

## 多形态积分基础层（2026-04-08）
- 新增 `backend/src/credits/credit-lot-policy.ts`：提供积分批次（lot）候选类型、默认扣减策略、lot 可用性过滤、优先级排序和扣减规划函数。
- 新增 `backend/src/credits/credit-lot-grants.ts`：提供充值、管理员补发、新用户注册赠送等“永久 lot”构建函数。
- 新增 Prisma 模型基础设施：
  - `CreditLot`：表示一批具有同一来源/有效期规则的积分，支持 `permanent`、`fixed_window`、`membership_bound` 三类生命周期。
  - `CreditConsumePolicy`：表示扣减优先级策略，支持按生命周期、来源、scope specificity 等规则排序。
- `CreditTransaction` 补充 lot / policy 审计字段：
  - `creditLotId`
  - `consumePolicyCode`
  - `consumePolicyVersion`
- `CreditsService.preDeductCredits` 已切到 hybrid lot 扣减：
  - 先按 `CreditLot` + consume policy 排序扣减
  - 若历史余额尚未 lot 化，则剩余部分走 `legacy_balance` 兜底
  - 交易流水 metadata 记录 `deductions`
- `CreditsService.refundCredits` 已支持按原 `deductions` 恢复 lot 剩余额度，并保留 legacy balance 回补。
- 已接入的发放链路：
  - `PaymentService.processPaymentSuccess`：充值成功后创建 `sourceType=recharge` 的 permanent lot。
  - `CreditsService.adminAddCredits`：管理员补发积分时创建 `sourceType=manual` 的 permanent lot。
  - `CreditsService.getOrCreateAccount`：首次使用时初始化 `CreditAccount`；不再发放“新用户注册赠送积分”，免费用户额度改由月度补发链路提供。
- 已接入的限时链路：
  - `CreditsService.claimDailyReward`：免费用户签到创建 `sourceType=gift + validityType=fixed_window` 的 lot，到期点为下一个凌晨 `3:00`；有效月卡、年卡及 VIP 白名单签到创建 `sourceType=gift + validityType=permanent` 的 lot，在当前资格有效时跨业务日保留。
  - `CreditsService.cleanupExpiredDailyRewards` 在账户锁内实时查询当前有效订阅和 VIP 白名单：有资格时暂停该账户签到清理；无资格时一次性清除所有已跨业务日签到批次，包括会员期间领取的 permanent gift 与历史无 lot 签到流水。发放时的 tierCode/retentionPolicy 只作审计，不再构成永久豁免。
  - `CreditsService.getExpiringCredits` 对当前有资格用户不显示到期；资格失效后先即时清除旧业务日签到积分，并把当日仍可用的签到积分统一展示为下一个凌晨 `3:00` 到期。
- consume policy：
  - 新增 `CreditConsumePolicy` 表，并在 migration 中初始化 `global_default`
  - 当前 `CreditsService` 先读取 `global_default`，缺失时回退内置默认策略
  - 内置默认优先级已调整为与定价策略一致：`月卡积分(subscription)` -> `赠送积分(gift)` -> `固定积分(recharge/manual)`；同类 lot 内再按过期时间和发放时间排序。
- 会员 P0 最小闭环：
  - 新增 `MembershipPlan`、`UserMembershipSubscription`、`MembershipEntitlementSnapshot` 三张基础表。
  - `PaymentOrder` 扩展支持 `orderType=membership`、`membershipPlanId`、`subscriptionId`、`planSnapshot`。
  - 新增 `MembershipService.activatePaidMembershipOrder`：支付成功后激活/续期订阅、upsert 权益快照，并发放 `sourceType=subscription` + `validityType=membership_bound` 的 lot。
  - 新增 `GET /api/payment/membership-plans`，以及会员订单创建校验：金额必须匹配已启用套餐，会员订单 `credits` 固定为 `0`。
- 会员 P1 到期收口：
  - 新增 `MembershipSchedulerService`，按小时扫描已过期订阅。
  - `MembershipService.expireElapsedMemberships()` 会把到期订阅标记为 `expired`，将关联的 `membership_bound` lot 归零并写入 `membership_expire` 流水，同时把权益快照回落到 `free/inactive`。
- 会员 P1 权益调度：
  - `CreditsService.issueFreeUserStarterQuotaCredits()` 会为没有活跃会员的用户补发一次性免费额度 `freeUserMonthlyQuotaCredits`，lot 类型为 `sourceType=subscription` + `validityType=fixed_window`，并记录 `free_starter_quota` 流水；历史 `free_monthly_quota` 流水也会被视为已领取，避免从月度规则切换后重复发 500。
  - 免费用户一次性额度过期后会清零剩余额度并同步扣减账户余额，记录 `free_monthly_quota_expire` 流水；不会再按 30 天周期续发，定时清理任务仅兜底扫描过期额度。
- `MembershipService.issueDailyMembershipGiftCredits()` 保留为历史兼容入口，但当前产品策略已停用自动每日赠送；会员套餐中的 `dailyGiftCredits` 现用于“每日签到基础积分”，而不是定时直接入账。
  - `MembershipService.decayDailyGiftCredits()` 以“执行时是否处于 VIP 有效期”为唯一会员判断：非有效 VIP 的邀请奖励、运营赠送与受邀注册免费额度等普通免费积分池每天默认衰减 `50`，有效 VIP/VIP 白名单暂停；签到 gift 明确排除此任务，统一交给凌晨 `3:00` 业务日清理，避免先衰减再整批清除。充值本金与充值赠送统一归类为 `recharge`，不参与衰减。签到 lot 使用 `priority=-200`，消费时优先于会员额度、其他赠送与充值批次。流水使用 `businessType=free_credit_decay`，同一用户同一自然日幂等。
  - 年卡额度在购买时一次性发放，`MembershipService.refreshYearlySubscriptionQuotaLots()` 保留兼容入口但固定空转，不再按月重复补发年卡额度。
  - 会员升级订单会记录 `membershipCycleSwitch`；支付入账同时根据当前订阅与目标套餐的真实周期推断，月卡→年卡即使订单标记缺失也会从支付时刻重开完整年周期。事务提交前会复读订阅、权益快照与新积分 lot，任一周期不一致则整体回滚。
  - `MembershipSchedulerService` 每小时只读巡检最近 48 小时的已支付年卡升级，检查订阅、权益快照和积分 lot 周期；异常只写错误日志，不自动修复或补积分。
- `MembershipSchedulerService` 每日 2 点执行免费积分池衰减；`CreditsSchedulerService` 每日 3 点在签到业务日切换时清理昨日签到余额，并把免费一次性额度的原 2 点到期扫描保持为独立任务；原每日 5 点会员自动赠送任务已停用。
- 会员读接口：
  - 新增 `GET /api/membership/current`：返回当前活跃订阅、当前套餐摘要和权益快照。
  - 新增 `GET /api/membership/entitlement`：返回当前权益快照；无快照时回退为 `free/inactive`。
- 后台策略配置：
  - 新增 `backend/src/business-policy/business-policy.service.ts`，统一读取/归一化 `membership_credit_policy`。
  - 新增 `GET /api/admin/membership-credit-policy` 与 `POST /api/admin/membership-credit-policy`。
  - 新增 `GET /api/admin/membership-plans`、`POST /api/admin/membership-plans`、`PATCH /api/admin/membership-plans/:id`，用于后台会员套餐管理。
  - 套餐覆盖式升级以用户开通时 `UserMembershipSubscription.snapshot` / `PaymentOrder.planSnapshot` 的价格快照为准，而不是当前后台套餐价格。目标档位更高（或同档月费转年费）时，只有新版分期年卡尚未发放的期数价值可抵扣新套餐；普通覆盖式升级保留旧套餐已发放积分、停止未来未发额度。旧价格版本月付换购当前 `2026-08-v2` 套餐是例外：全额付款并立即清零旧 `membership_bound` 批次，新周期从付款时刻重开，充值和永久赠送批次不受影响。
  - 用户有当前价格版本的生效会员时，只能购买严格更高档位的套餐；同档续费和所有低档套餐订单均由服务端拒绝。旧价格版本月付是唯一同档例外，可按上一条的清零重开规则换购当前同档套餐。订阅到期后不再存在活跃订阅，用户可按新购逻辑选择套餐。
  - 年费套餐必须在 `MembershipPlan.metadata` 显式配置 `creditIssuanceMode: "yearly_monthly_installments"` 才按 12 期发放；推荐同时写入 `priceVersion` 用于运营审计。未配置该模式的历史年费视为“一次性到账”版本：保留既有余额和发放行为，但升级时不计算剩余价值抵扣，避免已完整领取全年积分后重复享受折抵。
  - 独立积分充值不再按会员身份打折；所有用户按固定原价购买基础积分，普通用户到账 `100%`，仅有效最高档年卡与开启对应白名单权益的用户到账 `120%`。订单金额只按基础积分和 `1:100` 校验，资格与赠送积分由服务端订单快照确定，客户端不能控制。
  - `PaymentService.processPaymentSuccess` 和 `CreditsService.adminAddCredits` 现在会读取 `fixedCreditExpireDays`，将充值/手工补发 lot 生成为 `fixed_window` 或 `permanent`。
  - `CreditsService.issueFreeUserStarterQuotaCredits` 会读取 `freeUserMonthlyQuotaCredits` 与 `membershipRefreshCycleDays`，其中刷新周期仅作为一次性额度有效期窗口使用，不再触发月度续发。
- `CreditsService.claimDailyReward` 读取 `dailyRewardCredits`（免费）或当前会员套餐 `dailyGiftCredits`（活跃 VIP，且不叠加免费签到额度，含 `vip_69`），第 7 天按倍率发放；月卡/年卡/VIP 白名单签到在当前资格有效时保留，资格失效后所有跨业务日签到余额一次性清除。`ReferralService` 的邀请人与首充邀请奖励会创建 `gift` lot，供非有效 VIP 的每日免费积分衰减精确扣减；历史无 lot 邀请流水保留兼容扣减。
- `ReferralService.getCheckInStatus/checkIn` 现仅作为前端推广页签到入口的兼容壳层，底层状态与发奖统一复用 `CreditsService.canClaimDailyReward/claimDailyReward`；自动签到与手动签到不再各自维护独立逻辑，避免同一天重复发放。
- `CreditsService.adminAddCredits` 的正向加积分现已改为进入 `gift` 池，与定价策略“后台管理员操作积分视为赠送积分”一致。
- 尚未接入的链路：
  - 更细粒度 scope 策略（service/provider/model 级命中）
  - 月付会员自动续费
  - 前端会员页 / 支付页 / 弹窗统一接入套餐配置
  - lot 级对账与迁移回填工具

## 2026-04-12 Tencent Banana Pricing Update
- `credits.service.ts` now applies a Tencent-only pricing matrix for Banana image services (`channel/channelHint/executionChannel/providerChannel = tencent`).
- Pricing matrix: Fast `1K=30`; Pro `1K/2K/4K=90/100/170`; Ultra `0.5K/1K/2K/4K=30/50/70/110`.
- This override is limited to Tencent channel requests and does not affect non-Tencent Banana routes.

## 2026-04-15 Membership Check-In Alignment
- Frontend app entry no longer auto-claims daily reward on login/app bootstrap; users must manually check in.
- Membership plan `dailyGiftCredits` is treated as the paid-tier daily check-in base credits, not an automatically issued daily gift quota.
- `vip_69` is aligned with the same rule path as other paid tiers for check-in reward resolution.

## 2026-05-16 Volc Video Enhance Billing Alignment
- `volc-enhance-video` now bills by explicit parameter matrix (single source: backend quote + pre-deduct), and the platform price table is used directly as the deducted credits:
  - `toolVersion=standard`: `720P/1080P/2K/4K => 90/180/360/720` for `<=30fps`, `180/360/720/1440` for `>30fps`
  - `toolVersion=professional`: `720P/1080P/2K/4K => 750/1500/3000/6000` for `<=30fps`, `1500/3000/6000/12000` for `>30fps`
- Credits detail no longer relies on time-window merge; multi-item merge only happens when an explicit `parallelGroupId` exists.
- Billing remarks include resolved `volcVersion / volcResolutionTier / volcFpsBand / volcFactor / volcUnitPriceYuan / volcPlatformPrice` so frontend/admin credits pages can explain the chosen档位 and platform price.

## 2026-06-19 Admin API Credit Usage Audit
- `GET /api/admin/api-usage/records` supports `model` filtering in addition to user, service type, provider, status, and date range.
- The response includes `summary` for the filtered result set: actual consumed credits (`success + pending`), refunded failed credits, status call counts, token totals, unique users, and average processing time.
- The admin API records page exposes model plus day/month period controls and shows the filtered credit summary above the record table.

## 2026-04-13 Pre-Deduct Idempotency
- `CreditsService.preDeductCredits` now accepts `idempotencyKey` and optional `idempotencyWindowMs`.
- Duplicate requests in a short time window are deduplicated by `idempotencyKey` (primary) and request fingerprint (fallback), and reuse existing `apiUsageId`/spend transaction instead of creating a new charge.
- Dedup metadata (`idempotencyKey`, `requestFingerprint`) is persisted in `ApiUsageRecord.requestParams` for audit and troubleshooting.
- `AiController.withCredits`, `POST /api/ai/generate-video-provider`, and `POST /api/video-gif/convert` now propagate idempotency keys into credits pre-deduct.
- `main.ts` CORS allowlist now includes `idempotency-key`/`x-idempotency-key`/`x-request-id`, so browser preflight for idempotent requests no longer fails with frontend `Failed to fetch`.

## 2026-04-13 Banana Route Billing Consistency
- `AiController.buildCreditRequestParams` now writes explicit billing `channel` from `bananaImageRoute` (`normal => apimart`, `stable => tencent`) before pre-deduct.
- `CreditsService.normalizeChannel` and `AiController.normalizeChannelName` now normalize `nano2` to `apimart` (no longer treated as Tencent).
- Tencent Banana matrix resolution now gives highest priority to explicit route: `stable` always Tencent pricing matrix, `normal` always non-Tencent pricing matrix.
- Pre-deduct dedup now uses `idempotencyKey` as the sole primary key when present; `requestFingerprint` fallback is only used when idempotency key is absent, avoiding accidental merge of two user-initiated consecutive runs.
- Frontend image request adapter now writes latest Banana route into `providerOptions` per-request (runtime store value first, persisted value fallback), reducing stale-route charging when users switch route and trigger run quickly.
- Backend CORS allowlist now includes `x-banana-image-route` so request-side route header can pass browser preflight in cross-origin dev.
