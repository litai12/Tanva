import React from 'react';

interface ToolBarProps {
  style?: React.CSSProperties;
  showLayerPanel?: boolean;
  onClearCanvas?: () => void;
}

const ToolBar: React.FC<ToolBarProps> = ({
  showLayerPanel = false,
  onClearCanvas,
}) => {
  return (
    <div
      className={`fixed top-1/2 transform -translate-y-1/2 flex flex-col items-center gap-3 px-2 py-3 rounded-lg bg-white/95 backdrop-blur-sm shadow-lg border border-gray-200/50 z-[1000] transition-all duration-300 ${
        showLayerPanel ? 'left-[295px]' : 'left-2'
      }`}
      style={{
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.08)'
      }}
    >
      <div>Simple ToolBar</div>
    </div>
  );
};

export default ToolBar;