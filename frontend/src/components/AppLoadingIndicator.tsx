import React from 'react';
import { LoadingSpinner } from '@/components/ui/loading-spinner';

interface AppLoadingIndicatorProps {
  message?: string;
  className?: string;
}

export const AppLoadingIndicator: React.FC<AppLoadingIndicatorProps> = ({
  message = '加载中...',
  className = ''
}) => {
  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm ${className}`}>
      <div className="flex flex-col items-center gap-4 p-6 bg-white rounded-lg shadow-lg border">
        <LoadingSpinner size="lg" className="text-blue-500" />
        <p className="text-sm text-gray-600 font-medium">{message}</p>
      </div>
    </div>
  );
};
