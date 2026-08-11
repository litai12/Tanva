# 变更提案：Seedance 2.5 全模态任务类型前置引导

## 元信息

```yaml
类型: 兼容性功能
方案类型: proposal
优先级: P0
状态: 已完成
创建: 2026-08-11
```

## 背景

方舟为 Seedance 2.5 全模态参考任务新增 `omni_reference_task_type`，用于在创建阶段引导并预校验参考生成、视频编辑、视频延长三种子任务。模型仍会结合提示词后置复核，提示词与指定类型冲突时仍可能异步失败。

## 设计

1. 保留画布内部 `video_reference/video_editing/video_extend` 语义，集中映射为 `reference/edit/extend`；只有存在参考素材的全能参考任务才发送 `reference`。
2. 编辑模式固定 `ratio=adaptive,duration=-1`，输入视频限定 4–30 秒；延长固定 `ratio=adaptive` 并保留 4–30 秒输出时长；参考模式沿用合法比例和时长。
3. `VideoProviderRequestDto` 增加受枚举约束的 `omniReferenceTaskType`，Controller 在计费前推导、检查冲突与素材限制。
4. new-api `TaskSubmitReq` 与 Ark Doubao adapter 增加强类型字段和同级校验；直连 Ark 与数据库驱动的 V2 request profile 同步透传。
5. 编辑任务的前端价格预览按参考视频时长一次计费，与后端实际预扣保持一致。

## 验收标准

- 三种全模态子任务向 Ark 发送正确的 `omni_reference_task_type`。
- 编辑和延长在创建前阻止非法视频、比例或时长组合。
- 纯文生与首帧/首尾帧任务不发送全模态任务类型。
- 前端映射测试、new-api adapter 测试、前后端构建通过。
