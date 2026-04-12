# 2026-04-12 Video Pricing Ops Checklist

来源资料：
- `task/视频模型官方价格表 (1).xlsx`

目标：
- 让运营可按“模型支持参数”配置视频价格，而不是手写底层字段名。
- 保证前端积分预估与后端实际扣费使用同一套视频定价语义。
- 默认交互以“显式规则 / 公式”配置为主，减少误配。

## Checklist

- [x] 梳理价格表中的核心业务维度：模型档位、分辨率、时长、输入形态。
- [x] 抽出视频定价 canonical context：`resolution`、`duration`、`aspectRatio`、`inputType`、`hasAudio`。
- [x] 后端在模型管理定价解析前统一归一化视频请求上下文。
- [x] 前端 managed route pricing 支持 `pricing.formula`，避免与后端扣费结果不一致。
- [x] Admin「统一模型管理」为视频模型提供业务化条件选择器，不再要求运营手写 `mode/resolution` 文本条件。
- [x] Admin 支持配置“视频条件规则”，可直接表达“有声 + 视频输入 + 4K + 10s”这类固定价。
- [x] Admin 线性定价增量项改为使用模型支持参数的下拉选择，并显示中英文标签。
- [x] 模型 metadata 透出 `inputModes`，让价格配置只出现当前模型真实支持的参数选项。
- [x] 视频厂商新增“未命中条件时允许回退默认价”开关；默认按不可用处理，避免未配置规格误扣默认积分。
- [x] 管理台新增定价预览面板，支持当前模型试算与全部模型默认规格总览。
- [x] 新增自动化测试，覆盖 canonical context 映射与公式/固定规则解析。
- [x] 完成前后端构建验证。

## Test Cases

自动化：
- [x] `backend/test/video-pricing-context.test.ts`
  - [x] `reference_images / first_clip / image_video_audio` 等原始 mode 映射为 canonical `inputType`
  - [x] `generateAudio / sound / resolution / duration` 归一化为 `hasAudio / resolution / duration`
  - [x] 从图片 / 视频 / 音频素材 URL 自动推断 `inputType`
- [x] `backend/test/model-pricing-resolver.test.ts`
  - [x] 精确规则优先于公式和默认价
  - [x] 公式价按 `duration` 等乘数字段正确累计并输出 breakdown
  - [x] `defaultAvailable=false` 时，未命中规格返回不可用而不是回退默认价

人工回归：
- [x] Admin 视频模型配置页点击“新增增量项”能立即出现可编辑行
- [x] Admin 视频规则可通过下拉选择“输入类型 / 音频 / 分辨率 / 时长”
- [x] 关闭“允许回退默认价”后，前端节点积分预估与运行按钮会把未命中规格视为不可用
- [x] Admin 可直接预览当前模型指定条件的积分来源、最终积分、人民币价格和公式拆解
- [x] Admin 可查看全部模型默认规格的定价总览
- [x] 前端构建通过，视频节点仍能解析 managed route 定价
- [x] 后端构建通过，积分预扣费仍能读取模型管理价格

## Verification Commands

```bash
cd backend && npm test
cd backend && npm run build
cd frontend && npm run build
```

## Local Environment Apply

- [x] 已将 `task/视频模型官方价格表 (1).xlsx` 中选定视频模型价格按 `priceYuan * 100 = credits` 写入本地 `systemSetting.model_provider_mapping_v2`
- [x] 已生成本地执行前备份：`task/model_provider_mapping_v2.backup.2026-04-12T14-14-01-512Z.json`
- [x] 已回查关键模型配置：`vidu-q3/tencent_vod`、`kling-3.0/tencent_vod`、`kling-o3/legacy`、`seedance-1.5/seedance_api`、`seedance-2.0/seedance_api`
- [x] `seedance-2.0` 的“含视频输入区间价”仍保持不可用，避免把区间价误配置成精确积分
