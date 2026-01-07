import React from 'react';
import { Handle, Position } from 'reactflow';
import { Copy, Trash2, Download, FolderPlus, Send as SendIcon } from 'lucide-react';
import ImagePreviewModal, { type ImageItem } from '../../ui/ImagePreviewModal';
import { useImageHistoryStore } from '../../../stores/imageHistoryStore';
import { recordImageHistoryEntry } from '@/services/imageHistoryService';
import { useProjectContentStore } from '@/stores/projectContentStore';
import ContextMenu from '../../ui/context-menu';

type Props = {
  id: string;
  data: {
    imageData?: string;
    thumbnail?: string;
    imageWidth?: number;
    imageName?: string;
    onSend?: (id: string) => void;
  };
  selected?: boolean;
};

const buildImageSrc = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('data:image')) return trimmed;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return `data:image/png;base64,${trimmed}`;
};

const MIN_IMAGE_WIDTH = 150;
const MAX_IMAGE_WIDTH = 600;
const DEFAULT_IMAGE_WIDTH = 296;

// 角点样式常量
const CORNER_STYLE: React.CSSProperties = {
  position: 'absolute',
  width: 10,
  height: 10,
  borderRadius: '50%',
  background: '#3b82f6',
  zIndex: 20,
};

const ImageContent = React.memo(({ displaySrc, isDragOver, onDrop, onDragOver, onDragLeave, onDoubleClick }: {
  displaySrc?: string;
  isDragOver: boolean;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDoubleClick: () => void;
}) => (
  <div
    onDrop={onDrop}
    onDragOver={onDragOver}
    onDragLeave={onDragLeave}
    onDoubleClick={onDoubleClick}
    style={{
      position: 'relative',
      width: '100%',
      height: '100%',
      background: isDragOver ? '#e0f2fe' : displaySrc ? 'transparent' : '#f8f9fa',
      borderRadius: 12,
      overflow: 'hidden',
      cursor: 'pointer',
      border: isDragOver ? '2px dashed #3b82f6' : 'none',
    }}
    title='拖拽图片到此或双击上传'
  >
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {displaySrc ? (
        <img
          src={displaySrc}
          alt=""
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            transform: 'translateZ(0)',
            backfaceVisibility: 'hidden',
          }}
        />
      ) : (
        <span style={{ fontSize: 12, color: '#9ca3af' }}>
          {isDragOver ? '释放以上传' : '拖拽图片到此或双击上传'}
        </span>
      )}
    </div>
  </div>
));

function ImageProNodeInner({ id, data, selected }: Props) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // 图片源
  const fullSrc = React.useMemo(() => buildImageSrc(data.imageData), [data.imageData]);
  const displaySrc = React.useMemo(
    () => buildImageSrc(data.thumbnail) || fullSrc,
    [data.thumbnail, fullSrc]
  );

  // 状态
  const [hover, setHover] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);
  const [currentImageId, setCurrentImageId] = React.useState<string>('');
  const [contextMenu, setContextMenu] = React.useState<{ x: number; y: number } | null>(null);
  const [isDragOver, setIsDragOver] = React.useState(false);
  const [isResizing, setIsResizing] = React.useState(false);
  const resizeBoxRef = React.useRef<HTMLDivElement>(null);

  // 图片宽度
  const imageWidth = data.imageWidth || DEFAULT_IMAGE_WIDTH;
  const imageHeight = imageWidth * 0.75; // 保持 4:3 比例

  // 项目 ID
  const projectId = useProjectContentStore((state) => state.projectId);

  // 图片历史（仅预览时获取）
  const allImages = React.useMemo(() => {
    if (!preview) return [];
    const history = useImageHistoryStore.getState().history;
    const projectHistory = projectId
      ? history.filter((item) => {
          const pid = item.projectId ?? null;
          return pid === projectId || pid === null;
        })
      : history;
    return projectHistory.map(
      (item) =>
        ({
          id: item.id,
          src: item.src,
          title: item.title,
          timestamp: item.timestamp,
        }) as ImageItem
    );
  }, [preview, projectId]);

  // 处理文件上传
  const handleFiles = React.useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith('image/')) return;

    const normalizedFileName = (file.name || '').trim();
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      const displayName = normalizedFileName || '未命名图片';

      window.dispatchEvent(
        new CustomEvent('flow:updateNodeData', {
          detail: { id, patch: { imageData: base64, imageName: displayName } },
        })
      );

      const newImageId = `${id}-${Date.now()}`;
      setCurrentImageId(newImageId);
      void recordImageHistoryEntry({
        id: newImageId,
        base64,
        title: displayName,
        nodeId: id,
        nodeType: 'imagePro',
        fileName: file.name || `flow_image_${newImageId}.png`,
        projectId,
      });
    };
    reader.readAsDataURL(file);
  }, [id, projectId]);

  // 拖拽处理
  const onDrop = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const onDragOver = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const onDragLeave = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  // 双击上传
  const handleDoubleClick = React.useCallback(() => {
    inputRef.current?.click();
  }, []);

  // 粘贴处理
  const onPaste = React.useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          const fileList = new DataTransfer();
          fileList.items.add(file);
          handleFiles(fileList.files);
          return;
        }
      }
    }
  }, [handleFiles]);

  // 右键菜单
  const handleContextMenu = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = React.useCallback(() => {
    setContextMenu(null);
  }, []);

  // 复制节点（直接在画板上创建副本）
  const handleCopy = React.useCallback(() => {
    window.dispatchEvent(new CustomEvent('flow:duplicateNode', { detail: { nodeId: id } }));
  }, [id]);

  // 删除节点
  const handleDelete = React.useCallback(() => {
    window.dispatchEvent(new CustomEvent('flow:deleteNode', { detail: { nodeId: id } }));
  }, [id]);

  // 下载图片
  const handleDownload = React.useCallback(() => {
    if (!fullSrc) return;
    const link = document.createElement('a');
    link.href = fullSrc;
    link.download = `image_pro_${id}_${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [fullSrc, id]);

  // 添加到库
  const handleAddToLibrary = React.useCallback(() => {
    if (!data.imageData) return;
    window.dispatchEvent(
      new CustomEvent('flow:addToLibrary', {
        detail: { imageData: data.imageData, nodeId: id, nodeType: 'imagePro' },
      })
    );
  }, [data.imageData, id]);

  // 发送到画板
  const onSend = React.useCallback(() => {
    data.onSend?.(id);
  }, [data, id]);

  // 处理图片切换
  const handleImageChange = React.useCallback(
    (imageId: string) => {
      const selectedImage = allImages.find((item) => item.id === imageId);
      if (selectedImage) {
        setCurrentImageId(imageId);
      }
    },
    [allImages]
  );

  // ESC 关闭预览
  React.useEffect(() => {
    if (!preview) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreview(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [preview]);

  // 角点拖拽调整大小
  const handleResizeStart = React.useCallback(
    (corner: string) => (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();

      setIsResizing(true);
      const startX = e.clientX;
      const startY = e.clientY;
      const startWidth = imageWidth;
      let finalWidth = startWidth;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        // 只更新虚线预览框，不更新实际图片
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;

        let widthChange = 0;
        if (corner === 'top-left') {
          widthChange = -Math.max(deltaX, deltaY * (4 / 3));
        } else if (corner === 'top-right') {
          widthChange = Math.max(deltaX, -deltaY * (4 / 3));
        } else if (corner === 'bottom-left') {
          widthChange = Math.max(-deltaX, deltaY * (4 / 3));
        } else if (corner === 'bottom-right') {
          widthChange = Math.max(deltaX, deltaY * (4 / 3));
        }

        const newWidth = Math.max(
          MIN_IMAGE_WIDTH,
          Math.min(MAX_IMAGE_WIDTH, startWidth + widthChange)
        );
        finalWidth = newWidth;
        const newHeight = newWidth * 0.75;

        // 只更新虚线预览框
        if (resizeBoxRef.current) {
          resizeBoxRef.current.style.width = `${newWidth}px`;
          resizeBoxRef.current.style.height = `${newHeight}px`;
        }
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);

        // 只在结束时更新 React 状态，让图片跳到新尺寸
        if (finalWidth !== startWidth) {
          const totalChange = finalWidth - startWidth;
          const positionOffsetX = -totalChange / 2;
          const positionOffsetY = -(totalChange * 0.75) / 2;

          window.dispatchEvent(
            new CustomEvent('flow:updateNodeData', {
              detail: {
                id,
                patch: {
                  imageWidth: finalWidth,
                  _positionOffset: { x: positionOffsetX, y: positionOffsetY },
                },
              },
            })
          );
        }
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [imageWidth, id]
  );

  return (
    <div
      ref={containerRef}
      onContextMenu={handleContextMenu}
      onPaste={onPaste}
      tabIndex={0}
      style={{
        width: imageWidth + 24,
        background: 'transparent',
        position: 'relative',
        padding: '0 12px',
        outline: 'none',
      }}
    >
      {/* 隐藏的文件输入 */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(e.target.files)}
      />

      {/* 图片区域容器 */}
      <div style={{ position: 'relative' }}>
        {/* 选中时的蓝色边框 */}
        {selected && (
          <div
            style={{
              position: 'absolute',
              top: -2,
              left: -2,
              right: -2,
              bottom: -2,
              border: '2px solid #3b82f6',
              borderRadius: 0,
              pointerEvents: 'none',
              zIndex: 10,
            }}
          />
        )}

        {/* 图片区域 - 父容器控制大小 */}
        <div
          style={{
            width: imageWidth,
            height: imageHeight,
          }}
        >
          <ImageContent
            displaySrc={displaySrc}
            isDragOver={isDragOver}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDoubleClick={handleDoubleClick}
          />
        </div>

        {/* 缩放时的虚线预览框 */}
        {isResizing && (
          <div
            ref={resizeBoxRef}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: imageWidth,
              height: imageHeight,
              border: '1.5px dashed rgba(59, 130, 246, 0.4)',
              borderRadius: 12,
              background: 'rgba(59, 130, 246, 0.02)',
              pointerEvents: 'none',
              zIndex: 100,
            }}
          />
        )}

        {/* 选中时的四个角点 */}
        {selected && (
          <>
            <div
              className="nodrag"
              style={{ ...CORNER_STYLE, top: -5, left: -5, cursor: 'nwse-resize' }}
              onMouseDown={handleResizeStart('top-left')}
            />
            <div
              className="nodrag"
              style={{ ...CORNER_STYLE, top: -5, right: -5, cursor: 'nesw-resize' }}
              onMouseDown={handleResizeStart('top-right')}
            />
            <div
              className="nodrag"
              style={{ ...CORNER_STYLE, bottom: -5, left: -5, cursor: 'nesw-resize' }}
              onMouseDown={handleResizeStart('bottom-left')}
            />
            <div
              className="nodrag"
              style={{ ...CORNER_STYLE, bottom: -5, right: -5, cursor: 'nwse-resize' }}
              onMouseDown={handleResizeStart('bottom-right')}
            />
          </>
        )}

        {/* Handle - 左侧输入 */}
        <Handle
          type="target"
          position={Position.Left}
          id="img"
          style={{
            top: '50%',
            left: -12,
            width: 8,
            height: 8,
            background: '#6b7280',
            border: '2px solid #fff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }}
          onMouseEnter={() => setHover('img-in')}
          onMouseLeave={() => setHover(null)}
        />

        {/* Handle - 右侧输出 */}
        <Handle
          type="source"
          position={Position.Right}
          id="img"
          style={{
            top: '50%',
            right: -12,
            width: 8,
            height: 8,
            background: '#6b7280',
            border: '2px solid #fff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }}
          onMouseEnter={() => setHover('img-out')}
          onMouseLeave={() => setHover(null)}
        />

        {/* Handle 提示 */}
        {hover === 'img-in' && (
          <div
            className="flow-tooltip"
            style={{
              position: 'absolute',
              left: -16,
              top: '50%',
              transform: 'translate(-100%, -50%)',
              zIndex: 10,
            }}
          >
            image
          </div>
        )}
        {hover === 'img-out' && (
          <div
            className="flow-tooltip"
            style={{
              position: 'absolute',
              right: -16,
              top: '50%',
              transform: 'translate(100%, -50%)',
              zIndex: 10,
            }}
          >
            image
          </div>
        )}
      </div>

      {/* 图片预览模态框 */}
      <ImagePreviewModal
        isOpen={preview}
        imageSrc={
          allImages.length > 0 && currentImageId
            ? allImages.find((item) => item.id === currentImageId)?.src || fullSrc || ''
            : fullSrc || ''
        }
        imageTitle="全局图片预览"
        onClose={() => setPreview(false)}
        imageCollection={allImages}
        currentImageId={currentImageId}
        onImageChange={handleImageChange}
      />

      {/* 右键菜单 */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={closeContextMenu}
          items={[
            {
              label: '复制节点',
              icon: <Copy className="w-4 h-4" />,
              onClick: handleCopy,
            },
            {
              label: '删除节点',
              icon: <Trash2 className="w-4 h-4" />,
              onClick: handleDelete,
            },
            {
              label: '添加到库',
              icon: <FolderPlus className="w-4 h-4" />,
              onClick: handleAddToLibrary,
              disabled: !data.imageData,
            },
            {
              label: '下载图片',
              icon: <Download className="w-4 h-4" />,
              onClick: handleDownload,
              disabled: !data.imageData,
            },
            {
              label: '发送到画板',
              icon: <SendIcon className="w-4 h-4" />,
              onClick: onSend,
              disabled: !data.imageData,
            },
          ]}
        />
      )}
    </div>
  );
}

export default React.memo(ImageProNodeInner);
