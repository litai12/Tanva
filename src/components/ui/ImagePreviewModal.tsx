/**
 * 图片全屏预览模态框组件
 */

import React, { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from './button';

interface ImagePreviewModalProps {
  isOpen: boolean;
  imageSrc: string;
  imageTitle?: string;
  onClose: () => void;
}

const ImagePreviewModal: React.FC<ImagePreviewModalProps> = ({
  isOpen,
  imageSrc,
  imageTitle = '图片预览',
  onClose
}) => {
  // ESC键退出
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  // 监听键盘事件
  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      // 阻止背景滚动
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, handleKeyDown]);

  // 点击背景关闭
  const handleBackgroundClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  if (!isOpen) return null;

  const modalContent = (
    <div
        className="fixed inset-0 flex items-center justify-center cursor-pointer"
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.95)',
          backdropFilter: 'blur(4px)',
          zIndex: 999999,
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0
        }}
        onClick={handleBackgroundClick}
      >
        {/* 关闭按钮 */}
        <Button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('关闭预览按钮被点击');
            onClose();
          }}
          variant="ghost"
          size="sm"
          className="absolute top-4 right-4 h-8 w-8 p-0 text-white hover:bg-white/20 transition-all duration-200 z-[1000000]"
          title="关闭预览 (ESC)"
        >
          <X className="h-4 w-4" />
        </Button>

        {/* 图片容器 */}
        <div 
          className="w-full h-full flex items-center justify-center cursor-default"
          onClick={(e) => e.stopPropagation()}
        >
          <img
            src={imageSrc}
            alt={imageTitle}
            className="shadow-2xl"
            style={{
              filter: 'drop-shadow(0 25px 50px rgba(0, 0, 0, 0.8))',
              maxWidth: '100vw',
              maxHeight: '100vh',
              width: 'auto',
              height: 'auto',
              objectFit: 'contain'
            }}
            onLoad={() => console.log('预览图片加载成功:', imageSrc)}
            onError={(e) => {
              console.error('预览图片加载失败:', imageSrc, e);
            }}
          />
        </div>

    </div>
  );

  // 使用Portal确保模态框在最顶层
  return createPortal(modalContent, document.body);
};

export default ImagePreviewModal;