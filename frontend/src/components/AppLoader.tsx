import React from 'react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface AppLoaderProps {
  message?: string;
  showLogo?: boolean;
}

export const AppLoader: React.FC<AppLoaderProps> = ({
  message = "加载中...",
  showLogo = true
}) => {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-white">
      <div className="flex flex-col items-center gap-6">
        {showLogo && (
          <img
            src="/LogoText.svg"
            className="h-8 w-auto"
            alt="Tanva"
          />
        )}
        <LoadingSpinner size="lg" message={message} />
      </div>
    </div>
  );
};
