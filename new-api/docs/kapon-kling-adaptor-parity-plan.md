# kapon-kling 适配器补全计划（普通线路全模式走 kapon）

目标：让普通 kling（v2-6/v3/omni）的**全部模式**经 new-api 走 kapon 渠道（type 50），new-api 可见可计费；**不破坏 apimart**（apimart 仍是回落/其它模型货源）；尊享 kling 高级模式经腾讯也补全。

## 现状 / 根因
- new-api `relay/channel/task/kling/adaptor.go` 的 kapon(`istanvasMartRelay`, sk- key)分支只实现 `image2video`/`text2video` 两个端点，不读 image_tail/image_list/omni → 首尾帧/多图/参考/omni 退化为单图。
- vidu 适配器(type 52)是全的（4 端点），所以 vidu 普通全模式 kapon 没问题。

## 权威 spec（来自后端 video-provider.service.ts 已验证的 kapon 客户端）
基址 `https://models.kapon.cloud`，鉴权 `Authorization: Bearer <sk- key>`。

创建：
| 模式 | 端点 | payload 关键字段 |
|---|---|---|
| 文生 | `/kling/v1/videos/text2video` | `model_name,mode,duration,aspect_ratio?,prompt` |
| 单图 | `/kling/v1/videos/image2video` | `+image` |
| 首尾帧 | `/kling/v1/videos/image2video` | `+image,image_tail,prompt` |
| 多图 | `/kling/v1/videos/multi-image2video` | `model_name="kling-v1-6", image_list:[{image:url}], prompt` |
| omni | `/kling/v1/videos/omni-video` | `model_name="kling-v3-omni",mode,sound?,prompt,duration,aspect_ratio?, image_list:[{image_url,type:first_frame|end_frame}], video_list:[{video_url,refer_type,keep_original_sound}]` |

响应 `{code:0,data:{task_id}}`，状态 queued。
轮询：非 omni 依次试 `text2video/{id}`、`image2video/{id}`、`multi-image2video/{id}`，取 `code===0 && data`；omni 用 `omni-video/{id}`。结果 `data.task_status∈{submitted,processing,succeed,failed}`，URL 在 `data.task_result.videos[0].url`。

注意：kapon omni-video 用 `image_list[{image_url,type}]`（first_frame/end_frame）+ `video_list`，**没有 element_list（命名角色）**——后端 omni 客户端 generateKlingO1 也未实现 element_list，故 kapon omni 暂不支持命名元素；该模式仍需 apimart（或确认 kapon 是否支持后再补）。

## 推荐架构（方案①，且不破坏 apimart）
后端用「专用 metadata 命名空间」把 kapon 原生请求带过去，apimart 看不见、不受影响；new-api kapon-kling 适配器只做**薄转发**，不在 Go 里重写 generateKling：
1. 后端 createNewApiVideoTask 针对 kling：在 payload.metadata 增加 `kapon: { mode, endpoint_suffix, body }`（body = 已构造好的 kapon 原生 payload，复用后端 generateKling/generateKlingO1 的构造逻辑）。apimart 适配器忽略该键 → 不破坏。
2. new-api kling 适配器（仅 istanvasMartRelay 分支）：若 metadata.kapon 存在 → BuildRequestURL 用其 endpoint_suffix、BuildRequestBody 直接发 body、FetchTask 按 suffix 拼 `/{id}`（omni 用 omni-video）。否则维持现有 image2video/text2video 行为（兼容）。
   - 图片须为 kapon 可拉取的 URL（后端已 uploadBase64ImageToOSS / normalizeFirstPartyAssetUrl）。
3. 重建 new-api（`docker compose build new-api && up -d`），把 kapon-kling(#433) 及其 kling abilities 优先级提到 apimart(1000) 之上（如 1200），apimart 留作回落。

## 尊享（腾讯）补全
尊享 kling 经后端 `shouldRouteVideoToManagedTencent=true → generateVideoLegacy → generateManagedKling26/30/O3`，这些已构造 apimart/腾讯形状的全模式参数，经 `/proxy/tencent/vod` 记账。需核对 generateManagedKling* 对首尾帧/多图/参考/omni 的腾讯分支是否齐全（用户确认腾讯支持），缺的补上。

## 测试矩阵（需 kapon 可拉取的 OSS 图）
v2-6 / v3 / omni × {文生, 单图, 首尾帧, 多图, 参考, omni元素(若支持), 参考视频, 声音}，普通看落 #433、尊享看 `/proxy/tencent/vod`，均确认 new-api 有 consume log + 任务能轮询到 succeed。

## 不动项
apimart 适配器(type 59)、vidu 适配器(type 52)、distributor、官方 Kling(非 sk-)分支。
