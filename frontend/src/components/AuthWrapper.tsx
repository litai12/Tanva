import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { AppLoader } from '@/components/AppLoader';
import { getStoredTokenExpiry } from '@/services/authApi';

interface AuthWrapperProps {
  children: React.ReactNode;
}

export const AuthWrapper: React.FC<AuthWrapperProps> = ({ children }) => {
  const { user, initializing, error } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    try {
      const expiry = getStoredTokenExpiry();
      // 若没有本地过期时间或已过期，认为需要重新登录
      if (!expiry || expiry <= Date.now()) {
        window.dispatchEvent(
          new CustomEvent('toast', {
            detail: { message: '当前登录已过期，请重新登录', type: 'info' },
          })
        );
        if (!window.location.pathname.startsWith('/auth')) {
          navigate('/auth/login', { replace: true });
        }
      }
    } catch (e) {
      // 忽略本地存储读取错误
    }
  }, [navigate]);

  // 如果正在初始化认证状态，显示加载器
  if (initializing) {
    return <AppLoader message="验证登录状态..." />;
  }

  // 如果认证出错但没有用户，显示错误状态
  if (error && !user) {
    return (
      <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-white">
        <div className="text-center">
          <img
            src="/LogoText.svg"
            className="h-8 w-auto mx-auto mb-6"
            alt="Tanva"
          />
          <p className="text-red-500 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-800"
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }

  // 认证成功，显示子组件
  return <>{children}</>;
};
