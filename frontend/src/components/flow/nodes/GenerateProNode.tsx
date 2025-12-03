import React from 'react';
import { Handle, Position } from 'reactflow';
import { Send as SendIcon, Play, Plus, X } from 'lucide-react';
import ImagePreviewModal, { type ImageItem } from '../../ui/ImagePreviewModal';
import { useImageHistoryStore } from '../../../stores/imageHistoryStore';
import { recordImageHistoryEntry } from '@/services/imageHistoryService';
import GenerationProgressBar from './GenerationProgressBar';
import { useProjectContentStore } from '@/stores/projectContentStore';

type Props = {
  id: string;
  data: {
    status?: 'idle' | 'running' | 'succeeded' | 'failed';
    imageData?: string;
    error?: string;
    aspectRatio?: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';
    prompts?: string[]; // 多个提示词
    imageWidth?: number; // 图片宽度
    onRun?: (id: string) => void;
    onSend?: (id: string) => void;
  };
  selected?: boolean;
};

const MIN_IMAGE_WIDTH = 150;
const MAX_IMAGE_WIDTH = 600;
const DEFAULT_IMAGE_WIDTH = 296;

export default function GenerateProNode({ id, data, selected }: Props) {
  const { status, error } = data;
  const src = data.imageData ? `data:image/png;base64,${data.imageData}` : undefined;
  const [hover, setHover] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);
  const [currentImageId, setCurrentImageId] = React.useState<string>('');
  const [isResizing, setIsResizing] = React.useState(false);
  const [resizeCorner, setResizeCorner] = React.useState<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // 图片宽度
  const imageWidth = data.imageWidth || DEFAULT_IMAGE_WIDTH;

  // 提示词数组，至少有一个
  const prompts = React.useMemo(() => {
    const p = data.prompts || [''];
    return p.length > 0 ? p : [''];
  }, [data.prompts]);

  // 使用全局图片历史记录
  const projectId = useProjectContentStore((state) => state.projectId);
  const history = useImageHistoryStore((state) => state.history);
  const projectHistory = React.useMemo(() => {
    if (!projectId) return history;
    return history.filter((item) => {
      const pid = item.projectId ?? null;
      return pid === projectId || pid === null;
    });
  }, [history, projectId]);
  const allImages = React.useMemo(
    () =>
      projectHistory.map(
        (item) =>
          ({
            id: item.id,
            src: item.src,
            title: item.title,
            timestamp: item.timestamp,
          }) as ImageItem,
      ),
    [projectHistory],
  );

  const stopNodeDrag = React.useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
    const nativeEvent = (event as React.SyntheticEvent<any, Event>).nativeEvent as Event & { stopImmediatePropagation?: () => void };
    nativeEvent.stopImmediatePropagation?.();
  }, []);

  // 更新图片宽度
  const updateImageWidth = React.useCallback((width: number) => {
    const clampedWidth = Math.max(MIN_IMAGE_WIDTH, Math.min(MAX_IMAGE_WIDTH, width));
    window.dispatchEvent(
      new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { imageWidth: clampedWidth } }
      })
    );
  }, [id]);

  // 更新单个提示词
  const updatePrompt = React.useCallback((index: number, value: string) => {
    const newPrompts = [...prompts];
    newPrompts[index] = value;
    window.dispatchEvent(
      new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { prompts: newPrompts } }
      })
    );
  }, [id, prompts]);

  // 添加新提示词
  const addPrompt = React.useCallback(() => {
    const newPrompts = [...prompts, ''];
    window.dispatchEvent(
      new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { prompts: newPrompts } }
      })
    );
  }, [id, prompts]);

  // 删除提示词
  const removePrompt = React.useCallback((index: number) => {
    if (prompts.length <= 1) return; // 至少保留一个
    const newPrompts = prompts.filter((_, i) => i !== index);
    window.dispatchEvent(
      new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { prompts: newPrompts } }
      })
    );
  }, [id, prompts]);

  const onRun = React.useCallback(() => {
    data.onRun?.(id);
  }, [data, id]);

  const onSend = React.useCallback(() => {
    data.onSend?.(id);
  }, [data, id]);

  // 当图片数据更新时，添加到全局历史记录
  React.useEffect(() => {
    if (data.imageData && status === 'succeeded') {
      const newImageId = `${id}-${Date.now()}`;
      setCurrentImageId(newImageId);
      void recordImageHistoryEntry({
        id: newImageId,
        base64: data.imageData,
        title: `GeneratePro节点 ${new Date().toLocaleTimeString()}`,
        nodeId: id,
        nodeType: 'generatePro',
        fileName: `flow_generatepro_${newImageId}.png`,
        projectId,
      });
    }
  }, [data.imageData, status, id, projectId]);

  // 处理图片切换
  const handleImageChange = React.useCallback((imageId: string) => {
    const selectedImage = allImages.find(item => item.id === imageId);
    if (selectedImage) {
      setCurrentImageId(imageId);
    }
  }, [allImages]);

  React.useEffect(() => {
    if (!preview) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreview(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [preview]);

  // 处理角点拖拽调整大小
  const handleResizeStart = React.useCallback((corner: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsResizing(true);
    setResizeCorner(corner);

    const startX = e.clientX;
    const startWidth = imageWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      // 根据角点位置决定方向
      const multiplier = corner.includes('right') ? 1 : -1;
      const newWidth = startWidth + deltaX * multiplier;
      updateImageWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      setResizeCorner(null);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [imageWidth, updateImageWidth]);

  // 计算图片高度（保持4:3比例）
  const imageHeight = imageWidth * 0.75;

  // 角点样式
  const cornerStyle: React.CSSProperties = {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: '#3b82f6',
    cursor: 'nwse-resize',
    zIndex: 20,
  };

  return (
    <div
      ref={containerRef}
      style={{
        width: imageWidth + 24, // 加上左右 padding
        background: 'transparent',
        position: 'relative',
        padding: '0 12px',
      }}
    >
      {/* 图片区域容器 */}
      <div style={{ position: 'relative' }}>
        {/* 选中时的蓝色边框 - 标准矩形无圆角 */}
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

        {/* 图片区域 */}
        <div
          onDoubleClick={() => src && setPreview(true)}
          style={{
            position: 'relative',
            width: imageWidth,
            height: imageHeight,
            background: src ? 'transparent' : '#f8f9fa',
            borderRadius: 12,
            overflow: 'hidden',
            cursor: src ? 'pointer' : 'default',
          }}
          title={src ? '双击预览' : undefined}
        >
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {src ? (
              <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            ) : (
              <span style={{ fontSize: 12, color: '#9ca3af' }}>等待生成</span>
            )}
          </div>
        </div>

        {/* 选中时的四个角点 */}
        {selected && (
          <>
            <div
              className="nodrag"
              style={{ ...cornerStyle, top: -5, left: -5, cursor: 'nwse-resize' }}
              onMouseDown={handleResizeStart('top-left')}
            />
            <div
              className="nodrag"
              style={{ ...cornerStyle, top: -5, right: -5, cursor: 'nesw-resize' }}
              onMouseDown={handleResizeStart('top-right')}
            />
            <div
              className="nodrag"
              style={{ ...cornerStyle, bottom: -5, left: -5, cursor: 'nesw-resize' }}
              onMouseDown={handleResizeStart('bottom-left')}
            />
            <div
              className="nodrag"
              style={{ ...cornerStyle, bottom: -5, right: -5, cursor: 'nwse-resize' }}
              onMouseDown={handleResizeStart('bottom-right')}
            />
          </>
        )}

        {/* 图片区域的 Handle */}
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

        {hover === 'img-in' && (
          <div className="flow-tooltip" style={{
            position: 'absolute',
            left: -16,
            top: '50%',
            transform: 'translate(-100%, -50%)',
            zIndex: 10,
          }}>image</div>
        )}
        {hover === 'img-out' && (
          <div className="flow-tooltip" style={{
            position: 'absolute',
            right: -16,
            top: '50%',
            transform: 'translate(100%, -50%)',
            zIndex: 10,
          }}>image</div>
        )}
      </div>

      {/* 进度条 */}
      {status === 'running' && (
        <div style={{ marginTop: 8 }}>
          <GenerationProgressBar status={status} />
        </div>
      )}

      {/* 多个提示词输入框 - 带白色背景和圆角 */}
      {prompts.map((prompt, index) => (
        <div key={index} style={{ marginTop: 12, position: 'relative' }}>
          <div
            className="nodrag nopan group"
            style={{
              background: '#fff',
              borderRadius: 16,
              border: '1px solid #e5e7eb',
              padding: '12px 16px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              position: 'relative',
            }}
          >
            <textarea
              value={prompt}
              onChange={(event) => updatePrompt(index, event.target.value)}
              placeholder={index === 0 ? "输入提示词..." : "输入额外提示词..."}
              rows={2}
              style={{
                width: '100%',
                fontSize: 14,
                lineHeight: 1.5,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                resize: 'none',
                color: '#374151',
                paddingRight: prompts.length > 1 ? 24 : 0,
              }}
              onPointerDownCapture={stopNodeDrag}
              onPointerDown={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
              onMouseDown={stopNodeDrag}
            />
            {/* 删除按钮 - 只有多个时显示，hover时才可见 */}
            {prompts.length > 1 && (
              <button
                onClick={() => removePrompt(index)}
                onPointerDownCapture={stopNodeDrag}
                className="absolute top-2 right-2 w-5 h-5 rounded-full bg-gray-100 hover:bg-red-100 text-gray-400 hover:text-red-500 flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100"
                title="删除此提示词"
              >
                <X style={{ width: 12, height: 12 }} />
              </button>
            )}
          </div>

          {/* 第一个提示词框的 Handle */}
          {index === 0 && (
            <>
              <Handle
                type="target"
                position={Position.Left}
                id="text"
                style={{
                  top: '50%',
                  left: -12,
                  width: 8,
                  height: 8,
                  background: '#6b7280',
                  border: '2px solid #fff',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }}
                onMouseEnter={() => setHover('prompt-in')}
                onMouseLeave={() => setHover(null)}
              />
              <Handle
                type="source"
                position={Position.Right}
                id="text"
                style={{
                  top: '50%',
                  right: -12,
                  width: 8,
                  height: 8,
                  background: '#6b7280',
                  border: '2px solid #fff',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }}
                onMouseEnter={() => setHover('prompt-out')}
                onMouseLeave={() => setHover(null)}
              />

              {hover === 'prompt-in' && (
                <div className="flow-tooltip" style={{
                  position: 'absolute',
                  left: -16,
                  top: '50%',
                  transform: 'translate(-100%, -50%)',
                  zIndex: 10,
                }}>prompt</div>
              )}
              {hover === 'prompt-out' && (
                <div className="flow-tooltip" style={{
                  position: 'absolute',
                  right: -16,
                  top: '50%',
                  transform: 'translate(100%, -50%)',
                  zIndex: 10,
                }}>prompt</div>
              )}
            </>
          )}
        </div>
      ))}

      {/* 选中时才显示：添加提示词按钮和按钮组 */}
      {selected && (
        <>
          {/* 添加提示词按钮 */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              marginTop: 4,
              marginBottom: 4,
            }}
          >
            <button
              onClick={addPrompt}
              onPointerDownCapture={stopNodeDrag}
              className="text-gray-400 hover:text-gray-600 flex items-center justify-center transition-colors cursor-pointer"
              title="添加提示词"
              style={{
                padding: 0,
                background: 'transparent',
                border: 'none',
              }}
            >
              <Plus style={{ width: 12, height: 12 }} />
            </button>
          </div>

          {/* 按钮组 */}
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
            <div
              className="inline-flex items-center gap-2 px-2 py-2 rounded-[999px] bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border border-liquid-glass"
            >
              {/* Run 按钮 */}
              <button
                onClick={onRun}
                disabled={status === 'running'}
                onPointerDownCapture={stopNodeDrag}
                className="p-0 h-8 w-8 rounded-full bg-white/50 border border-gray-300 text-gray-700 transition-all duration-200 hover:bg-blue-50 hover:border-blue-300 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                title={status === 'running' ? '生成中...' : '运行生成'}
              >
                <Play style={{ width: 14, height: 14 }} />
              </button>

              {/* 发送按钮 */}
              <button
                onClick={onSend}
                disabled={!data.imageData}
                onPointerDownCapture={stopNodeDrag}
                className="p-0 h-8 w-8 rounded-full bg-white/50 border border-gray-300 text-gray-700 transition-all duration-200 hover:bg-blue-50 hover:border-blue-300 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                title={!data.imageData ? '无可发送的图像' : '发送到画布'}
              >
                <SendIcon style={{ width: 14, height: 14 }} />
              </button>
            </div>
          </div>
        </>
      )}

      {/* 状态和错误信息 */}
      {status === 'failed' && error && (
        <div style={{
          fontSize: 12,
          color: '#ef4444',
          marginTop: 8,
          whiteSpace: 'pre-wrap',
          padding: '8px 12px',
          background: '#fef2f2',
          borderRadius: 8,
        }}>
          {error}
        </div>
      )}

      <ImagePreviewModal
        isOpen={preview}
        imageSrc={
          allImages.length > 0 && currentImageId
            ? allImages.find(item => item.id === currentImageId)?.src || src || ''
            : src || ''
        }
        imageTitle="全局图片预览"
        onClose={() => setPreview(false)}
        imageCollection={allImages}
        currentImageId={currentImageId}
        onImageChange={handleImageChange}
      />
    </div>
  );
}
