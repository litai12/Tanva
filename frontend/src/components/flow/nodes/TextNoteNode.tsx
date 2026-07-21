import React from 'react';
import { Handle, Position, NodeResizer, useReactFlow } from '@xyflow/react';
import { useLocaleText } from '@/utils/localeText';
import { useAIChatStore } from '@/stores/aiChatStore';

type Props = {
  id: string;
  data: { text?: string; boxW?: number; boxH?: number };
  selected?: boolean;
};

function TextNoteNodeInner({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const rf = useReactFlow();
  const isDarkTheme = useAIChatStore((state) => state.chatTheme === 'black');
  const [value, setValue] = React.useState<string>(data.text || '');
  const [hover, setHover] = React.useState<string | null>(null);
  const noteBackground = isDarkTheme ? '#1c1c1c' : '#f2f3f5';
  const borderColor = selected ? '#2563eb' : '#e5e7eb';
  const boxShadow = selected
    ? '0 0 0 2px rgba(37,99,235,0.12)'
    : '0 1px 2px rgba(0,0,0,0.04)';
  const width = data.boxW || 220;
  const height = data.boxH || 120;
  const editorRef = React.useRef<HTMLDivElement | null>(null);
  const [isEditing, setIsEditing] = React.useState(false);
  const isComposing = React.useRef(false);

  React.useEffect(() => {
    if ((data.text || '') !== value) setValue(data.text || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.text]);

  const stopPropagation = React.useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
    const nativeEvent = (
      event as React.SyntheticEvent<Element, Event>
    ).nativeEvent as Event & { stopImmediatePropagation?: () => void };
    nativeEvent.stopImmediatePropagation?.();
  }, []);

  React.useEffect(() => {
    if (!editorRef.current) return;
    if (isEditing) return;
    const current = editorRef.current.innerText;
    if (current !== value) {
      editorRef.current.innerText = value;
    }
  }, [isEditing, value]);

  const commitValue = React.useCallback((next: string) => {
    setValue(next);
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', { detail: { id, patch: { text: next } } }));
  }, [id]);

  const onEditorInput = React.useCallback((event: React.FormEvent<HTMLDivElement>) => {
    if (isComposing.current) return;
    const next = event.currentTarget.innerText;
    commitValue(next);
  }, [commitValue]);

  const handleCompositionStart = React.useCallback(() => {
    isComposing.current = true;
  }, []);

  const handleCompositionEnd = React.useCallback((event: React.CompositionEvent<HTMLDivElement>) => {
    isComposing.current = false;
    commitValue(event.currentTarget.innerText);
  }, [commitValue]);

  const exitEditing = React.useCallback((commit = true) => {
    if (commit && editorRef.current) {
      const finalText = editorRef.current.innerText ?? '';
      commitValue(finalText);
    } else if (!commit && editorRef.current) {
      editorRef.current.innerText = value;
    }
    setIsEditing(false);
  }, [commitValue, value]);

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      exitEditing(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      exitEditing(false);
    }
  }, [exitEditing]);

  const startEditing = React.useCallback((event: React.MouseEvent | React.KeyboardEvent) => {
    event.stopPropagation();
    setIsEditing(true);
  }, []);

  React.useEffect(() => {
    if (!isEditing || !editorRef.current) return;
    // 进入编辑态后聚焦并将光标移动到文本末尾
    const id = window.setTimeout(() => {
      const el = editorRef.current;
      if (!el) return;
      el.focus();
      const selection = window.getSelection();
      if (!selection) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }, 0);
    return () => window.clearTimeout(id);
  }, [isEditing]);

  return (
    <div
      className="tanva-textnote"
      style={{
        width,
        minHeight: height,
        padding: '12px 14px',
        background: noteBackground,
        border: `1px solid ${borderColor}`,
        borderRadius: 14,
        boxShadow,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        boxSizing: 'border-box',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
      }}
    >
      <NodeResizer
        isVisible
        minWidth={160}
        minHeight={96}
        lineStyle={{ display: 'none' }}
        handleStyle={{ background: 'transparent', border: 'none', width: 16, height: 16, opacity: 0 }}
        onResize={(_, params) => {
          rf.setNodes(ns => ns.map(node => node.id === id ? { ...node, data: { ...(node.data || {}), boxW: params.width, boxH: params.height } } : node));
        }}
        onResizeEnd={(_, params) => {
          rf.setNodes(ns => ns.map(node => node.id === id ? { ...node, data: { ...(node.data || {}), boxW: params.width, boxH: params.height } } : node));
        }}
      />
      <div
        ref={editorRef}
        className={`tanva-textnote-editor nowheel${isEditing ? ' nodrag' : ''}`}
        contentEditable={isEditing}
        suppressContentEditableWarning
        data-placeholder={lt("输入文本", "Enter text")}
        onInput={onEditorInput}
        onWheelCapture={isEditing ? stopPropagation : undefined}
        onMouseDown={isEditing ? stopPropagation : undefined}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onBlur={() => exitEditing(true)}
        onKeyDown={handleKeyDown}
        onDoubleClick={startEditing}
        style={{
          width: '100%',
          minHeight: Math.max(60, height - 24),
          borderRadius: 10,
          background: noteBackground,
          fontSize: 14,
          fontWeight: 400,
          color: isDarkTheme ? '#ffffff' : '#111827',
          textAlign: 'center',
          outline: 'none',
          lineHeight: 1.4,
          padding: '8px 12px',
          display: 'block',
          boxSizing: 'border-box',
          minWidth: 0,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflowWrap: 'anywhere',
          pointerEvents: 'auto',
        }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="text"
        style={{ top: '50%' }}
        className="tanva-textnote-handle tanva-textnote-handle--target"
        onMouseEnter={() => setHover('prompt-in')}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="text-right-out"
        style={{ top: '50%' }}
        className="tanva-textnote-handle tanva-textnote-handle--source"
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

export default React.memo(TextNoteNodeInner);
