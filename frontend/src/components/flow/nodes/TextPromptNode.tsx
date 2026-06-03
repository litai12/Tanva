import React from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, NodeResizer, useReactFlow, useStore, type ReactFlowState, type Edge } from 'reactflow';
import { resolveTextFromSourceNode } from '../utils/textSource';
import useNodeInternalsSync from '../hooks/useNodeInternalsSync';
import { usePromptSiblingImages, type SiblingImage } from '../hooks/usePromptSiblingImages';
import PromptImageStrip from './PromptImageStrip';
import { useLocaleText } from '@/utils/localeText';
import { useCanvasStore } from '@/stores';

type Props = {
  id: string;
  data: { text?: string; boxW?: number; boxH?: number; title?: string };
  selected?: boolean;
};

const DEFAULT_TITLE = 'Prompt';
const MIN_NODE_WIDTH = 180;
const MIN_NODE_HEIGHT = 120;

function TextPromptNodeInner({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const rf = useReactFlow();
  const edges = useStore((state: ReactFlowState) => state.edges);
  const [value, setValue] = React.useState<string>(data.text || '');
  const [hover, setHover] = React.useState<string | null>(null);
  const [incomingTexts, setIncomingTexts] = React.useState<string[]>([]);
  const [isResizing, setIsResizing] = React.useState(false);
  const [resizePreview, setResizePreview] = React.useState<{
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const edgesRef = React.useRef<Edge[]>(edges);
  const borderColor = selected ? '#2563eb' : '#e5e7eb';
  const boxShadow = selected ? '0 0 0 2px rgba(37,99,235,0.12)' : '0 1px 2px rgba(0,0,0,0.04)';
  const normalizedTitle = typeof data.title === 'string' && data.title.trim().length
    ? data.title.trim()
    : DEFAULT_TITLE;
  const [title, setTitle] = React.useState<string>(normalizedTitle);
  const [titleDraft, setTitleDraft] = React.useState<string>(normalizedTitle);
  const [isEditingTitle, setIsEditingTitle] = React.useState(false);
  const titleInputRef = React.useRef<HTMLInputElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const siblingImages = usePromptSiblingImages(id);
  const nodeRootRef = React.useRef<HTMLDivElement | null>(null);
  const isComposingRef = React.useRef(false);
  const [atMention, setAtMention] = React.useState<{
    startIndex: number;
    query: string;
    selectedIdx: number;
  } | null>(null);
  const [dropdownPos, setDropdownPos] = React.useState<{ top: number; left: number; width: number } | null>(null);
  const incomingCount = incomingTexts.length;
  const hasIncoming = incomingCount > 0;
  const shouldPassWheelToCanvas = React.useCallback((event: React.WheelEvent<HTMLTextAreaElement>) => {
    const store = useCanvasStore.getState();
    const isModifierWheel = event.ctrlKey || event.metaKey;
    return store.wheelZoomMode === 'direct' ? !isModifierWheel : isModifierWheel;
  }, []);
  const isPromptEditable = selected === true;
  const mentionImages = React.useMemo(() => {
    if (!isPromptEditable || !atMention || siblingImages.length === 0) return [];
    const q = atMention.query.toLowerCase();
    if (!q) return siblingImages;
    return siblingImages.filter(img => String(img.index).includes(q) || `图${img.index}`.includes(q));
  }, [atMention, isPromptEditable, siblingImages]);

  const detectAtMention = React.useCallback((text: string, cursorPos: number) => {
    if (siblingImages.length === 0) return null;
    const before = text.slice(0, cursorPos);
    const atIdx = before.lastIndexOf('@');
    if (atIdx < 0) return null;
    const afterAt = before.slice(atIdx + 1);
    if (/[\s\n]/.test(afterAt)) return null;
    return { startIndex: atIdx, query: afterAt };
  }, [siblingImages.length]);

  const resizeStartRef = React.useRef<{ width: number; height: number; x: number; y: number } | null>(null);
  const resizePendingRef = React.useRef<{ width: number; height: number; offsetX: number; offsetY: number } | null>(null);
  const resizePreviewRafRef = React.useRef<number | null>(null);

  const applyIncomingText = React.useCallback((incoming: string) => {
    setValue((prev) => (prev === incoming ? prev : incoming));
    const currentDataText = typeof data.text === 'string' ? data.text : '';
    if (currentDataText !== incoming) {
      window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { text: incoming } }
      }));
    }
  }, [data.text, id]);

  const syncFromSource = React.useCallback((
    sourceId: string,
    sourceHandle?: string | null,
    optimisticPatch?: Record<string, unknown>
  ) => {
    const srcNode = rf.getNode(sourceId);
    const sourceForRead = srcNode && optimisticPatch
      ? { ...srcNode, data: { ...(srcNode.data as Record<string, unknown>), ...optimisticPatch } }
      : srcNode;
    const upstream = resolveTextFromSourceNode(sourceForRead, sourceHandle) || '';
    applyIncomingText(upstream);
  }, [rf, applyIncomingText]);

  const handleDisconnectInputs = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    event.preventDefault();
    const currentEdges = rf.getEdges();
    const remain = currentEdges.filter(edge => !(edge.target === id && edge.targetHandle === 'text'));
    if (remain.length === currentEdges.length) return;
    setIncomingTexts([]);
    rf.setEdges(remain);
  }, [rf, id]);

  const collectIncomingTexts = React.useCallback((
    edgeList: Edge[],
    optimisticSource?: { sourceId: string; patch: Record<string, unknown> } | null
  ) => {
    const incomingEdges = edgeList
      .filter((edge) => edge.target === id && edge.targetHandle === 'text');
    if (!incomingEdges.length) return [];

    const decorated = incomingEdges.map((edge, index) => {
      const handle = edge.sourceHandle ?? undefined;
      let order = 1000 + index;
      if (typeof handle === 'string') {
        const promptMatch = handle.match(/^prompt(\d+)$/);
        if (promptMatch) {
          order = Number(promptMatch[1]);
        } else {
          const numericMatch = handle.match(/(\d+)/);
          if (numericMatch) {
            order = Number(numericMatch[1]);
          }
        }
      }
      return { edge, order, index };
    });

    decorated.sort((a, b) => (a.order - b.order) || (a.index - b.index));

    return decorated
      .map(({ edge }) => {
        const node = rf.getNode(edge.source);
        const sourceForRead = node && optimisticSource?.sourceId === edge.source
          ? {
              ...node,
              data: { ...(node.data as Record<string, unknown>), ...optimisticSource.patch },
            }
          : node;
        const resolved = resolveTextFromSourceNode(sourceForRead, edge.sourceHandle);
        return typeof resolved === 'string' && resolved.trim().length ? resolved.trim() : '';
      })
      .filter((text) => text.length > 0);
  }, [id, rf]);

  React.useEffect(() => {
    // keep internal state in sync if external changes happen
    if (isComposingRef.current) return;
    if ((data.text || '') !== value) setValue(data.text || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.text]);

  React.useEffect(() => {
    setTitle(normalizedTitle);
    if (!isEditingTitle) {
      setTitleDraft(normalizedTitle);
    }
  }, [normalizedTitle, isEditingTitle]);

  React.useEffect(() => {
    if (!isEditingTitle) return;
    requestAnimationFrame(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    });
  }, [isEditingTitle]);

  React.useEffect(() => {
    if (isPromptEditable) return;
    if (textareaRef.current && document.activeElement === textareaRef.current) {
      textareaRef.current.blur();
    }
    isComposingRef.current = false;
    setAtMention(null);
  }, [isPromptEditable]);

  React.useEffect(() => {
    edgesRef.current = edges;
    const texts = collectIncomingTexts(edges);
    setIncomingTexts(texts);
    if (texts.length) {
      applyIncomingText(texts.join('\n\n'));
    }
  }, [edges, collectIncomingTexts, applyIncomingText]);

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; patch: Record<string, unknown> }>).detail;
      if (!detail?.id || detail.id === id) return;
      const isSourceLinked = edgesRef.current.some(
        (edge) => edge.target === id && edge.targetHandle === 'text' && edge.source === detail.id
      );
      if (!isSourceLinked) return;

      const patch = detail.patch || {};
      const texts = collectIncomingTexts(edgesRef.current, { sourceId: detail.id, patch });
      setIncomingTexts(texts);
      if (texts.length) {
        applyIncomingText(texts.join('\n\n'));
        return;
      }

      const incoming = edgesRef.current.find((edge) => edge.target === id && edge.targetHandle === 'text' && edge.source === detail.id);
      const textPatch = typeof patch.text === 'string' ? patch.text : undefined;
      if (typeof textPatch === 'string') return applyIncomingText(textPatch);
      const promptPatch = typeof patch.prompt === 'string' ? patch.prompt : undefined;
      if (typeof promptPatch === 'string') return applyIncomingText(promptPatch);
      if (incoming) {
        syncFromSource(detail.id, incoming.sourceHandle, patch);
      }
    };
    window.addEventListener('flow:updateNodeData', handler as EventListener);
    return () => window.removeEventListener('flow:updateNodeData', handler as EventListener);
  }, [id, applyIncomingText, syncFromSource, collectIncomingTexts]);

  const startTitleEditing = React.useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    setTitleDraft(title);
    setIsEditingTitle(true);
  }, [title]);

  const commitTitle = React.useCallback((raw: string) => {
    const trimmed = raw.trim();
    const nextTitle = trimmed.length ? trimmed : DEFAULT_TITLE;
    setTitle(nextTitle);
    setTitleDraft(nextTitle);
    setIsEditingTitle(false);
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch: { title: nextTitle } }
    }));
  }, [id]);

  const cancelTitleEditing = React.useCallback(() => {
    setIsEditingTitle(false);
    setTitleDraft(title);
  }, [title]);

  const commitValue = React.useCallback((next: string) => {
    // write through to node data via DOM event (handled in FlowOverlay)
    const ev = new CustomEvent('flow:updateNodeData', { detail: { id, patch: { text: next } } });
    window.dispatchEvent(ev);
  }, [id]);

  const handleMentionSelect = React.useCallback((img: SiblingImage) => {
    const el = textareaRef.current;
    if (!el || !atMention) return;
    const cursorPos = el.selectionStart ?? value.length;
    const before = value.slice(0, atMention.startIndex);
    const after = value.slice(cursorPos);
    const inserted = `@图${img.index}`;
    const next = before + inserted + after;
    setValue(next);
    commitValue(next);
    setAtMention(null);
    requestAnimationFrame(() => {
      el.focus();
      const newCursor = atMention.startIndex + inserted.length;
      el.setSelectionRange(newCursor, newCursor);
    });
  }, [atMention, commitValue, value]);

  const handleMentionKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!atMention || mentionImages.length === 0) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setAtMention(null);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setAtMention(prev => prev ? { ...prev, selectedIdx: Math.min(prev.selectedIdx + 1, mentionImages.length - 1) } : null);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setAtMention(prev => prev ? { ...prev, selectedIdx: Math.max(prev.selectedIdx - 1, 0) } : null);
      return;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      const img = mentionImages[atMention.selectedIdx];
      if (img) {
        event.preventDefault();
        handleMentionSelect(img);
      }
    }
  }, [atMention, handleMentionSelect, mentionImages]);

  const handleInsert = React.useCallback((text: string) => {
    if (isComposingRef.current) return;
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + text + value.slice(end);
    setValue(next);
    commitValue(next);
    // Restore focus and move cursor after inserted text
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  }, [commitValue, value]);

  const handleValueChange = React.useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.target.value;
    const cursorPos = event.target.selectionStart ?? next.length;
    const nativeEvent = event.nativeEvent as InputEvent & { isComposing?: boolean };
    setValue(next);
    if (!isComposingRef.current && !nativeEvent.isComposing) {
      commitValue(next);
    }
    const mention = detectAtMention(next, cursorPos);
    if (mention) {
      setAtMention(prev => ({
        ...mention,
        selectedIdx: prev?.startIndex === mention.startIndex ? prev.selectedIdx : 0,
      }));
    } else {
      setAtMention(null);
    }
  }, [commitValue, detectAtMention]);

  const handleCompositionStart = React.useCallback(() => {
    isComposingRef.current = true;
  }, []);

  const handleCompositionEnd = React.useCallback((event: React.CompositionEvent<HTMLTextAreaElement>) => {
    isComposingRef.current = false;
    const next = event.currentTarget.value;
    setValue(next);
    commitValue(next);
  }, [commitValue]);

  const handleTextareaSelect = React.useCallback((event: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const el = event.currentTarget;
    const cursorPos = el.selectionStart ?? 0;
    const mention = detectAtMention(el.value, cursorPos);
    if (!mention) setAtMention(null);
  }, [detectAtMention]);

  React.useEffect(() => {
    if (atMention && textareaRef.current) {
      const rect = textareaRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    } else if (!atMention) {
      setDropdownPos(null);
    }
  }, [atMention !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!atMention) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (textareaRef.current && !textareaRef.current.contains(e.target as Node)) {
        setAtMention(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [atMention]);

  const commitResize = React.useCallback((width: number, height: number, x: number, y: number) => {
    const nextWidth = Math.max(MIN_NODE_WIDTH, Math.round(width));
    const nextHeight = Math.max(MIN_NODE_HEIGHT, Math.round(height));
    const nextX = Math.round(x);
    const nextY = Math.round(y);
    rf.setNodes((ns) => {
      const targetIndex = ns.findIndex((node) => node.id === id);
      if (targetIndex < 0) return ns;

      const targetNode = ns[targetIndex];
      const targetData = targetNode.data || {};
      const positionChanged = targetNode.position.x !== nextX || targetNode.position.y !== nextY;
      const sizeChanged = targetData.boxW !== nextWidth || targetData.boxH !== nextHeight;
      if (!positionChanged && !sizeChanged) {
        return ns;
      }

      const nextNodes = ns.slice();
      nextNodes[targetIndex] = {
        ...targetNode,
        position: positionChanged
          ? { x: nextX, y: nextY }
          : targetNode.position,
        data: sizeChanged
          ? { ...targetData, boxW: nextWidth, boxH: nextHeight }
          : targetData,
      };
      return nextNodes;
    });
  }, [id, rf]);

  React.useEffect(() => {
    return () => {
      if (resizePreviewRafRef.current !== null) {
        window.cancelAnimationFrame(resizePreviewRafRef.current);
        resizePreviewRafRef.current = null;
      }
      resizePendingRef.current = null;
      resizeStartRef.current = null;
    };
  }, []);

  const handleResizeStart = React.useCallback((_: unknown, params: { width: number; height: number; x: number; y: number }) => {
    resizeStartRef.current = {
      width: Math.max(MIN_NODE_WIDTH, Math.round(params.width)),
      height: Math.max(MIN_NODE_HEIGHT, Math.round(params.height)),
      x: Math.round(params.x),
      y: Math.round(params.y),
    };
    resizePendingRef.current = null;
    setResizePreview(null);
    setIsResizing(true);
  }, []);

  const shouldResize = React.useCallback((_: unknown, params: { width: number; height: number; x: number; y: number }) => {
    const start = resizeStartRef.current;
    if (!start) return false;

    resizePendingRef.current = {
      width: Math.max(MIN_NODE_WIDTH, Math.round(params.width)),
      height: Math.max(MIN_NODE_HEIGHT, Math.round(params.height)),
      offsetX: Math.round(params.x - start.x),
      offsetY: Math.round(params.y - start.y),
    };

    if (resizePreviewRafRef.current !== null) return false;
    resizePreviewRafRef.current = window.requestAnimationFrame(() => {
      resizePreviewRafRef.current = null;
      setResizePreview(resizePendingRef.current);
    });
    return false;
  }, []);

  const handleResizeEnd = React.useCallback((_: unknown, params: { width: number; height: number; x: number; y: number }) => {
    setIsResizing(false);
    if (resizePreviewRafRef.current !== null) {
      window.cancelAnimationFrame(resizePreviewRafRef.current);
      resizePreviewRafRef.current = null;
    }

    const start = resizeStartRef.current;
    const pending = resizePendingRef.current;
    resizeStartRef.current = null;
    resizePendingRef.current = null;
    setResizePreview(null);

    const finalPreview = pending || {
      width: Math.max(MIN_NODE_WIDTH, Math.round(params.width)),
      height: Math.max(MIN_NODE_HEIGHT, Math.round(params.height)),
      offsetX: start ? Math.round(params.x - start.x) : 0,
      offsetY: start ? Math.round(params.y - start.y) : 0,
    };

    const baseX = start?.x ?? Math.round(params.x);
    const baseY = start?.y ?? Math.round(params.y);
    commitResize(
      finalPreview.width,
      finalPreview.height,
      baseX + finalPreview.offsetX,
      baseY + finalPreview.offsetY
    );
  }, [commitResize]);

  useNodeInternalsSync(
    id,
    nodeRootRef,
    [data.boxW, data.boxH, isEditingTitle, isPromptEditable],
    { disabled: isResizing }
  );

  const renderedBoxW = isResizing && resizePreview ? resizePreview.width : (data.boxW || 240);
  const renderedBoxH = isResizing && resizePreview ? resizePreview.height : (data.boxH || 180);
  const renderedOffsetX = isResizing && resizePreview ? resizePreview.offsetX : 0;
  const renderedOffsetY = isResizing && resizePreview ? resizePreview.offsetY : 0;

  return (
    <div ref={nodeRootRef} style={{
      width: renderedBoxW,
      height: renderedBoxH,
      padding: 8,
      background: '#fff',
      border: `1px solid ${borderColor}`,
      borderRadius: 8,
      boxShadow,
      transition: isResizing ? 'none' : 'border-color 0.15s ease, box-shadow 0.15s ease',
      transform: isResizing ? `translate(${renderedOffsetX}px, ${renderedOffsetY}px)` : undefined,
      willChange: isResizing ? 'transform, width, height' : undefined,
      contain: isResizing ? 'layout paint' : undefined,
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      overflow: 'visible'
    }}>
      <NodeResizer
        isVisible
        minWidth={MIN_NODE_WIDTH}
        minHeight={MIN_NODE_HEIGHT}
        color="transparent"
        lineStyle={{ display: 'none' }}
        handleStyle={{ background: 'transparent', border: 'none', width: 16, height: 16, opacity: 0 }}
        onResizeStart={handleResizeStart}
        shouldResize={shouldResize}
        onResizeEnd={handleResizeEnd}
      />
      <div style={{ fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={() => commitTitle(titleDraft)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitTitle(titleDraft);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                cancelTitleEditing();
              }
            }}
            style={{
              fontWeight: 600,
              fontSize: 13,
              border: '1px solid #d1d5db',
              borderRadius: 4,
              padding: '2px 4px',
              outline: 'none',
              width: '100%'
            }}
          />
        ) : (
          <span
            onDoubleClick={startTitleEditing}
            title={lt("双击编辑标题", "Double-click to edit title")}
            style={{ cursor: 'text', userSelect: 'none' }}
          >
            {title}
          </span>
        )}
        {hasIncoming && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#6b7280' }}>
              {lt(`已拼接 ${incomingCount} 条输入`, `${incomingCount} inputs merged`)}
            </span>
            <button
              onClick={handleDisconnectInputs}
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 999,
                border: '1px solid #e5e7eb',
                background: '#fff',
                color: '#374151',
                cursor: 'pointer'
              }}
            >
              {lt("内置", "Builtin")}
            </button>
          </div>
        )}
      </div>
      <textarea
        ref={textareaRef}
        className={isPromptEditable ? "nodrag nopan nowheel" : undefined}
        value={value}
        readOnly={!isPromptEditable}
        tabIndex={isPromptEditable ? 0 : -1}
        onChange={handleValueChange}
        onKeyDown={handleMentionKeyDown}
        onSelect={handleTextareaSelect}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onWheelCapture={(event) => {
          if (!isPromptEditable) return;
          if (shouldPassWheelToCanvas(event)) return;
          event.stopPropagation();
          if (event.nativeEvent?.stopImmediatePropagation) {
            event.nativeEvent.stopImmediatePropagation();
          }
        }}
        onPointerDownCapture={(event) => {
          if (!isPromptEditable) return;
          event.stopPropagation();
          if (event.nativeEvent?.stopImmediatePropagation) {
            event.nativeEvent.stopImmediatePropagation();
          }
        }}
        onMouseDownCapture={(event) => {
          if (!isPromptEditable) return;
          event.stopPropagation();
        }}
        placeholder={lt("输入提示词", "Enter prompt")}
        style={{
          width: '100%',
          flex: 1,
          resize: 'none',
          maxHeight: '100%',
          minHeight: 60,
          overflowY: 'auto',
          fontSize: 12,
          border: '1px solid #e5e7eb',
          borderRadius: 6,
          padding: 6,
          outline: 'none',
          pointerEvents: isPromptEditable ? 'auto' : 'none',
          background: 'rgba(255,255,255,0.92)',
          cursor: isPromptEditable ? 'text' : 'default'
        }}
      />
      {isPromptEditable && (
        <PromptImageStrip images={siblingImages} onInsert={handleInsert} />
      )}
      {atMention && dropdownPos && mentionImages.length > 0 && createPortal(
        <div
          className="nodrag nopan"
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            left: dropdownPos.left,
            minWidth: Math.min(dropdownPos.width, 280),
            zIndex: 10000,
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            boxShadow: '0 4px 20px rgba(0,0,0,0.14)',
            padding: 6,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
          }}
        >
          {mentionImages.map((img, idx) => (
            <button
              key={`${img.nodeId}::${img.index}`}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onClick={(e) => { e.stopPropagation(); handleMentionSelect(img); }}
              style={{
                padding: 4,
                borderRadius: 6,
                border: `2px solid ${idx === atMention.selectedIdx ? '#2563eb' : 'transparent'}`,
                background: idx === atMention.selectedIdx ? '#eff6ff' : '#f9fafb',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
              }}
            >
              <img
                src={img.url}
                alt={`图${img.index}`}
                style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 4, display: 'block' }}
                draggable={false}
              />
              <span style={{ fontSize: 11, color: '#374151', lineHeight: 1 }}>@图{img.index}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
      <Handle
        type="target"
        position={Position.Left}
        id="text"
        style={{ top: '50%' }}
        onMouseEnter={() => setHover('prompt-in')}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="text"
        style={{ top: '50%' }}
        onMouseEnter={() => setHover('prompt-out')}
        onMouseLeave={() => setHover(null)}
      />
      {hover === 'prompt-in' && (
        <div className="flow-tooltip" style={{ left: -8, top: '50%', transform: 'translate(-100%, -50%)' }}>prompt</div>
      )}
      {hover === 'prompt-out' && (
        <div className="flow-tooltip" style={{ right: -8, top: '50%', transform: 'translate(100%, -50%)' }}>prompt</div>
      )}
    </div>
  );
}

export default React.memo(TextPromptNodeInner);
