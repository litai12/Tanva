# 任务清单: 后端开发环境放开 CORS

目录: `helloagents/plan/202601151707_backend_cors/`

---

## 1. 后端 CORS 配置
- [√] 1.1 在 `backend/src/main.ts` 中新增开发环境放开开关（如 `CORS_DEV_ALLOW_ALL`），当 `NODE_ENV=development` 且开关开启时设置 `origin: true`，验证 why.md#需求-开发环境允许所有来源-场景-本地开发--内网穿透
- [√] 1.2 在 `backend/.env` 中补充开发环境示例配置，验证 why.md#需求-开发环境允许所有来源-场景-本地开发--内网穿透，依赖任务1.1

## 2. 文档更新
- [√] 2.1 更新 `helloagents/wiki/modules/backend-app.md` 记录开发环境 CORS 开关

## 3. 安全检查
- [√] 3.1 执行安全检查（按G9: 输入验证、敏感信息处理、权限控制、EHRB风险规避）

## 4. 测试
- [-] 4.1 手动验证跨域请求：本地与隧道域名请求接口均返回 CORS 允许头
> 备注: 未执行，需要手动验证
