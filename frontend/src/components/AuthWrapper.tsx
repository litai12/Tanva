import React from 'react';
import { useAuthStore } from '@/stores/authStore';
import { AppLoader } from '@/components/AppLoader';

interface AuthWrapperProps {
  children: React.ReactNode;
}

export const AuthWrapper: React.FC<AuthWrapperProps> = ({ children }) => {
  const { user, initializing, error } = useAuthStore();

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
