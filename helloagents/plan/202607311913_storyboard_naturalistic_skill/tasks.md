# 任务清单：自然主义快节奏剧本转分镜 Skill

目录：`helloagents/plan/202607311913_storyboard_naturalistic_skill/`

## 执行状态

```yaml
总任务: 7
已完成: 7
完成率: 100%
```

## 任务列表

- [√] 分析现有 Skill、动态列生成、parser/serializer 与账号 Skill 库链路。
- [√] 设计拆镜创作/锁镜精修双模式及规则冲突优先级。
- [√] 实现自然主义快节奏内置 Skill。
- [√] 更新空分镜表默认列和转换兜底字段。
- [√] 增加针对性契约测试并同步 SSOT、wiki、用户文档与变更日志。
- [√] 运行前端测试、lint、build 和差异复核。
- [√] 按用户反馈增加八层细节密度规则、三秒手掌动作示例、特写结构稳定约束及回归验证。

## 验证结果

- `npm run test:storyboard-prompt-table`：8/8 通过。
- 变更文件针对性 ESLint：通过。
- `npm run build`：通过；仅保留仓库既有动态/静态 import 与 chunk size 警告。
- 用户反馈回归：八层细节规则、`>1.0s` 至少三段、3 秒手掌四段示例以及五指结构稳定约束已进入契约测试；8/8 继续通过。
- 全量 `npm run lint`：仍被仓库既有 2729 个问题阻塞（2534 errors / 195 warnings，包含 `tmp_head_aiChatStore.ts` 二进制解析错误）；本次变更文件无新增 ESLint 问题。
- `ai-metadata-sync`：本机 `/Users/libiqiang/.codex/Skills` 与 `/Users/libiqiang/.codex/skills` 均未安装该脚本，无法执行；未手工伪造 metadata。
