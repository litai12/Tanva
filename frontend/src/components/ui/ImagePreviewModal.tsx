/**
 * 图片全屏预览模态框组件
 */

import React, { useEffect, useCallback, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronUp, ChevronDown } from 'lucide-react';
import { Button } from './button';
import './ImagePreviewModal.css';

export interface ImageItem {
  id: string;
  src: string;
  title?: string;
  timestamp?: number;
}

interface ImagePreviewModalProps {
  isOpen: boolean;
  imageSrc: string;
  imageTitle?: string;
  onClose: () => void;
  imageCollection?: ImageItem[]; // 图片集合
  currentImageId?: string; // 当前图片ID
  onImageChange?: (imageId: string) => void; // 切换图片回调
  collectionTitle?: string; // 缩略图集合标题
}

const ImagePreviewModal: React.FC<ImagePreviewModalProps> = ({
  isOpen,
  imageSrc,
  imageTitle = '图片预览',
  onClose,
  imageCollection = [],
  currentImageId,
  onImageChange,
  collectionTitle = '历史记录'
}) => {
  const sortedCollection = useMemo(() => {
    return imageCollection
      .map((item, index) => ({ ...item, _originalIndex: index }))
      .sort((a, b) => {
        const timeDiff = (b.timestamp ?? 0) - (a.timestamp ?? 0);
        if (timeDiff !== 0) return timeDiff;
        return a._originalIndex - b._originalIndex;
      })
      .map(({ _originalIndex, ...rest }) => rest as ImageItem);
  }, [imageCollection]);

  const [thumbnailScrollPosition, setThumbnailScrollPosition] = useState(0);
  const hasCollection = sortedCollection.length > 0;
  const showOrderBadges = hasCollection && sortedCollection.some((item) => typeof item.timestamp === 'number');
  // 处理缩略图点击
  const handleThumbnailClick = useCallback((imageId: string) => {
    if (onImageChange) {
      onImageChange(imageId);
    }
  }, [onImageChange]);

  // 获取当前图片索引
  const getCurrentImageIndex = useCallback(() => {
    if (!currentImageId || !hasCollection) return -1;
    return sortedCollection.findIndex(item => item.id === currentImageId);
  }, [currentImageId, sortedCollection, hasCollection]);

  // 切换到下一张/上一张图片
  const navigateImage = useCallback((direction: 'prev' | 'next') => {
    if (!hasCollection || !onImageChange) return;
    
    const currentIndex = getCurrentImageIndex();
    if (currentIndex === -1) return;

    let newIndex;
    if (direction === 'next') {
      newIndex = (currentIndex + 1) % sortedCollection.length;
    } else {
      newIndex = currentIndex === 0 ? sortedCollection.length - 1 : currentIndex - 1;
    }
    
    onImageChange(sortedCollection[newIndex].id);
  }, [hasCollection, onImageChange, getCurrentImageIndex, sortedCollection]);

  // 键盘事件处理
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      navigateImage('prev');
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      navigateImage('next');
    }
  }, [onClose, navigateImage]);

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
        className="fixed inset-0 flex cursor-pointer"
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
          className="absolute top-1 right-4 h-8 w-8 p-0 text-white hover:bg-white/20 transition-all duration-200 z-[1000000]"
          title="关闭预览 (ESC)"
        >
          <X className="h-4 w-4" />
        </Button>

        {/* 主图片容器 */}
        <div 
          className="flex-1 flex items-center justify-center cursor-default"
          style={{ paddingRight: hasCollection ? '240px' : '0' }}
          onClick={(e) => e.stopPropagation()}
        >
          <img
            src={imageSrc}
            alt={imageTitle}
            className="shadow-2xl"
            style={{
              filter: 'drop-shadow(0 25px 50px rgba(0, 0, 0, 0.8))',
              maxWidth: '100%',
              maxHeight: '100vh',
              width: 'auto',
              height: 'auto',
              objectFit: 'contain'
            }}
            onLoad={() => console.log('预览图片加载成功')}
            onError={(e) => {
              console.error('预览图片加载失败:', e);
            }}
          />
        </div>

        {/* 右侧缩略图栏 */}
        {hasCollection && (
          <div 
            className="absolute right-0 top-0 bottom-0 w-60 bg-black/80 border-l border-white/10 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 缩略图标题 */}
            <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-white text-sm font-medium">{collectionTitle}</h3>
            </div>

            {/* 缩略图滚动容器 */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              <div className="p-2 space-y-2">
                {sortedCollection.map((item, index) => {
                  const isActive = item.id === currentImageId;
                  const chronologicalNumber = sortedCollection.length - index;
                  const formattedTimestamp = item.timestamp
                    ? new Date(item.timestamp).toLocaleString()
                    : undefined;
                  // 判断文件名是否以.png结尾
                  const isPngFileName = item.title?.toLowerCase().endsWith('.png') ?? false;
                  // .png命名的图片永远不显示数字序号
                  const shouldShowBadge = showOrderBadges && !isPngFileName;
                  return (
                    <div
                      key={item.id}
                      className={`group relative cursor-pointer rounded-lg overflow-hidden transition-all duration-200 ${
                        isActive 
                          ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-black' 
                          : 'hover:ring-1 hover:ring-white/30'
                      }`}
                      onClick={() => handleThumbnailClick(item.id)}
                      title={formattedTimestamp ? `生成时间：${formattedTimestamp}` : undefined}
                    >
                      {shouldShowBadge && (
                        <div className="absolute top-1 left-1 w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-semibold flex items-center justify-center shadow">
                          {chronologicalNumber}
                        </div>
                      )}
                      {/* .png命名的图片显示"Current"标记 */}
                      {isPngFileName && isActive && (
                        <div className="absolute top-1 left-1 px-2 py-0.5 rounded-md bg-blue-600 text-white text-[9px] font-semibold flex items-center justify-center shadow-lg whitespace-nowrap z-10">
                          Current
                        </div>
                      )}
                      <div className="aspect-video bg-gray-800">
                        <img
                          src={item.src}
                          alt={item.title || `图片 ${index + 1}`}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </div>
                      {/* 标题 - hover时显示 */}
                      {item.title && (
                        <div className="absolute bottom-0 left-0 right-0 bg-black/80 p-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                          <p className="text-white text-xs truncate">{item.title}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 导航提示移除 */}
          </div>
        )}

    </div>
  );

  // 使用Portal确保模态框在最顶层
  return createPortal(modalContent, document.body);
};

export default ImagePreviewModal;
