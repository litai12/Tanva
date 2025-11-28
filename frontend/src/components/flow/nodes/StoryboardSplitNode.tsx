import React from 'react';
import { Handle, Position, NodeResizer, useReactFlow, useStore, type ReactFlowState, type Edge } from 'reactflow';

type Props = {
  id: string;
  data: {
    status?: 'idle' | 'succeeded' | 'failed';
    inputText?: string;
    segments?: string[];
    outputCount?: number;
    error?: string;
    boxW?: number;
    boxH?: number;
  };
  selected?: boolean;
};

const MIN_OUTPUT_COUNT = 1;
const MAX_OUTPUT_COUNT = 20;
const DEFAULT_OUTPUT_COUNT = 9;

/**
 * 分镜脚本解析器 - 只识别 |**XX**| 和 | **XX** | 格式
 * 例如：|**1**|, |**01**|, | **1** |, | **01** |
 */
function parseStoryboardScript(text: string): string[] {
  if (!text || !text.trim()) return [];

  // 匹配 Markdown 表格格式 |**XX**| 或 | **XX** |（支持1-99，含或不含空格）
  const mdPattern = /\|\s?\*\*(\d{1,2})\*\*\s?\|/g;
  const mdMatches = [...text.matchAll(mdPattern)];

  if (mdMatches.length === 0) {
    return []; // 没找到任何分镜格式，返回空
  }

  return extractSegmentsByMatches(text, mdMatches);
}

function extractSegmentsByMatches(text: string, matches: RegExpMatchArray[]): string[] {
  const segments: string[] = [];

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index!;
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const segment = text.slice(start, end).trim();
    if (segment) {
      segments.push(segment);
    }
  }

  return segments;
}

export default function StoryboardSplitNode({ id, data, selected }: Props) {
  const rf = useReactFlow();
  const edges = useStore((state: ReactFlowState) => state.edges);
  const edgesRef = React.useRef<Edge[]>(edges);

  const [inputText, setInputText] = React.useState<string>(data.inputText || '');
  const [segments, setSegments] = React.useState<string[]>(data.segments || []);
  const [outputCount, setOutputCount] = React.useState<number>(
    Math.min(MAX_OUTPUT_COUNT, Math.max(MIN_OUTPUT_COUNT, data.outputCount || DEFAULT_OUTPUT_COUNT))
  );
  const [hover, setHover] = React.useState<string | null>(null);

  const borderColor = selected ? '#2563eb' : '#e5e7eb';
  const boxShadow = selected ? '0 0 0 2px rgba(37,99,235,0.12)' : '0 1px 2px rgba(0,0,0,0.04)';

  // 同步 edges ref
  React.useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  // 同步外部数据变化
  React.useEffect(() => {
    if (data.inputText !== undefined && data.inputText !== inputText) {
      setInputText(data.inputText);
    }
  }, [data.inputText]);

  React.useEffect(() => {
    if (data.segments && JSON.stringify(data.segments) !== JSON.stringify(segments)) {
      setSegments(data.segments);
    }
  }, [data.segments]);

  React.useEffect(() => {
    const count = data.outputCount || DEFAULT_OUTPUT_COUNT;
    if (count !== outputCount) {
      setOutputCount(Math.min(MAX_OUTPUT_COUNT, Math.max(MIN_OUTPUT_COUNT, count)));
    }
  }, [data.outputCount]);

  // 更新节点数据
  const updateNodeData = React.useCallback((patch: Record<string, unknown>) => {
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch }
    }));
  }, [id]);

  // 处理输入文本
  const applyIncomingText = React.useCallback((text: string) => {
    setInputText(text);
    updateNodeData({ inputText: text });
  }, [updateNodeData]);

  // 从源节点同步文本
  const syncFromSource = React.useCallback((sourceId: string) => {
    const srcNode = rf.getNode(sourceId);
    if (!srcNode) return;
    const srcData = (srcNode.data as Record<string, unknown>) || {};
    const text =
      (typeof srcData.text === 'string' ? srcData.text : undefined) ||
      (typeof srcData.prompt === 'string' ? srcData.prompt : undefined) ||
      (typeof srcData.expandedText === 'string' ? srcData.expandedText : undefined) ||
      (typeof srcData.responseText === 'string' ? srcData.responseText : undefined) ||
      '';
    if (text !== inputText) {
      applyIncomingText(text);
    }
  }, [rf, applyIncomingText, inputText]);

  // 监听上游节点连接变化
  React.useEffect(() => {
    const incoming = edges.find((e) => e.target === id && e.targetHandle === 'text');
    if (incoming?.source) {
      syncFromSource(incoming.source);
    }
  }, [edges, id, syncFromSource]);

  // 监听上游数据更新事件
  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; patch: Record<string, unknown> }>).detail;
      if (!detail?.id || detail.id === id) return;

      const incoming = edgesRef.current.find((e) => e.target === id && e.targetHandle === 'text');
      if (!incoming || incoming.source !== detail.id) return;

      const patch = detail.patch || {};
      const textPatch =
        (typeof patch.text === 'string' ? patch.text : undefined) ||
        (typeof patch.prompt === 'string' ? patch.prompt : undefined) ||
        (typeof patch.expandedText === 'string' ? patch.expandedText : undefined) ||
        (typeof patch.responseText === 'string' ? patch.responseText : undefined);

      if (typeof textPatch === 'string') {
        applyIncomingText(textPatch);
      } else {
        syncFromSource(detail.id);
      }
    };

    window.addEventListener('flow:updateNodeData', handler as EventListener);
    return () => window.removeEventListener('flow:updateNodeData', handler as EventListener);
  }, [id, applyIncomingText, syncFromSource]);

  // 执行拆分
  const handleSplit = React.useCallback(() => {
    if (!inputText.trim()) {
      updateNodeData({ status: 'failed', error: '输入文本为空', segments: [] });
      setSegments([]);
      return;
    }

    try {
      const parsed = parseStoryboardScript(inputText);
      setSegments(parsed);

      // 自动扩展输出端口数量
      const newOutputCount = Math.min(MAX_OUTPUT_COUNT, Math.max(outputCount, parsed.length));
      if (newOutputCount !== outputCount) {
        setOutputCount(newOutputCount);
      }

      // 构建每个输出端口对应的数据
      const segmentPatch: Record<string, unknown> = {
        status: 'succeeded',
        segments: parsed,
        outputCount: newOutputCount,
        error: undefined
      };

      // 为每个 segment 创建对应的 promptX 字段
      parsed.forEach((seg, i) => {
        segmentPatch[`prompt${i + 1}`] = seg;
      });

      updateNodeData(segmentPatch);
    } catch (err) {
      updateNodeData({
        status: 'failed',
        error: err instanceof Error ? err.message : '解析失败',
        segments: []
      });
      setSegments([]);
    }
  }, [inputText, outputCount, updateNodeData]);

  // 更新输出端口数量
  const handleOutputCountChange = React.useCallback((value: number) => {
    const count = Math.min(MAX_OUTPUT_COUNT, Math.max(MIN_OUTPUT_COUNT, value));
    setOutputCount(count);
    updateNodeData({ outputCount: count });
  }, [updateNodeData]);

  const stopNodeDrag = React.useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
    const nativeEvent = (event as React.SyntheticEvent<unknown, Event>).nativeEvent as Event & { stopImmediatePropagation?: () => void };
    nativeEvent.stopImmediatePropagation?.();
  }, []);

  const getHandleTopPercent = React.useCallback((index: number) => {
    if (outputCount <= 1) return 50;
    return 10 + (index / (outputCount - 1)) * 80;
  }, [outputCount]);

  const boxW = data.boxW || 320;
  const boxH = data.boxH || 400;

  return (
    <div style={{
      width: boxW,
      minHeight: boxH,
      padding: 12,
      background: '#fff',
      border: `1px solid ${borderColor}`,
      borderRadius: 8,
      boxShadow,
      transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
      position: 'relative',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <NodeResizer
        isVisible
        minWidth={280}
        minHeight={300}
        color="transparent"
        lineStyle={{ display: 'none' }}
        handleStyle={{ background: 'transparent', border: 'none', width: 16, height: 16, opacity: 0, cursor: 'nwse-resize' }}
        onResize={(_, params) => {
          rf.setNodes(ns => ns.map(n => n.id === id
            ? { ...n, data: { ...n.data, boxW: params.width, boxH: params.height } }
            : n
          ));
        }}
      />

      {/* 标题栏 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontWeight: 600 }}>Storyboard Split</div>
        <button
          onClick={handleSplit}
          style={{
            fontSize: 12,
            padding: '4px 10px',
            background: '#111827',
            color: '#fff',
            borderRadius: 6,
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Split
        </button>
      </div>

      {/* 输出数量配置 */}
      <div className="nodrag nopan" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: '#6b7280' }}>输出端口</label>
        <input
          type="number"
          min={MIN_OUTPUT_COUNT}
          max={MAX_OUTPUT_COUNT}
          value={outputCount}
          onChange={(e) => handleOutputCountChange(Number(e.target.value))}
          onPointerDown={stopNodeDrag}
          onPointerDownCapture={stopNodeDrag}
          onMouseDown={stopNodeDrag}
          onMouseDownCapture={stopNodeDrag}
          onClick={stopNodeDrag}
          onClickCapture={stopNodeDrag}
          className="nodrag nopan"
          style={{
            width: 60,
            fontSize: 12,
            padding: '2px 6px',
            border: '1px solid #e5e7eb',
            borderRadius: 6
          }}
        />
        <span style={{ fontSize: 11, color: '#9ca3af' }}>(1-20)</span>
      </div>

      {/* 输入预览 */}
      <div style={{
        background: '#f9fafb',
        borderRadius: 6,
        padding: 8,
        marginBottom: 8,
        maxHeight: 100,
        overflow: 'auto',
      }}>
        <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>输入预览</div>
        <div style={{ fontSize: 12, color: '#374151', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {inputText ? inputText.substring(0, 200) + (inputText.length > 200 ? '...' : '') : '等待输入...'}
        </div>
      </div>

      {/* 状态显示 */}
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
        状态: {data.status === 'succeeded'
          ? `已拆分 ${segments.length} 个分镜`
          : data.status === 'failed'
            ? `失败`
            : 'idle'}
      </div>

      {/* 错误信息 */}
      {data.status === 'failed' && data.error && (
        <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 8 }}>{data.error}</div>
      )}

      {/* 拆分结果预览 */}
      {segments.length > 0 && (
        <div style={{
          flex: 1,
          minHeight: 80,
          maxHeight: 150,
          overflow: 'auto',
          fontSize: 11,
          color: '#374151',
          background: '#f0fdf4',
          borderRadius: 6,
          padding: 8,
        }}>
          {segments.slice(0, outputCount).map((seg, i) => (
            <div key={i} style={{
              marginBottom: 4,
              borderBottom: i < segments.length - 1 ? '1px dashed #d1d5db' : 'none',
              paddingBottom: 4
            }}>
              <strong style={{ color: '#059669' }}>#{i + 1}:</strong>{' '}
              {seg.substring(0, 60)}{seg.length > 60 ? '...' : ''}
            </div>
          ))}
          {segments.length > outputCount && (
            <div style={{ color: '#f59e0b', fontStyle: 'italic' }}>
              还有 {segments.length - outputCount} 个分镜未显示（请增加输出端口数量）
            </div>
          )}
        </div>
      )}

      {/* 输入端口 */}
      <Handle
        type="target"
        position={Position.Left}
        id="text"
        style={{ top: '50%', transform: 'translateY(-50%)' }}
        onMouseEnter={() => setHover('text-in')}
        onMouseLeave={() => setHover(null)}
      />

      {/* 动态输出端口 */}
      {Array.from({ length: outputCount }).map((_, i) => {
        const portId = `prompt${i + 1}`;
        const topPercent = getHandleTopPercent(i);
        return (
          <Handle
            key={portId}
            type="source"
            position={Position.Right}
            id={portId}
            style={{ top: `${topPercent}%`, transform: 'translateY(-50%)' }}
            onMouseEnter={() => setHover(`${portId}-out`)}
            onMouseLeave={() => setHover(null)}
          />
        );
      })}

      {/* 工具提示 */}
      {hover === 'text-in' && (
        <div className="flow-tooltip" style={{ left: -8, top: '50%', transform: 'translate(-100%, -50%)' }}>
          分镜脚本
        </div>
      )}
      {hover?.endsWith('-out') && (
        <div className="flow-tooltip" style={{
          right: -8,
          top: `${getHandleTopPercent(parseInt(hover.replace('prompt', '').replace('-out', '')) - 1)}%`,
          transform: 'translate(100%, -50%)'
        }}>
          分镜 #{hover.replace('prompt', '').replace('-out', '')}
        </div>
      )}
    </div>
  );
}
