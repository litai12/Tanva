# 技术设计: 后端开发环境放开 CORS

## 技术方案
### 核心技术
- NestJS + Fastify CORS 插件
- 配置文件/环境变量（ConfigService）

### 实现要点
- 新增配置开关（如 `CORS_DEV_ALLOW_ALL=true`）并通过 `ConfigService` 读取。
- 当 `NODE_ENV=development` 且开关开启时，CORS 直接放开（`origin: true`），忽略 `CORS_ORIGIN`。
- 其他环境保持现有白名单与 `trycloudflare.com` 子域规则。

## 安全与性能
- **安全:** 开发放开仅在 `NODE_ENV=development` 且显式开关为真时生效。
- **性能:** 无显著影响。

## 测试与部署
- **测试:** 本地与隧道域名访问接口，验证 `Access-Control-Allow-Origin` 返回。
- **部署:** 开发环境 `.env` 增加开关变量；生产不设置该变量。
