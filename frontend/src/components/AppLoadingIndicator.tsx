import React from 'react';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { useTranslation } from 'react-i18next';

interface AppLoadingIndicatorProps {
  message?: string;
  className?: string;
  style?: React.CSSProperties;
  variant?: 'card' | 'minimal';
}

export const AppLoadingIndicator: React.FC<AppLoadingIndicatorProps> = ({
  message,
  className = '',
  style,
  variant = 'card',
}) => {
  const { i18n } = useTranslation();
  const isZh = (i18n.resolvedLanguage || i18n.language || '').toLowerCase().startsWith('zh');
  const displayMessage = message ?? (isZh ? '加载中...' : 'Loading...');
  const isMinimal = variant === 'minimal';

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center ${
        isMinimal ? 'bg-white/35 backdrop-blur-md' : 'bg-white/80 backdrop-blur-sm'
      } ${className}`}
      style={style}
    >
      <div
        className={
          isMinimal
            ? 'flex flex-col items-center gap-3'
            : 'flex flex-col items-center gap-4 p-6 bg-white rounded-lg shadow-lg border'
        }
      >
        <LoadingSpinner size="lg" className="text-blue-500" />
        <p className={isMinimal ? 'text-sm text-slate-600 font-medium' : 'text-sm text-gray-600 font-medium'}>
          {displayMessage}
        </p>
      </div>
    </div>
  );
};
