import '@/bootstrap/polyfills';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import '@/i18n';
import ProtectedRoute from '@/routes/ProtectedRoute';
import './index.css';
import App from './App.tsx';
import HomeGate from '@/pages/landing/HomeGate';
import WorkspaceGate from '@/pages/landing/WorkspaceGate';
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
import DirectorHarnessPage from '@/pages/DirectorHarnessPage';
import ForcedRigTestPage from '@/pages/ForcedRigTestPage';
import ForcedCameraTestPage from '@/pages/ForcedCameraTestPage';
import { initializeRuntimeStability } from '@/bootstrap/runtimeStability';

function RootRoutes() {
  const user = useAuthStore((s) => s.user);
  const loadProjects = useProjectStore((s) => s.load);
  // Lazy init is triggered by protected routes/login flow to avoid auto /api/auth/me on every load.
  useEffect(() => {
    if (user) loadProjects();
  }, [user, loadProjects]);

  return (
    <>
      <Routes>
        <Route path="/" element={<HomeGate />} />
        <Route path="/auth/login" element={<LoginPage />} />
        <Route path="/auth/register" element={<RegisterPage />} />
        <Route path="/legal/terms" element={<TermsOfService />} />
        <Route path="/legal/privacy" element={<PrivacyPolicy />} />
        <Route path="/legal/community" element={<CommunityGuidelines />} />
        <Route path="/oss" element={<OSSDemo />} />
        <Route path="/director-harness" element={<DirectorHarnessPage />} />
        <Route path="/forced-rig-test" element={<ForcedRigTestPage />} />
        <Route path="/forced-camera-test" element={<ForcedCameraTestPage />} />
        {/* /workspace 按租户分流：xingdou 公开访问，其余租户在 WorkspaceGate 内保持登录保护 */}
        <Route path="/workspace" element={<WorkspaceGate />} />
        <Route element={<ProtectedRoute />}>
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <RootRoutes />
    </BrowserRouter>
  </StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
}
