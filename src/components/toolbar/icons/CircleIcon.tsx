import React from 'react';

interface CircleIconProps {
  className?: string;
}

const CircleIcon: React.FC<CircleIconProps> = ({ className }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className}>
    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" fill="none" />
  </svg>
);

export default CircleIcon;