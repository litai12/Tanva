# CDN配置检查指南

## ✅ 当前配置状态

根据检查脚本的结果，你的CDN配置如下：

- **CDN域名**: `tai.tanva.tgtai.com`
- **OSS区域**: `oss-cn-shenzhen`
- **OSS存储桶**: `tai-tanva-ai`
- **代码支持**: ✅ 已实现CDN域名优先逻辑

## 🔍 如何验证CDN是否生效

### 方法1: 检查环境变量配置

运行检查脚本：
```bash
cd backend
node check-cdn.js
```

### 方法2: 检查返回的URL

1. 启动后端服务
2. 调用OSS服务的 `publicUrl()` 方法
3. 检查返回的URL：
   - ✅ **已配置CDN**: URL应该是 `https://tai.tanva.tgtai.com/...`
   - ❌ **未配置CDN**: URL会是 `https://tai-tanva-ai.oss-cn-shenzhen.aliyuncs.com/...`

### 方法3: 检查HTTP响应头

访问一个实际存在的OSS文件，检查响应头：

```bash
# 替换为实际的OSS文件路径
curl -Ik https://tai.tanva.tgtai.com/projects/xxx/image.jpg
```

**CDN已生效的标识**：
- `x-cache: HIT` 或 `x-cache: MISS` (阿里云CDN)
- `x-served-by: 阿里云CDN`
- `via: cache` (某些CDN)
- `cf-cache-status: HIT` (Cloudflare CDN)

**CDN未生效的标识**：
- `x-oss-server-time` (直接访问OSS)
- `server: AliyunOSS`
- 没有缓存相关的响应头

### 方法4: 在阿里云控制台检查

1. 登录 [阿里云控制台](https://ecs.console.aliyun.com)
2. 进入 **CDN** 服务
3. 查看 **加速域名** 列表
4. 确认 `tai.tanva.tgtai.com` 的状态：
   - ✅ **已启动** = CDN已配置并运行
   - ⚠️ **配置中** = 正在配置，等待生效
   - ❌ **已停止** = CDN未启用

### 方法5: 测试实际文件访问

如果你有已上传的文件，可以：

1. 通过后端API获取文件的URL
2. 在浏览器中访问该URL
3. 打开开发者工具 (F12) → Network标签
4. 查看响应头，确认是否有CDN标识

## 📝 代码中的CDN使用

查看 `backend/src/oss/oss.service.ts` 的 `publicUrl()` 方法：

```typescript
publicUrl(key: string): string {
  const { cdnHost, bucket, region } = this.conf;
  const host = cdnHost || `${bucket}.${region}.aliyuncs.com`;
  return `https://${host}/${key}`;
}
```

**逻辑说明**：
- 如果配置了 `OSS_CDN_HOST`，优先使用CDN域名
- 否则使用OSS直连域名

## 🚨 常见问题

### Q1: 环境变量已配置，但URL还是OSS直连？

**可能原因**：
1. 环境变量文件未被加载（检查 `.env` 文件位置）
2. 后端服务未重启（环境变量需要重启才能生效）
3. 环境变量名称错误（应该是 `OSS_CDN_HOST`）

**解决方法**：
```bash
# 检查环境变量
cd backend
node check-cdn.js

# 重启后端服务
npm run start:dev
```

### Q2: CDN域名无法访问？

**可能原因**：
1. DNS未配置或未生效
2. CDN域名在阿里云控制台未启动
3. SSL证书未配置

**解决方法**：
1. 检查DNS解析：`nslookup tai.tanva.tgtai.com`
2. 在阿里云控制台检查CDN域名状态
3. 配置SSL证书（CDN需要HTTPS）

### Q3: 如何确认CDN真的在加速？

**测试方法**：
1. 访问一个较大的文件（如视频）
2. 对比CDN域名和OSS直连域名的下载速度
3. 使用 `curl` 测试响应时间：
   ```bash
   # CDN域名
   time curl -o /dev/null https://tai.tanva.tgtai.com/large-file.mp4
   
   # OSS直连（对比）
   time curl -o /dev/null https://tai-tanva-ai.oss-cn-shenzhen.aliyuncs.com/large-file.mp4
   ```

## 📚 相关文档

- 完整CDN配置指南: `frontend/docs/存储和CDN/01-OSS和CDN指南.md`
- OSS服务代码: `backend/src/oss/oss.service.ts`

## 🎯 快速检查清单

- [ ] 环境变量 `OSS_CDN_HOST` 已配置
- [ ] 后端服务已重启
- [ ] 阿里云控制台中CDN域名状态为"已启动"
- [ ] DNS解析正常
- [ ] 实际返回的URL使用CDN域名
- [ ] HTTP响应头包含CDN标识

