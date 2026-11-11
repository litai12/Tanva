# Tasks

## P0 链路确认

- [x] 选 A（Tanva video-productions 执行，TapCanvas 只规划和对话）。
- [x] TapCanvas 对话 manifest v1.3 `hostTools` 可声明宿主自定义工具，`generationMode` 默认 host（`host-canvas-protocol.ts`）。
- [ ] 101 上 `video-productions` 线上真实跑一条成片和一条复刻（会扣少量积分）。

## P1 后端

- [x] Prisma：`MobileConversation` / `MobileMessage` 与迁移。
- [x] `mobile-chat` 模块：会话 CRUD、SSE 消息、宿主工具执行、并发限制。
- [x] `xiaot-host-context`：host=`tanva-mobile` 时保留 manifest 自带 notes，不注入画布查询说明。
- [x] 单元测试（`npm run test:mobile-chat`）与 `npm run build`；小T host-context / handoff 回归通过。

## P2 前端

- [x] `/m` 路由与移动端登录（独立分包 30.7KB / gzip 10.3KB）。
- [x] 抽屉、主页、消息流、任务卡片、上传；Logo 使用统一的 `Logo.svg` / `tanvas_ai.png`。
- [~] bsk iPhone 14 仿真 + 本地 mock 接口：登录、主页、抽屉、会话与成片卡片已验；发送流程自测被用户中止，待补。
- [x] `npm run build`。

## P3 发布

- [x] 101：迁移、后端、前端发布（2026-11-11）。
- [ ] 真机验收：真实对话（工具调用、下一轮可接续、2 积分扣费）→ 一键成片 → 一键复刻。
- [x] wiki / CHANGELOG。
