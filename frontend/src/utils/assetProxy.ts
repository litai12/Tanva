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

function getApiBaseUrl(): string {
  const viteEnv = import.meta.env as unknown as Record<string, unknown>;
  const raw =
    (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
    "http://localhost:4000";
  return normalizeApiBaseUrl(String(raw));
}

function isAssetProxyPath(pathname: string): boolean {
  return pathname === "/api/assets/proxy" || pathname === "/assets/proxy";
}

export function proxifyRemoteAssetUrl(input: string): string {
  const value = typeof input === "string" ? input.trim() : "";
  if (!value) return input;

  const apiBase = getApiBaseUrl();

  // 已经是同源相对 proxy 的，生产环境下补齐后端域名（静态部署无反向代理时需要）
  if (
    value.startsWith("/api/assets/proxy") ||
    value.startsWith("/assets/proxy")
  ) {
    return apiBase ? `${apiBase}${value}` : value;
  }

  if (!/^https?:\/\//i.test(value)) return input;

  try {
    const url = new URL(value);

    // 如果已经是 proxy URL（可能来自旧数据：localhost / 旧域名 / 同源绝对地址），统一重写到配置的后端域名
    if (isAssetProxyPath(url.pathname)) {
      if (apiBase) return `${apiBase}${url.pathname}${url.search}`;
      return `${url.pathname}${url.search}`;
    }

    if (url.hostname === window.location.hostname) return input;

    // 默认仅代理 OSS/aliyuncs 公网资源，避免把任意外部 URL 变成依赖后端的"通用代理"
    if (!url.hostname.endsWith(".aliyuncs.com")) {
      return input;
    }
  } catch {
    return input;
  }

  return `${apiBase}/api/assets/proxy?url=${encodeURIComponent(value)}`;
}
