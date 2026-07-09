import { lazy, Suspense } from 'react';
import Home from '@/pages/Home';
import { useTenantHomepage } from './useTenantHomepage';

// 官网模板按需加载，主站用户不加载落地页代码
const NewwayLanding = lazy(() => import('./newway/NewwayLanding'));
const XingdouLanding = lazy(() => import('./xingdou/XingdouLanding'));

/**
 * 首页分流：按当前域名的租户配置（Tenant.homepage）选择首页模板，主站/子站均可在后台切换。
 * - default → 平台默认首页（现状）
 * - newway  → NewWay 官网宣发页
 * - xingdou → 星斗传媒官网（着陆页 + /workspace 工作台，见 WorkspaceGate）
 */
export default function HomeGate() {
  const homepage = useTenantHomepage();

  // 未知期间不渲染，避免先闪默认首页再切官网（首次 ~1 个请求耗时，之后走缓存）
  if (!homepage) return null;

  if (homepage === 'newway') {
    return (
      <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
        <NewwayLanding />
      </Suspense>
    );
  }
  if (homepage === 'xingdou') {
    return (
      <Suspense fallback={<div className="min-h-screen bg-black" />}>
        <XingdouLanding />
      </Suspense>
    );
  }
  return <Home />;
}
