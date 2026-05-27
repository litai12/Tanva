import { Navigate, Outlet } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { AuthWrapper } from '@/components/AuthWrapper';
import LoginNoticeModal from '@/components/auth/LoginNoticeModal';

export default function ProtectedRoute() {
  const user = useAuthStore((s) => s.user);
  const initializing = useAuthStore((s) => s.initializing);
  const init = useAuthStore((s) => s.init);

  // Trigger lazy auth init on first mount to avoid calling /api/auth/me immediately.
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      // Initialize asynchronously (this sets initializing=true).
      init().catch(() => {});
    }
  }, [init]);

  // Show auth wrapper while initialization has not started or is in progress.
  if (!initializedRef.current || initializing) {
    return <AuthWrapper><Outlet /></AuthWrapper>;
  }

  if (!user) return <Navigate to="/auth/login" replace />;
  return (
    <>
      <Outlet />
      <LoginNoticeModal />
    </>
  );
}
