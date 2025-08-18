import React from 'react';

interface LineIconProps {
  className?: string;
}

const LineIcon: React.FC<LineIconProps> = ({ className }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className}>
    <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

export default LineIcon;