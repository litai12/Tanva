import { useEffect, useState } from 'react';

export type HomepageKind = 'default' | 'newway' | 'xingdou';

const CACHE_KEY = 'tenant-homepage';
const KNOWN_KINDS: HomepageKind[] = ['default', 'newway', 'xingdou'];

function normalizeKind(value: unknown): HomepageKind | null {
  return KNOWN_KINDS.includes(value as HomepageKind) ? (value as HomepageKind) : null;
}

function readCache(): HomepageKind | null {
  try {
    return normalizeKind(sessionStorage.getItem(CACHE_KEY));
  } catch {
    return null;
  }
}

/**
 * 按当前域名的租户配置（Tenant.homepage）解析首页模板，主站/子站均可在后台切换。
 * 缓存秒开 + 后台校验（stale-while-revalidate）：有缓存先渲染防闪屏，
 * 每次仍拉最新配置，后台切换模板后用户刷新一次即生效；接口失败回落默认首页。
 * 返回 null 表示尚未确定（首次加载且无缓存），调用方应暂不渲染避免闪屏。
 */
export function useTenantHomepage(): HomepageKind | null {
  const [homepage, setHomepage] = useState<HomepageKind | null>(readCache);

  useEffect(() => {
    let cancelled = false;
    // VITE_API_BASE_URL=/（多租户同源部署）时必须去尾斜杠，否则拼出 //api/... 被当成协议相对 URL（主机名变成 "api"）
    const API_BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined) || 'http://localhost:4000').replace(/\/+$/, '');
    fetch(`${API_BASE}/api/settings/site-info`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('site-info unavailable'))))
      .then((data) => {
        if (cancelled) return;
        const kind: HomepageKind = normalizeKind(data?.homepage) ?? 'default';
        try {
          sessionStorage.setItem(CACHE_KEY, kind);
        } catch {
          /* 隐私模式等场景忽略 */
        }
        setHomepage(kind);
      })
      .catch(() => {
        // 拉取失败：有缓存用缓存，否则回落默认首页
        if (!cancelled) setHomepage((prev) => prev ?? 'default');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return homepage;
}
