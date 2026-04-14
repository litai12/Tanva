# Tanva 视频价格表到 Pricing Rule Schema 映射样例

## 1. 文档目标

本文件用于验证：

- 组合定价引擎设计是否真的能装下当前 `xlsx`
- 如何把真实价格表映射为结构化规则
- 哪些模型适合 `linear`
- 哪些模型必须 `lookup_matrix`

参考来源：

- [视频模型官方价格表 (1).xlsx](/Users/libiqiang/business/Tanva/task/视频模型官方价格表%20(1).xlsx)

## 2. 建议的数据承载方式

每个产品模型下，挂多个 vendor。每个 vendor 下，挂一个 `pricingBook`。

```json
{
  "modelKey": "example-model",
  "vendors": [
    {
      "vendorKey": "kapon",
      "pricingBook": {
        "version": "v1",
        "rules": []
      }
    }
  ]
}
```

## 3. 示例一：Q3 Turbo

### 3.1 原始表特征

- 模型：`Q3-turbo`
- 模式：图生视频 / 文生视频 / 首尾帧
- 分辨率：540P / 720P / 1080P
- 时长：1-16 秒
- 价格规律：完全线性

### 3.2 适合的 evaluator

- `linear`

### 3.3 映射样例

```json
{
  "modelKey": "q3-turbo-video",
  "vendors": [
    {
      "vendorKey": "kapon",
      "pricingBook": {
        "version": "v1",
        "rules": [
          {
            "ruleKey": "q3_turbo_540p",
            "enabled": true,
            "priority": 50,
            "when": {
              "all": [
                { "field": "generationMode", "op": "in", "value": ["t2v", "i2v", "start_end_frame"] },
                { "field": "resolution", "op": "eq", "value": "540P" }
              ]
            },
            "evaluator": {
              "type": "linear",
              "unitField": "durationSec",
              "unitPriceYuan": 0.25
            }
          },
          {
            "ruleKey": "q3_turbo_720p",
            "enabled": true,
            "priority": 50,
            "when": {
              "all": [
                { "field": "generationMode", "op": "in", "value": ["t2v", "i2v", "start_end_frame"] },
                { "field": "resolution", "op": "eq", "value": "720P" }
              ]
            },
            "evaluator": {
              "type": "linear",
              "unitField": "durationSec",
              "unitPriceYuan": 0.375
            }
          },
          {
            "ruleKey": "q3_turbo_1080p",
            "enabled": true,
            "priority": 50,
            "when": {
              "all": [
                { "field": "generationMode", "op": "in", "value": ["t2v", "i2v", "start_end_frame"] },
                { "field": "resolution", "op": "eq", "value": "1080P" }
              ]
            },
            "evaluator": {
              "type": "linear",
              "unitField": "durationSec",
              "unitPriceYuan": 0.5
            }
          }
        ]
      }
    }
  ]
}
```

### 3.4 示例报价

- `540P + 8s -> 2.0 元 -> 200 积分`
- `720P + 8s -> 3.0 元 -> 300 积分`
- `1080P + 8s -> 4.0 元 -> 400 积分`

## 4. 示例二：Q2 Pro 参考生

### 4.1 原始表特征

- 模型：`Q2 pro-参考生`
- 分辨率：540P / 720P / 1080P
- 时长：1-10 秒
- 价格看起来接近线性，但第一阶段不建议强行抽象为公式

### 4.2 适合的 evaluator

- `lookup_matrix`

### 4.3 映射样例

```json
{
  "modelKey": "q2-pro-reference-video",
  "vendors": [
    {
      "vendorKey": "kapon",
      "pricingBook": {
        "version": "v1",
        "rules": [
          {
            "ruleKey": "q2_pro_reference_matrix",
            "enabled": true,
            "priority": 80,
            "when": {
              "all": [
                { "field": "generationMode", "op": "eq", "value": "reference" }
              ]
            },
            "evaluator": {
              "type": "lookup_matrix",
              "axes": ["resolution", "durationSec"],
              "matrix": {
                "540P": {
                  "1": 0.625,
                  "2": 0.781,
                  "3": 0.938,
                  "4": 1.094,
                  "5": 1.25,
                  "6": 1.406,
                  "7": 1.563,
                  "8": 1.719,
                  "9": 1.875,
                  "10": 2.031
                },
                "720P": {
                  "1": 0.938,
                  "2": 1.094,
                  "3": 1.25,
                  "4": 1.406,
                  "5": 1.563,
                  "6": 1.719,
                  "7": 1.875,
                  "8": 2.031,
                  "9": 2.188,
                  "10": 2.344
                },
                "1080P": {
                  "1": 2.344,
                  "2": 2.5,
                  "3": 2.656,
                  "4": 2.813,
                  "5": 2.969,
                  "6": 3.125,
                  "7": 3.281,
                  "8": 3.438,
                  "9": 3.594,
                  "10": 3.75
                }
              }
            }
          }
        ]
      }
    }
  ]
}
```

### 4.4 说明

这类模型后续如果确认严格线性，再考虑优化成 `linear`。第一阶段优先保证精确还原。

## 5. 示例三：Kling-2.6 图生视频

### 5.1 原始表特征

- 模型：`Kling-2.6 图生视频`
- 维度：`声音(hasAudio)` × `模式(qualityMode)` × `时长(durationSec)`
- 时长只有 `5` / `10`
- 价格不是简单线性，而是组合查价

### 5.2 适合的 evaluator

- `lookup_matrix`

### 5.3 映射样例

```json
{
  "modelKey": "kling-2.6-video",
  "vendors": [
    {
      "vendorKey": "kapon",
      "pricingBook": {
        "version": "v1",
        "rules": [
          {
            "ruleKey": "kling_26_audio_quality_duration_matrix",
            "enabled": true,
            "priority": 100,
            "when": {
              "all": [
                { "field": "generationMode", "op": "eq", "value": "i2v" }
              ]
            },
            "evaluator": {
              "type": "lookup_matrix",
              "axes": ["hasAudio", "qualityMode", "durationSec"],
              "matrix": {
                "false": {
                  "std": {
                    "5": 1.5,
                    "10": 3
                  },
                  "pro": {
                    "5": 3,
                    "10": 5
                  }
                },
                "true": {
                  "std": {
                    "5": 5,
                    "10": 10
                  },
                  "pro": {
                    "5": 6,
                    "10": 12
                  }
                }
              }
            }
          }
        ]
      }
    }
  ]
}
```

### 5.4 示例报价

- `无声 + std + 5s -> 1.5 元 -> 150 积分`
- `有声 + pro + 10s -> 12 元 -> 1200 积分`

## 6. 示例四：Kling-3.0 文生/图生/首尾帧

### 6.1 原始表特征

- 模型：`Kling-3.0 文生-图生-首尾帧`
- 维度：`hasAudio` × `qualityMode` × `durationSec`
- `qualityMode` 本身已带分辨率语义：
- `std -> 720P`
- `pro -> 1080P`

### 6.2 推荐映射策略

不要在第一阶段强行拆开 `qualityMode` 和 `resolution` 的价格来源关系。

建议：

- `qualityMode` 作为主定价维度
- `resolution` 作为派生展示字段

### 6.3 映射样例

```json
{
  "modelKey": "kling-3.0-video",
  "vendors": [
    {
      "vendorKey": "kapon",
      "pricingBook": {
        "version": "v1",
        "rules": [
          {
            "ruleKey": "kling_30_matrix",
            "enabled": true,
            "priority": 100,
            "when": {
              "all": [
                { "field": "generationMode", "op": "in", "value": ["t2v", "i2v", "start_end_frame"] }
              ]
            },
            "evaluator": {
              "type": "lookup_matrix",
              "axes": ["hasAudio", "qualityMode", "durationSec"],
              "matrix": {
                "false": {
                  "std": {
                    "5": 3,
                    "10": 6
                  },
                  "pro": {
                    "5": 4,
                    "10": 8
                  }
                },
                "true": {
                  "std": {
                    "5": 4.5,
                    "10": 9
                  },
                  "pro": {
                    "5": 6,
                    "10": 12
                  }
                }
              }
            },
            "metadata": {
              "qualityToResolution": {
                "std": "720P",
                "pro": "1080P"
              }
            }
          }
        ]
      }
    }
  ]
}
```

### 6.4 说明

这种场景提醒我们：

- 某些表中的“模式”字段本身就包含定价语义
- 不应机械地把每一列都拆成独立维度
- 系统要允许“一个字段承载多个业务含义”

## 7. 示例五：Q3 标准版

### 7.1 原始表特征

- `Q3 720P = 0.9375/秒`
- `Q3 1080P = 1.0/秒`
- 适合线性

### 7.2 映射样例

```json
{
  "modelKey": "q3-video",
  "vendors": [
    {
      "vendorKey": "kapon",
      "pricingBook": {
        "version": "v1",
        "rules": [
          {
            "ruleKey": "q3_720p_linear",
            "enabled": true,
            "priority": 50,
            "when": {
              "all": [
                { "field": "resolution", "op": "eq", "value": "720P" }
              ]
            },
            "evaluator": {
              "type": "linear",
              "unitField": "durationSec",
              "unitPriceYuan": 0.9375
            }
          },
          {
            "ruleKey": "q3_1080p_linear",
            "enabled": true,
            "priority": 50,
            "when": {
              "all": [
                { "field": "resolution", "op": "eq", "value": "1080P" }
              ]
            },
            "evaluator": {
              "type": "linear",
              "unitField": "durationSec",
              "unitPriceYuan": 1.0
            }
          }
        ]
      }
    }
  ]
}
```

## 8. 方案验证结论

基于以上样例，可以得到明确结论：

### 8.1 能被统一承载的，不是单一公式

真正可统一的是：

- 统一 `PricingContext`
- 统一 `Rule`
- 统一 `Evaluator` 接口
- 统一 `QuoteResult`

### 8.2 第一阶段不应强行“公式化一切”

优先级建议：

- 能精确矩阵就先用矩阵
- 明显线性再用线性
- 后续再做归纳优化

### 8.3 当前 `xlsx` 至少需要以下 evaluator

- `linear`
- `lookup_matrix`

第二阶段可能再加：

- `base_plus_linear`
- `piecewise`

## 9. 第一阶段实施建议

建议第一阶段仅做：

1. 视频模型接入新 rule engine
2. 支持 `linear` 和 `lookup_matrix`
3. 统一输出 `priceYuan` 和 `credits`
4. 统一换算：

```ts
credits = ceil(priceYuan * 100)
```

5. 前端价格一览、按钮提示、下单扣费全部消费同一个 quote 结果

## 10. 最终结论

这份 `xlsx` 可以被统一模型管理方案承载，但前提是：

- 不是“模型 + 固定积分”
- 不是“简单条件 + 固定 price bundle”
- 而是“组合条件匹配 + 多 evaluator 求值 + 统一积分换算”

换句话说，Tanva 要统一的不是一张价格表，而是一套定价引擎。
