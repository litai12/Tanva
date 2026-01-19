// 获取 API 基础地址
function normalizeApiBaseUrl(raw: string): string {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return "";

  // 兼容历史文档/配置：有的人会配置成 https://domain/api 或 /api
  const withoutTrailingSlashes = trimmed.replace(/\/+$/, "");
  const withoutApiSuffix = withoutTrailingSlashes.endsWith("/api")
    ? withoutTrailingSlashes.slice(0, -4)
    : withoutTrailingSlashes;
  return withoutApiSuffix.replace(/\/+$/, "");
}

export function getApiBaseUrl(): string {
  const viteEnv = import.meta.env as unknown as Record<string, unknown>;
  const raw =
    (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
    "http://localhost:4000";
  return normalizeApiBaseUrl(String(raw));
}

function normalizePublicAssetBaseUrl(raw: string): string {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return "";
  return trimmed.replace(/\/+$/, "");
}

// 直连 OSS/CDN 的公共 base（用于将 key 拼成可访问 URL；例如 https://cdn.example.com）
export function getPublicAssetBaseUrl(): string {
  const raw = import.meta.env.VITE_ASSET_PUBLIC_BASE_URL as string | undefined;
  return normalizePublicAssetBaseUrl(String(raw || ""));
}

function isAssetProxyPath(pathname: string): boolean {
  return pathname === "/api/assets/proxy" || pathname === "/assets/proxy";
}

// 是否启用前端代理 OSS 资源（可通过 VITE_PROXY_ASSETS 控制，默认 true）
function shouldProxyAssets(): boolean {
  const raw = import.meta.env.VITE_PROXY_ASSETS as string | undefined;
  if (typeof raw === "string") {
    const v = raw.trim().toLowerCase();
    if (v === "false" || v === "0" || v === "no") return false;
    return true;
  }
  return true;
}

export function isAssetProxyEnabled(): boolean {
  return shouldProxyAssets();
}

function resolvePublicAssetUrlFromKey(key: string): string | null {
  const base = getPublicAssetBaseUrl();
  const trimmed = typeof key === "string" ? key.trim() : "";
  const withoutLeading = trimmed.replace(/^\/+/, "");
  if (!base || !withoutLeading) return null;
  if (!/^https?:\/\//i.test(base)) return null;
  return `${base}/${withoutLeading}`;
}

function tryUnwrapAssetProxyUrl(input: string): string | null {
  const value = typeof input === "string" ? input.trim() : "";
  if (!value) return null;
  try {
    const base =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "http://localhost";
    const url = new URL(value, base);
    const key = url.searchParams.get("key");
    if (key) {
      const direct = resolvePublicAssetUrlFromKey(key);
      if (direct) return direct;
    }
    const remote = url.searchParams.get("url");
    if (remote) return remote;
  } catch {
    // ignore
  }
  return null;
}

export function proxifyRemoteAssetUrl(
  input: string,
  options?: { forceProxy?: boolean }
): string {
  const value = typeof input === "string" ? input.trim() : "";
  if (!value) return input;

  const apiBase = getApiBaseUrl();
  const proxyEnabled = options?.forceProxy ? true : shouldProxyAssets();

  // 判断是否为视频资源或 presigned 链接（例如包含 X-Amz-* 参数）
  const looksLikeVideo = /\.(mp4|webm|m3u8)(\?|$)/i.test(value);
  const looksLikePresigned =
    /[?&](?:X-Amz|X-Tos)[^=]*=/i.test(value) || /x-amz-|x-tos-/i.test(value);

  // 对 presigned 链接：**直接返回原始 URL**，不要代理或修改（否则会破坏签名）。
  // 前提是目标 S3/OSS 已正确配置 CORS，允许浏览器直接请求。
  if (looksLikePresigned) {
    return value;
  }

  // 对普通视频资源（非 presigned），优先直接使用已知允许的 OSS/CDN 主机的原始 URL（避免代理签名或触发网关限制）。
  // 仅在目标主机不在允许列表时，才使用前端 proxy（或根据 proxyEnabled 决定）。
  if (looksLikeVideo) {
    try {
      const url = new URL(value);
      const allowedHosts = [
        ".aliyuncs.com",
        "models.kapon.cloud",
        "kechuangai.com",
        "volces.com",
        "volcengine.com",
        "alicdn.com",
      ];
      const isAllowed = allowedHosts.some(
        (host) => url.hostname === host || url.hostname.endsWith(host)
      );
      if (isAllowed) {
        // 直接使用 OSS/CDN 原始 URL（不要通过前端 proxy），以便 video 元素直接请求
        return value;
      }
    } catch {
      // fallthrough to proxy behavior if URL is invalid
    }

    const frontendBase = import.meta.env.DEV
      ? "http://localhost:5173"
      : apiBase;
    return `${frontendBase}/api/assets/proxy?url=${encodeURIComponent(value)}`;
  }

  // 已经是同源相对 proxy 的，生产环境下补齐后端域名（静态部署无反向代理时需要）
  if (
    value.startsWith("/api/assets/proxy") ||
    value.startsWith("/assets/proxy")
  ) {
    if (!proxyEnabled) {
      const direct = tryUnwrapAssetProxyUrl(value);
      if (direct) return direct;
    }
    // 图片资源使用前端 5173 端口（开发模式），其他 API 保持使用后端配置
    const frontendBase = import.meta.env.DEV
      ? "http://localhost:5173"
      : apiBase;
    return frontendBase ? `${frontendBase}${value}` : value;
  }

  if (!/^https?:\/\//i.test(value)) return input;

  try {
    const url = new URL(value);

    // 如果已经是 proxy URL（可能来自旧数据：localhost / 旧域名 / 同源绝对地址），统一重写到配置的前端/后端域名
    if (isAssetProxyPath(url.pathname)) {
      if (!proxyEnabled) {
        const direct = tryUnwrapAssetProxyUrl(url.toString());
        if (direct) return direct;
      }
      const frontendBase = import.meta.env.DEV
        ? "http://localhost:5173"
        : apiBase;
      if (frontendBase) return `${frontendBase}${url.pathname}${url.search}`;
      return `${url.pathname}${url.search}`;
    }

    if (url.hostname === window.location.hostname) return input;

    // 默认仅考虑代理 OSS/aliyuncs 公网资源，避免把任意外部 URL 变成依赖后端的"通用代理"
    const allowedHosts = [
      ".aliyuncs.com",
      "models.kapon.cloud",
      "kechuangai.com",
      "volces.com",
      "volcengine.com",
      "alicdn.com",
    ];

    const isAllowed = allowedHosts.some(
      (host) => url.hostname === host || url.hostname.endsWith(host)
    );

    if (!isAllowed) {
      return input;
    }

    // 当显式关闭代理时（VITE_PROXY_ASSETS=false），直接使用 OSS 原始 URL，
    // 避免占用前端内存缓存与重复的 base64/占位替换。
    if (!proxyEnabled) {
      return value;
    }
  } catch {
    return input;
  }

  // 图片资源使用前端 5173 端口（开发）或后端 apiBase（生产），通过 proxy 转发
  const frontendBase = import.meta.env.DEV ? "http://localhost:5173" : apiBase;
  return `${frontendBase}/api/assets/proxy?url=${encodeURIComponent(value)}`;
}
