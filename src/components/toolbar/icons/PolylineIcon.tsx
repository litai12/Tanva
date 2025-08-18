import React from 'react';

interface PolylineIconProps {
  className?: string;
}

const PolylineIcon: React.FC<PolylineIconProps> = ({ className }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className}>
    {/* 多段线路径 */}
    <path
      d="M2 12 L6 4 L10 8 L14 2"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
    {/* 起始点 */}
    <circle cx="2" cy="12" r="1.5" fill="currentColor" />
    {/* 中间节点 */}
    <circle cx="6" cy="4" r="1" fill="currentColor" />
    <circle cx="10" cy="8" r="1" fill="currentColor" />
    {/* 结束点 */}
    <circle cx="14" cy="2" r="1.5" fill="currentColor" />
  </svg>
);

export default PolylineIcon;