# 后端模块：对象存储与素材（backend-oss）

## 作用
- 提供上传凭证/素材代理/视频帧等能力，为前端素材管理、项目缩略图、视频拆帧等提供支持。

## 关键文件
- `backend/src/oss/oss.service.ts`：OSS client、签名、public URL、允许域名白名单
- `backend/src/oss/uploads.controller.ts`：`/uploads/*`
- `backend/src/oss/assets.controller.ts`：`/assets/*`
- `backend/src/oss/video-frames.controller.ts`：`/video-frames/*`
- `backend/src/oss/video-gif.controller.ts`：`/video-gif/*`

## 配置项（节选）
- `OSS_REGION`、`OSS_BUCKET`
- `OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`
- `OSS_CDN_HOST`（可选）、`OSS_ENDPOINT`（可选）
- `ALLOWED_PROXY_HOSTS`：额外允许代理的域名（逗号分隔）

## 注意事项
- `allowedPublicHosts()` 内置了部分常见 AI/静态资源域名白名单；是否需要更严格以产品要求为准。
- new-api/Seedance 等异步视频查询返回第三方视频时，`VideoProviderService` 会逐跳校验下载地址及重定向目标；`files.toapis.com` 是已知允许的视频来源。校验通过后必须在服务端转存为 Tanva OSS URL，未知域名或跳转到未知域名时直接失败并记录来源，不得把第三方临时 URL 原样返回浏览器触发 CORS。
