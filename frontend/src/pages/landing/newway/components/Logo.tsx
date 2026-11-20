import React from 'react';

export const Logo: React.FC<{ className?: string }> = ({ className }) => {
  return (
    <svg 
      viewBox="0 0 320 80" 
      className={className} 
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMinYMid meet"
    >
      {/* Stylized MW Signature */}
      <text 
        x="0" 
        y="62" 
        fill="white" 
        fontFamily="'Brush Script MT', 'Segoe Script', 'Caveat', cursive" 
        fontSize="68" 
        fontStyle="italic"
      >
        MW
      </text>
      
      {/* NEWWAY Text */}
      <text 
        x="135" 
        y="54" 
        fill="white" 
        fontFamily="Inter, system-ui, sans-serif" 
        fontSize="34" 
        fontWeight="500" 
        letterSpacing="0.15em"
      >
        NEWWAY
      </text>
    </svg>
  );
};
