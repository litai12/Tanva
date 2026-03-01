# Sora2 视频 URL 下载分析与优化

## 🔍 当前情况分析

### 问题 URL：
```
https://filesystem.site/cdn/20251115/363e38c69a973749215b9466308eb4.mp4
```

### URL 特征分析
| 特征 | 说明 | 影响 |
|------|------|------|
| **域名** | `filesystem.site` | CDN 跨域域名 |
| **路径** | `/cdn/20251115/...` | 带日期戳的 CDN 路径 |
| **格式** | `.mp4` | 标准 MPEG-4 视频格式 |
| **文件名** | `363e38c6...` | Hash 值形式的文件名 |

---

## 🚨 当前下载实现的问题

### 1️⃣ **HTML5 `<a>` 标签下载问题**

```typescript
// 当前实现 (可能失效)
<a
  href={message.videoUrl}
  download
  className="..."
>
  📥 下载
</a>
```

**问题原因：**
- ❌ 跨域资源（CORS）可能被阻止
- ❌ `download` 属性在跨域资源上可能不生效
- ❌ 服务器可能没有设置 `Content-Disposition: attachment` 头
- ❌ 无法自定义下载的文件名

### 2️⃣ **剪贴板复制问题**

```typescript
// 当前实现 (可能失效)
const response = await fetch(message.videoUrl!);
const blob = await response.blob();
await navigator.clipboard.write([
  new ClipboardItem({ [blob.type]: blob })
]);
```

**问题原因：**
- ❌ CORS 限制导致 fetch 失败
- ❌ 需要 `Blob` 类型支持，某些浏览器不支持
- ❌ 剪贴板 API 需要 HTTPS 环境

---

## ✅ 解决方案

### 方案 1：改进的跨域下载（推荐）

```typescript
// 使用服务端代理 + 自定义下载逻辑
const downloadVideo = async (videoUrl: string, fileName?: string) => {
  try {
    console.log('📥 开始下载视频:', videoUrl);

    // 方案 A: 通过 fetch 获取 blob（需要服务端 CORS）
    const response = await fetch(videoUrl, {
      mode: 'cors',
      credentials: 'omit'
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const blob = await response.blob();

    // 创建下载链接
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = fileName || `video-${Date.now()}.mp4`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // 释放内存
    URL.revokeObjectURL(downloadUrl);

    console.log('✅ 视频下载完成');
  } catch (error) {
    console.error('❌ 下载失败:', error);

    // 降级方案：使用原始 URL 跳转
    window.open(videoUrl, '_blank');
  }
};
```

### 方案 2：后端代理下载（最稳定）

```typescript
// 新增后端路由处理跨域
// POST /api/ai/download-video
// 后端代码伪代码：
async downloadVideo(url: string) {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();

  return {
    buffer,
    contentType: 'video/mp4',
    contentDisposition: `attachment; filename="video-${Date.now()}.mp4"`
  };
}
```

对应前端代码：
```typescript
const downloadVideoViaBackend = async (videoUrl: string) => {
  try {
    const response = await fetch('/api/ai/download-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: videoUrl })
    });

    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `video-${Date.now()}.mp4`;
    link.click();
    URL.revokeObjectURL(downloadUrl);
  } catch (error) {
    console.error('❌ 后端下载失败:', error);
    window.open(videoUrl, '_blank');
  }
};
```

### 方案 3：打开新标签页（最快，用户体验差）

```typescript
const openVideoInNewTab = (videoUrl: string) => {
  window.open(videoUrl, '_blank');
};
```

---

## 🔧 推荐的完整实现

### 更新 AIChatDialog.tsx 中的视频下载逻辑

```typescript
// 自定义下载函数，支持多种方案
const downloadVideo = async (videoUrl: string) => {
  try {
    console.log('📥 尝试下载视频:', videoUrl);

    // 步骤 1: 尝试直接 fetch（假设已配置 CORS）
    try {
      const response = await fetch(videoUrl, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        headers: {
          'User-Agent': navigator.userAgent
        }
      });

      if (response.ok) {
        const blob = await response.blob();
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = downloadUrl;
        link.download = `sora2-video-${new Date().toISOString().slice(0, 10)}.mp4`;

        // 触发下载
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // 清理资源
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 100);

        console.log('✅ 视频下载成功');
        return;
      }
    } catch (fetchError) {
      console.warn('⚠️ Fetch 失败，尝试后端代理...', fetchError);
    }

    // 步骤 2: 后端代理（如果配置了）
    try {
      const response = await fetch('/api/ai/download-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl })
      });

      if (response.ok) {
        const blob = await response.blob();
        const downloadUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `sora2-video-${new Date().toISOString().slice(0, 10)}.mp4`;
        link.click();
        URL.revokeObjectURL(downloadUrl);

        console.log('✅ 通过后端代理下载成功');
        return;
      }
    } catch (backendError) {
      console.warn('⚠️ 后端代理失败，尝试新标签页...', backendError);
    }

    // 步骤 3: 降级方案 - 在新标签页打开
    console.warn('⚠️ 使用降级方案：在新标签页打开视频');
    window.open(videoUrl, '_blank');

  } catch (error) {
    console.error('❌ 视频下载过程中出错:', error);

    // 最后的降级：直接打开链接
    alert('下载失败，已打开视频链接。您可以右键保存视频。');
    window.open(videoUrl, '_blank');
  }
};

// 复制视频 URL 到剪贴板（更简单可靠）
const copyVideoUrl = async (videoUrl: string) => {
  try {
    await navigator.clipboard.writeText(videoUrl);
    console.log('✅ 视频链接已复制到剪贴板');
    // 可选：显示 Toast 提示
    alert('视频链接已复制！');
  } catch (error) {
    console.error('❌ 复制失败:', error);
  }
};
```

### 更新 UI 按钮

```tsx
<div className="flex gap-2 text-xs">
  {/* 下载按钮 */}
  <button
    onClick={() => downloadVideo(message.videoUrl!)}
    className="px-3 py-1.5 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors flex items-center gap-1"
  >
    📥 下载
  </button>

  {/* 复制链接按钮 */}
  <button
    onClick={() => copyVideoUrl(message.videoUrl!)}
    className="px-3 py-1.5 bg-purple-500 text-white rounded-md hover:bg-purple-600 transition-colors flex items-center gap-1"
  >
    🔗 复制链接
  </button>

  {/* 新标签页打开 */}
  <a
    href={message.videoUrl}
    target="_blank"
    rel="noopener noreferrer"
    className="px-3 py-1.5 bg-green-500 text-white rounded-md hover:bg-green-600 transition-colors flex items-center gap-1"
  >
    🌐 浏览器打开
  </a>
</div>
```

---

## 🔐 CORS 配置检查

### 问题诊断

在浏览器开发者工具（F12）检查：

```javascript
// 在控制台运行，检查 CORS 是否允许
fetch('https://filesystem.site/cdn/20251115/363e38c69a973749215b9466308eb4.mp4', {
  mode: 'cors',
  credentials: 'omit'
})
.then(r => {
  console.log('✅ CORS 允许');
  console.log('Content-Type:', r.headers.get('content-type'));
  console.log('Content-Length:', r.headers.get('content-length'));
})
.catch(e => {
  console.log('❌ CORS 被阻止或其他错误:', e.message);
});
```

### 如果 CORS 被阻止

**需要后端配置：**
```
Access-Control-Allow-Origin: *
或
Access-Control-Allow-Origin: https://你的域名
```

---

## 📋 分步修复清单

- [ ] **第一步：测试当前下载**
  ```javascript
  // 在控制台运行测试
  fetch('https://filesystem.site/cdn/20251115/363e38c69a973749215b9466308eb4.mp4')
    .then(r => console.log('Status:', r.status))
    .catch(e => console.error('Error:', e))
  ```

- [ ] **第二步：选择下载方案**
  - ✅ 方案 1（改进 fetch）：简单，需要 CORS 支持
  - ✅ 方案 2（后端代理）：最稳定，需要后端支持
  - ✅ 方案 3（新标签页）：最快，用户体验最差

- [ ] **第三步：实现下载函数**
  使用上述 `downloadVideo()` 函数

- [ ] **第四步：更新 UI 按钮**
  添加多个选项（下载、复制链接、浏览器打开）

- [ ] **第五步：测试所有场景**
  - 网络正常
  - 网络超时
  - 跨域被阻止
  - 大文件下载

---

## 🎯 最快的修复（3 分钟）

直接替换当前的下载按钮为多选项方案：

```tsx
{message.videoUrl ? (
  <>
    <video controls className="w-full max-w-md rounded-lg border shadow-sm">
      <source src={message.videoUrl} type="video/mp4" />
    </video>
    <div className="flex gap-2 text-xs flex-wrap">
      {/* 选项 1: 直接打开 */}
      <a
        href={message.videoUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="px-3 py-1.5 bg-green-500 text-white rounded-md hover:bg-green-600"
      >
        🌐 在浏览器中打开
      </a>

      {/* 选项 2: 复制链接 */}
      <button
        onClick={() => {
          navigator.clipboard.writeText(message.videoUrl!);
          alert('链接已复制！');
        }}
        className="px-3 py-1.5 bg-purple-500 text-white rounded-md hover:bg-purple-600"
      >
        🔗 复制链接
      </button>

      {/* 选项 3: 下载 */}
      <button
        onClick={async () => {
          try {
            const response = await fetch(message.videoUrl!, {
              mode: 'cors'
            });
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `video-${Date.now()}.mp4`;
            a.click();
            URL.revokeObjectURL(url);
          } catch (e) {
            alert('下载失败，已打开链接');
            window.open(message.videoUrl, '_blank');
          }
        }}
        className="px-3 py-1.5 bg-blue-500 text-white rounded-md hover:bg-blue-600"
      >
        📥 下载视频
      </button>
    </div>
  </>
) : null}
```

---

## 📊 对比总结

| 方案 | 优点 | 缺点 | 推荐度 |
|------|------|------|--------|
| **Fetch + Blob** | 标准方案，可自定义文件名 | 需要 CORS 支持 | ⭐⭐⭐⭐⭐ |
| **后端代理** | 最稳定，绕过 CORS | 需要额外后端开发 | ⭐⭐⭐⭐ |
| **新标签页** | 最快，无依赖 | 用户体验差 | ⭐⭐⭐ |
| **复制链接** | 简单可靠 | 用户需要手动处理 | ⭐⭐⭐⭐ |

---

## 🧪 测试命令

```bash
# 1. 测试 URL 是否可访问
curl -I 'https://filesystem.site/cdn/20251115/363e38c69a973749215b9466308eb4.mp4'

# 2. 测试文件大小
curl -s -I 'https://filesystem.site/cdn/20251115/363e38c69a973749215b9466308eb4.mp4' | grep -i content-length

# 3. 下载文件到本地
curl -O 'https://filesystem.site/cdn/20251115/363e38c69a973749215b9466308eb4.mp4'
```

---

## 🎓 关键学习点

1. **HTML5 `download` 属性的局限性** - 跨域资源不适用
2. **CORS 的重要性** - CDN 资源必须配置正确的 CORS 头
3. **Blob API 的应用** - 动态文件下载的标准方式
4. **降级方案的价值** - 当主方案失败时，总有备选方案

---

**建议**：采用 **Fetch + Blob 方案** 作为主方案，同时保留**新标签页**作为降级方案。这样既能提供最佳用户体验，又能保证在 CORS 被阻止时仍然可用。
