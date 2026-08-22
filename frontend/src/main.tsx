import '@/bootstrap/polyfills';
import { StrictMode, Suspense, lazy, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import '@/i18n';
import ProtectedRoute from '@/routes/ProtectedRoute';
import './index.css';
import App from './App.tsx';
import Home from '@/pages/Home';
import LoginPage from '@/pages/auth/Login';
import RegisterPage from '@/pages/auth/Register';
import OSSDemo from '@/pages/OSSDemo';
import Admin from '@/pages/Admin';
import MyCredits from '@/pages/MyCredits';
import MembershipSubscribePage from '@/pages/MembershipSubscribePage';
import TermsOfService from '@/pages/legal/TermsOfService';
import PrivacyPolicy from '@/pages/legal/PrivacyPolicy';
import CommunityGuidelines from '@/pages/legal/CommunityGuidelines';
import { useAuthStore } from '@/stores/authStore';
import { useProjectStore } from '@/stores/projectStore';
import Workspace from '@/pages/Workspace';
// 三个3D调试页依赖three全家桶,懒加载避免拖进主包
const DirectorHarnessPage = lazy(() => import('@/pages/DirectorHarnessPage'));
const ForcedRigTestPage = lazy(() => import('@/pages/ForcedRigTestPage'));
const ForcedCameraTestPage = lazy(() => import('@/pages/ForcedCameraTestPage'));
import { initializeRuntimeStability } from '@/bootstrap/runtimeStability';
import RuntimeErrorBoundary from '@/components/RuntimeErrorBoundary';
import DesktopApp from '@/desktop/DesktopApp';
import { initializeAuthTokenStorage } from '@/services/authTokenStorage';

function RootRoutes() {
  const user = useAuthStore((s) => s.user);
  const loadProjects = useProjectStore((s) => s.load);
  const desktopPreview =
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get('desktopPreview') === '1';
  // Lazy init is triggered by protected routes/login flow to avoid auto /api/auth/me on every load.
  useEffect(() => {
    if (user) loadProjects();
  }, [user, loadProjects]);

  if (window.tanvaDesktop?.isElectron || desktopPreview) {
    return (
      <Routes>
        <Route path="*" element={user || desktopPreview ? <DesktopApp /> : <LoginPage />} />
      </Routes>
    );
  }

  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/auth/login" element={<LoginPage />} />
        <Route path="/auth/register" element={<RegisterPage />} />
        <Route path="/legal/terms" element={<TermsOfService />} />
        <Route path="/legal/privacy" element={<PrivacyPolicy />} />
        <Route path="/legal/community" element={<CommunityGuidelines />} />
        <Route path="/oss" element={<OSSDemo />} />
        <Route path="/director-harness" element={<Suspense fallback={null}><DirectorHarnessPage /></Suspense>} />
        <Route path="/forced-rig-test" element={<Suspense fallback={null}><ForcedRigTestPage /></Suspense>} />
        <Route path="/forced-camera-test" element={<Suspense fallback={null}><ForcedCameraTestPage /></Suspense>} />
        <Route element={<ProtectedRoute />}>
          <Route path="/workspace" element={<Workspace />} />
          <Route path="/app" element={<App />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/my-credits" element={<MyCredits />} />
          <Route path="/membership" element={<MembershipSubscribePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

initializeRuntimeStability();

// Browser history assumes an HTTP server can serve every route. A packaged
// Electron build uses file://, so hash history keeps navigation anchored to
// the shipped index.html. Preload has already exposed tanvaDesktop here.
const AppRouter = window.tanvaDesktop?.isElectron ? HashRouter : BrowserRouter;

const renderApplication = () => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RuntimeErrorBoundary label="应用" variant="root">
        <AppRouter>
          <RootRoutes />
        </AppRouter>
      </RuntimeErrorBoundary>
    </StrictMode>,
  );
};

const bootstrapApplication = async () => {
  if (window.tanvaDesktop?.isElectron) {
    // 桌面端必须先恢复系统加密的令牌并校验/续期登录态，之后才能决定
    // 展示任务壳还是登录页。网页端继续沿用受保护路由的延迟初始化。
    await initializeAuthTokenStorage();
    await useAuthStore.getState().init();
  }
  renderApplication();
};

void bootstrapApplication();

if (import.meta.env.PROD && !window.tanvaDesktop?.isElectron && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
}
