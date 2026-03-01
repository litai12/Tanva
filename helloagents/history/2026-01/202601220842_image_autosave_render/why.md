# 变更提案: 直连 OSS/CDN 资源（禁用 /api/assets/proxy）

## 需求背景
当前 OSS 已支持跨域访问，图片上传与生成资源全部落在 OSS，上游代理 `/api/assets/proxy` 不再必要且可能带来额外跳转与依赖。需要前端默认直连 OSS/CDN，并保留显式开启代理的能力。

## 变更内容
1. 默认禁用前端静态资源代理，避免生成 `/api/assets/proxy` 作为图片源。
2. 对 OSS key（如 `projects/...`）优先拼接公共 CDN/OSS 基址渲染。
3. 保留通过环境变量显式开启代理的回退能力。

## 影响范围
- **模块:** 前端资源访问与渲染
- **文件:**
  - `frontend/src/utils/assetProxy.ts`
  - `frontend/src/utils/imageSource.ts`
- **API:** 无
- **数据:** 不影响持久化结构（仍为远程 URL/OSS key）

## 核心场景

### 需求: 禁用静态资源代理
**模块:** 前端资源访问
图片渲染不再通过 `/api/assets/proxy`，改为直接访问 OSS/CDN。

#### 场景: 通过 key 拼接公共地址
给定 `projects/...` 资源 key，前端使用 `VITE_ASSET_PUBLIC_BASE_URL` 拼接出可访问 URL。
- 预期结果: 资源直接从 OSS/CDN 访问，无需代理。

## 风险评估
- **风险:** 未配置 `VITE_ASSET_PUBLIC_BASE_URL` 时 key 无法解析为完整 URL。
- **缓解:** 在渲染层回退为同源绝对路径，且可通过 `VITE_PROXY_ASSETS=true` 重新开启代理。
