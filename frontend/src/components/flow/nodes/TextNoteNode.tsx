import React from 'react';
import { Handle, Position, NodeResizer, useReactFlow } from 'reactflow';

type Props = {
  id: string;
  data: { text?: string; boxW?: number; boxH?: number };
  selected?: boolean;
};

const handleConfigs = [
  { key: 'top', position: Position.Top, style: { top: 0, left: '50%', transform: 'translate(-50%, -50%)' } },
  { key: 'bottom', position: Position.Bottom, style: { bottom: 0, left: '50%', transform: 'translate(-50%, 50%)' } },
  { key: 'left', position: Position.Left, style: { left: 0, top: '50%', transform: 'translate(-50%, -50%)' } },
  { key: 'right', position: Position.Right, style: { right: 0, top: '50%', transform: 'translate(50%, -50%)' } },
] as const;

export default function TextNoteNode({ id, data, selected }: Props) {
  const rf = useReactFlow();
  const [value, setValue] = React.useState<string>(data.text || '');
  const borderColor = selected ? '#2563eb' : '#e5e7eb';
  const boxShadow = selected ? '0 0 0 2px rgba(37,99,235,0.12)' : '0 1px 2px rgba(0,0,0,0.04)';
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
    const nativeEvent = (event as React.SyntheticEvent<any, Event>).nativeEvent as Event & { stopImmediatePropagation?: () => void };
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
        background: '#f5f7fa',
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
        handleStyle={{ background: 'transparent', border: 'none', width: 16, height: 16, opacity: 0, cursor: 'nwse-resize' }}
        onResize={(_, params) => {
          rf.setNodes(ns => ns.map(node => node.id === id ? { ...node, data: { ...(node.data || {}), boxW: params.width, boxH: params.height } } : node));
        }}
        onResizeEnd={(_, params) => {
          rf.setNodes(ns => ns.map(node => node.id === id ? { ...node, data: { ...(node.data || {}), boxW: params.width, boxH: params.height } } : node));
        }}
      />
      <div
        ref={editorRef}
        className="tanva-textnote-editor"
        contentEditable={isEditing}
        suppressContentEditableWarning
        data-placeholder="输入文本"
        onInput={onEditorInput}
        onWheelCapture={isEditing ? stopPropagation : undefined}
        onPointerDownCapture={isEditing ? stopPropagation : undefined}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onBlur={() => exitEditing(true)}
        onKeyDown={handleKeyDown}
        onDoubleClick={startEditing}
        style={{
          width: '100%',
          minHeight: Math.max(60, height - 24),
          borderRadius: 12,
          background: '#f5f7fa',
          fontSize: 18,
          fontWeight: 600,
          color: '#111827',
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
      {handleConfigs.map((cfg) => (
        <React.Fragment key={cfg.key}>
          <Handle
            type="source"
            id={`text-${cfg.key}-out`}
            position={cfg.position}
            style={cfg.style as React.CSSProperties}
            className="tanva-textnote-handle tanva-textnote-handle--source"
          />
          <Handle
            type="target"
            id={`text-${cfg.key}-in`}
            position={cfg.position}
            style={cfg.style as React.CSSProperties}
            className="tanva-textnote-handle tanva-textnote-handle--target"
          />
        </React.Fragment>
      ))}
    </div>
  );
}
