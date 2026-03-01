# 技术设计: Seedance 视频结果走 OSS

## 技术方案
### 核心技术
- NestJS + Fetch API
- OSS SDK（ali-oss）
- Node.js stream（流式上传）

### 实现要点
- 在 `video-provider.service.ts` 中为 Seedance 增加“远程视频上传到 OSS”的私有方法。
- `queryDoubao` 在 `succeeded` 状态时：
  1) 读取上游 `video_url`。
  2) 若已是自有 OSS 域名，则直接返回。
  3) 否则拉取远程视频流并上传到 OSS，返回 OSS 公网 URL。
- 上传失败或 OSS 未启用时返回可识别错误，避免返回不可用链接。
- 可选：用内存 Map 缓存 `taskId -> ossUrl`，避免同一任务重复上传。

## 架构决策 ADR
### ADR-001: Seedance 视频结果必须落 OSS
**上下文:** 上游预签名链接存在 CORS/过期问题，前端无法稳定下载。
**决策:** 在后端完成上游视频拉取并上传到 OSS，前端仅使用自有 OSS 公网链接。
**理由:** 统一可控的资源域名、避免跨域与签名过期问题。
**替代方案:** 前端直接请求上游 TOS 链接 → 拒绝原因: CORS 不可控且链接易过期。
**影响:** 增加后端带宽与 OSS 存储成本，需要处理上传失败场景。

## API设计
### GET /api/ai/video-task/:provider/:taskId
- **响应:** `videoUrl` 固定为 OSS 公网 URL（Seedance 成功时）。

## 数据模型
无

## 安全与性能
- **安全:** 仅允许从已知上游域名下载；避免将任意 URL 作为上传源。
- **性能:** 使用流式下载/上传，避免将大文件完整加载到内存。

## 测试与部署
- **测试:** 手动触发 Seedance 任务，确认 `videoUrl` 返回自有 OSS 域名并可下载。
- **部署:** 确保 OSS 相关环境变量已配置并启用。
