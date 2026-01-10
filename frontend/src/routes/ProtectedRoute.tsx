import { Navigate, Outlet } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/stores/authStore';

export default function ProtectedRoute() {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const init = useAuthStore((s) => s.init);

  // 本组件在首次挂载时触发延迟初始化，避免应用一加载就调用 /api/auth/me
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      // 异步触发初始化（会设置 loading 为 true）
      init().catch(() => {});
    }
  }, [init]);

  // 如果尚未开始初始化或正在初始化，保持空白（避免误重定向）
  if (!initializedRef.current || loading) return null;
  if (!user) return <Navigate to="/auth/login" replace />;
  return <Outlet />;
}
