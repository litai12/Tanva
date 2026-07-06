import { lazy, Suspense, useEffect, useState } from 'react';
import Home from '@/pages/Home';

// 官网模板按需加载，主站用户不加载落地页代码
const NewwayLanding = lazy(() => import('./newway/NewwayLanding'));

type HomepageKind = 'default' | 'newway';

const CACHE_KEY = 'tenant-homepage';

function readCache(): HomepageKind | null {
  try {
    const v = sessionStorage.getItem(CACHE_KEY);
    return v === 'newway' || v === 'default' ? v : null;
  } catch {
    return null;
  }
}

/**
 * 首页分流：按当前域名的租户配置（Tenant.homepage）选择首页模板，主站/子站均可在后台切换。
 * - default → 平台默认首页（现状）
 * - newway  → NewWay 官网宣发页
 * 缓存秒开 + 后台校验（stale-while-revalidate）：有缓存先渲染防闪屏，
 * 每次仍拉最新配置，后台切换模板后用户刷新一次即生效；接口失败回落默认首页。
 */
export default function HomeGate() {
  const [homepage, setHomepage] = useState<HomepageKind | null>(readCache);

  useEffect(() => {
    let cancelled = false;
    const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || 'http://localhost:4000';
    fetch(`${API_BASE}/api/settings/site-info`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('site-info unavailable'))))
      .then((data) => {
        if (cancelled) return;
        const kind: HomepageKind = data?.homepage === 'newway' ? 'newway' : 'default';
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

  // 未知期间不渲染，避免先闪默认首页再切官网（首次 ~1 个请求耗时，之后走缓存）
  if (!homepage) return null;

  if (homepage === 'newway') {
    return (
      <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
        <NewwayLanding />
      </Suspense>
    );
  }
  return <Home />;
}
