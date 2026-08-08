# 画布视频 VOD-only 约定

当前画布中的 Kling 2.6、Kling 3.0、Kling 3.0 Omni、Vidu Q2/Q3、Hailuo H3 只允许使用 Tencent VOD 托管线路。前端以节点配置中的 Tencent vendor 为判定依据，将该模型的可见路由收敛为一个，并在新建、加载旧节点和运行前分别保证：

- `vendorKey/platformKey` 为 `tencent_vod`（兼容旧键 `tengxun`）；
- `channelTier=vip`；
- 不显示普通/尊享切换器；
- 不因旧节点的 `channelSelectionExplicit=false` 回落到普通线路。

Backend 使用 `NEW_API_KEY_VIP` 调 new-api `/v1/videos`，任务 ID 使用 `newapivod:`，创建与轮询必须使用同一 token。new-api 的 type 67 adaptor 转发 `metadata` 和 `provider_options`，以保留 Vidu 具体版本、Kling 声音、参考视频和分镜等能力。

Seedance、Wan、HappyHorse 不应用该前端收敛规则。完整链路与部署补丁说明见 `helloagents/wiki/tencent-vod-canvas-video-routing.md`。
