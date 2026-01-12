import React from 'react';
import { Handle, Position, useReactFlow } from 'reactflow';
import { Send as SendIcon, Play, Plus, X, Link, Copy, Trash2, Download, FolderPlus } from 'lucide-react';
import ImagePreviewModal, { type ImageItem } from '../../ui/ImagePreviewModal';
import { useImageHistoryStore } from '../../../stores/imageHistoryStore';
import { recordImageHistoryEntry } from '@/services/imageHistoryService';
import GenerationProgressBar from './GenerationProgressBar';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { useAIChatStore } from '@/stores/aiChatStore';
import { cn } from '@/lib/utils';
import { resolveTextFromSourceNode } from '../utils/textSource';
import ContextMenu from '../../ui/context-menu';
import { proxifyRemoteAssetUrl } from '@/utils/assetProxy';

// 长宽比图标
const AspectRatioIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <rect x="2" y="4" width="12" height="8" stroke="currentColor" strokeWidth="1.5" fill="none" rx="1" />
  </svg>
);

type Props = {
  id: string;
  data: {
    status?: 'idle' | 'running' | 'succeeded' | 'failed';
    imageData?: string;
    imageUrl?: string;
    thumbnail?: string; // 缩略图，用于节点显示
    error?: string;
    aspectRatio?: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';
    imageSize?: '1K' | '2K' | '4K' | null;
    prompts?: string[];
    imageWidth?: number;
    promptHeight?: number;
    onRun?: (id: string) => void;
    onSend?: (id: string) => void;
  };
  selected?: boolean;
};

const buildImageSrc = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('data:image')) return trimmed;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return proxifyRemoteAssetUrl(trimmed);
  return `data:image/png;base64,${trimmed}`;
};

const MIN_IMAGE_WIDTH = 150;
const MAX_IMAGE_WIDTH = 600;
const DEFAULT_IMAGE_WIDTH = 296;
const MIN_PROMPT_HEIGHT = 60;
const MAX_PROMPT_HEIGHT = 400;
const DEFAULT_PROMPT_HEIGHT = 80;

function GenerateProNodeInner({ id, data, selected }: Props) {
  const { status, error } = data;

  // 原图用于预览和下载
  const fullSrc = React.useMemo(
    () => buildImageSrc(data.imageData || data.imageUrl),
    [data.imageData, data.imageUrl]
  );

  // 缩略图用于节点显示（优先使用缩略图，没有则用原图）
  const displaySrc = React.useMemo(
    () => buildImageSrc(data.thumbnail) || fullSrc,
    [data.thumbnail, fullSrc]
  );

  const [hover, setHover] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);
  const [currentImageId, setCurrentImageId] = React.useState<string>('');
  const [isResizing, setIsResizing] = React.useState(false);
  const [resizeCorner, setResizeCorner] = React.useState<string | null>(null);
  const [isTextFocused, setIsTextFocused] = React.useState(false); // 文字输入框是否聚焦
  const [isAspectMenuOpen, setIsAspectMenuOpen] = React.useState(false);
  const [isImageSizeMenuOpen, setIsImageSizeMenuOpen] = React.useState(false);
  const [contextMenu, setContextMenu] = React.useState<{ x: number; y: number } | null>(null);
  const aspectMenuRef = React.useRef<HTMLDivElement>(null);
  const imageSizeMenuRef = React.useRef<HTMLDivElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // 图片宽度
  const imageWidth = data.imageWidth || DEFAULT_IMAGE_WIDTH;
  // 提示词区域高度
  const promptHeight = data.promptHeight || DEFAULT_PROMPT_HEIGHT;

  // 提示词数组，至少有一个
  const prompts = React.useMemo(() => {
    const p = data.prompts || [''];
    return p.length > 0 ? p : [''];
  }, [data.prompts]);

  // 使用全局图片历史记录 - 只在预览时才获取
  const projectId = useProjectContentStore((state) => state.projectId);
  const aiProvider = useAIChatStore((state) => state.aiProvider);

  // 判断是否为 Pro 模式（显示尺寸和 HD 按钮）
  const isProMode = aiProvider === 'gemini-pro' || aiProvider === 'banana';

  const rf = useReactFlow();
  // 移除 useEdges() - 改用事件监听方式获取外部提示词，避免频繁重渲染
  // 支持多个外部提示词输入
  const [externalPrompts, setExternalPrompts] = React.useState<string[]>([]);
  const [externalSourceIds, setExternalSourceIds] = React.useState<string[]>([]);

  // 只在预览模式下才获取历史记录，避免不必要的重渲染
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
        }) as ImageItem,
    );
     
  }, [preview, projectId]);

  const stopNodeDrag = React.useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
    const nativeEvent = (event as React.SyntheticEvent<any, Event>).nativeEvent as Event & { stopImmediatePropagation?: () => void };
    nativeEvent.stopImmediatePropagation?.();
  }, []);

  const refreshExternalPrompts = React.useCallback(() => {
    const currentEdges = rf.getEdges();
    // 获取所有连接到 text handle 的边
    const textEdges = currentEdges.filter(e => e.target === id && e.targetHandle === 'text');

    if (textEdges.length === 0) {
      setExternalPrompts([]);
      setExternalSourceIds([]);
      return;
    }

    const sourceIds: string[] = [];
    const prompts: string[] = [];

    for (const edge of textEdges) {
      sourceIds.push(edge.source);
      const sourceNode = rf.getNode(edge.source);
      if (sourceNode) {
        const resolved = resolveTextFromSourceNode(sourceNode, edge.sourceHandle);
        if (resolved && resolved.trim().length) {
          prompts.push(resolved.trim());
        }
      }
    }

    setExternalSourceIds(sourceIds);
    setExternalPrompts(prompts);
  }, [id, rf]);

  React.useEffect(() => {
    refreshExternalPrompts();
  }, [refreshExternalPrompts]);

  // 监听边的变化（连接/断开）来刷新外部提示词
  React.useEffect(() => {
    const handleEdgesChange = () => {
      refreshExternalPrompts();
    };
    window.addEventListener('flow:edgesChange', handleEdgesChange);
    return () => window.removeEventListener('flow:edgesChange', handleEdgesChange);
  }, [refreshExternalPrompts]);

  React.useEffect(() => {
    if (externalSourceIds.length === 0) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string }>).detail;
      if (!detail?.id || !externalSourceIds.includes(detail.id)) return;
      refreshExternalPrompts();
    };
    window.addEventListener('flow:updateNodeData', handler as EventListener);
    return () => window.removeEventListener('flow:updateNodeData', handler as EventListener);
  }, [externalSourceIds, refreshExternalPrompts]);

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

  // 右键菜单处理
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

  // 下载图片（使用原图）
  const handleDownload = React.useCallback(() => {
    if (!fullSrc) return;
    const link = document.createElement('a');
    link.href = fullSrc;
    link.download = `generate_pro_${id}_${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [fullSrc, id]);

  // 添加到个人库
  const handleAddToLibrary = React.useCallback(() => {
    if (!data.imageData) return;
    window.dispatchEvent(new CustomEvent('flow:addToLibrary', {
      detail: { imageData: data.imageData, nodeId: id, nodeType: 'generatePro' }
    }));
  }, [data.imageData, id]);

  // 长宽比选项
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

  // 更新长宽比
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
  const imageSizeValue = data.imageSize ?? null;

  // 图像尺寸选项
  const imageSizeOptions: Array<{ label: string; value: '1K' | '2K' | '4K' | null }> = React.useMemo(() => ([
    { label: '自动', value: null },
    { label: '1K', value: '1K' },
    { label: '2K', value: '2K' },
    { label: '4K', value: '4K' },
  ]), []);

  // 更新图像尺寸
  const updateImageSize = React.useCallback((size: '1K' | '2K' | '4K' | null) => {
    window.dispatchEvent(
      new CustomEvent('flow:updateNodeData', {
        detail: {
          id,
          patch: {
            imageSize: size
          }
        }
      })
    );
  }, [id]);

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

  // 点击外部关闭长宽比菜单
  React.useEffect(() => {
    if (!isAspectMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (aspectMenuRef.current && !aspectMenuRef.current.contains(e.target as Node)) {
        setIsAspectMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isAspectMenuOpen]);

  // 点击外部关闭图像尺寸菜单
  React.useEffect(() => {
    if (!isImageSizeMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (imageSizeMenuRef.current && !imageSizeMenuRef.current.contains(e.target as Node)) {
        setIsImageSizeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isImageSizeMenuOpen]);

  // 处理角点拖拽调整大小 - 以中心点为基准
  const handleResizeStart = React.useCallback((corner: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsResizing(true);
    setResizeCorner(corner);

    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = imageWidth;
    let lastWidth = startWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      // 根据角点位置决定调整方向
      let widthChange = 0;

      if (corner === 'top-left') {
        // 左上角：向左上拖放大，向右下拖缩小
        widthChange = -Math.max(deltaX, deltaY * (4/3));
      } else if (corner === 'top-right') {
        // 右上角：向右上拖放大，向左下拖缩小
        widthChange = Math.max(deltaX, -deltaY * (4/3));
      } else if (corner === 'bottom-left') {
        // 左下角：向左下拖放大，向右上拖缩小
        widthChange = Math.max(-deltaX, deltaY * (4/3));
      } else if (corner === 'bottom-right') {
        // 右下角：向右下拖放大，向左上拖缩小
        widthChange = Math.max(deltaX, deltaY * (4/3));
      }

      const newWidth = Math.max(MIN_IMAGE_WIDTH, Math.min(MAX_IMAGE_WIDTH, startWidth + widthChange));

      // 计算相对于上一次的增量变化
      const incrementalChange = newWidth - lastWidth;
      lastWidth = newWidth;

      if (incrementalChange === 0) return;

      // 计算需要偏移的位置（增量变化的一半，高度按比例）- 以中心点为基准
      const positionOffsetX = -incrementalChange / 2;
      const positionOffsetY = -(incrementalChange * 0.75) / 2;

      // 同时更新宽度和位置
      window.dispatchEvent(
        new CustomEvent('flow:updateNodeData', {
          detail: {
            id,
            patch: {
              imageWidth: newWidth,
              _positionOffset: { x: positionOffsetX, y: positionOffsetY }
            }
          }
        })
      );
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      setResizeCorner(null);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [imageWidth, id]);

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

  // 处理 prompt 区域高度拖拽
  const handlePromptResizeStart = React.useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    const startY = e.clientY;
    const startHeight = promptHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const newHeight = Math.max(MIN_PROMPT_HEIGHT, Math.min(MAX_PROMPT_HEIGHT, startHeight + deltaY));

      window.dispatchEvent(
        new CustomEvent('flow:updateNodeData', {
          detail: { id, patch: { promptHeight: newHeight } }
        })
      );
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [promptHeight, id]);

  return (
    <div
      ref={containerRef}
      onContextMenu={handleContextMenu}
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
          onDoubleClick={() => fullSrc && setPreview(true)}
          style={{
            position: 'relative',
            width: imageWidth,
            height: imageHeight,
            background: displaySrc ? 'transparent' : '#f8f9fa',
            borderRadius: 12,
            overflow: 'hidden',
            cursor: displaySrc ? 'pointer' : 'default',
          }}
          title={displaySrc ? '双击预览' : undefined}
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
            {displaySrc ? (
              <img src={displaySrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
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
          onDoubleClick={(e) => {
            e.stopPropagation();
            // 触发创建新节点并连线的事件
            window.dispatchEvent(
              new CustomEvent('flow:duplicateAndConnect', {
                detail: {
                  sourceId: id,
                  sourceHandle: 'img',
                  targetHandle: 'img',
                  nodeType: 'generatePro',
                  offsetX: imageWidth + 100, // 水平偏移
                }
              })
            );
          }}
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

      {/* 进度条区域 - 与文字框上缘对齐 */}
      <div style={{ height: 14, position: 'relative' }}>
        {status === 'running' && (
          <div style={{
            position: 'absolute',
            bottom: -6,
            left: 16,
            right: 16,
            zIndex: 10,
          }}>
            <GenerationProgressBar status={status} />
          </div>
        )}
      </div>

      {/* 多个提示词输入框 - 带白色背景和圆角 */}
      {prompts.map((prompt, index) => (
        <div key={index} style={{ marginTop: index === 0 ? 0 : 8, position: 'relative' }}>
          <div
            className="group"
            style={{
              background: '#fff',
              borderRadius: 16,
              border: '1px solid #e5e7eb',
              padding: '12px 16px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              position: 'relative',
              minHeight: index === 0 ? promptHeight : undefined,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {index === 0 && externalPrompts.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                {externalPrompts.map((extPrompt, extIndex) => (
                  <div
                    key={extIndex}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 6,
                      padding: '8px 10px',
                      background: '#f0f9ff',
                      borderRadius: 8,
                      border: '1px solid #bae6fd',
                    }}
                  >
                    <Link style={{ width: 14, height: 14, color: '#0ea5e9', flexShrink: 0, marginTop: 2 }} />
                    <span
                      style={{
                        fontSize: 13,
                        color: '#0369a1',
                        lineHeight: 1.4,
                        wordBreak: 'break-word',
                        maxHeight: 60,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {extPrompt.length > 100 ? `${extPrompt.slice(0, 100)}...` : extPrompt}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <textarea
              className="nodrag nopan nowheel"
              value={prompt}
              onChange={(event) => updatePrompt(index, event.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onRun();
                }
              }}
              placeholder={index === 0
                ? (externalPrompts.length > 0 ? "输入额外提示词..." : "输入提示词...")
                : "输入额外提示词..."}
              style={{
                width: '100%',
                flex: 1,
                minHeight: 40,
                fontSize: 14,
                lineHeight: 1.5,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                resize: 'none',
                color: '#374151',
                paddingRight: prompts.length > 1 ? 24 : 0,
              }}
              onWheelCapture={(event) => {
                event.stopPropagation();
                (event.nativeEvent as Event & { stopImmediatePropagation?: () => void })?.stopImmediatePropagation?.();
              }}
              onPointerDownCapture={(event) => {
                event.stopPropagation();
                (event.nativeEvent as Event & { stopImmediatePropagation?: () => void })?.stopImmediatePropagation?.();
              }}
              onMouseDownCapture={(event) => {
                event.stopPropagation();
                (event.nativeEvent as Event & { stopImmediatePropagation?: () => void })?.stopImmediatePropagation?.();
              }}
              onFocus={() => setIsTextFocused(true)}
              onBlur={() => setIsTextFocused(false)}
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
            {/* 底部拖拽条 - 仅第一个提示词框显示 */}
            {index === 0 && (
              <div
                className="nodrag"
                onMouseDown={handlePromptResizeStart}
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 16,
                  right: 16,
                  height: 8,
                  cursor: 'ns-resize',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 3,
                    borderRadius: 2,
                    background: '#d1d5db',
                    opacity: 0.6,
                    transition: 'opacity 0.15s',
                  }}
                  className="group-hover:opacity-100"
                />
              </div>
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

      {/* 选中或文字聚焦时显示：添加提示词按钮和按钮组 */}
      {(selected || isTextFocused) && (
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
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div
              className="inline-flex items-center gap-2 px-2 py-2 rounded-[999px] bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border border-liquid-glass"
            >
              {/* 长宽比选择按钮 - 仅 Pro 模式显示 */}
              {isProMode && (
                <div className="relative" ref={aspectMenuRef}>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsAspectMenuOpen(!isAspectMenuOpen);
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onPointerDownCapture={stopNodeDrag}
                    className={cn(
                      "p-0 h-8 w-8 rounded-full bg-white/50 border border-gray-300 text-gray-700 transition-all duration-200 hover:bg-gray-800/10 hover:border-gray-800/20 flex items-center justify-center",
                      aspectRatioValue ? "bg-gray-800 text-white border-gray-800" : ""
                    )}
                    title={aspectRatioValue ? `长宽比: ${aspectRatioValue}` : '选择长宽比'}
                  >
                    <AspectRatioIcon style={{ width: 14, height: 14 }} />
                  </button>
                </div>
              )}

              {/* HD 图像尺寸选择按钮 - 仅 Pro 模式显示 */}
              {isProMode && (
                <div className="relative" ref={imageSizeMenuRef}>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsImageSizeMenuOpen(!isImageSizeMenuOpen);
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onPointerDownCapture={stopNodeDrag}
                    className={cn(
                      "p-0 h-8 w-8 rounded-full bg-white/50 border border-gray-300 text-gray-700 transition-all duration-200 hover:bg-gray-800/10 hover:border-gray-800/20 flex items-center justify-center",
                      imageSizeValue ? "bg-gray-800 text-white border-gray-800" : ""
                    )}
                    title={imageSizeValue ? `分辨率: ${imageSizeValue}` : '选择分辨率'}
                  >
                    <span className="font-medium text-[10px] leading-none">
                      {imageSizeValue || 'HD'}
                    </span>
                  </button>
                </div>
              )}

              {/* Run 按钮 */}
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onRun();
                }}
                onMouseDown={(e) => {
                  // 阻止点击时节点失去选中状态
                  e.preventDefault();
                  e.stopPropagation();
                }}
                disabled={status === 'running'}
                onPointerDownCapture={stopNodeDrag}
                className="p-0 h-8 w-8 rounded-full bg-white/50 border border-gray-300 text-gray-700 transition-all duration-200 hover:bg-gray-800/10 hover:border-gray-800/20 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                title={status === 'running' ? '生成中...' : '运行生成'}
              >
                <Play style={{ width: 14, height: 14 }} />
              </button>
            </div>

            {/* 长宽比水平选择栏 - 仅 Pro 模式显示 */}
            {isProMode && isAspectMenuOpen && (
              <div
                className="bg-white rounded-full shadow-lg border border-gray-200 px-2 py-1.5 flex items-center gap-1"
              >
                {aspectOptions.map(opt => (
                  <button
                    key={opt.value || 'auto'}
                    onClick={(e) => {
                      e.stopPropagation();
                      updateAspectRatio(opt.value);
                      setIsAspectMenuOpen(false);
                    }}
                    onPointerDownCapture={stopNodeDrag}
                    className={cn(
                      "px-2 py-1 text-xs rounded-md transition-colors whitespace-nowrap",
                      (aspectRatioValue === opt.value || (!aspectRatioValue && opt.value === ''))
                        ? "bg-gray-800 text-white font-medium"
                        : "text-gray-700 hover:bg-gray-100"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {/* HD 图像尺寸水平选择栏 - 仅 Pro 模式显示 */}
            {isProMode && isImageSizeMenuOpen && (
              <div
                className="bg-white rounded-full shadow-lg border border-gray-200 px-2 py-1.5 flex items-center gap-1"
              >
                {imageSizeOptions.map(opt => (
                  <button
                    key={opt.value || 'auto'}
                    onClick={(e) => {
                      e.stopPropagation();
                      updateImageSize(opt.value);
                      setIsImageSizeMenuOpen(false);
                    }}
                    onPointerDownCapture={stopNodeDrag}
                    className={cn(
                      "px-2 py-1 text-xs rounded-md transition-colors whitespace-nowrap",
                      imageSizeValue === opt.value
                        ? "bg-gray-800 text-white font-medium"
                        : "text-gray-700 hover:bg-gray-100"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
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
            ? allImages.find(item => item.id === currentImageId)?.src || fullSrc || ''
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

export default React.memo(GenerateProNodeInner);
