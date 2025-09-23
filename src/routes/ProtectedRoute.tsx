import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

export default function ProtectedRoute() {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);

  // 等待初始化完成，避免刷新时误判为未登录
  if (loading) return null;
  if (!user) return <Navigate to="/auth/login" replace />;
  return <Outlet />;
}
