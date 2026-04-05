# 腾讯视频 API 接入 Checklist

说明：
- 本清单用于跟踪视频模型接入进度。
- 每项完成后，将对应的 `- [ ]` 改为 `- [x]`。

## Tencent Video API

- [x] 确认官方文档与接口协议
  创建任务：`CreateAigcVideoTask`
  查询任务：`DescribeTaskDetail`
  文档：
  `/Users/libiqiang/business/Tanva/task/【通用】VOD AIGC服务接入指南 (1).docx`
  域名：`vod.tencentcloudapi.com`

- [x] 接入 `Kling API`
- [x] 接入 `Kling 2.6` 模型
- [x] 接入 `Kling 3.0` 模型
- [x] 接入 `Kling 3.0-Omni` 模型

- [x] 接入 `Vidu API`
- [x] 接入 `Vidu Q2` 模型
- [x] 接入 `Vidu Q2-Turbo` 模型
- [x] 接入 `Vidu Q2-Pro` 模型
- [x] 接入 `Vidu Q3` 模型
- [x] 接入 `Vidu Q3-Mix` 模型

- [x] 接入 `Sora 2 API`
- [x] 接入 `Sora 2.0` 模型

- [x] 接入 `Seedance API`
- [x] 接入 `Seedance 1.5-Pro` 模型
- [x] 接入 `Seedance 2.0` 模型

## 验收补充

- [x] 腾讯视频创建任务走 `vod.tencentcloudapi.com`
- [x] 腾讯视频查询任务走 `vod.tencentcloudapi.com`
- [x] `TaskId / Status / FileId / FileUrl / Message / RequestId` 已完成映射
- [x] 后端接口已联通并可创建任务
- [x] 任务查询/轮询已联通
- [x] 前端节点/入口已接入
- [x] 模型配置与文案已补齐
- [x] 基本可用性测试已完成
