import '@/bootstrap/polyfills';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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
import { initializeRuntimeStability } from '@/bootstrap/runtimeStability';
import { claimDailyReward } from '@/services/adminApi';

const DAILY_REWARD_RESET_HOUR = 3;
const DAILY_REWARD_AUTO_CLAIM_KEY = 'daily_reward_auto_claim_key';

function getDailyRewardBusinessDayKey(date: Date): string {
  const anchor = new Date(date);
  if (anchor.getHours() < DAILY_REWARD_RESET_HOUR) {
    anchor.setDate(anchor.getDate() - 1);
  }

  const year = anchor.getFullYear();
  const month = String(anchor.getMonth() + 1).padStart(2, '0');
  const day = String(anchor.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function RootRoutes() {
  const user = useAuthStore((s) => s.user);
  const loadProjects = useProjectStore((s) => s.load);
  // Lazy init is triggered by protected routes/login flow to avoid auto /api/auth/me on every load.
  useEffect(() => {
    if (user) loadProjects();
  }, [user, loadProjects]);

  useEffect(() => {
    if (!user?.id || typeof window === 'undefined') {
      return;
    }

    const businessDayKey = getDailyRewardBusinessDayKey(new Date());
    const dedupeKey = `${user.id}:${businessDayKey}`;
    const claimedKey = window.sessionStorage.getItem(DAILY_REWARD_AUTO_CLAIM_KEY);
    if (claimedKey === dedupeKey) {
      return;
    }

    window.sessionStorage.setItem(DAILY_REWARD_AUTO_CLAIM_KEY, dedupeKey);
    void claimDailyReward()
      .then((result) => {
        if (result?.success) {
          window.dispatchEvent(new CustomEvent('refresh-credits'));
        }
      })
      .catch((error) => {
        console.warn('Auto claim daily reward failed:', error);
        window.sessionStorage.removeItem(DAILY_REWARD_AUTO_CLAIM_KEY);
      });
  }, [user?.id]);

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/auth/login" element={<LoginPage />} />
      <Route path="/auth/register" element={<RegisterPage />} />
      <Route path="/legal/terms" element={<TermsOfService />} />
      <Route path="/legal/privacy" element={<PrivacyPolicy />} />
      <Route path="/legal/community" element={<CommunityGuidelines />} />
      <Route path="/oss" element={<OSSDemo />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/workspace" element={<Workspace />} />
        <Route path="/app" element={<App />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/my-credits" element={<MyCredits />} />
        <Route path="/membership" element={<MembershipSubscribePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
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
