import React from "react";

interface GlassButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

const GlassButton: React.FC<GlassButtonProps> = ({
  children,
  onClick,
  className = "",
}) => {
  return (
    <button
      onClick={onClick}
      className={`
        relative group
        px-12 py-3
        bg-gradient-to-r from-pink-500/20 via-purple-500/20 to-blue-500/20
        backdrop-blur-xl
        border border-white/30
        rounded-full
        text-white text-xl
        shadow-2xl
        hover:shadow-pink-500/50
        transition-all duration-300
        hover:scale-105
        overflow-hidden
        ${className}
      `}
      style={{
        boxShadow:
          "0 0 20px rgba(236, 72, 153, 0.3), 0 0 40px rgba(168, 85, 247, 0.2), inset 0 0 20px rgba(255, 255, 255, 0.1)",
      }}
    >
      {/* 发光边框效果 */}
      <div
        className='absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300'
        style={{
          background:
            "linear-gradient(90deg, #ec4899, #a855f7, #3b82f6, #ec4899)",
          backgroundSize: "200% 100%",
          animation: "gradient-shift 3s linear infinite",
          filter: "blur(8px)",
          zIndex: -1,
        }}
      />

      {/* 内部光泽 */}
      <div className='absolute inset-0 bg-gradient-to-b from-white/20 to-transparent rounded-full opacity-50' />

      {/* 文字内容 */}
      <span className='relative z-10'>{children}</span>

      {/* 悬停时的光效 */}
      <div className='absolute inset-0 rounded-full opacity-0 group-hover:opacity-30 transition-opacity duration-300 bg-gradient-to-r from-pink-400 via-purple-400 to-blue-400 blur-xl' />
    </button>
  );
};

export default GlassButton;
