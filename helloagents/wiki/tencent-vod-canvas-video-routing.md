# 当前画布视频的 Tencent VOD 路由

## 适用模型

VOD-only 业务模型 ID：

- `kling-v2-6`
- `kling-v3`
- `kling-v3-omni`
- `vidu-q2`
- `vidu-q3`
- `hailuo-h3`

Seedance、Wan 与 HappyHorse 不属于本规则，继续使用各自现有线路。

## 请求链路

1. Flow 从公开节点配置读取托管路由；只要路由中存在 `tencent_vod`/`tengxun`，前端会移除同模型的其他 vendor 并将 VOD 设为默认。
2. 新节点直接保存 `channelTier=vip`；旧节点在渲染和运行前也会按当前配置自愈，不能通过历史 `channelSelectionExplicit=false` 回落。
3. Backend 将上述业务模型统一提交到 new-api `/v1/videos`，使用 `NEW_API_KEY_VIP`。返回任务加 `newapivod:` 前缀，轮询继续使用同一个 VIP token。
4. new-api type 67 adaptor 把统一请求的图片、视频、音频、metadata 与 `provider_options` 转发到 Backend 内部 Tencent VOD create/poll endpoint。
5. Backend 还原 Vidu 具体子型号及模式、Kling 声音/视频参考/分镜等参数，最后由 Tencent VOD AIGC service 签名提交。

## 网关部署

执行生产数据补丁 `new-api/patches/2026-08-08/001-force-canvas-vod-video-models.sql`。补丁会：

- 为 type 67 channel 同步六个模型；
- 在 `default`、`auto`、`vip` group 启用 type 67 ability；
- 禁用六个模型在其他 channel 上的同组 ability；
- 不修改 Seedance、Wan 或 HappyHorse。

部署前需确认 Backend 配置 `NEW_API_KEY_VIP`，且该 token 可命中 `vip` ability；type 67 channel 的 `base_url` 与内部 token 已由运维填写，不能保留 placeholder。

## 能力传递

- Kling：支持 720P、1080P、2K、4K；2K/4K 自动带 `EnhanceSwitch=Enabled`。3.0/Omni 为 3–15 秒，视频参考限制为 3–10 秒；2.6 为 5/10 秒。
- Vidu：保留 `q2-pro`、`q2-turbo`、`q3-pro`、`q3-turbo`、`q3-mix` 等具体版本，不再压扁成 q2/q3；参考模式使用 `FileInfos[].Usage=Reference`，图生使用 `FirstFrame`，错峰参数写入 `OutputConfig.OffPeak`。
- Hailuo H3：继续由 new-api 模型目录和现有 H3 动态计价逻辑作为规格与价格唯一来源。
