# 统一模型管理未填入动态价格模型清单

生成时间：2026-04-14

数据来源：
- 数据库 `SystemSetting.key = model_provider_mapping_v2`
- 仅统计 `enabled !== false` 的模型

判定口径：
- “已填入动态价格”指任一 vendor 存在以下任一配置：
  - `pricing.matchingRules`
  - `pricing.evaluators`
  - `pricing.formula.adjustments`
  - `pricing.rules`
- 不算动态价格：
  - 仅有 `creditsPerCall`
  - 仅有 `priceYuan`
  - 仅有 `pricing.defaults`
  - 完全没有 `pricing`

结论：
- 当前共有 16 个已启用模型尚未填入动态价格
- 其中大部分只有静态 `creditsPerCall`
- 这些模型当前仍可计费，但还没有接入统一模型管理的动态价格规则

## 图片模型

1. `gemini-3-pro-image`
   - 名称：Nano Banana Pro
   - 默认 vendor：`banana`
   - 当前静态价格：`creditsPerCall = 30`

2. `gemini-3.1-image`
   - 名称：Nano Banana 2
   - 默认 vendor：`banana-3.1`
   - 当前静态价格：`creditsPerCall = 20`

3. `gemini-image-edit`
   - 名称：Nano Banana Pro 图像编辑
   - 默认 vendor：`banana`
   - 当前静态价格：`creditsPerCall = 30`

4. `gemini-3.1-image-edit`
   - 名称：Nano Banana 2 图像编辑
   - 默认 vendor：`banana-3.1`
   - 当前静态价格：`creditsPerCall = 20`

5. `gemini-image-blend`
   - 名称：Nano Banana Pro 图像融合
   - 默认 vendor：`banana`
   - 当前静态价格：`creditsPerCall = 30`

6. `gemini-3.1-image-blend`
   - 名称：Nano Banana 2 图像融合
   - 默认 vendor：`banana-3.1`
   - 当前静态价格：`creditsPerCall = 20`

7. `gemini-image-analyze`
   - 名称：Gemini 图像分析
   - 默认 vendor：`gemini`
   - 当前静态价格：`creditsPerCall = 6`

8. `gemini-2.5-image-edit`
   - 名称：Nano Banana Fast 图像编辑
   - 默认 vendor：`banana-2.5`
   - 当前静态价格：`creditsPerCall = 30`

9. `gemini-2.5-image-blend`
   - 名称：Nano Banana Fast 图像融合
   - 默认 vendor：`banana-2.5`
   - 当前静态价格：`creditsPerCall = 30`

10. `gemini-2.5-image-analyze`
    - 名称：Nano Banana Fast 图像分析
    - 默认 vendor：`banana-2.5`
    - 当前静态价格：`creditsPerCall = 20`

11. `seedream5`
    - 名称：Seedream 5.0
    - 默认 vendor：`seedream5`
    - 当前静态价格：`creditsPerCall = 30`

12. `midjourney`
    - 名称：Midjourney
    - 默认 vendor：`midjourney`
    - 当前静态价格：`creditsPerCall = 50`

## 视频模型

13. `wan-2.6`
    - 名称：Wan 2.6
    - 默认 vendor：`dashscope`
    - 当前静态价格：`creditsPerCall = 600`

14. `wan-2.6-r2v`
    - 名称：Wan 2.6 参考视频
    - 默认 vendor：`dashscope`
    - 当前静态价格：`creditsPerCall = 600`

15. `wan-2.7`
    - 名称：Wan 2.7
    - 默认 vendor：`dashscope`
    - 当前静态价格：`creditsPerCall = 600`

16. `sora-2`
    - 名称：Sora 2
    - 默认 vendor：`sora2_api`
    - vendor 数量：2
    - 当前状态：
      - `sora2_api` 没有动态价格配置
      - `tencent_vod` 没有动态价格配置
      - 两个 vendor 也都没有静态 `creditsPerCall`

## 额外观察

- 当前数据库里已经填入动态价格的模型，主要集中在视频统一模型：
  - `kling-2.6`
  - `kling-3.0`
  - `kling-o3`
  - `vidu-q2`
  - `vidu-q3`
  - `seedance-1.5`
  - `seedance-2.0`

- 图片统一模型目前基本仍停留在“静态积分”阶段，尚未迁到 pricing v2 动态规则。

- `sora-2` 是当前最危险的一项：
  - 没有动态价格
  - 也没有静态 `creditsPerCall`
  - 后续若强依赖统一模型管理计价，容易直接出现“价格未配置”类问题

## 建议优先级

P0：
- `sora-2`
- `gemini-2.5-image-analyze`
- `gemini-image-analyze`

P1：
- 所有 Banana 图片链路
  - `gemini-3-pro-image`
  - `gemini-3.1-image`
  - `gemini-image-edit`
  - `gemini-3.1-image-edit`
  - `gemini-image-blend`
  - `gemini-3.1-image-blend`
  - `gemini-2.5-image-edit`
  - `gemini-2.5-image-blend`

P2：
- `seedream5`
- `midjourney`
- `wan-2.6`
- `wan-2.6-r2v`
- `wan-2.7`
