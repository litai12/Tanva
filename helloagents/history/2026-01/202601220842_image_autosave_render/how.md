# 技术设计: 直连 OSS/CDN 资源（禁用 /api/assets/proxy）

## 技术方案
### 核心技术
- 资源代理开关：`VITE_PROXY_ASSETS`
- 公共资源基址：`VITE_ASSET_PUBLIC_BASE_URL`

### 实现要点
- 默认关闭代理开关，避免 `proxifyRemoteAssetUrl` 生成 `/api/assets/proxy` 路径。
- 当输入为 OSS key（`projects/...`）时：
  - 若代理关闭：拼接公共基址并直连
  - 若代理开启：保持 `/api/assets/proxy?key=...` 逻辑
- 对历史 proxy URL，代理关闭时解析出直连 URL 或回退为 key 路径。

## 安全与性能
- **安全:** 不改变资源权限模型，仅减少代理路径使用。
- **性能:** 降低代理层转发压力，减少图片加载延迟。

## 测试与部署
- **测试:** 验证资源 key 与远程 URL 两类场景在代理关闭时均可直接加载。
- **部署:** 前端发布；如需代理回退，设置 `VITE_PROXY_ASSETS=true`。
