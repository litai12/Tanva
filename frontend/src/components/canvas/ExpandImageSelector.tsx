import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import paper from 'paper';
import { useCanvasStore } from '@/stores';
import { Button } from '../ui/button';
import { X, Send, Ruler } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

interface ExpandImageSelectorProps {
  imageBounds: { x: number; y: number; width: number; height: number };
  imageId: string;
  imageUrl: string;
  onSelect: (bounds: { x: number; y: number; width: number; height: number }, expandRatios: { left: number; top: number; right: number; bottom: number }) => void;
  onCancel: () => void;
}

const COMMON_SIZES = [
  { label: '16:9', ratio: 16 / 9 },
  { label: '1:1', ratio: 1 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '3:4', ratio: 3 / 4 },
  { label: '9:16', ratio: 9 / 16 },
];

const ExpandImageSelector: React.FC<ExpandImageSelectorProps> = ({
  imageBounds,
  imageId,
  imageUrl,
  onSelect,
  onCancel,
}) => {
  const [expandRatios, setExpandRatios] = useState<{ left: number; top: number; right: number; bottom: number } | null>(null);
  const [selectedSizeLabel, setSelectedSizeLabel] = useState('常用尺寸');
  const [frameBounds, setFrameBounds] = useState(imageBounds);
  const isDraggingRef = useRef(false);
  const hasCustomFrameRef = useRef(false);
  const prevImageIdRef = useRef(imageId);
  const prevImageBoundsRef = useRef(imageBounds);
  const dragStateRef = useRef<{
    index: number;
    startBounds: { x: number; y: number; width: number; height: number };
    startPaper: paper.Point;
  } | null>(null);
  // const { zoom, panX, panY } = useCanvasStore();

  // Keep local frame synced with image movement while preserving user adjustments
  useEffect(() => {
    const prev = prevImageBoundsRef.current;
    const deltaX = imageBounds.x - prev.x;
    const deltaY = imageBounds.y - prev.y;
    const scaleX = prev.width ? imageBounds.width / prev.width : 1;
    const scaleY = prev.height ? imageBounds.height / prev.height : 1;
    const hasMeaningfulChange =
      Math.abs(deltaX) > 0.5 ||
      Math.abs(deltaY) > 0.5 ||
      Math.abs(imageBounds.width - prev.width) > 0.5 ||
      Math.abs(imageBounds.height - prev.height) > 0.5;

    prevImageBoundsRef.current = imageBounds;

    if (!hasMeaningfulChange || isDraggingRef.current) return;

    setFrameBounds((current) => {
      if (!current) return imageBounds;
      if (!hasCustomFrameRef.current) {
        return imageBounds;
      }

      return {
        x: current.x + deltaX,
        y: current.y + deltaY,
        width: current.width * scaleX,
        height: current.height * scaleY,
      };
    });
  }, [imageBounds]);

  useEffect(() => {
    if (prevImageIdRef.current === imageId) return;
    prevImageIdRef.current = imageId;
    prevImageBoundsRef.current = imageBounds;
    hasCustomFrameRef.current = false;
    setFrameBounds(imageBounds);
    setSelectedSizeLabel('常用尺寸');
  }, [imageId, imageBounds]);

  // 将Paper.js坐标转换为屏幕坐标
  const convertToScreen = useCallback((point: paper.Point) => {
    if (!paper.view) return { x: point.x, y: point.y };
    const dpr = window.devicePixelRatio || 1;
    const viewPoint = paper.view.projectToView(point);
    return { x: viewPoint.x / dpr, y: viewPoint.y / dpr };
  }, []);

  // 将屏幕坐标转换为Paper.js坐标
  const convertToPaper = useCallback((screenX: number, screenY: number) => {
    if (!paper.view) return new paper.Point(screenX, screenY);
    const dpr = window.devicePixelRatio || 1;
    return paper.view.viewToProject(new paper.Point(screenX * dpr, screenY * dpr));
  }, []);

  // 计算扩图比例
  const calculateExpandRatios = useCallback((bounds: { x: number; y: number; width: number; height: number }) => {
    const imageWidth = imageBounds.width;
    const imageHeight = imageBounds.height;
    const imageLeft = imageBounds.x;
    const imageTop = imageBounds.y;

    // 计算选择区域相对于图片的位置
    const relativeLeft = Math.max(0, imageLeft - bounds.x);
    const relativeTop = Math.max(0, imageTop - bounds.y);
    const relativeRight = Math.max(0, (bounds.x + bounds.width) - (imageLeft + imageWidth));
    const relativeBottom = Math.max(0, (bounds.y + bounds.height) - (imageTop + imageHeight));

    // 计算扩图比例（扩图部分/原图尺寸）
    return {
      left: relativeLeft / imageWidth,
      top: relativeTop / imageHeight,
      right: relativeRight / imageWidth,
      bottom: relativeBottom / imageHeight,
    };
  }, [imageBounds]);

  // 取消选择
  const handleCancel = useCallback(() => {
    onCancel();
    setSelectedSizeLabel('常用尺寸');
  }, [onCancel]);

  const handleRightClickCancel = useCallback((e?: React.MouseEvent | MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    handleCancel();
  }, [handleCancel]);

  // Handle resizing logic outside useEffect

  const getPaperPointFromClient = useCallback((clientX: number, clientY: number) => {
    const canvas = paper.project?.view?.element;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;
    return convertToPaper(screenX, screenY);
  }, [convertToPaper]);

  const startHandleDrag = useCallback((index: number, clientX: number, clientY: number) => {
    const startPaper = getPaperPointFromClient(clientX, clientY);
    if (!startPaper) return;
    isDraggingRef.current = true;
    hasCustomFrameRef.current = true;
    dragStateRef.current = {
      index,
      startBounds: { ...frameBounds },
      startPaper,
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!dragStateRef.current) return;
      const currentPaper = getPaperPointFromClient(event.clientX, event.clientY);
      if (!currentPaper) return;

      const { index: handleIndex, startBounds, startPaper: start } = dragStateRef.current;
      const delta = currentPaper.subtract(start);

      let newX = startBounds.x;
      let newY = startBounds.y;
      let newWidth = startBounds.width;
      let newHeight = startBounds.height;

      const affectsLeft = handleIndex === 0 || handleIndex === 3;
      const affectsTop = handleIndex === 0 || handleIndex === 1;

      switch (handleIndex) {
        case 0: // top-left
          newX += delta.x;
          newY += delta.y;
          newWidth -= delta.x;
          newHeight -= delta.y;
          break;
        case 1: // top-right
          newY += delta.y;
          newWidth += delta.x;
          newHeight -= delta.y;
          break;
        case 2: // bottom-right
          newWidth += delta.x;
          newHeight += delta.y;
          break;
        case 3: // bottom-left
          newX += delta.x;
          newWidth -= delta.x;
          newHeight += delta.y;
          break;
      }

      const minSize = 40;
      if (newWidth < minSize) {
        if (affectsLeft) {
          newX = startBounds.x + (startBounds.width - minSize);
        }
        newWidth = minSize;
      }
      if (newHeight < minSize) {
        if (affectsTop) {
          newY = startBounds.y + (startBounds.height - minSize);
        }
        newHeight = minSize;
      }

      const imageLeft = imageBounds.x;
      const imageTop = imageBounds.y;
      const imageRight = imageBounds.x + imageBounds.width;
      const imageBottom = imageBounds.y + imageBounds.height;

      let newRight = newX + newWidth;
      let newBottom = newY + newHeight;

      if (newX > imageLeft) {
        newX = imageLeft;
        newWidth = newRight - newX;
      }
      if (newRight < imageRight) {
        newRight = imageRight;
        newWidth = newRight - newX;
      }
      if (newY > imageTop) {
        newY = imageTop;
        newHeight = newBottom - newY;
      }
      if (newBottom < imageBottom) {
        newBottom = imageBottom;
        newHeight = newBottom - newY;
      }

      if (newWidth < imageBounds.width) {
        newWidth = imageBounds.width;
        newX = imageBounds.x;
      }
      if (newHeight < imageBounds.height) {
        newHeight = imageBounds.height;
        newY = imageBounds.y;
      }

      setFrameBounds({ x: newX, y: newY, width: newWidth, height: newHeight });
    };

    const handlePointerUp = () => {
      dragStateRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      isDraggingRef.current = false;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  }, [frameBounds, getPaperPointFromClient]);

  const handleHandlePointerDown = useCallback((index: number) => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    startHandleDrag(index, event.clientX, event.clientY);
  }, [startHandleDrag]);

  // Update ratios on frame change
  useEffect(() => {
    if (frameBounds) {
      setExpandRatios(calculateExpandRatios(frameBounds));
    }
  }, [frameBounds, calculateExpandRatios]);

  // 应用比例
  const applyAspectRatio = useCallback((ratio: number, label?: string) => {
    if (ratio <= 0) return;
    hasCustomFrameRef.current = true;

    const baseWidth = imageBounds.width;
    const baseHeight = imageBounds.height;

    let newWidth = baseWidth;
    let newHeight = newWidth / ratio;

    if (newHeight < baseHeight) {
      newHeight = baseHeight;
      newWidth = newHeight * ratio;
    }

    const MIN_SIZE = 10;
    newWidth = Math.max(newWidth, MIN_SIZE);
    newHeight = Math.max(newHeight, MIN_SIZE);

    const centerX = imageBounds.x + imageBounds.width / 2;
    const centerY = imageBounds.y + imageBounds.height / 2;

    const newBounds = {
      x: centerX - newWidth / 2,
      y: centerY - newHeight / 2,
      width: newWidth,
      height: newHeight,
    };

    setFrameBounds(newBounds);
    const ratios = calculateExpandRatios(newBounds);
    setExpandRatios(ratios);

    if (label) {
      setSelectedSizeLabel(label);
    }
  }, [imageBounds, calculateExpandRatios]);

  // 确认选择并发送
  const handleConfirm = useCallback(() => {
    if (!frameBounds || !expandRatios) return;
    onSelect(frameBounds, expandRatios);
  }, [frameBounds, expandRatios, onSelect]);

  const screenBounds = useMemo(() => {
    if (!frameBounds) return null;
    const topLeft = convertToScreen(new paper.Point(frameBounds.x, frameBounds.y));
    const bottomRight = convertToScreen(new paper.Point(frameBounds.x + frameBounds.width, frameBounds.y + frameBounds.height));
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    };
  }, [frameBounds, convertToScreen]);

  const imageScreenBounds = useMemo(() => {
    const topLeft = convertToScreen(new paper.Point(imageBounds.x, imageBounds.y));
    const bottomRight = convertToScreen(new paper.Point(imageBounds.x + imageBounds.width, imageBounds.y + imageBounds.height));
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    };
  }, [imageBounds, convertToScreen]);

  const previewImagePosition = useMemo(() => {
    if (!screenBounds) return null;
    if (!imageScreenBounds) return null;
    return {
      left: imageScreenBounds.x - screenBounds.x,
      top: imageScreenBounds.y - screenBounds.y,
      width: imageScreenBounds.width,
      height: imageScreenBounds.height,
    };
  }, [imageScreenBounds, screenBounds]);

  // 阻止画板的默认交互，但允许截图选择层工作
  useEffect(() => {
    const canvas = paper.project?.view?.element;
    if (!canvas) return;

    // 设置画板为不可交互，让我们的选择层处理所有鼠标事件
    canvas.style.pointerEvents = 'none';

    return () => {
      canvas.style.pointerEvents = 'auto';
    };
  }, []);

  const controlPanelPosition = useMemo(() => {
    if (!screenBounds) return { left: 0, top: 0 };
    const panelHeight = 106;
    const panelWidth = 50;
    const gap = 12;

    let left = screenBounds.x + screenBounds.width + gap;
    let top = screenBounds.y + screenBounds.height - panelHeight;

    if (left + panelWidth > window.innerWidth - 12) {
      left = window.innerWidth - panelWidth - 12;
    }
    if (top + panelHeight > window.innerHeight - 12) {
      top = window.innerHeight - panelHeight - 12;
    }
    if (top < 12) {
      top = 12;
    }

    return { left, top };
  }, [screenBounds]);

  const sizeBadgePosition = useMemo(() => {
    if (!screenBounds) return { left: 0, top: 0 };
    const gap = 10;
    const left = Math.max(
      Math.min(screenBounds.x + screenBounds.width / 2, window.innerWidth - 80),
      12
    );
    const top = Math.min(screenBounds.y + screenBounds.height + gap, window.innerHeight - 30);
    return { left, top };
  }, [screenBounds]);

  return (
    <>
      {/* 全屏覆盖层 */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 10000,
          cursor: 'crosshair',
          backgroundColor: 'transparent',
          pointerEvents: 'auto',
        }}
        onContextMenu={handleRightClickCancel}
      >
        <div
          style={{
            position: 'absolute',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0, 0, 0, 0.75)',
            color: 'white',
            padding: '12px 24px',
            borderRadius: '8px',
            fontSize: '14px',
            zIndex: 10001,
          }}
        >
          {frameBounds ? '左键拖拽角柄调整区域，右键或点击取消按钮退出' : '请拖拽图片角柄调整扩图区域'}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCancel}
          style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            zIndex: 10000,
            backgroundColor: 'white',
          }}
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {frameBounds && screenBounds && (
        <>
          <div
            style={{
              position: 'fixed',
              left: `${screenBounds.x}px`,
              top: `${screenBounds.y}px`,
              width: `${screenBounds.width}px`,
              height: `${screenBounds.height}px`,
              zIndex: 10000,
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: '#fff',
                boxShadow: '0 30px 70px rgba(15,23,42,0.25)',
                pointerEvents: 'none',
              }}
            />
            {imageUrl && previewImagePosition && (
              <img
                src={imageUrl}
                alt=""
                style={{
                  position: 'absolute',
                  left: `${previewImagePosition.left}px`,
                  top: `${previewImagePosition.top}px`,
                  width: `${previewImagePosition.width}px`,
                  height: `${previewImagePosition.height}px`,
                  objectFit: 'cover',
                  pointerEvents: 'none',
                  userSelect: 'none',
                  zIndex: 1,
                }}
                draggable={false}
              />
            )}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                border: '2px dashed #3b82f6',
                borderRadius: 0,
                pointerEvents: 'none',
                zIndex: 2,
              }}
            />
            {[
              { key: 'tl', style: { left: -8, top: -8 }, cursor: 'nwse-resize', index: 0 },
              { key: 'tr', style: { right: -8, top: -8 }, cursor: 'nesw-resize', index: 1 },
              { key: 'br', style: { right: -8, bottom: -8 }, cursor: 'nwse-resize', index: 2 },
              { key: 'bl', style: { left: -8, bottom: -8 }, cursor: 'nesw-resize', index: 3 },
            ].map(handle => (
              <div
                key={handle.key}
                onPointerDown={handleHandlePointerDown(handle.index)}
                style={{
                  position: 'absolute',
                  width: 14,
                  height: 14,
                  borderRadius: 2,
                  background: '#2563eb',
                  border: '1px solid #dbeafe',
                  boxShadow: '0 3px 8px rgba(37, 99, 235, 0.18)',
                  cursor: handle.cursor as React.CSSProperties['cursor'],
                  pointerEvents: 'auto',
                  zIndex: 3,
                  ...handle.style,
                }}
              />
            ))}
          </div>
          <div
            style={{
              position: 'fixed',
              left: `${sizeBadgePosition.left}px`,
              top: `${sizeBadgePosition.top}px`,
              zIndex: 10001,
              background: '#fff',
              color: '#0f172a',
              padding: '3px 10px',
              borderRadius: '999px',
              fontSize: '11px',
              letterSpacing: '0.1px',
              border: '1px solid rgba(15,23,42,0.1)',
              pointerEvents: 'none',
              transform: 'translateX(-50%)',
              boxShadow: '0 6px 14px rgba(15, 23, 42, 0.08)',
            }}
          >
            {`${frameBounds.width.toFixed(0)} × ${frameBounds.height.toFixed(0)}`}
          </div>
          <div
            data-expand-panel
            style={{
              position: 'fixed',
              left: `${controlPanelPosition.left}px`,
              top: `${controlPanelPosition.top}px`,
              zIndex: 10001,
              background: 'transparent',
              borderRadius: '18px',
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              alignItems: 'center',
              boxShadow: 'none',
              pointerEvents: 'auto',
              border: 'none',
              width: '50px',
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  style={{
                    color: '#0f172a',
                    border: '1px solid rgba(15,23,42,0.15)',
                    borderRadius: '999px',
                    width: '34px',
                    height: '34px',
                    background: '#f8fafc',
                    // padding: '5px',
                    margin: '0px 8px',
                  }}
                  title="选择常用尺寸"
                >
                  <Ruler className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="start" style={{ width: '74px', background: 'rgba(255,255,255,0.9)', fontSize: '10px' }}>
                {COMMON_SIZES.map(({ label, ratio }) => (
                  <DropdownMenuItem
                    key={label}
                    onClick={() => applyAspectRatio(ratio, label)}
                    style={{ textAlign: 'center' }}
                  >
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="default"
              size="sm"
              onClick={handleConfirm}
              disabled={!frameBounds || !expandRatios}
              title="发送"
              style={{
                width: '34px',
                height: '34px',
                borderRadius: '50%',
                boxShadow: '0 8px 14px rgba(37, 99, 235, 0.25)',
              }}
            >
              <Send className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              title="取消"
              style={{
                color: '#0f172a',
                border: '1px solid rgba(15,23,42,0.15)',
                width: '34px',
                height: '34px',
                borderRadius: '50%',
                background: '#f8fafc',
              }}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </>
      )}
    </>
  );
};

export default ExpandImageSelector;
