import React from 'react';
import { Handle, Position, useReactFlow } from 'reactflow';
import { Link } from 'lucide-react';
import { resolveTextFromSourceNode } from '../utils/textSource';

type Props = {
  id: string;
  data: {
    prompts?: string[];
    text?: string;
    boxWidth?: number;
    boxHeight?: number;
  };
  selected?: boolean;
};

const MIN_BOX_WIDTH = 200;
const MAX_BOX_WIDTH = 600;
const DEFAULT_BOX_WIDTH = 320;
const MIN_BOX_HEIGHT = 60;
const MAX_BOX_HEIGHT = 400;
const DEFAULT_BOX_HEIGHT = 80;

const stopNodeDrag = (event: React.SyntheticEvent) => {
  event.stopPropagation();
  const nativeEvent = (event as React.SyntheticEvent<unknown, Event>)
    .nativeEvent as Event & { stopImmediatePropagation?: () => void };
  nativeEvent.stopImmediatePropagation?.();
};

function TextPromptProNodeInner({ id, data, selected }: Props) {
  const rf = useReactFlow();
  const [hover, setHover] = React.useState<string | null>(null);
  const [isTextFocused, setIsTextFocused] = React.useState(false);
  const [isResizing, setIsResizing] = React.useState(false);

  const boxWidth = data.boxWidth || DEFAULT_BOX_WIDTH;
  const boxHeight = data.boxHeight || DEFAULT_BOX_HEIGHT;

  const prompts = React.useMemo(() => {
    const p = data.prompts || [''];
    return p.length > 0 ? p : [''];
  }, [data.prompts]);

  const updateNodeData = React.useCallback((patch: Record<string, unknown>) => {
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', { detail: { id, patch } }));
  }, [id]);

  const updatePrompt = React.useCallback((index: number, value: string) => {
    const next = [...prompts];
    next[index] = value;
    updateNodeData({ prompts: next, text: next.join('\n\n').trim() });
  }, [prompts, updateNodeData]);

  const [externalPrompts, setExternalPrompts] = React.useState<string[]>([]);
  const [externalSourceIds, setExternalSourceIds] = React.useState<string[]>([]);

  const refreshExternalPrompts = React.useCallback(() => {
    const currentEdges = rf.getEdges();
    const textEdges = currentEdges.filter((e) => e.target === id && e.targetHandle === 'text');

    if (textEdges.length === 0) {
      setExternalPrompts([]);
      setExternalSourceIds([]);
      return;
    }

    const sourceIds: string[] = [];
    const texts: string[] = [];

    for (const edge of textEdges) {
      sourceIds.push(edge.source);
      const sourceNode = rf.getNode(edge.source);
      if (sourceNode) {
        const resolved = resolveTextFromSourceNode(sourceNode, edge.sourceHandle);
        if (resolved && resolved.trim().length) {
          texts.push(resolved.trim());
        }
      }
    }

    setExternalSourceIds(sourceIds);
    setExternalPrompts(texts);
  }, [id, rf]);

  React.useEffect(() => {
    refreshExternalPrompts();
  }, [refreshExternalPrompts]);

  React.useEffect(() => {
    const handleEdgesChange = () => refreshExternalPrompts();
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

  // 同步 text 字段
  React.useEffect(() => {
    const allTexts = [...externalPrompts, ...prompts]
      .map((p) => (typeof p === 'string' ? p.trim() : ''))
      .filter((p) => p.length > 0);
    const combinedText = allTexts.join('\n\n');
    if (data.text !== combinedText) {
      updateNodeData({ text: combinedText });
    }
  }, [externalPrompts, prompts, data.text, updateNodeData]);

  // 处理拖拽调整大小
  const handleResizeStart = React.useCallback((direction: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsResizing(true);

    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = boxWidth;
    const startHeight = boxHeight;
    let lastWidth = startWidth;
    let lastHeight = startHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;

      let newWidth = startWidth;
      let newHeight = startHeight;
      let positionOffsetX = 0;
      let positionOffsetY = 0;

      if (direction === 'left') {
        newWidth = Math.max(MIN_BOX_WIDTH, Math.min(MAX_BOX_WIDTH, startWidth - deltaX));
        positionOffsetX = -(newWidth - lastWidth);
      } else if (direction === 'right') {
        newWidth = Math.max(MIN_BOX_WIDTH, Math.min(MAX_BOX_WIDTH, startWidth + deltaX));
      } else if (direction === 'top') {
        newHeight = Math.max(MIN_BOX_HEIGHT, Math.min(MAX_BOX_HEIGHT, startHeight - deltaY));
        positionOffsetY = -(newHeight - lastHeight);
      } else if (direction === 'bottom') {
        newHeight = Math.max(MIN_BOX_HEIGHT, Math.min(MAX_BOX_HEIGHT, startHeight + deltaY));
      }

      const widthChanged = newWidth !== lastWidth;
      const heightChanged = newHeight !== lastHeight;

      if (!widthChanged && !heightChanged) return;

      lastWidth = newWidth;
      lastHeight = newHeight;

      window.dispatchEvent(
        new CustomEvent('flow:updateNodeData', {
          detail: {
            id,
            patch: {
              boxWidth: newWidth,
              boxHeight: newHeight,
              _positionOffset: { x: positionOffsetX, y: positionOffsetY }
            }
          }
        })
      );
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [boxWidth, boxHeight, id]);

  // 角点样式
  const cornerStyle: React.CSSProperties = {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: '#3b82f6',
    zIndex: 20,
  };

  return (
    <div
      style={{
        width: boxWidth + 24,
        background: 'transparent',
        position: 'relative',
        padding: '0 12px',
      }}
    >
      {/* 提示词输入框 */}
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
              borderRadius: 18,
              pointerEvents: 'none',
              zIndex: 10,
            }}
          />
        )}

        {/* 选中时的调节点 */}
        {selected && (
          <>
            <div
              className="nodrag"
              style={{ ...cornerStyle, top: '50%', left: -5, transform: 'translateY(-50%)', cursor: 'ew-resize' }}
              onMouseDown={handleResizeStart('left')}
            />
            <div
              className="nodrag"
              style={{ ...cornerStyle, top: '50%', right: -5, transform: 'translateY(-50%)', cursor: 'ew-resize' }}
              onMouseDown={handleResizeStart('right')}
            />
            <div
              className="nodrag"
              style={{ ...cornerStyle, top: -5, left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' }}
              onMouseDown={handleResizeStart('top')}
            />
            <div
              className="nodrag"
              style={{ ...cornerStyle, bottom: -5, left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' }}
              onMouseDown={handleResizeStart('bottom')}
            />
          </>
        )}

        <div
          className="group"
          style={{
            background: '#fff',
            borderRadius: 16,
            border: '1px solid #e5e7eb',
            padding: '12px 16px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            position: 'relative',
            width: boxWidth,
            minHeight: boxHeight,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* 外部连接的提示词 - 与 GenerateProNode 样式一致 */}
          {externalPrompts.length > 0 && (
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

          {/* 本地输入框 */}
          <textarea
            className="nodrag nopan nowheel"
            value={prompts[0] || ''}
            onChange={(event) => updatePrompt(0, event.target.value)}
            placeholder={externalPrompts.length > 0 ? '输入额外提示词...' : '输入提示词...'}
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
        </div>

        {/* Handle - 与 GenerateProNode 样式一致 */}
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
            prompt
          </div>
        )}
        {hover === 'prompt-out' && (
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
            prompt
          </div>
        )}
      </div>
    </div>
  );
}

export default React.memo(TextPromptProNodeInner);
