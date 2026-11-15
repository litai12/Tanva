import { Navigate, useLocation } from 'react-router-dom';
import { readPreferDesktop, shouldRedirectToMobile } from '@/utils/mobileRedirect';

// 手机访问首页/画布入口时跳到同域 /m（登录态同源共享）；`?desktop=1` 可强制桌面版，`?desktop=0` 恢复。
export default function MobileRedirectGuard() {
  const { pathname, search } = useLocation();
  if (!shouldRedirectToMobile(pathname, navigator.userAgent, readPreferDesktop(search))) return null;
  return <Navigate to="/m" replace />;
}
