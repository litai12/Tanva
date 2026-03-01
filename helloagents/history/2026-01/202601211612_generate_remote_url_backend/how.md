# 技术设计: 生成链路使用远程 URL 由后端处理

## 技术方案
### 核心技术
- React + TypeScript
- NestJS

### 实现要点
- 前端输入解析遇到远程 URL 时不转 dataURL，改为发送 `sourceImageUrl(s)`。
- 后端 edit/blend DTO 支持 `sourceImageUrl(s)`，并在 controller 中下载转为 dataURL。
- 服务器端下载增加白名单与大小限制，避免 SSRF 与超大文件。

## 安全与性能
- **安全:** 仅允许 OSS/CDN 白名单主机；校验协议与内容类型。
- **性能:** 限制最大 15MB；避免前端 base64 内存峰值。

## 测试与部署
- **测试:** Multi-generate → Image → Generate，使用 OSS 直链输入，确认生成正常。
- **部署:** 前后端构建流程不变。
