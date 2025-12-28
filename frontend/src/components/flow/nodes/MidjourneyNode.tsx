import React from 'react';
import { Handle, Position } from 'reactflow';
import { Send as SendIcon, Sparkles } from 'lucide-react';
import ImagePreviewModal, { type ImageItem } from '../../ui/ImagePreviewModal';
import { useImageHistoryStore } from '../../../stores/imageHistoryStore';
import GenerationProgressBar from './GenerationProgressBar';
import { useProjectContentStore } from '@/stores/projectContentStore';

type MidjourneyMode = 'FAST' | 'RELAX';

type MidjourneyButtonInfo = {
  customId: string;
  emoji?: string;
  label?: string;
  type?: number;
  style?: number;
};

type Props = {
  id: string;
  data: {
    status?: 'idle' | 'running' | 'succeeded' | 'failed';
    imageData?: string;
    thumbnail?: string;
    error?: string;
    aspectRatio?: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';
    mode?: MidjourneyMode;
    presetPrompt?: string;
    onRun?: (id: string) => void;
    onSend?: (id: string) => void;
    // Midjourney 特有的元数据
    taskId?: string;
    buttons?: MidjourneyButtonInfo[];
    imageUrl?: string;
    promptEn?: string;
    lastHistoryId?: string;
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

function MidjourneyNodeInner({ id, data, selected }: Props) {
  const { status, error } = data;
  const fullSrc = buildImageSrc(data.imageData);
  const displaySrc = buildImageSrc(data.thumbnail) || fullSrc;
  const [hover, setHover] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);
  const [currentImageId, setCurrentImageId] = React.useState<string>('');
  const [actionLoading, setActionLoading] = React.useState<string | null>(null);

  const borderColor = selected ? '#8b5cf6' : '#e5e7eb';
  const boxShadow = selected
    ? '0 0 0 2px rgba(139,92,246,0.12)'
    : '0 1px 2px rgba(0,0,0,0.04)';

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
          } as ImageItem)
      ),
    [projectHistory]
  );

  const stopNodeDrag = React.useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
    const nativeEvent = (event as React.SyntheticEvent<any, Event>).nativeEvent as Event & {
      stopImmediatePropagation?: () => void;
    };
    nativeEvent.stopImmediatePropagation?.();
  }, []);

  // 宽高比选择
  const aspectRatioValue = data.aspectRatio ?? '';
  const aspectOptions = React.useMemo(
    () => [
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
    ],
    []
  );

  const updateAspectRatio = React.useCallback(
    (ratio: string) => {
      window.dispatchEvent(
        new CustomEvent('flow:updateNodeData', {
          detail: { id, patch: { aspectRatio: ratio || undefined } },
        })
      );
    },
    [id]
  );

  // 预设提示词
  const presetPromptValue = data.presetPrompt ?? '';
  const updatePresetPrompt = React.useCallback(
    (value: string) => {
      window.dispatchEvent(
        new CustomEvent('flow:updateNodeData', {
          detail: { id, patch: { presetPrompt: value } },
        })
      );
    },
    [id]
  );

  const onRun = React.useCallback(() => {
    data.onRun?.(id);
  }, [data, id]);

  const onSend = React.useCallback(() => {
    data.onSend?.(id);
  }, [data, id]);

  // 处理 Midjourney 按钮操作（U1-U4, V1-V4 等）
  const handleButtonAction = React.useCallback(
    async (button: MidjourneyButtonInfo) => {
      if (!data.taskId || actionLoading) return;

      setActionLoading(button.customId);

      try {
        window.dispatchEvent(
          new CustomEvent('flow:midjourneyAction', {
            detail: {
              nodeId: id,
              taskId: data.taskId,
              customId: button.customId,
              label: button.label,
            },
          })
        );
      } catch (err) {
        console.error('Midjourney action failed:', err);
      } finally {
        setActionLoading(null);
      }
    },
    [id, data.taskId, actionLoading]
  );

  // 当节点数据更新时同步最新历史图片 id（历史写入在 FlowOverlay 中统一处理，避免 onlyRenderVisibleElements 时丢失）
  React.useEffect(() => {
    if (status === 'succeeded' && data.lastHistoryId) {
      setCurrentImageId(data.lastHistoryId);
    }
  }, [data.lastHistoryId, status]);

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

  // Upscale 按钮标签映射（Midjourney V6 的 Subtle/Creative 模式）
  const getUpscaleDisplayLabel = (label?: string): string => {
    if (!label) return '';
    const lower = label.toLowerCase();
    // upscale (subtle) 或 upscale_1 (不是 U1) -> Subtle
    if (lower.includes('subtle') || lower === 'upscale_1') return 'Subtle';
    // upscale (creative) 或 upscale_2 (不是 U2) -> Creative
    if (lower.includes('creative') || lower === 'upscale_2') return 'Creative';
    // U1, U2, U3, U4 等保持原样
    return label;
  };

  // 渲染 Midjourney 操作按钮
  const renderActionButtons = () => {
    if (!data.buttons || data.buttons.length === 0) return null;

    // 分组按钮：Upscale (Subtle/Creative), V1-V4, 其他
    const upscaleButtons = data.buttons.filter((b) => {
      const label = b.label?.toLowerCase() || '';
      return label.startsWith('u') || label.includes('upscale');
    });
    const variationButtons = data.buttons.filter((b) => b.label?.startsWith('V'));
    const otherButtons = data.buttons.filter((b) => {
      const label = b.label?.toLowerCase() || '';
      const emoji = b.emoji || '';
      // 只保留刷新按钮（🔄 emoji 或 reroll/redo 标签）
      if (emoji === '🔄' || label.includes('reroll') || label.includes('redo') || label.includes('refresh')) {
        return true;
      }
      return false;
    });

    const buttonStyle: React.CSSProperties = {
      fontSize: 11,
      height: 26,
      borderRadius: 6,
      border: '1px solid #e5e7eb',
      background: '#fff',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#4b5563',
      fontWeight: 500,
    };

    const handleMouseEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
      e.currentTarget.style.borderColor = '#8b5cf6';
      e.currentTarget.style.color = '#7c3aed';
      e.currentTarget.style.background = '#f5f3ff';
      e.currentTarget.style.transform = 'translateY(-1px)';
      e.currentTarget.style.boxShadow = '0 2px 4px rgba(139, 92, 246, 0.1)';
    };

    const handleMouseLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
      e.currentTarget.style.borderColor = '#e5e7eb';
      e.currentTarget.style.color = '#4b5563';
      e.currentTarget.style.background = '#fff';
      e.currentTarget.style.transform = 'none';
      e.currentTarget.style.boxShadow = 'none';
    };

    return (
      <div
        className="nodrag"
        style={{
          marginTop: 10,
          padding: '10px 12px',
          background: '#faf5ff',
          borderRadius: 8,
          border: '1px solid #e9d5ff',
        }}
      >
        <div style={{ fontSize: 11, color: '#7c3aed', marginBottom: 8, fontWeight: 600 }}>
          Midjourney 操作
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {upscaleButtons.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '20px 1fr', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>U</span>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(upscaleButtons.length, 4)}, 1fr)`, gap: 6 }}>
                {upscaleButtons.map((btn) => (
                  <button
                    key={btn.customId}
                    onClick={() => handleButtonAction(btn)}
                    disabled={!!actionLoading}
                    style={{
                      ...buttonStyle,
                      opacity: actionLoading === btn.customId ? 0.6 : 1,
                    }}
                    onMouseEnter={!actionLoading ? handleMouseEnter : undefined}
                    onMouseLeave={!actionLoading ? handleMouseLeave : undefined}
                    title={btn.label}
                  >
                    {btn.emoji || getUpscaleDisplayLabel(btn.label)}
                  </button>
                ))}
              </div>
            </div>
          )}
          
          {variationButtons.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '20px 1fr', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>V</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                {variationButtons.map((btn) => (
                  <button
                    key={btn.customId}
                    onClick={() => handleButtonAction(btn)}
                    disabled={!!actionLoading}
                    style={{
                      ...buttonStyle,
                      opacity: actionLoading === btn.customId ? 0.6 : 1,
                    }}
                    onMouseEnter={!actionLoading ? handleMouseEnter : undefined}
                    onMouseLeave={!actionLoading ? handleMouseLeave : undefined}
                    title={btn.label}
                  >
                    {btn.emoji || btn.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {otherButtons.length > 0 && (
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              marginTop: 2,
              paddingTop: 8,
              borderTop: '1px dashed #ddd6fe',
              justifyContent: 'center'
            }}>
              {otherButtons.map((btn) => (
                <button
                  key={btn.customId}
                  onClick={() => handleButtonAction(btn)}
                  disabled={!!actionLoading}
                  style={{
                    ...buttonStyle,
                    width: 'auto',
                    minWidth: 32,
                    padding: '0 10px',
                    opacity: actionLoading === btn.customId ? 0.6 : 1,
                  }}
                  onMouseEnter={!actionLoading ? handleMouseEnter : undefined}
                  onMouseLeave={!actionLoading ? handleMouseLeave : undefined}
                  title={btn.label}
                >
                  {btn.emoji || btn.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      style={{
        width: 280,
        padding: 10,
        background: '#fff',
        border: `1px solid ${borderColor}`,
        borderRadius: 10,
        boxShadow,
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        position: 'relative',
      }}
    >
      {/* 标题栏 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Sparkles size={16} color="#8b5cf6" />
          <span style={{ fontWeight: 600, color: '#7c3aed' }}>Midjourney</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={onRun}
            disabled={status === 'running'}
            style={{
              fontSize: 12,
              padding: '4px 10px',
              background: status === 'running' ? '#e5e7eb' : '#8b5cf6',
              color: '#fff',
              borderRadius: 6,
              border: 'none',
              cursor: status === 'running' ? 'not-allowed' : 'pointer',
            }}
          >
            {status === 'running' ? 'Running...' : 'Run'}
          </button>
          <button
            onClick={onSend}
            disabled={!data.imageData}
            title={!data.imageData ? '无可发送的图像' : '发送到画布'}
            style={{
              fontSize: 12,
              padding: '4px 8px',
              background: !data.imageData ? '#e5e7eb' : '#8b5cf6',
              color: '#fff',
              borderRadius: 6,
              border: 'none',
              cursor: !data.imageData ? 'not-allowed' : 'pointer',
            }}
          >
            <SendIcon size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* 预设提示词 */}
      <div style={{ marginBottom: 8 }}>
        <label
          style={{
            display: 'block',
            fontSize: 11,
            color: '#6b7280',
            marginBottom: 2,
          }}
        >
          预设提示词
        </label>
        <input
          value={presetPromptValue}
          onChange={(event) => updatePresetPrompt(event.target.value)}
          placeholder="生成时自动拼接在提示词前"
          style={{
            width: '100%',
            fontSize: 12,
            padding: '4px 6px',
            borderRadius: 6,
            border: '1px solid #e5e7eb',
            outline: 'none',
            background: '#fff',
          }}
          onPointerDownCapture={stopNodeDrag}
          onPointerDown={stopNodeDrag}
          onMouseDownCapture={stopNodeDrag}
          onMouseDown={stopNodeDrag}
        />
      </div>

      {/* 尺寸选择 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <label
          className="nodrag nopan"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 11,
            color: '#6b7280',
          }}
        >
          尺寸
          <select
            value={aspectRatioValue}
            onChange={(e) => updateAspectRatio(e.target.value)}
            onPointerDown={stopNodeDrag}
            onPointerDownCapture={stopNodeDrag}
            onMouseDown={stopNodeDrag}
            onMouseDownCapture={stopNodeDrag}
            onClick={stopNodeDrag}
            onClickCapture={stopNodeDrag}
            className="nodrag nopan"
            style={{
              fontSize: 11,
              padding: '2px 4px',
              borderRadius: 6,
              border: '1px solid #e5e7eb',
              background: '#fff',
              color: '#111827',
            }}
          >
            {aspectOptions.map((opt) => (
              <option key={opt.value || 'auto'} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* 图片预览区域 */}
      <div
        onDoubleClick={() => fullSrc && setPreview(true)}
        style={{
          width: '100%',
          height: 180,
          background: '#faf5ff',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          border: '1px solid #e9d5ff',
        }}
        title={displaySrc ? '双击预览' : undefined}
      >
        {displaySrc ? (
          <img
            src={displaySrc}
            alt=""
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              background: '#fff',
            }}
          />
        ) : (
          <div style={{ textAlign: 'center' }}>
            <Sparkles size={24} color="#c4b5fd" />
            <div style={{ fontSize: 12, color: '#a78bfa', marginTop: 4 }}>等待生成</div>
          </div>
        )}
      </div>

      <GenerationProgressBar status={status} />

      {/* 错误信息 */}
      {status === 'failed' && error && (
        <div
          style={{
            fontSize: 11,
            color: '#ef4444',
            marginTop: 4,
            whiteSpace: 'pre-wrap',
          }}
        >
          {error}
        </div>
      )}

      {/* Midjourney 操作按钮 */}
      {renderActionButtons()}

      {/* 连接点 */}
      <Handle
        type="target"
        position={Position.Left}
        id="img"
        style={{ top: '35%' }}
        onMouseEnter={() => setHover('img-in')}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="text"
        style={{ top: '65%' }}
        onMouseEnter={() => setHover('prompt-in')}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="img"
        style={{ top: '50%' }}
        onMouseEnter={() => setHover('img-out')}
        onMouseLeave={() => setHover(null)}
      />

      {/* 连接点提示 */}
      {hover === 'img-in' && (
        <div
          className="flow-tooltip"
          style={{ left: -8, top: '35%', transform: 'translate(-100%, -50%)' }}
        >
          image
        </div>
      )}
      {hover === 'prompt-in' && (
        <div
          className="flow-tooltip"
          style={{ left: -8, top: '65%', transform: 'translate(-100%, -50%)' }}
        >
          prompt
        </div>
      )}
      {hover === 'img-out' && (
        <div
          className="flow-tooltip"
          style={{ right: -8, top: '50%', transform: 'translate(100%, -50%)' }}
        >
          image
        </div>
      )}

      {/* 图片预览模态框 */}
      <ImagePreviewModal
        isOpen={preview}
        imageSrc={
          allImages.length > 0 && currentImageId
            ? allImages.find((item) => item.id === currentImageId)?.src || fullSrc || ''
            : fullSrc || ''
        }
        imageTitle="Midjourney 图片预览"
        onClose={() => setPreview(false)}
        imageCollection={allImages}
        currentImageId={currentImageId}
        onImageChange={handleImageChange}
      />
    </div>
  );
}

export default React.memo(MidjourneyNodeInner);
