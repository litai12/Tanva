# 任务清单：微信公众号登录二维码刷新防风暴

目录：`helloagents/plan/202608112130_wechat_qr_refresh_guard/`

## 执行状态

```yaml
总任务: 6
已完成: 6
完成率: 100%
```

## 任务列表

- [√] 定位独立登录页失败后 effect 立即重入的死循环根因。
- [√] 设计匿名访问者 5 秒原子限流及 Redis 降级策略。
- [√] 实现后端限流与 access token 并发请求合并。
- [√] 修复登录页/登录弹窗自动重试并增加刷新冷却反馈。
- [√] 更新认证 wiki、CHANGELOG 与技术约定。
- [√] 运行专项验证、前后端构建、lint 和差异检查。

## 验证记录

- `cd backend && npm run verify:wechat-login-rate-limit`：通过，覆盖同身份 5 秒窗口、窗口到期、不同 visitor、IPv4-mapped IPv6 归一化及 access token 并发合并/缓存。
- `cd backend && npm run build`：通过。
- `cd frontend && npm run build`：通过（仅保留仓库既有 chunk size / dynamic import 警告）。
- 本次三个前端文件的聚焦 ESLint（保留 hooks、未使用项等规则，仅忽略文件既有 `any`）通过。
- 全量 `npm run lint -- --quiet` 仍被仓库既有 2547 个错误阻断，包括 `tmp_head_aiChatStore.ts` 二进制解析失败及全仓历史 `any` 等；未在本修复中做无关清理。
- `git diff --check`：通过。
- `ai-metadata-sync` 未执行：本机 `/Users/libiqiang/.codex/Skills` 与 `/Users/libiqiang/.codex/skills` 均未安装对应脚本，未手工伪造 metadata。
