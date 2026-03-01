# 代理配置快速指南

## 已完成的修复 ✅

### 问题
- `@google/genai` 使用 Node.js fetch（undici）
- undici **不会自动使用** HTTP_PROXY/HTTPS_PROXY 环境变量
- 导致 Google API 调用在代理环境下失败

### 解决方案
已在 `backend/src/main.ts` 中实现 undici ProxyAgent 全局配置

## 使用方法

### 1. 启用代理（开发环境）

```bash
# 设置代理环境变量
export HTTPS_PROXY=http://proxy.example.com:8080
export HTTP_PROXY=http://proxy.example.com:8080

# 或使用身份验证
export HTTPS_PROXY=http://user:password@proxy.example.com:8080

# 启动应用
npm run dev
```

### 2. 验证代理配置

启动应用时应看到日志：
```
[Proxy] undici configured with proxy: proxy.example.com:8080...
```

### 3. 不使用代理

如果未设置 `HTTP_PROXY` 或 `HTTPS_PROXY` 环境变量，应用会正常启动：
```
npm run dev
```

## 配置详情

| 变量 | 优先级 | 格式 |
|------|--------|------|
| HTTPS_PROXY | ⭐⭐⭐ | http://[user:password@]host:port |
| HTTP_PROXY | ⭐⭐ | http://[user:password@]host:port |
| https_proxy | ⭐ | http://[user:password@]host:port |
| http_proxy | ⭐ | http://[user:password@]host:port |

## 工作原理

1. **应用启动前** → `configureProxyForUndici()` 执行
2. **读取环境变量** → 优先级：HTTPS_PROXY > HTTP_PROXY
3. **创建代理** → 使用 undici ProxyAgent
4. **全局设置** → setGlobalDispatcher() 应用到所有 fetch
5. **自动应用** → @google/genai 和其他 fetch 请求自动通过代理

## 代码位置

```typescript
// backend/src/main.ts (第 13-32 行)
function configureProxyForUndici() {
  const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
  const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const proxyUrl = httpsProxy || httpProxy;

  if (proxyUrl) {
    try {
      const agent = new ProxyAgent(proxyUrl);
      setGlobalDispatcher(agent);
      console.log(`[Proxy] undici configured with proxy: ...`);
    } catch (error) {
      console.error(`[Proxy] Failed to configure undici ProxyAgent: ...`);
    }
  }
}

configureProxyForUndici();
```

## 故障排除

### 看不到代理日志？
- 检查是否设置了环境变量
- 确认代理 URL 格式正确

### 代理配置失败？
- 查看错误信息中的具体原因
- 验证代理服务器是否可访问

### Google API 仍然超时？
- 确保代理能够访问 `generativelanguage.googleapis.com`
- 检查代理是否需要身份验证

## 相关文件

- ✅ `/backend/src/main.ts` - 主配置文件
- ✅ `/backend/package.json` - undici 依赖
- 📄 `/PROXY_FIX.md` - 详细说明

## 版本兼容性

- Node.js 20+ ✅
- Node.js 23+ ✅
- @google/genai ^1.1.0 ✅
- NestJS 10.x ✅
