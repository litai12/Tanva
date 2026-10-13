# 账号头像上传与显示修复（2026-10-13）

## Analyze：上传成功与显示可用的检查边界不一致

- `FloatingHeader.handleAvatarFileChange` 原先将 `ossUploadService.uploadToOSS` 返回的 `result.url` 直接 PATCH 到 `/api/users/me`。`UsersService.updateProfile` 允许远程 HTTP(S)、站内路径和 `uploads/projects/templates` key，并只保存字符串，不检查图片解码。
- 默认图片上传走 `POST /api/uploads/image`，后端返回 `OssService.putStream` 的 URL/key；`OssService.publicUrl` 将对象 host 与 key 拼成原桶地址。
- `ossUploadService.verifyUploadedAssetReadable` 检查的是带登录信息的 `/api/assets/proxy` GET 是否成功。资源代理可以签名读取私有对象，因此这项检查无法证明 `result.url` 可由浏览器匿名直连，也无法证明响应能被图片解码。
- 设置面板与账号菜单共用 `FloatingHeader.renderAvatar`，原先直接 `<img src={user.avatarUrl}>`，未解析历史 key，也没有加载失败兜底。原桶不支持匿名读取时，即使上传的代理检查成功，头像仍可显示 broken image 与 alt 文字。
- 此结论由代码链路与模拟私有桶回归验证支持；未使用真实账号或外部对象存储凭据，未声称已检查用户原头像 HTTP 响应。

## Design：稳定持久化引用与运行期图片显示分离

- 保存原上传 URL；不将运行期 Blob URL 或签名临时 URL 写入用户资料。
- 头像先通过既有 `useNonBase64ImageSrc`/`imageSource` 解析普通 URL、历史 key 和代理引用，优先直连。
- 直连失败时，显示首字占位，同时通过配置的绝对 API 地址请求资源代理。代理响应转 Blob，并由浏览器实际解码后显示；两条路径均失败时保留首字，避免持续显示破图。
- 头像更新只在实际解码成功后 PATCH 用户资料；失败不改旧头像或认证 store。
- 保留浏览器 cookie 和桌面 bearer token 兼容：代理 fetch 使用 `fetchWithAuth` 默认鉴权、`credentials: include`，禁止头像展示请求触发自动 token refresh。用绝对 API 地址避免 Electron 的 `file://` 来源或缺少 Vite 代理时请求错误。
- 未直接复用 `resolveImageToObjectUrl`：现有底层 `fetchImageResponse` 明确设置 `auth: omit` 与 `credentials: omit`，且候选 proxy 地址在 DEV 下可能依赖前端 origin。头像仅使用自己的鉴权代理 fetch 和解码校验，不修改其他画布图片读取合同。
- 历史 `application/octet-stream` 或空 MIME 响应允许进入真实图片解码；明确的 HTML/JSON 等响应直接拒绝，图片 MIME 的损坏字节同样由解码拒绝。

## Develop：变更范围

- `frontend/src/components/ui/UserAvatar.tsx`：头像专用显示组件，按 src 重置状态，处理代理重试、首字兜底、卸载后异步结果丢弃和 Object URL 回收。
- `frontend/src/utils/avatarImage.ts`：有界加载/代理读取和实际图片解码校验；成功预检产生的 Object URL 在校验完成后回收。
- `frontend/src/services/avatarProfile.ts`：集中上传、校验、保存顺序，保存稳定原上传 URL。
- `frontend/src/components/layout/FloatingHeader.tsx`：设置面板（48px）与账号菜单（32px）共用 UserAvatar；上传处理仍在成功后更新认证 store 并广播 `tanva:profile-updated`。
- `frontend/scripts/verifyAvatarBrowser.mjs`：独立临时 Vite 缓存与虚拟页面，通过 Playwright 拦截所有测试 API/对象存储请求，不产生真实上传或用户资料写入。
- `AccountBadge` 只显示账号文字，无头像图片。评论与协作成员头像仍有独立的原生 img；它们不属于本次截图的账号设置入口，未扩大修改范围。

## 验证与状态

- 定向 ESLint：`cd frontend && npx eslint src/components/ui/UserAvatar.tsx src/utils/avatarImage.ts src/services/avatarProfile.ts scripts/verifyAvatarBrowser.mjs`，通过。
- 浏览器回归：`cd frontend && node scripts/verifyAvatarBrowser.mjs`，通过：公网直连不请求代理、历史 OSS key、公网 403 后带 bearer 代理成功并显示 Blob、上传保存原 URL、octet-stream 可解码、403/损坏图片阻止资料更新并保留旧头像、最终首字兜底、更换 URL 后恢复与无 React 运行时异常。
- 主 Agent 全量 lint 记录：既有 `2556 errors / 199 warnings`，未将仓库级 lint 标记为通过。元数据同步脚本不存在，主 Agent 已尝试并记录限制。
- 主 Agent 最终 `npm run build`（TypeScript + Vite）通过，`git diff --check` 通过。
- 未提交、未部署、未用真实用户凭据；已有头像资料与用户其他改动保持原样。
