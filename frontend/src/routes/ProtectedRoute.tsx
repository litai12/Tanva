import { Navigate, Outlet } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { AuthWrapper } from '@/components/AuthWrapper';

export default function ProtectedRoute() {
  const user = useAuthStore((s) => s.user);
  const initializing = useAuthStore((s) => s.initializing);
  const init = useAuthStore((s) => s.init);

  // 本组件在首次挂载时触发延迟初始化，避免应用一加载就调用 /api/auth/me
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      // 异步触发初始化（会设置 initializing 为 true）
      init().catch(() => {});
    }
  }, [init]);

  // 如果尚未开始初始化或正在初始化，显示认证包装器
  if (!initializedRef.current || initializing) {
    return <AuthWrapper><Outlet /></AuthWrapper>;
  }

  if (!user) return <Navigate to="/auth/login" replace />;
  return <Outlet />;
}
