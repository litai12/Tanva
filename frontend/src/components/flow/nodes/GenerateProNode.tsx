import React from 'react';
import { Handle, Position } from 'reactflow';
import { Send as SendIcon, Play, RectangleHorizontal } from 'lucide-react';
import { createPortal } from 'react-dom';
import ImagePreviewModal, { type ImageItem } from '../../ui/ImagePreviewModal';
import { useImageHistoryStore } from '../../../stores/imageHistoryStore';
import { recordImageHistoryEntry } from '@/services/imageHistoryService';
import GenerationProgressBar from './GenerationProgressBar';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { cn } from '@/lib/utils';

type Props = {
  id: string;
  data: {
    status?: 'idle' | 'running' | 'succeeded' | 'failed';
    imageData?: string;
    error?: string;
    aspectRatio?: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';
    presetPrompt?: string;
    onRun?: (id: string) => void;
    onSend?: (id: string) => void;
  };
  selected?: boolean;
};

export default function GenerateProNode({ id, data, selected }: Props) {
  const { status, error } = data;
  const src = data.imageData ? `data:image/png;base64,${data.imageData}` : undefined;
  const [hover, setHover] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);
  const [currentImageId, setCurrentImageId] = React.useState<string>('');
  const [isAspectOpen, setIsAspectOpen] = React.useState(false);
  const [aspectPos, setAspectPos] = React.useState({ top: 0, left: 0 });
  const [aspectReady, setAspectReady] = React.useState(false);
  const buttonGroupRef = React.useRef<HTMLDivElement>(null);
  const aspectPanelRef = React.useRef<HTMLDivElement>(null);

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

  const updateAspectRatio = React.useCallback((ratio: string) => {
    window.dispatchEvent(
      new CustomEvent('flow:updateNodeData', {
        detail: {
          id,
          patch: {
            aspectRatio: ratio || undefined
          }
        }
      })
    );
  }, [id]);

  const aspectRatioValue = data.aspectRatio ?? '';
  const aspectOptions: Array<{ label: string; value: string }> = React.useMemo(() => ([
    { label: '自动', value: '' },
    { label: '1:1', value: '1:1' },
    { label: '3:4', value: '3:4' },
    { label: '4:3', value: '4:3' },
    { label: '2:3', value: '2:3' },
    { label: '3:2', value: '3:2' },
    { label: '4:5', value: '4:5' },
    { label: '5:4', value: '5:4' },
    { label: '9:16', value: '9:16' },
    { label: '16:9', value: '16:9' },
    { label: '21:9', value: '21:9' },
  ]), []);

  const stopNodeDrag = React.useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
    const nativeEvent = (event as React.SyntheticEvent<any, Event>).nativeEvent as Event & { stopImmediatePropagation?: () => void };
    nativeEvent.stopImmediatePropagation?.();
  }, []);

  const presetPromptValue = data.presetPrompt ?? '';
  const updatePresetPrompt = React.useCallback((value: string) => {
    window.dispatchEvent(
      new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { presetPrompt: value } }
      })
    );
  }, [id]);

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

  // 尺寸菜单定位 - 在按钮组下方
  React.useLayoutEffect(() => {
    if (isAspectOpen && buttonGroupRef.current) {
      const rect = buttonGroupRef.current.getBoundingClientRect();
      setAspectPos({
        top: rect.bottom + 8,
        left: rect.left + rect.width / 2 - 150,
      });
      setAspectReady(true);
    } else {
      setAspectReady(false);
    }
  }, [isAspectOpen]);

  // 点击外部关闭菜单
  React.useEffect(() => {
    if (!isAspectOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        aspectPanelRef.current && !aspectPanelRef.current.contains(e.target as Node) &&
        buttonGroupRef.current && !buttonGroupRef.current.contains(e.target as Node)
      ) {
        setIsAspectOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isAspectOpen]);

  // 计算图片显示的宽高比
  const getImageContainerStyle = React.useMemo(() => {
    if (!aspectRatioValue) {
      return { width: '100%', paddingBottom: '75%' }; // 默认 4:3
    }
    const [w, h] = aspectRatioValue.split(':').map(Number);
    const ratio = (h / w) * 100;
    return { width: '100%', paddingBottom: `${ratio}%` };
  }, [aspectRatioValue]);

  return (
    <div style={{
      width: 320,
      background: 'transparent',
      position: 'relative',
      padding: '0 12px', // 给 Handle 留出空间
    }}>
      {/* 图片区域容器 - 包含 Handle */}
      <div style={{ position: 'relative' }}>
        {/* 图片区域 - 干净无边框 */}
        <div
          onDoubleClick={() => src && setPreview(true)}
          style={{
            position: 'relative',
            ...getImageContainerStyle,
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

        {/* 图片区域的 Handle - 放在容器外部，更清晰可见 */}
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

      {/* 提示词输入框容器 - 包含 Handle */}
      <div style={{ marginTop: 12, position: 'relative' }}>
        <div
          className="nodrag nopan"
          style={{
            background: '#fff',
            borderRadius: 16,
            border: '1px solid #e5e7eb',
            padding: '12px 16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <textarea
            value={presetPromptValue}
            onChange={(event) => updatePresetPrompt(event.target.value)}
            placeholder="输入提示词..."
            rows={3}
            style={{
              width: '100%',
              fontSize: 14,
              lineHeight: 1.5,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              resize: 'none',
              color: '#374151',
            }}
            onPointerDownCapture={stopNodeDrag}
            onPointerDown={stopNodeDrag}
            onMouseDownCapture={stopNodeDrag}
            onMouseDown={stopNodeDrag}
          />
        </div>

        {/* 提示词区域的 Handle - 放在容器外部 */}
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
      </div>

      {/* 按钮组 - 与图片按钮栏样式一致 */}
      <div
        ref={buttonGroupRef}
        className="flex items-center justify-center gap-2 px-2 py-2 rounded-[999px] bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border border-liquid-glass"
        style={{
          marginTop: 12,
        }}
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

        {/* 尺寸按钮 - 图标按钮 */}
        <button
          onClick={() => setIsAspectOpen(v => !v)}
          onPointerDownCapture={stopNodeDrag}
          className={cn(
            "p-0 h-8 w-8 rounded-full border transition-all duration-200 flex items-center justify-center",
            isAspectOpen || aspectRatioValue
              ? "bg-blue-50 border-blue-300 text-blue-700"
              : "bg-white/50 border-gray-300 text-gray-700 hover:bg-blue-50 hover:border-blue-300"
          )}
          title={aspectRatioValue ? `尺寸: ${aspectRatioValue}` : '选择尺寸'}
        >
          <RectangleHorizontal style={{ width: 14, height: 14 }} />
        </button>
      </div>

      {/* 尺寸菜单弹出层 - 在按钮组下方 */}
      {isAspectOpen && typeof document !== 'undefined' && (
        createPortal(
          <div
            ref={aspectPanelRef}
            className="rounded-xl bg-white/95 backdrop-blur-md shadow-2xl border border-slate-200"
            style={{
              position: 'fixed',
              top: aspectPos.top,
              left: aspectPos.left,
              zIndex: 9999,
              visibility: aspectReady ? 'visible' : 'hidden'
            }}
          >
            <div className="flex items-center gap-1 p-2 flex-wrap" style={{ maxWidth: 300 }}>
              {aspectOptions.map((opt) => (
                <button
                  key={opt.value || 'auto'}
                  className={cn(
                    'px-2 py-1 text-xs rounded-md',
                    (aspectRatioValue === opt.value)
                      ? 'bg-blue-50 text-blue-700 border border-blue-200'
                      : 'hover:bg-gray-100 text-gray-700 border border-transparent'
                  )}
                  onClick={() => {
                    updateAspectRatio(opt.value);
                    setIsAspectOpen(false);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>,
          document.body
        )
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
