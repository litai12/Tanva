# 豆包 Seed 2.0 Lite 视频分析按时长计费

## 背景

`doubao-seed-2-0-lite-260428` 曾按 Responses token usage 结算，导致一段视频可能只扣 2 积分，和产品定价不一致。

## 目标

- Lite 视频分析按待分析视频的真实时长计费。
- 单价锚定标准付费 Seedance 2.0 480P，并取其 `1/3`。
- 当前 Seedance 2.0 480P 为 `1.25 元/秒`，所以 Lite 精确单价为 `125/3 积分/秒`。
- 先计算完整请求的精确总价，再向上取整为整数积分。
- 前端媒体时长仅用于预估；实扣使用后端安全下载后由 `ffprobe` 识别的时长。
- Mini/Pro 保持按 Responses token usage 后扣，Gemini 保持原有模型档位计费。

## 非目标

- 不改变视频生成的 Seedance 2.0 定价或限时免费开关。
- 不信任客户端上报时长作为最终扣费依据。
- 不改变豆包远程 `input_video.video_url` 的模型调用方式。
