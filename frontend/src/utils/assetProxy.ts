export function proxifyRemoteAssetUrl(input: string): string {
  const value = typeof input === 'string' ? input.trim() : '';
  if (!value) return input;
  if (!/^https?:\/\//i.test(value)) return input;

  try {
    const url = new URL(value);
    if (url.hostname === window.location.hostname) {
      return input;
    }
    // 默认仅代理 OSS/aliyuncs 公网资源，避免把任意外部 URL 变成依赖后端的“通用代理”
    if (!url.hostname.endsWith('.aliyuncs.com')) {
      return input;
    }
  } catch {
    return input;
  }

  return `/api/assets/proxy?url=${encodeURIComponent(value)}`;
}

