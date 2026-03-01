import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from '@/routes/ProtectedRoute';
import './index.css';
import App from './App.tsx';
import Home from '@/pages/Home';
import LoginPage from '@/pages/auth/Login';
import RegisterPage from '@/pages/auth/Register';
import OSSDemo from '@/pages/OSSDemo';
import Admin from '@/pages/Admin';
import MyCredits from '@/pages/MyCredits';
import TermsOfService from '@/pages/legal/TermsOfService';
import PrivacyPolicy from '@/pages/legal/PrivacyPolicy';
import CommunityGuidelines from '@/pages/legal/CommunityGuidelines';
import { useAuthStore } from '@/stores/authStore';
import { useProjectStore } from '@/stores/projectStore';
import Workspace from '@/pages/Workspace';
import RunningHubTest from '@/pages/RunningHubTest';
import PendingUploadLeavePrompt from '@/components/guards/PendingUploadLeavePrompt';
import PendingUploadNavigationGuard from '@/components/guards/PendingUploadNavigationGuard';

function RootRoutes() {
  const user = useAuthStore((s) => s.user);
  const loadProjects = useProjectStore((s) => s.load);
  // 延迟初始化：由受保护路由或登录流程触发，避免在每次页面加载时自动请求 /api/auth/me
  useEffect(() => {
    if (user) loadProjects();
  }, [user, loadProjects]);
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/auth/login" element={<LoginPage />} />
      <Route path="/auth/register" element={<RegisterPage />} />
      <Route path="/legal/terms" element={<TermsOfService />} />
      <Route path="/legal/privacy" element={<PrivacyPolicy />} />
      <Route path="/legal/community" element={<CommunityGuidelines />} />
      <Route path="/oss" element={<OSSDemo />} />
      <Route path="/runninghub-test" element={<RunningHubTest />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/workspace" element={<Workspace />} />
        <Route path="/app" element={<App />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/my-credits" element={<MyCredits />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <PendingUploadNavigationGuard />
      <PendingUploadLeavePrompt />
      <RootRoutes />
    </BrowserRouter>
  </StrictMode>,
);
