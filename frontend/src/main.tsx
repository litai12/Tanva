import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from '@/routes/ProtectedRoute';
import './index.css';
import App from './App.tsx';
import { installGlobalImageLoadTracker } from '@/utils/globalImageLoadTracker';
import Home from '@/pages/Home';
import LoginPage from '@/pages/auth/Login';
import RegisterPage from '@/pages/auth/Register';
import OSSDemo from '@/pages/OSSDemo';
import Admin from '@/pages/Admin';
import MyCredits from '@/pages/MyCredits';
import { useAuthStore } from '@/stores/authStore';
import { useProjectStore } from '@/stores/projectStore';
import Workspace from '@/pages/Workspace';
import RunningHubTest from '@/pages/RunningHubTest';
import { runMigrations } from '@/services/indexedDB/migrations';

// 应用启动时执行 localStorage -> IndexedDB 迁移
runMigrations().catch(console.error);

function RootRoutes() {
  const init = useAuthStore((s) => s.init);
  const user = useAuthStore((s) => s.user);
  const loadProjects = useProjectStore((s) => s.load);
  useEffect(() => { init(); }, [init]);
  useEffect(() => {
    if (user) loadProjects();
  }, [user, loadProjects]);
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/auth/login" element={<LoginPage />} />
      <Route path="/auth/register" element={<RegisterPage />} />
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

installGlobalImageLoadTracker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <RootRoutes />
    </BrowserRouter>
  </StrictMode>,
);
