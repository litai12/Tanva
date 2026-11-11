# 移动端网页 `/m`：对话 + 一键成片 / 一键复刻 — 设计

用户 2026-11-10 确认按推荐方案实施。

## 结论

- **成片执行走 Tanva**：一键成片 / 一键复刻调用 Tanva 已有的 `/api/video-productions`（mode=film / remake）。TapCanvas 只负责资产规划，生图、Seedance、ffmpeg 合成都在 Tanva 执行，计费已闭环：规划按回执 × 15 扣积分，生图和生视频按原价扣，余额不足时停在 `waiting_credits`。
- **不直接调 TapCanvas `/public/v1/video-remakes`**：该接口必须提供 TapCanvas 的 `projectId + canvasFlowId`，而且没有费用回执；生成在 TapCanvas 执行，绕开了 Tanva 的会员权益和 Seedance 白名单。
- **对话调 TapCanvas**：复用 `XiaotAgentService.run()`，链路为 new-api → TapCanvas `/public/v1/chat/completions`，按轮走网关签名订单，与小T同一条计费链路。移动端声明一份自己的 capability manifest（host=`tanva-mobile`），用 v1.3 `hostTools` 声明 `tanva_make_video` 和 `tanva_remake_video`，`generationMode` 保持默认的 `host`，TapCanvas 自己不生成媒体。模型回传 `host_tool` 后，由 Tanva 后端以当前用户身份调用 `VideoProductionService.create`。

## 后端 `backend/src/mobile-chat/`

- 新增 `MobileConversation` / `MobileMessage` 两张表（迁移 `202611100001_mobile_chat`）。消息 `kind`：`text` / `job`（`jobId`）/ `error`。
- 接口（JWT）：
  - `GET/POST /api/mobile-chat/conversations`，`GET/PATCH/DELETE /api/mobile-chat/conversations/:id`
  - `POST /api/mobile-chat/conversations/:id/messages`：SSE 流式返回，事件为 `delta`、`job`、`final`、`error`、`done`。客户端断开连接后，服务端仍会跑完本轮并落库。
- 同一会话同一时刻只允许一个进行中的回合。每个用户最多同时运行 2 个成片任务，第三个直接拒绝。
- 上游会话 key 为 `buildXiaotUpstreamSessionUser(mobile:<conversationId>)`，对话历史保存在 TapCanvas 侧。每轮在用户消息前附上本会话成片任务的当前状态，让模型知道进度。
- 参考素材只接受远程 URL：前端先上传 OSS，再把 URL 交给工具参数，符合设计 JSON 规范。抖音等分享链接第一期不支持，只支持上传文件或视频直链。

## 前端 `frontend/src/pages/mobile/`

- 路由 `/m`、`/m/c/:id`，懒加载，不打包画布。未登录时显示移动端手机号验证码登录。
- 布局：左侧抽屉，包含品牌、一键成片、一键复刻、我的作品、最近会话、头像菜单和新建会话。主页面为问候语加底部输入栏（`+` 上传图片或视频，发送按钮）。任务卡片展示阶段进度、预估积分与已扣积分、成片播放和下载，支持继续、重试、取消。
- 深色主题，使用 Tanva 自己的品牌元素，不复用参考图里的 logo 和标志。

## 默认参数

Seedance 2.0、720P、9:16；复刻按原片时长。第一期不做语音、团队钱包、项目和定时任务。
