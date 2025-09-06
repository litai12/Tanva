import React, { useRef, useCallback, useMemo, useState, useEffect } from 'react';
import paper from 'paper';
import { useAIChatStore } from '@/stores/aiChatStore';
import { Sparkles, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';

interface ImageData {
  id: string;
  src: string;
  fileName?: string;
}

interface ImageContainerProps {
  imageData: ImageData;
  bounds: { x: number; y: number; width: number; height: number }; // Paper.js世界坐标
  isSelected?: boolean;
  visible?: boolean; // 是否可见
  drawMode?: string; // 当前绘图模式
  isSelectionDragging?: boolean; // 是否正在拖拽选择框
  layerIndex?: number; // 图层索引，用于计算z-index
  onSelect?: () => void;
  onMove?: (newPosition: { x: number; y: number }) => void; // Paper.js坐标
  onResize?: (newBounds: { x: number; y: number; width: number; height: number }) => void; // Paper.js坐标
  onDelete?: (imageId: string) => void; // 删除图片回调
}

const ImageContainer: React.FC<ImageContainerProps> = ({
  imageData,
  bounds,
  isSelected = false,
  visible = true,
  drawMode = 'select',
  isSelectionDragging = false,
  layerIndex = 0,
  onSelect,
  onMove,
  onResize,
  onDelete
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // 获取AI聊天状态
  const { setSourceImageForEditing, addImageForBlending, showDialog, sourceImageForEditing, sourceImagesForBlending } = useAIChatStore();

  // 实时Paper.js坐标状态
  const [realTimeBounds, setRealTimeBounds] = useState(bounds);
  const [isPositionStable, setIsPositionStable] = useState(true);

  // 将Paper.js世界坐标转换为屏幕坐标（改进版）
  const convertToScreenBounds = useCallback((paperBounds: { x: number; y: number; width: number; height: number }) => {
    if (!paper.view) return paperBounds;

    try {
      // 使用更精确的坐标转换
      const topLeft = paper.view.projectToView(new paper.Point(paperBounds.x, paperBounds.y));
      const bottomRight = paper.view.projectToView(new paper.Point(paperBounds.x + paperBounds.width, paperBounds.y + paperBounds.height));

      // 添加数值验证，防止NaN或无限值
      const result = {
        x: isFinite(topLeft.x) ? topLeft.x : paperBounds.x,
        y: isFinite(topLeft.y) ? topLeft.y : paperBounds.y,
        width: isFinite(bottomRight.x - topLeft.x) ? bottomRight.x - topLeft.x : paperBounds.width,
        height: isFinite(bottomRight.y - topLeft.y) ? bottomRight.y - topLeft.y : paperBounds.height
      };

      return result;
    } catch (error) {
      console.warn('坐标转换失败，使用原始坐标:', error);
      return paperBounds;
    }
  }, []);

  // 从Paper.js获取实时坐标
  const getRealTimePaperBounds = useCallback(() => {
    try {
      const imageGroup = paper.project?.layers?.flatMap(layer =>
        layer.children.filter(child =>
          child.data?.type === 'image' && child.data?.imageId === imageData.id
        )
      )[0];

      if (imageGroup) {
        const raster = imageGroup.children.find(child => child instanceof paper.Raster) as paper.Raster;
        if (raster && raster.bounds) {
          return {
            x: raster.bounds.x,
            y: raster.bounds.y,
            width: raster.bounds.width,
            height: raster.bounds.height
          };
        }
      }
    } catch (error) {
      console.warn('获取Paper.js实时坐标失败:', error);
    }
    
    return bounds; // 回退到props中的bounds
  }, [imageData.id, bounds]);

  // 实时同步Paper.js状态
  useEffect(() => {
    if (!isSelected) return;

    let animationFrame: number;
    let isUpdating = false;

    const updateRealTimeBounds = () => {
      if (isUpdating) return;
      isUpdating = true;

      const paperBounds = getRealTimePaperBounds();
      
      // 检查坐标是否发生变化
      const hasChanged = 
        Math.abs(paperBounds.x - realTimeBounds.x) > 0.5 ||
        Math.abs(paperBounds.y - realTimeBounds.y) > 0.5 ||
        Math.abs(paperBounds.width - realTimeBounds.width) > 0.5 ||
        Math.abs(paperBounds.height - realTimeBounds.height) > 0.5;

      if (hasChanged) {
        setIsPositionStable(false);
        setRealTimeBounds(paperBounds);
        
        // 短暂延迟后标记为稳定
        setTimeout(() => {
          setIsPositionStable(true);
        }, 100);
      }

      isUpdating = false;
      animationFrame = requestAnimationFrame(updateRealTimeBounds);
    };

    // 开始实时更新
    animationFrame = requestAnimationFrame(updateRealTimeBounds);

    return () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
    };
  }, [isSelected, getRealTimePaperBounds, realTimeBounds]);

  // 同步初始bounds
  useEffect(() => {
    setRealTimeBounds(bounds);
  }, [bounds]);

  // 使用实时坐标进行屏幕坐标转换
  const screenBounds = useMemo(() => {
    return convertToScreenBounds(realTimeBounds);
  }, [realTimeBounds, convertToScreenBounds]);

  // 处理AI编辑按钮点击
  const handleAIEdit = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    try {
      // 找到对应的Paper.js Raster对象
      const imageGroup = paper.project?.layers?.flatMap(layer =>
        layer.children.filter(child =>
          child.data?.type === 'image' && child.data?.imageId === imageData.id
        )
      )[0];

      if (imageGroup) {
        const raster = imageGroup.children.find(child => child instanceof paper.Raster) as paper.Raster;
        if (raster && raster.canvas) {
          const imageDataUrl = raster.canvas.toDataURL('image/png');
          
          // 检查是否已有图片，如果有则添加到融合模式，否则设置为编辑图片
          const hasExistingImages = sourceImageForEditing || sourceImagesForBlending.length > 0;
          
          if (hasExistingImages) {
            // 如果有编辑图片，先将其转换为融合模式
            if (sourceImageForEditing) {
              addImageForBlending(sourceImageForEditing);
              setSourceImageForEditing(null);
              console.log('🎨 将编辑图像转换为融合模式');
            }
            
            // 已有图片：添加新图片到融合模式
            addImageForBlending(imageDataUrl);
            console.log('🎨 已添加图像到融合模式');
          } else {
            // 没有现有图片：设置为编辑图片
            setSourceImageForEditing(imageDataUrl);
            console.log('🎨 已设置图像为编辑模式');
          }
          
          showDialog();
        }
      }
    } catch (error) {
      console.error('获取图像数据失败:', error);
    }
  }, [imageData.id, setSourceImageForEditing, addImageForBlending, showDialog, sourceImageForEditing, sourceImagesForBlending]);

  // 处理删除按钮点击
  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (onDelete) {
      onDelete(imageData.id);
      console.log('🗑️ 已删除图像:', imageData.id);
    }
  }, [imageData.id, onDelete]);

  // 已简化 - 移除了所有鼠标事件处理逻辑，让Paper.js完全处理交互

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        left: screenBounds.x,
        top: screenBounds.y,
        width: screenBounds.width,
        height: screenBounds.height,
        zIndex: 10 + layerIndex * 2 + (isSelected ? 1 : 0), // 大幅降低z-index，确保在对话框下方
        cursor: 'default',
        userSelect: 'none',
        pointerEvents: 'none', // 让所有鼠标事件穿透到Paper.js
        display: visible ? 'block' : 'none' // 根据visible属性控制显示/隐藏
      }}
    >
      {/* 透明覆盖层，让交互穿透到Paper.js */}
      <div
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: 'transparent',
          pointerEvents: 'none'
        }}
      />

      {/* 图片操作按钮组 - 只在选中时显示，位于图片底部 */}
      {isSelected && (
        <div
          className={`absolute flex items-center justify-center gap-2 transition-all duration-200 ease-in-out ${
            !isPositionStable ? 'opacity-90' : 'opacity-100'
          }`}
          style={{
            bottom: -40, // 位于图片底部外侧
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 30, // 确保低于对话框的z-50
            pointerEvents: 'auto', // 只有按钮区域可以点击
            // 添加更稳定的定位
            position: 'absolute',
            minWidth: '72px', // 容纳两个按钮和间距
            minHeight: '32px'
          }}
        >
          {/* AI编辑按钮 */}
          <Button
            variant="outline"
            size="sm"
            className="px-2 py-2 h-8 w-8 shadow-lg hover:shadow-xl transition-all duration-200 ease-in-out hover:scale-105"
            onClick={handleAIEdit}
            title="添加到AI对话框进行编辑"
            style={{
              backdropFilter: 'blur(8px)'
            }}
          >
            <Sparkles className="w-4 h-4" />
          </Button>
          
          {/* 删除按钮 */}
          <Button
            variant="outline"
            size="sm"
            className="px-2 py-2 h-8 w-8 shadow-lg hover:shadow-xl transition-all duration-200 ease-in-out hover:scale-105 hover:bg-red-50 hover:border-red-300"
            onClick={handleDelete}
            title="删除图片"
            style={{
              backdropFilter: 'blur(8px)'
            }}
          >
            <Trash2 className="w-4 h-4 text-red-600" />
          </Button>
        </div>
      )}
    </div>
  );
};

export default ImageContainer;