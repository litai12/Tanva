# Tasks

## 已完成（分析）

- [x] 核对 TapCanvas 资产规划与爆款复刻的公开接口、输入输出与计费方式。
- [x] 核对 Tanva new-api 的 Tanva 订单与 `tapcanvas_pending → tapcanvas_receipt` 对账链路。
- [x] 核对 Tanva `consumption-orders` 结算（markup 1.5，多退少补）。
- [x] 只读探测线上 `/public/v1/models` 与资产规划查询接口（鉴权与信封格式可用）。

## P1 资产规划

- [ ] 只读核对 TapCanvas 接入账户冻结的图片/视频模型配置；确认视频目标为 Tanva 有节点的模型。
- [x] TapCanvas T1：`GET /public/v1/asset-plans/{jobId}/receipt` 人民币回执 + 单测。
- [x] new-api N1：`POST /v1/tanva/asset-plans`、`…/:jobId/retry` 订单入口与回执类型 + 单测。
- [x] new-api N2：状态 / 结果 / 停止透传（仅限已绑定订单的 jobId）。
- [ ] new-api 配置 TapCanvas 渠道（轮换后的 Key、`price_ratio=1.0`）与 `tapcanvas-asset-plan` 预扣价格。
- [x] Tanva 后端：任务复用 `VideoTask`（`taskType='tapcanvas-plan'`），无需迁移。
- [x] Tanva 后端：`tapcanvas-plans` 模块（创建 / 查询 / 结果 / 停止 / 重试 / 模型目录），接入 `consumption-orders`。
- [x] 核实超额补扣：余额不足时订单转 `reconciliation_required` 持续重试；个人钱包提交时真实预扣，团队按余额校验。
- [x] Tanva 前端：改为画布节点「爆款复刻 & 一键成片」（进度、停止、续跑、刷新恢复）。
- [x] Tanva 前端：asset-plan v5 → Flow 节点映射纯函数 + 测试（48 节点真实夹具）。
- [x] Tanva 前端：`instantiateTemplate` 显式落点、分组布局、参考图按 referenceBindings 顺序连线。
- [ ] 端到端验收：真实章节规划、节点一致性、积分扣减与回执一致。
- [x] 同步 `helloagents/project.md`、`wiki/`、`CHANGELOG.md`。

## P2 一键复刻

- [ ] （可选升级）TapCanvas T2：`video-remakes` plan-only 模式，返回资产规划 jobId，替换节点复刻模式的规划来源。
- [x] Tanva：节点「爆款复刻」模式（参考视频作为规划素材），复用 P1 订单、轮询与映射。
