# 变更提案：Seedance 2.5 接入

## 元信息

```yaml
类型: 功能
方案类型: proposal
优先级: P0
状态: 已完成
创建: 2026-07-31
```

## 需求

在现有 Seedance 2.x 画布与 Ark 官方通道中增加 Seedance 2.5：

- 上游模型 ID 固定为 `doubao-seedance-2-5`
- 当前只支持 `480P`、`720P`
- 继续按处理视频时长线性计费
- 对应分辨率的单价为当前标准 Seedance 2.0 的 `1.5x`

## 设计

1. 不新增顶层托管模型，继续使用 `modelKey=seedance-2.0`，以 `seedanceModel=seedance-2.5` 作为定价和上游路由子维度。
2. 前端 selector、请求类型与 Flow 运行时保留 2.5 值；分辨率选项只暴露 480P/720P，切换时清理旧非法值。
3. 后端把所有 2.5 别名规范为 `seedance-2.5`，精确映射到 `doubao-seedance-2-5`，固定走 `seedance_api/default`，并在预扣前拒绝 1080P/4K。
4. 复用现有 Seedance 2.x 的一次性 Ark 素材、参考媒体限制、任务查询和 `output + unique reference videos` 总计费时长。
5. 在统一定价书加入两条独立线性规则：
   - 480P：`1.25 × 1.5 = 1.875 元/秒`
   - 720P：`1.50 × 1.5 = 2.25 元/秒`
6. `SEEDANCE20_FREE` 是已有 2.0/Fast/Mini 活动开关；2.5 作为独立付费 SKU 不纳入活动。
7. new-api 通过幂等 PostgreSQL patch 从现有 2.0 官渠克隆 ability，不写入凭据；模型目录只声明 480P/720P。

## 验收标准

- Flow 可选择 Seedance 2.5，且只能选择 480P/720P。
- 后端上游 payload 的模型 ID 为 `doubao-seedance-2-5`。
- 2.5 的 5 秒 480P/720P 价格分别为 938/1125 积分。
- 参考视频继续计入总处理时长。
- new-api 能识别、路由并展示 2.5 的按时长价格。
- 前端、后端与 new-api 针对性检查通过，知识库与变更日志同步。
