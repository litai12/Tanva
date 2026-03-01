# 🚀 本地网络访问 - 快速参考

## ✅ 你的网络设置已完成！

### 📍 你的本地网络地址
```
IP: 192.168.2.115
前端: http://192.168.2.115:5173
后端: http://192.168.2.115:4000
```

---

## 🎯 如何在其他PC上访问

### 方式1: 在浏览器中打开前端

```
http://192.168.2.115:5173
```

你会看到完整的UI，所有API调用自动通过代理转发到后端。

### 方式2: 直接调用API (无需浏览器)

**获取可用的AI提供商**:
```bash
curl http://192.168.2.115:4000/api/public/ai/providers
```

**生成图像**:
```bash
curl -X POST http://192.168.2.115:4000/api/public/ai/generate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "一只可爱的猫",
    "model": "gemini-2.5-flash-image"
  }'
```

**编辑图像**:
```bash
curl -X POST http://192.168.2.115:4000/api/public/ai/edit \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "给猫加墨镜",
    "sourceImage": "data:image/png;base64,...",
    "model": "gemini-2.5-flash-image"
  }'
```

---

## 🔧 环境信息

| 项目 | 值 |
|------|------|
| 本地IP | `192.168.2.115` |
| 前端端口 | `5173` |
| 后端端口 | `4000` |
| Vite代理 | `/api -> http://localhost:4000` |
| CORS源 | `http://192.168.2.115:5173` 等 |
| 后端监听 | `0.0.0.0:4000` |

---

## 📋 启动命令

**终端1 - 启动后端**:
```bash
cd server
npm run dev
```

**终端2 - 启动前端**:
```bash
npm run dev
```

---

## ⚠️ 常见问题

**Q: 其他PC访问超时？**
- 检查防火墙是否允许端口 5173/4000
- 确认IP地址正确 (试试 `ifconfig`)
- 确保两台PC在同一局域网

**Q: CORS错误？**
- 重启后端服务
- 检查 `server/.env` 中的 CORS_ORIGIN 是否包含 `192.168.2.115:5173`

**Q: 公开API无需认证，安全吗？**
- ✅ 适合内部开发和测试
- ❌ 不适合生产环境
- 生产环境部署到Aliyun时应该启用认证

---

## 📚 详细文档

更多信息见: `LOCAL_NETWORK_SETUP.md`

