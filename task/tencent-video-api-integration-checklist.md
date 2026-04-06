# 腾讯视频 API 接入 Checklist

说明：

- 本清单用于跟踪视频模型接入进度。
- 每项完成后，将对应的 `- [ ]` 改为 `- [x]`。

## Tencent Video API

- [X] 确认官方文档与接口协议
  创建任务：`CreateAigcVideoTask`
  查询任务：`DescribeTaskDetail`
  文档：
  `/Users/libiqiang/business/Tanva/task/【通用】VOD AIGC服务接入指南 (1).docx`
  域名：`vod.tencentcloudapi.com`
- [X] 接入 `Kling API`
- [X] 接入 `Kling 2.6` 模型
- [X] 接入 `Kling 3.0` 模型
- [X] 接入 `Kling 3.0-Omni` 模型
- [X] 接入 `Vidu API`
- [X] 接入 `Vidu Q2` 模型
- [X] 接入 `Vidu Q2-Turbo` 模型
- [X] 接入 `Vidu Q2-Pro` 模型
- [X] 接入 `Vidu Q3` 模型
- [X] 接入 `Vidu Q3-Mix` 模型
- [X] 接入 `Sora 2 API`
- [X] 接入 `Sora 2.0` 模型
- [X] 接入 `Seedance API`
- [X] 接入 `Seedance 1.5-Pro` 模型

## JSON V2 映射落地

说明：

- 以下模型统一按 `model_provider_mapping_v2` 落地。
- 腾讯 VOD 公共平台模板统一承载厂商域名、创建任务、查询任务、轮询状态映射。
- 模型 vendor 只保留 `platformKey / provider / modelName / modelVersion / defaultVendor` 等差异字段。
- 参考文档：`/Users/libiqiang/business/Tanva/task/【通用】VOD AIGC服务接入指南 (1).docx`

### 平台模板

- [X] `platformKey=tencent_vod`
  - `route=tencent_vod`
  - `endpoint=https://vod.tencentcloudapi.com/`
  - `upstreamDomain=vod.tencentcloudapi.com`
  - `createTask.action=CreateAigcVideoTask`
  - `queryTask.action=DescribeTaskDetail`
  - `queryTask.url=https://vod.tencentcloudapi.com/`
  - `polling.strategy=describe_task_detail`
  - `responseMapping=TaskId / Status / FileId / FileUrl / Message / RequestId`

### 模型映射

说明：

- 下列条目表示“代码/配置已支持该模型接入腾讯 VOD”，不等于“当前默认一定走腾讯 VOD”。
- 当前实际生效状态以 `model_provider_mapping_v2` 设置值为准；本文件同时记录默认配置基线。

- [X] `kling-2.6`
  - 代码已支持 `tencent_vod` 接入
  - 当前默认配置：`defaultVendor=legacy`
  - 当前默认基线未启用 `tencent_vod vendor`
- [X] `kling-3.0`
  - `platformKey=tencent_vod`
  - `provider=kling-o3`
  - `modelName=Kling`
  - `modelVersion=3.0`
  - 当前默认配置：`defaultVendor=legacy`
  - 当前默认基线启用 `tencent_vod vendor`
- [X] `kling-o3`
  - `platformKey=tencent_vod`
  - `provider=kling-o3`
  - `modelName=Kling`
  - `modelVersion=3.0-Omni`
  - 当前默认配置：`defaultVendor=tencent_vod`
- [X] `vidu-q2`
  - `platformKey=tencent_vod`
  - `provider=vidu`
  - `modelName=Vidu`
  - `modelVersion=q2`
  - 当前默认配置：`defaultVendor=tencent_vod`
- [X] `vidu-q2-turbo`
  - `platformKey=tencent_vod`
  - `provider=vidu`
  - `modelName=Vidu`
  - `modelVersion=q2-turbo`
- [X] `vidu-q2-pro`
  - `platformKey=tencent_vod`
  - `provider=vidu`
  - `modelName=Vidu`
  - `modelVersion=q2-pro`
- [X] `vidu-q3`
  - `platformKey=tencent_vod`
  - `provider=vidu`
  - `modelName=Vidu`
  - `modelVersion=q3`
  - 当前默认配置：`defaultVendor=tencent_vod`
- [X] `vidu-q3-mix`
  - `platformKey=tencent_vod`
  - `provider=vidu`
  - `modelName=Vidu`
  - `modelVersion=q3-mix`
- [X] `sora-2`
  - `platformKey=tencent_vod`
  - `provider=sora2`
  - `modelName=OS`
  - `modelVersion=2.0`
  - 当前默认配置：`defaultVendor=tencent_vod`
- [X] `seedance-1.5`
  - `platformKey=tencent_vod`
  - `provider=doubao`
  - `modelName=Seedance`
  - `modelVersion=1.5-pro`
  - 当前默认配置：`defaultVendor=tencent_vod`
- [X] `seedance-2.0`
  - 代码已支持 `seedance_api` v2 request profile
  - 当前默认配置：`enabled=false`

## 验收补充

- [X] 腾讯视频创建任务走 `vod.tencentcloudapi.com`
- [X] 腾讯视频查询任务走 `vod.tencentcloudapi.com`
- [X] `TaskId / Status / FileId / FileUrl / Message / RequestId` 已完成映射
- [X] 后端接口已联通并可创建任务
- [X] 任务查询/轮询已联通
- [X] 前端节点/入口已接入
- [X] 模型配置与文案已补齐
- [X] 基本可用性测试已完成

## 当前默认配置基线（已同步）

- [X] `kling-2.6`: 默认 `legacy`，仅保留旧链路 vendor
- [X] `kling-3.0`: 默认 `legacy`，同时启用 `tencent_vod`
- [X] `kling-o3`: 默认 `tencent_vod`
- [X] `vidu-q2`: 默认 `tencent_vod`
- [X] `vidu-q3`: 默认 `tencent_vod`
- [X] `sora-2`: 默认 `tencent_vod`
- [X] `seedance-1.5`: 默认 `tencent_vod`
- [X] `seedance-2.0`: 默认禁用
