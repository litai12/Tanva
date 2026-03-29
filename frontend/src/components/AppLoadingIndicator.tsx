import React from 'react';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { useTranslation } from 'react-i18next';

interface AppLoadingIndicatorProps {
  message?: string;
  className?: string;
}

export const AppLoadingIndicator: React.FC<AppLoadingIndicatorProps> = ({
  message,
  className = ''
}) => {
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language || '').toLowerCase().startsWith('zh');
  const displayMessage = message ?? (isZh ? '加载中...' : 'Loading...');

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm ${className}`}>
      <div className="flex flex-col items-center gap-4 p-6 bg-white rounded-lg shadow-lg border">
        <LoadingSpinner size="lg" className="text-blue-500" />
        <p className="text-sm text-gray-600 font-medium">{displayMessage}</p>
      </div>
    </div>
  );
};
