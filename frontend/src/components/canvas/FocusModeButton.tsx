import React from 'react';
import { useUIStore } from '@/stores';
import { useAIChatStore } from '@/stores/aiChatStore';

// 眼睛图标（专注模式关闭状态）
const EyeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

// 带斜线的眼睛图标（专注模式开启状态）
const EyeOffIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

const FocusModeButton: React.FC = () => {
  const { focusMode, toggleFocusMode, showLayerPanel } = useUIStore();
  const isAIChatMaximized = useAIChatStore(state => state.isMaximized);

  // AI 对话框最大化时隐藏眼睛按钮
  if (isAIChatMaximized) {
    return null;
  }

  return (
    <div
      className="fixed bottom-[120px] z-[1000] transition-all duration-[50ms] ease-out"
      style={{ left: showLayerPanel ? '322px' : '8px' }}
    >
      {/* 外层容器模拟工具栏的 px-2 padding，使眼睛图标中心对齐 */}
      <div className="px-2">
        <button
          onClick={toggleFocusMode}
          className="h-8 w-8 rounded-full flex items-center justify-center text-gray-400 hover:text-blue-600 transition-colors duration-200"
          title={focusMode ? "退出专注模式" : "进入专注模式（隐藏顶部导航和AI对话框）"}
        >
          {focusMode ? (
            <EyeOffIcon className="w-4 h-4" />
          ) : (
            <EyeIcon className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
};

export default FocusModeButton;
