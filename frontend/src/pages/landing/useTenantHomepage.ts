import { useEffect, useState } from 'react';

export type HomepageKind = 'default' | 'newway' | 'xingdou';

export interface TenantSiteInfo {
  homepage: HomepageKind;
  hideLogo: boolean;
  name: string | null;
}

const CACHE_KEY = 'tenant-homepage';
const HIDE_LOGO_CACHE_KEY = 'tenant-hide-logo';
const KNOWN_KINDS: HomepageKind[] = ['default', 'newway', 'xingdou'];

function normalizeKind(value: unknown): HomepageKind | null {
  return KNOWN_KINDS.includes(value as HomepageKind) ? (value as HomepageKind) : null;
}

function readHomepageCache(): HomepageKind | null {
  try {
    return normalizeKind(sessionStorage.getItem(CACHE_KEY));
  } catch {
    return null;
  }
}

function readHideLogoCache(): boolean | null {
  try {
    const raw = sessionStorage.getItem(HIDE_LOGO_CACHE_KEY);
    if (raw === '1') return true;
    if (raw === '0') return false;
    return null;
  } catch {
    return null;
  }
}

function applyTenantDocumentTitle(info: TenantSiteInfo) {
  if (typeof document === 'undefined') return;
  if (info.hideLogo) {
    document.title = info.name?.trim() || '工作台';
  }
}

let cachedSiteInfo: TenantSiteInfo | null = null;
let inflightSiteInfo: Promise<TenantSiteInfo> | null = null;

function fetchSiteInfoOnce(): Promise<TenantSiteInfo> {
  if (cachedSiteInfo) return Promise.resolve(cachedSiteInfo);
  if (inflightSiteInfo) return inflightSiteInfo;
  // VITE_API_BASE_URL=/（多租户同源部署）时必须去尾斜杠，否则拼出 //api/... 被当成协议相对 URL（主机名变成 "api"）
  const API_BASE = ((import.meta.env.VITE_API_BASE_URL as string | undefined) || 'http://localhost:4000').replace(/\/+$/, '');
  inflightSiteInfo = fetch(`${API_BASE}/api/settings/site-info`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('site-info unavailable'))))
    .then((data) => {
      const info: TenantSiteInfo = {
        homepage: normalizeKind(data?.homepage) ?? 'default',
        hideLogo: Boolean(data?.hideLogo),
        name: typeof data?.name === 'string' ? data.name : null,
      };
      cachedSiteInfo = info;
      applyTenantDocumentTitle(info);
      try {
        sessionStorage.setItem(CACHE_KEY, info.homepage);
        sessionStorage.setItem(HIDE_LOGO_CACHE_KEY, info.hideLogo ? '1' : '0');
      } catch {
        /* 隐私模式等场景忽略 */
      }
      return info;
    })
    .finally(() => {
      inflightSiteInfo = null;
    });
  return inflightSiteInfo;
}

/**
 * 按当前域名的租户配置（Tenant.homepage）解析首页模板，主站/子站均可在后台切换。
 * 缓存秒开 + 后台校验（stale-while-revalidate）：有缓存先渲染防闪屏，
 * 每次仍拉最新配置，后台切换模板后用户刷新一次即生效；接口失败回落默认首页。
 * 返回 null 表示尚未确定（首次加载且无缓存），调用方应暂不渲染避免闪屏。
 */
export function useTenantHomepage(): HomepageKind | null {
  const [homepage, setHomepage] = useState<HomepageKind | null>(
    () => cachedSiteInfo?.homepage ?? readHomepageCache(),
  );

  useEffect(() => {
    let cancelled = false;
    fetchSiteInfoOnce()
      .then((info) => {
        if (!cancelled) setHomepage(info.homepage);
      })
      .catch(() => {
        if (!cancelled) setHomepage((prev) => prev ?? 'default');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return homepage;
}

/**
 * 当前租户是否开启「隐藏 Logo」（电脑端与 m 站统一读取，单次请求共享缓存）。
 * 首次加载尚无缓存时先返回 true，避免开启隐藏 Logo 的分站在首屏 50ms 闪现平台 Logo。
 */
export function useHideBrandLogo(): boolean {
  const [hideLogo, setHideLogo] = useState<boolean>(() => {
    if (cachedSiteInfo) return cachedSiteInfo.hideLogo;
    const cached = readHideLogoCache();
    return cached ?? true;
  });

  useEffect(() => {
    let cancelled = false;
    fetchSiteInfoOnce()
      .then((info) => {
        if (!cancelled) setHideLogo(info.hideLogo);
      })
      .catch(() => {
        if (!cancelled) setHideLogo(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return hideLogo;
}
