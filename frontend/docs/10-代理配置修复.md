# Node.js 20+ 代理修复说明

## 问题分析

`@google/genai` 库使用 Node.js 内置的 `fetch` API（由 undici 实现），但存在以下问题：

- **undici 不会自动读取** `HTTP_PROXY`、`HTTPS_PROXY` 环境变量
- **需要显式配置** ProxyAgent 并设置为全局 dispatcher
- Node.js 20+ 中 undici 的代理支持方式有所改变

## 实施的修复

### 1. 安装 undici 包
```bash
npm install --save-dev undici
```

### 2. 在 `backend/src/main.ts` 中配置代理

添加了以下代码：

```typescript
import { setGlobalDispatcher, ProxyAgent } from 'undici';

// 配置 undici ProxyAgent 以支持代理（修复 Node.js 20+ 中 @google/genai 的代理问题）
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

### 3. 修复了 CORS 回调类型错误

将 `originCallback` 的类型签名从 `(boolean | undefined)` 改为 `(boolean | string)` 以支持传递 origin URL。

## 工作原理

1. **启动时执行**: `configureProxyForUndici()` 在应用启动前运行
2. **检查环境变量**: 优先读取 `HTTPS_PROXY`，其次 `HTTP_PROXY`（不区分大小写）
3. **创建代理**: 使用 undici 的 `ProxyAgent` 创建代理实例
4. **全局配置**: 通过 `setGlobalDispatcher()` 设置为全局 dispatcher
5. **自动应用**: 所有后续的 fetch 请求（包括 @google/genai）都会使用此代理

## 环境变量配置

在 `.env` 或启动脚本中设置：

```bash
# HTTP 代理
export HTTP_PROXY=http://proxy.example.com:8080

# HTTPS 代理
export HTTPS_PROXY=http://proxy.example.com:8080

# 带身份验证的代理
export HTTPS_PROXY=http://user:password@proxy.example.com:8080
```

## 测试验证

启动应用时，应看到日志：
```
[Proxy] undici configured with proxy: proxy.example.com:8080...
```

如果配置失败，会显示错误日志。

## 相关文件修改

- ✅ `backend/src/main.ts` - 添加代理配置
- ✅ `backend/package.json` - 添加 undici 依赖
- ✅ 修复了 CORS 回调类型签名

## 兼容性

- ✅ Node.js 20+
- ✅ Node.js 23+
- ✅ @google/genai ^1.1.0
- ✅ NestJS 10.x
- ✅ 向后兼容（未配置代理时正常工作）
