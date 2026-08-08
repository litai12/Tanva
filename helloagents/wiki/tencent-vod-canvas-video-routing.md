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

若创建接口返回 `No available channel for model ... under group vip`，先检查 `abilities` 是否存在对应模型的 `vip` 行；仅有 `default`/`auto` 不足以服务 `NEW_API_KEY_VIP`。本地 compose 的历史数据库需要重新执行上述幂等补丁并重启 new-api，使内存路由缓存刷新。

## 能力传递

- Kling：支持 720P、1080P、2K、4K；2K/4K 自动带 `EnhanceSwitch=Enabled`。3.0/Omni 为 3–15 秒，2.6 为 5/10 秒。首帧使用 `Usage=FirstFrame`，首尾帧使用首帧角色加 `LastFrameUrl`；3.0 普通版不接收参考视频或多主体参考图，只有 Omni 可用 `Usage=Reference` 和参考视频。Omni 参考视频限制为 3–10 秒且不支持 4K。2.6 首尾帧强制无声，预估与实际提交使用同一个无声参数。
- Kling 3.0 与 3.0-Omni 4K 无参考视频：无声/有声的腾讯 VOD 刊例价均为 `3 元/秒`，Tanva 按 `300 积分/秒` 预扣；例如 3 秒为 900 积分。
- Vidu：画布显式提供文生、首帧、首尾帧、参考四种输入模式。Q3 文生/首帧/首尾帧使用 `q3-pro`，参考模式使用 `q3` 和 `FileInfos[].Usage=Reference`，最多 7 张参考图；具体版本不会再被压扁成错误的 q2/q3 请求。
- Vidu 正常价：画布不再显示错峰开关，历史 `offPeak=true` 会在前端试算、Backend 计费上下文和 Tencent 请求三层归一为关闭。Vidu Q3/Q3-Pro 的 540P、720P、1080P、2K、4K 规则均只保留正常价。
- Hailuo H3：继续由 new-api 模型目录和现有 H3 动态计价逻辑作为规格与价格唯一来源。Tanva 后端会重复校验最多 9 图、3 视频、3 音频、合计 12 个文件以及“音频不能单独参考”，首尾帧发送正确角色；原生音频生成默认开启，画布可关闭。

## 回归验证

- `cd backend && npm run verify:vod-video-routing`
- `cd frontend && npm run test:video-provider-params && npm run build`
- 使用 VIP token 查询 new-api `/v1/models`，六个业务模型必须全部可见；数据库中它们只能存在 type 67 的启用 ability。
- `kling-o3 + 4K + sound=on + 3s` 的 `/api/credits/preview` 必须返回 900 积分。
