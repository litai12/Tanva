# 任务清单：Seedance 2.5 接入

目录：`helloagents/plan/202607311500_seedance25_integration/`

## 执行状态

```yaml
总任务: 8
已完成: 8
完成率: 100%
```

## 任务列表

- [√] 分析现有 Seedance 2.0 的 Flow、后端路由、计费与 new-api 链路。
- [√] 增加前端 2.5 型号、别名规范化和 480P/720P 选择限制。
- [√] 增加后端精确 Ark ID 路由与 480P/720P 服务端校验。
- [√] 增加 2.5 的 1.5 倍线性定价、账单名称和价格验证。
- [√] 注册 new-api Ark adapter 模型与参数定价。
- [√] 增加幂等 PostgreSQL 模型、channel、ability 与价格补丁。
- [√] 同步 SSOT、模块 wiki、OpenAPI 与变更日志。
- [√] 运行前端 build、后端 build/计费验证和 Go 针对性测试；前端全量 lint 仍受仓库既有 2729 条问题（含 `tmp_head_aiChatStore.ts` 二进制解析错误）阻塞，本次新增行的针对性 ESLint 检查无新增问题。
