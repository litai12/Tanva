import React from 'react';
import { Handle, Position, NodeResizer, useReactFlow, useStore, type Edge, type ReactFlowState } from 'reactflow';

type Props = {
  id: string;
  data: {
    segmentA?: string;
    segmentB?: string;
    fusedText?: string;
    text?: string;
    autoFuse?: boolean;
    boxW?: number;
    boxH?: number;
  };
  selected?: boolean;
};

type TargetHandle = 'textA' | 'textB';

function cleanChineseSegment(input: string, isFirst: boolean): string {
  let value = input.trim();
  if (isFirst) {
    value = value.replace(/[，,。；;！？!?、\s]+$/, '');
  } else {
    value = value.replace(/^[，,。；;！？!?、\s]+/, '').replace(/[，,。；;！？!?、\s]+$/, '');
  }
  return value;
}

function cleanEnglishSegment(input: string, isFirst: boolean): string {
  let value = input.trim();
  if (isFirst) {
    value = value.replace(/[.,;:!?]+$/, '');
  } else {
    value = value.replace(/^[^a-zA-Z0-9]+/, '').replace(/[.,;:!?]+$/, '');
  }
  if (isFirst && value.length > 0) {
    value = value.charAt(0).toUpperCase() + value.slice(1);
  }
  if (!isFirst && value.length > 0) {
    value = value.charAt(0).toLowerCase() + value.slice(1);
  }
  return value;
}

function fuseSegments(segmentA: string, segmentB: string): string {
  const rawA = (segmentA || '').trim();
  const rawB = (segmentB || '').trim();
  const hasA = rawA.length > 0;
  const hasB = rawB.length > 0;
  if (!hasA && !hasB) return '';
  if (hasA && !hasB) return rawA;
  if (!hasA && hasB) return rawB;

  const containsChinese = /[\u4e00-\u9fff]/.test(rawA + rawB);
  if (containsChinese) {
    const partA = cleanChineseSegment(rawA, true);
    const partB = cleanChineseSegment(rawB, false);
    let sentence = `${partA}，并融合${partB}`;
    sentence = sentence.replace(/，并融合$/, '');
    if (!/[。！？!?；;]$/.test(sentence)) {
      sentence += '。';
    }
    return sentence;
  }

  const partA = cleanEnglishSegment(rawA, true);
  const partB = cleanEnglishSegment(rawB, false);
  let sentence = `${partA}, while also ${partB}`;
  sentence = sentence.replace(/[.,\s]+$/, '');
  if (!sentence.endsWith('.')) sentence += '.';
  return sentence;
}

function extractTextFromNode(nodeData: any): string {
  if (!nodeData || typeof nodeData !== 'object') return '';
  const direct = typeof nodeData.text === 'string' ? nodeData.text : undefined;
  if (typeof direct === 'string') return direct;
  const fused = typeof nodeData.fusedText === 'string' ? nodeData.fusedText : undefined;
  if (typeof fused === 'string') return fused;
  const expanded = typeof nodeData.expandedText === 'string' ? nodeData.expandedText : undefined;
  if (typeof expanded === 'string') return expanded;
  const prompt = typeof nodeData.prompt === 'string' ? nodeData.prompt : undefined;
  if (typeof prompt === 'string') return prompt;
  return '';
}

function extractTextFromPatch(patch: Record<string, unknown>): string | undefined {
  const keys = ['text', 'fusedText', 'expandedText', 'prompt'];
  for (const key of keys) {
    const value = patch[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

export default function PromptFusionNode({ id, data }: Props) {
  const rf = useReactFlow();
  const edges = useStore((state: ReactFlowState) => state.edges);
  const edgesRef = React.useRef<Edge[]>(edges);
  const [hover, setHover] = React.useState<string | null>(null);

  const [segmentA, setSegmentA] = React.useState<string>(data.segmentA ?? '');
  const [segmentB, setSegmentB] = React.useState<string>(data.segmentB ?? '');
  const [fused, setFused] = React.useState<string>(data.fusedText ?? data.text ?? '');
  const [autoFuse, setAutoFuse] = React.useState<boolean>(data.autoFuse !== false);
  const [connectedA, setConnectedA] = React.useState<boolean>(false);
  const [connectedB, setConnectedB] = React.useState<boolean>(false);

  const lastSnapshot = React.useRef({
    segmentA: data.segmentA ?? '',
    segmentB: data.segmentB ?? '',
    fusedText: data.fusedText ?? data.text ?? '',
    text: data.text ?? data.fusedText ?? '',
    autoFuse: data.autoFuse !== false,
  });

  const updateNodeData = React.useCallback((patch: Record<string, any>) => {
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', { detail: { id, patch } }));
  }, [id]);

  const syncFromSource = React.useCallback((handle: TargetHandle, sourceId: string) => {
    const node = rf.getNode(sourceId);
    if (!node) return;
    const upstream = extractTextFromNode(node.data);
    if (handle === 'textA') {
      setSegmentA(prev => (prev === upstream ? prev : upstream));
    } else {
      setSegmentB(prev => (prev === upstream ? prev : upstream));
    }
  }, [rf]);

  React.useEffect(() => {
    edgesRef.current = edges;
    const incomingA = edges.find(e => e.target === id && e.targetHandle === 'textA');
    const incomingB = edges.find(e => e.target === id && e.targetHandle === 'textB');
    if (incomingA?.source) {
      setConnectedA(true);
      syncFromSource('textA', incomingA.source);
    } else {
      setConnectedA(false);
    }
    if (incomingB?.source) {
      setConnectedB(true);
      syncFromSource('textB', incomingB.source);
    } else {
      setConnectedB(false);
    }
  }, [edges, id, syncFromSource]);

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; patch: Record<string, unknown> }>).detail;
      if (!detail?.id || detail.id === id) return;
      const incomingA = edgesRef.current.find(e => e.target === id && e.targetHandle === 'textA');
      if (incomingA?.source === detail.id) {
        const patchText = extractTextFromPatch(detail.patch || {});
        if (typeof patchText === 'string') {
          setSegmentA(prev => (prev === patchText ? prev : patchText));
        } else {
          syncFromSource('textA', detail.id);
        }
      }
      const incomingB = edgesRef.current.find(e => e.target === id && e.targetHandle === 'textB');
      if (incomingB?.source === detail.id) {
        const patchText = extractTextFromPatch(detail.patch || {});
        if (typeof patchText === 'string') {
          setSegmentB(prev => (prev === patchText ? prev : patchText));
        } else {
          syncFromSource('textB', detail.id);
        }
      }
    };
    window.addEventListener('flow:updateNodeData', handler as EventListener);
    return () => window.removeEventListener('flow:updateNodeData', handler as EventListener);
  }, [id, syncFromSource]);

  React.useEffect(() => {
    const next = data.autoFuse !== false;
    setAutoFuse(prev => (prev === next ? prev : next));
  }, [data.autoFuse]);

  React.useEffect(() => {
    const next = data.segmentA ?? '';
    setSegmentA(prev => (prev === next ? prev : next));
  }, [data.segmentA]);

  React.useEffect(() => {
    const next = data.segmentB ?? '';
    setSegmentB(prev => (prev === next ? prev : next));
  }, [data.segmentB]);

  React.useEffect(() => {
    const nextFused = data.fusedText ?? data.text ?? '';
    if (nextFused !== fused && !autoFuse) {
      setFused(nextFused);
    }
  }, [data.fusedText, data.text, fused, autoFuse]);

  React.useEffect(() => {
    if (!autoFuse) return;
    const next = fuseSegments(segmentA, segmentB);
    setFused(prev => (prev === next ? prev : next));
  }, [segmentA, segmentB, autoFuse]);

  React.useEffect(() => {
    const payload = {
      segmentA,
      segmentB,
      fusedText: fused,
      text: fused,
      autoFuse,
    };
    const snapshot = lastSnapshot.current;
    const changed = Object.keys(payload).some((key) => (snapshot as any)[key] !== (payload as any)[key]);
    if (changed) {
      lastSnapshot.current = { ...snapshot, ...payload };
      updateNodeData(payload);
    }
  }, [segmentA, segmentB, fused, autoFuse, updateNodeData]);

  const handleManualFuse = React.useCallback(() => {
    const next = fuseSegments(segmentA, segmentB);
    setFused(next);
  }, [segmentA, segmentB]);

  const DEFAULT_WIDTH = 420;
  const DEFAULT_HEIGHT = 380;

  const width = Math.max(data.boxW ?? DEFAULT_WIDTH, DEFAULT_WIDTH);
  const height = Math.max(data.boxH ?? DEFAULT_HEIGHT, DEFAULT_HEIGHT);

  React.useEffect(() => {
    const clampedWidth = Math.max(data.boxW ?? DEFAULT_WIDTH, DEFAULT_WIDTH);
    const clampedHeight = Math.max(data.boxH ?? DEFAULT_HEIGHT, DEFAULT_HEIGHT);
    if (clampedWidth !== data.boxW || clampedHeight !== data.boxH) {
      rf.setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, boxW: clampedWidth, boxH: clampedHeight } } : n));
    }
  }, [data.boxW, data.boxH, id, rf]);

  return (
    <div
      style={{
        width,
        height,
      padding: 16,
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 10,
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        gap: 10,
        boxSizing: 'border-box',
      }}
    >
      <NodeResizer
        isVisible
        minWidth={DEFAULT_WIDTH}
        minHeight={DEFAULT_HEIGHT}
        color="transparent"
        lineStyle={{ display: 'none' }}
        handleStyle={{ background: 'transparent', border: 'none', width: 16, height: 16, opacity: 0, cursor: 'nwse-resize' }}
        onResize={(evt, params) => {
          rf.setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, boxW: params.width, boxH: params.height } } : n));
        }}
        onResizeEnd={(evt, params) => {
          rf.setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, boxW: params.width, boxH: params.height } } : n));
        }}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 600 }}>Prompt Fusion</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#6b7280' }}>
          <input
            type="checkbox"
            checked={autoFuse}
            onChange={(event) => setAutoFuse(event.target.checked)}
            style={{ margin: 0 }}
          />
          自动融合
        </label>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>
          段落 A {connectedA ? '（已连接）' : ''}
        </div>
        <textarea
          value={segmentA}
          disabled={connectedA}
          onChange={(event) => setSegmentA(event.target.value)}
          placeholder="输入或连接提示词段落 A"
          onWheelCapture={(event) => {
            event.stopPropagation();
            event.preventDefault();
          }}
          onPointerDownCapture={(event) => {
            event.stopPropagation();
          }}
          style={{
            width: '100%',
            minHeight: 64,
            flex: 1,
            resize: 'vertical',
            fontSize: 12,
            borderRadius: 6,
            border: '1px solid #d1d5db',
        padding: '10px 12px',
            background: connectedA ? '#f9fafb' : '#fff',
            color: '#111827',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>
          段落 B {connectedB ? '（已连接）' : ''}
        </div>
        <textarea
          value={segmentB}
          disabled={connectedB}
          onChange={(event) => setSegmentB(event.target.value)}
          placeholder="输入或连接提示词段落 B"
          onWheelCapture={(event) => {
            event.stopPropagation();
            event.preventDefault();
          }}
          onPointerDownCapture={(event) => {
            event.stopPropagation();
          }}
          style={{
            width: '100%',
            minHeight: 64,
            flex: 1,
            resize: 'vertical',
            fontSize: 12,
            borderRadius: 6,
            border: '1px solid #d1d5db',
            padding: '10px 12px',
            background: connectedB ? '#f9fafb' : '#fff',
            color: '#111827',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#4b5563' }}>融合结果</div>
        <button
          onClick={handleManualFuse}
          disabled={autoFuse}
          style={{
            fontSize: 11,
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px solid #d1d5db',
            background: autoFuse ? '#f3f4f6' : '#111827',
            color: autoFuse ? '#9ca3af' : '#fff',
            cursor: autoFuse ? 'not-allowed' : 'pointer',
          }}
        >
          重新融合
        </button>
      </div>

      <textarea
        value={fused}
        disabled={autoFuse}
        onChange={(event) => setFused(event.target.value)}
        placeholder="融合结果将在此处生成"
        onWheelCapture={(event) => {
          event.stopPropagation();
          event.preventDefault();
        }}
        onPointerDownCapture={(event) => {
          event.stopPropagation();
        }}
        style={{
          width: '100%',
          flex: 1,
          minHeight: 72,
          resize: 'vertical',
          fontSize: 12,
          borderRadius: 6,
          border: '1px solid #d1d5db',
        padding: '12px 16px',
          background: autoFuse ? '#f9fafb' : '#fff',
          color: '#111827',
          outline: 'none',
          boxSizing: 'border-box',
        }}
      />

      <Handle
        type="target"
        position={Position.Left}
        id="textA"
        style={{ top: '28%' }}
        onMouseEnter={() => setHover('A-in')}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="textB"
        style={{ top: '58%' }}
        onMouseEnter={() => setHover('B-in')}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="text"
        style={{ top: '50%' }}
        onMouseEnter={() => setHover('out')}
        onMouseLeave={() => setHover(null)}
      />

      {hover === 'A-in' && (
        <div className="flow-tooltip" style={{ left: -8, top: '28%', transform: 'translate(-100%, -50%)' }}>prompt A</div>
      )}
      {hover === 'B-in' && (
        <div className="flow-tooltip" style={{ left: -8, top: '58%', transform: 'translate(-100%, -50%)' }}>prompt B</div>
      )}
      {hover === 'out' && (
        <div className="flow-tooltip" style={{ right: -8, top: '50%', transform: 'translate(100%, -50%)' }}>prompt</div>
      )}
    </div>
  );
}
