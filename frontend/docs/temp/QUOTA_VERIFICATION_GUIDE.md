# 📖 Google Cloud 配额验证指南

## 快速导航到配额页面

### 方法 1：直接链接
```
https://console.cloud.google.com/quotas
```

### 方法 2：手动导航
1. 打开 https://console.cloud.google.com/
2. 左侧菜单 → "APIs & Services"
3. 点击 "Quotas"

---

## 查看配额的步骤

### 第一步：确保选择了正确的项目

左上角的项目选择器显示什么项目？

记下项目名称和 ID

### 第二步：搜索 Veo API

在配额列表中搜索：
- `veo`
- `video`
- `generative`

### 第三步：查看配额详情

点击任何配额项来查看：

```
配额名称: Veo API - Requests per minute
限制: 100
当前使用: ? (你需要看这个)
百分比: ? %
重置时间: ?
```

### 第四步：记录这些信息

请告诉我：

1. **找到的配额项列表**
   ```
   - veo-3.1-requests-per-minute: ? / ?
   - veo-3.0-requests-per-day: ? / ?
   - ...
   ```

2. **使用百分比**
   ```
   - Veo API: ? %
   - 其他 API: ? %
   ```

3. **配额重置时间**
   ```
   通常重置于: UTC 00:00 或每月的几号
   ```

---

## 常见的配额项

当你在 Quotas 页面时，可能会看到：

```
✓ Generative AI API
  - Requests per second
  - Requests per minute
  - Requests per day
  - Requests per month

✓ Video API
  - Video generation requests per minute
  - Video generation requests per day
  - Video generation requests per month

✓ Veo API (如果单独列出)
  - Video generation requests
  - Concurrent requests
```

---

## 如何增加配额

如果配额已满：

### 步骤 1：选择配额
点击要增加的配额项

### 步骤 2：点击 "EDIT QUOTAS"

### 步骤 3：输入新限制
例如：从 100 改为 1000

### 步骤 4：提交请求
点击 "Next"，填写原因，然后提交

通常 24-48 小时内会批准

---

## 特殊注意事项

### 对于免费层用户
- 配额通常较低
- 可能没有调整权限
- 需要升级到付费账户才能增加

### 对于付费用户
- 可以直接请求增加
- 通常快速批准
- 可以设置很高的限制

### 对于新项目
- 首次可能有较低的默认配额
- 一旦升级可能自动增加

---

## 我需要看到的截图（可选）

如果可以，请截图并分享：

1. **Quotas 页面**
   - 显示 Veo 或 Video 相关配额
   - 显示使用百分比

2. **Billing 页面**
   - 确认账户是否为付费
   - 显示当前月份的使用情况

这样我可以确认问题并给出更精确的建议。
