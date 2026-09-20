# 视频生成 new-api 单轨（2026-09-20）

视频生成公开入口统一经 `generateVideoAttempt → createNewApiVideoTask → new-api /v1/videos`。移除 Seedance 参考媒体冲突时的 Ark 直连回退、未被主路径使用的旧生成分发入口、Seedance 旧托管生成与 Ark 创建/查询实现，以及视频服务中的备用火山密钥。

网关报错直接向调用方传播；现有正常用户预扣失败退款流程保持不变。素材服务未开通时的 HTTPS 引用重试仍在同一 new-api 网关内。素材审核/上传及由 new-api 调用的腾讯 VOD 适配器不属于绕过网关的视频提交。

验证：`backend/scripts/verify-video-single-gateway.ts` 模拟媒体冲突，断言只调用一次网关且没有直连请求；覆盖 1.5/2.0/2.5 正常提交。另运行 VOD 路由回归、禁用节点的计费前拒绝回归与后端构建。

此修复不证明 9 月 19 日两笔火山任务的来源，不撤销火山平台上的 API Key，也不改动模型启用状态。

## 生产发布

2026-09-20 16:55（UTC+8）已定向更新 101 正式环境 `tanvas-api` 的源文件及编译产物，PM2 reload 成功，内外网 `/api/health` 均返回 ok。发布前校验生产源文件与本地修改前 HEAD 的 SHA-256 一致。备份位于 `/opt/tanva-backups/video-single-gateway-20260920/`。生产编译产物通过无外部请求的媒体冲突回归，确认不存在旧直连方法。测试站及 TapCanvas 独立服务未发布。

本地新增回归、VOD 路由回归、禁用节点回归、后端构建与 diff 检查均通过。约定的 ai-metadata-sync 脚本在本机不存在，未执行该同步。
