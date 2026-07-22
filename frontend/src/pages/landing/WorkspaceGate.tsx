import { lazy, Suspense, useEffect, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import Workspace from '@/pages/Workspace';
import { useAuthStore } from '@/stores/authStore';
import { AuthWrapper } from '@/components/AuthWrapper';
import LoginNoticeModal from '@/components/auth/LoginNoticeModal';
import { useTenantHomepage } from './useTenantHomepage';

const XingdouWorkspace = lazy(() => import('./xingdou/XingdouWorkspace'));

/**
 * /workspace 分流：xingdou 租户展示星斗工作台（未登录也可浏览，操作时再引导登录）；
 * 其余租户保持原受保护的默认工作台（等价于原先包在 ProtectedRoute 里的行为）。
 */
function ProtectedDefaultWorkspace() {
  const user = useAuthStore((s) => s.user);
  const initializing = useAuthStore((s) => s.initializing);
  const init = useAuthStore((s) => s.init);

  const initializedRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      init().catch(() => {});
    }
  }, [init]);

  if (!initializedRef.current || initializing) {
    return (
      <AuthWrapper>
        <Workspace />
      </AuthWrapper>
    );
  }

  if (!user) return <Navigate to="/auth/login" replace />;
  return (
    <>
      <Workspace />
      <LoginNoticeModal />
    </>
  );
}

export default function WorkspaceGate() {
  const homepage = useTenantHomepage();

  // 未知期间不渲染，避免先闪默认工作台再切星斗版
  if (!homepage) return null;

  if (homepage === 'xingdou') {
    return (
      <Suspense fallback={<div className="min-h-screen bg-white" />}>
        <XingdouWorkspace />
      </Suspense>
    );
  }
  return <ProtectedDefaultWorkspace />;
}
