import React, { useRef, useCallback, useMemo, useState, useEffect } from 'react';
import paper from 'paper';
import { useAIChatStore } from '@/stores/aiChatStore';
import { useCanvasStore } from '@/stores';
import { Sparkles, Trash2, ChevronUp, ChevronDown, Eye, EyeOff, Download } from 'lucide-react';
import { Button } from '../ui/button';
import ImagePreviewModal from '../ui/ImagePreviewModal';
import { downloadImage, getSuggestedFileName } from '@/utils/downloadHelper';

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
  onMoveLayerUp?: (imageId: string) => void; // 图层上移回调
  onMoveLayerDown?: (imageId: string) => void; // 图层下移回调
  onToggleVisibility?: (imageId: string) => void; // 切换图层可见性回调
  getImageDataForEditing?: (imageId: string) => string | null; // 获取高质量图像数据的函数
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
  onDelete,
  onMoveLayerUp,
  onMoveLayerDown,
  onToggleVisibility,
  getImageDataForEditing
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // 获取AI聊天状态
  const { setSourceImageForEditing, addImageForBlending, showDialog, sourceImageForEditing, sourceImagesForBlending } = useAIChatStore();

  // 获取画布状态 - 用于监听画布移动变化
  const { zoom, panX, panY } = useCanvasStore();

  // 实时Paper.js坐标状态
  const [realTimeBounds, setRealTimeBounds] = useState(bounds);
  const [isPositionStable, setIsPositionStable] = useState(true);
  
  // 预览模态框状态
  const [showPreview, setShowPreview] = useState(false);

  // 将Paper.js世界坐标转换为屏幕坐标（改进版）
  const convertToScreenBounds = useCallback((paperBounds: { x: number; y: number; width: number; height: number }) => {
    if (!paper.view) return paperBounds;

    try {
      const dpr = window.devicePixelRatio || 1;
      // 使用更精确的坐标转换
      const topLeft = paper.view.projectToView(new paper.Point(paperBounds.x, paperBounds.y));
      const bottomRight = paper.view.projectToView(new paper.Point(paperBounds.x + paperBounds.width, paperBounds.y + paperBounds.height));

      // 添加数值验证，防止NaN或无限值
      const result = {
        x: isFinite(topLeft.x) ? topLeft.x / dpr : paperBounds.x,
        y: isFinite(topLeft.y) ? topLeft.y / dpr : paperBounds.y,
        width: isFinite(bottomRight.x - topLeft.x) ? (bottomRight.x - topLeft.x) / dpr : paperBounds.width,
        height: isFinite(bottomRight.y - topLeft.y) ? (bottomRight.y - topLeft.y) / dpr : paperBounds.height
      };

      return result;
    } catch (error) {
      console.warn('坐标转换失败，使用原始坐标:', error);
      return paperBounds;
    }
  }, [zoom, panX, panY]); // 添加画布状态依赖，确保画布变化时函数重新创建

  // 从Paper.js获取实时坐标
  const getRealTimePaperBounds = useCallback(() => {
    try {
      // 首先尝试从所有图层中查找图片对象
      const imageGroup = paper.project?.layers?.flatMap(layer =>
        layer.children.filter(child =>
          child.data?.type === 'image' && child.data?.imageId === imageData.id
        )
      )[0];

      if (imageGroup instanceof paper.Group) {
        const raster = imageGroup.children.find(child => child instanceof paper.Raster) as paper.Raster;
        if (raster && raster.bounds && isFinite(raster.bounds.x)) {
          // 获取实际的边界信息，确保数值有效
          const realBounds = {
            x: Math.round(raster.bounds.x * 100) / 100, // 四舍五入到小数点后2位
            y: Math.round(raster.bounds.y * 100) / 100,
            width: Math.round(raster.bounds.width * 100) / 100,
            height: Math.round(raster.bounds.height * 100) / 100
          };

          // 验证bounds是否合理
          if (realBounds.width > 0 && realBounds.height > 0) {
            return realBounds;
          }
        }
      }
    } catch (error) {
      console.warn('获取Paper.js实时坐标失败:', error);
    }
    
    return bounds; // 回退到props中的bounds
  }, [imageData.id, bounds]);

  // 监听画布状态变化，强制重新计算坐标
  useEffect(() => {
    // 当画布状态变化时，强制重新计算屏幕坐标
    const newPaperBounds = getRealTimePaperBounds();
    setRealTimeBounds(newPaperBounds);
    setIsPositionStable(false);

    // 设置稳定定时器
    const stableTimer = setTimeout(() => {
      setIsPositionStable(true);
    }, 150);

    return () => {
      clearTimeout(stableTimer);
    };
  }, [zoom, panX, panY, getRealTimePaperBounds]); // 直接监听画布状态变化

  // 实时同步Paper.js状态 - 只在选中时启用
  useEffect(() => {
    if (!isSelected) return;

    let animationFrame: number;
    let isUpdating = false;
    let stableTimer: NodeJS.Timeout;

    const updateRealTimeBounds = () => {
      if (isUpdating) return;
      isUpdating = true;

      const paperBounds = getRealTimePaperBounds();

      // 检查坐标是否发生变化 - 降低阈值以获得更高精度
      const hasChanged =
        Math.abs(paperBounds.x - realTimeBounds.x) > 0.1 ||
        Math.abs(paperBounds.y - realTimeBounds.y) > 0.1 ||
        Math.abs(paperBounds.width - realTimeBounds.width) > 0.1 ||
        Math.abs(paperBounds.height - realTimeBounds.height) > 0.1;

      if (hasChanged) {
        setIsPositionStable(false);
        setRealTimeBounds(paperBounds);

        // 清除之前的稳定定时器
        if (stableTimer) {
          clearTimeout(stableTimer);
        }

        // 设置新的稳定定时器
        stableTimer = setTimeout(() => {
          setIsPositionStable(true);
        }, 150); // 增加延迟时间，确保位置真正稳定
      }

      isUpdating = false;
      animationFrame = requestAnimationFrame(updateRealTimeBounds);
    };

    // 立即更新一次，然后开始循环
    const paperBounds = getRealTimePaperBounds();
    setRealTimeBounds(paperBounds);
    animationFrame = requestAnimationFrame(updateRealTimeBounds);

    return () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
      if (stableTimer) {
        clearTimeout(stableTimer);
      }
    };
  }, [isSelected, getRealTimePaperBounds]);

  // 同步Props bounds变化
  useEffect(() => {
    setRealTimeBounds(bounds);
    setIsPositionStable(true);
  }, [bounds]);


  // 使用实时坐标进行屏幕坐标转换
  const screenBounds = useMemo(() => {
    return convertToScreenBounds(realTimeBounds);
  }, [realTimeBounds, convertToScreenBounds, zoom, panX, panY]); // 添加画布状态依赖，确保完全响应画布变化

  // 处理AI编辑按钮点击
  const handleAIEdit = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    try {
      // 🎯 优先使用原始高质量图像数据
      let imageDataUrl: string | null = null;
      
      // 首先尝试从getImageDataForEditing获取原始数据
      if (getImageDataForEditing) {
        imageDataUrl = getImageDataForEditing(imageData.id);
        if (imageDataUrl) {
          // console.log('🎨 AI编辑：使用原始高质量图像数据');
        }
      }
      
      // 备用方案：从canvas获取（已缩放，质量较低）
      if (!imageDataUrl) {
        console.warn('⚠️ AI编辑：未找到原始图像数据，使用canvas数据（可能已缩放）');
        const imageGroup = paper.project?.layers?.flatMap(layer =>
          layer.children.filter(child =>
            child.data?.type === 'image' && child.data?.imageId === imageData.id
          )
        )[0];

        if (imageGroup) {
          const raster = imageGroup.children.find(child => child instanceof paper.Raster) as paper.Raster;
          if (raster && raster.canvas) {
            imageDataUrl = raster.canvas.toDataURL('image/png');
          }
        }
      }
      
      if (!imageDataUrl) {
        console.error('❌ 无法获取图像数据');
        return;
      }
      
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
    } catch (error) {
      console.error('获取图像数据失败:', error);
    }
  }, [imageData.id, getImageDataForEditing, setSourceImageForEditing, addImageForBlending, showDialog, sourceImageForEditing, sourceImagesForBlending]);

  // 处理删除按钮点击
  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (onDelete) {
      onDelete(imageData.id);
      console.log('🗑️ 已删除图像:', imageData.id);
    }
  }, [imageData.id, onDelete]);

  // 处理图层上移
  const handleLayerMoveUp = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (onMoveLayerUp) {
      onMoveLayerUp(imageData.id);
      console.log('⬆️ 图层上移:', imageData.id);
    }
  }, [imageData.id, onMoveLayerUp]);

  // 处理图层下移
  const handleLayerMoveDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (onMoveLayerDown) {
      onMoveLayerDown(imageData.id);
      console.log('⬇️ 图层下移:', imageData.id);
    }
  }, [imageData.id, onMoveLayerDown]);

  // 处理预览按钮点击
  const handlePreview = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowPreview(true);
    console.log('👁️ 打开图片预览:', imageData.id);
  }, [imageData.id]);

  // 处理切换可见性按钮点击
  const handleToggleVisibility = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (onToggleVisibility) {
      onToggleVisibility(imageData.id);
      console.log('👁️‍🗨️ 切换图层可见性:', imageData.id);
    }
  }, [imageData.id, onToggleVisibility]);

  // 处理下载按钮点击
  const handleDownload = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    try {
      // 🎯 优先使用原始高质量图像数据
      let imageDataUrl: string | null = null;
      
      // 首先尝试从getImageDataForEditing获取原始数据
      if (getImageDataForEditing) {
        imageDataUrl = getImageDataForEditing(imageData.id);
        if (imageDataUrl) {
          // console.log('💾 下载：使用原始高质量图像数据');
        }
      }
      
      // 备用方案：使用imageData.src
      if (!imageDataUrl) {
        imageDataUrl = imageData.src;
        console.log('💾 下载：使用imageData.src');
      }
      
      if (!imageDataUrl) {
        console.error('❌ 无法获取图像数据进行下载');
        return;
      }
      
      // 生成建议的文件名
      const fileName = getSuggestedFileName(imageData.fileName, 'image');
      
      // 下载图片
      downloadImage(imageDataUrl, fileName);
      
      console.log('✅ 图片下载成功:', fileName);
    } catch (error) {
      console.error('❌ 图片下载失败:', error);
    }
  }, [imageData.id, imageData.src, imageData.fileName, getImageDataForEditing]);

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
          className={`absolute flex items-center justify-center gap-2 transition-all duration-150 ease-out ${
            !isPositionStable ? 'opacity-85 scale-95' : 'opacity-100 scale-100'
          }`}
          style={{
            bottom: -42, // 位于图片底部外侧
            left: 0,
            right: 0, // 使用left: 0, right: 0来确保完全居中
            marginLeft: 'auto',
            marginRight: 'auto',
            width: 'fit-content', // 自适应内容宽度
            zIndex: 30,
            pointerEvents: 'auto',
            position: 'absolute',
            // 添加固定定位确保稳定性
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center'
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
              backdropFilter: 'blur(12px)',
              background: 'rgba(255, 255, 255, 0.8)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12), 0 4px 16px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(255, 255, 255, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.2)'
            }}
          >
            <Sparkles className="w-4 h-4 text-blue-600" />
          </Button>

          {/* 预览按钮 */}
          <Button
            variant="outline"
            size="sm"
            className="px-2 py-2 h-8 w-8 shadow-lg hover:shadow-xl transition-all duration-200 ease-in-out hover:scale-105 hover:bg-blue-50 hover:border-blue-300"
            onClick={handlePreview}
            title="全屏预览图片"
            style={{
              backdropFilter: 'blur(12px)',
              background: 'rgba(255, 255, 255, 0.8)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12), 0 4px 16px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(255, 255, 255, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.2)'
            }}
          >
            <Eye className="w-4 h-4 text-blue-600" />
          </Button>

          {/* 隐藏/显示按钮 */}
          <Button
            variant="outline"
            size="sm"
            className="px-2 py-2 h-8 w-8 shadow-lg hover:shadow-xl transition-all duration-200 ease-in-out hover:scale-105 hover:bg-orange-50 hover:border-orange-300"
            onClick={handleToggleVisibility}
            title="隐藏图层（可在图层面板中恢复）"
            style={{
              backdropFilter: 'blur(12px)',
              background: 'rgba(255, 255, 255, 0.8)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12), 0 4px 16px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(255, 255, 255, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.2)'
            }}
          >
            <EyeOff className="w-4 h-4 text-blue-600" />
          </Button>

          {/* 下载按钮 */}
          <Button
            variant="outline"
            size="sm"
            className="px-2 py-2 h-8 w-8 shadow-lg hover:shadow-xl transition-all duration-200 ease-in-out hover:scale-105 hover:bg-green-50 hover:border-green-300"
            onClick={handleDownload}
            title="下载原始图片"
            style={{
              backdropFilter: 'blur(12px)',
              background: 'rgba(255, 255, 255, 0.8)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12), 0 4px 16px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(255, 255, 255, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.2)'
            }}
          >
            <Download className="w-4 h-4 text-blue-600" />
          </Button>

          {/* 删除按钮 */}
          <Button
            variant="outline"
            size="sm"
            className="px-2 py-2 h-8 w-8 shadow-lg hover:shadow-xl transition-all duration-200 ease-in-out hover:scale-105 hover:bg-red-50 hover:border-red-300"
            onClick={handleDelete}
            title="删除图片"
            style={{
              backdropFilter: 'blur(12px)',
              background: 'rgba(255, 255, 255, 0.8)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12), 0 4px 16px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(255, 255, 255, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.2)'
            }}
          >
            <Trash2 className="w-4 h-4 text-blue-600" />
          </Button>
        </div>
      )}

      {/* 图层顺序调整按钮 - 只在选中时显示，位于图片右侧 */}
      {isSelected && (
        <div
          className={`absolute flex flex-col gap-1 transition-all duration-150 ease-out ${
            !isPositionStable ? 'opacity-85 scale-95' : 'opacity-100 scale-100'
          }`}
          style={{
            right: -42, // 位于图片右侧外侧
            top: '50%', // 垂直居中
            transform: 'translateY(-50%)', // 确保垂直居中
            zIndex: 30,
            pointerEvents: 'auto',
            position: 'absolute'
          }}
        >
          {/* 图层上移按钮 */}
          <Button
            variant="outline"
            size="sm"
            className="px-2 py-2 h-8 w-8 shadow-lg hover:shadow-xl transition-all duration-200 ease-in-out hover:scale-105 hover:bg-blue-50 hover:border-blue-300"
            onClick={handleLayerMoveUp}
            title="图层上移"
            style={{
              backdropFilter: 'blur(12px)',
              background: 'rgba(255, 255, 255, 0.8)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12), 0 4px 16px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(255, 255, 255, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.2)'
            }}
          >
            <ChevronUp className="w-4 h-4 text-blue-600" />
          </Button>

          {/* 图层下移按钮 */}
          <Button
            variant="outline"
            size="sm"
            className="px-2 py-2 h-8 w-8 shadow-lg hover:shadow-xl transition-all duration-200 ease-in-out hover:scale-105 hover:bg-blue-50 hover:border-blue-300"
            onClick={handleLayerMoveDown}
            title="图层下移"
            style={{
              backdropFilter: 'blur(12px)',
              background: 'rgba(255, 255, 255, 0.8)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12), 0 4px 16px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(255, 255, 255, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.2)'
            }}
          >
            <ChevronDown className="w-4 h-4 text-blue-600" />
          </Button>
        </div>
      )}
      
      {/* 图片预览模态框 */}
      <ImagePreviewModal
        isOpen={showPreview}
        imageSrc={getImageDataForEditing ? (getImageDataForEditing(imageData.id) || imageData.src) : imageData.src}
        imageTitle={imageData.fileName || `图片 ${imageData.id}`}
        onClose={() => setShowPreview(false)}
      />
    </div>
  );
};

export default ImageContainer;
