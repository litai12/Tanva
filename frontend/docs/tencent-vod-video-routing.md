# 画布视频 VOD-only 约定

当前画布中的 Kling 2.6、Kling 3.0、Kling 3.0 Omni、Vidu Q2/Q3、Hailuo H3 只允许使用 Tencent VOD 托管线路。前端以节点配置中的 Tencent vendor 为判定依据，将该模型的可见路由收敛为一个，并在新建、加载旧节点和运行前分别保证：

- `vendorKey/platformKey` 为 `tencent_vod`（兼容旧键 `tengxun`）；
- `channelTier=vip`；
- 不显示普通/尊享切换器；
- 不因旧节点的 `channelSelectionExplicit=false` 回落到普通线路。

Backend 使用 `NEW_API_KEY_VIP` 调 new-api `/v1/videos`，任务 ID 使用 `newapivod:`，创建与轮询必须使用同一 token。new-api 的 type 67 adaptor 转发 `metadata` 和 `provider_options`，以保留 Vidu 具体版本、Kling 声音、参考视频和分镜等能力。

`NEW_API_KEY_VIP` 只能命中 `vip` ability；type 67 渠道只有 `default`/`auto` 行时，价格预览仍可能成功，但实际创建会在 new-api distributor 阶段返回 503。Kling 3.0 与 3.0-Omni 4K 无参考视频的 VOD 刊例价为 3 元/秒，无声、有声统一对应 300 积分/秒。

所有 VOD 画布模型统一按正常价，不展示错峰入口；历史节点的 `offPeak` 值在试算和提交时固定归一为 `false`。Vidu 输入模式使用文生、首帧、首尾帧、参考四档：Q3 的前三档实际提交 `q3-pro`，参考档提交 `q3`，参考图最多 7 张。Kling 首尾帧角色必须保留；普通 3.0 不接受参考视频，Omni 参考视频为 3–10 秒且不支持 4K。Hailuo H3 默认生成原生音频，可在节点关闭，媒体数量限制由前端和后端共同校验。

Seedance、Wan、HappyHorse 不应用该前端收敛规则。完整链路与部署补丁说明见 `helloagents/wiki/tencent-vod-canvas-video-routing.md`。
