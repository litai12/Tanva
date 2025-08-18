import React from 'react';

interface DashedSelectIconProps {
  className?: string;
}

const DashedSelectIcon: React.FC<DashedSelectIconProps> = ({ className }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className}>
    <rect x="3" y="3" width="10" height="10" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" fill="none" />
  </svg>
);

export default DashedSelectIcon;