import React from 'react';
import { Handle, Position, NodeResizer, useReactFlow, useStore, useUpdateNodeInternals, type ReactFlowState, type Edge } from 'reactflow';
import { useLocaleText } from '@/utils/localeText';
import { resolveTextFromSourceNode } from '../utils/textSource';
import {
  flowNodeControlField,
  flowNodeMutedWellBackground,
  flowNodeShellChrome,
  useFlowNodeDarkTheme,
} from './flowNodeDarkTheme';

type Props = {
  id: string;
  data: {
    status?: 'idle' | 'succeeded' | 'failed';
    inputText?: string;
    segments?: string[];
    outputCount?: number;
    splitFormat?: string;
    error?: string;
    boxW?: number;
    boxH?: number;
  };
  selected?: boolean;
};

const MAX_OUTPUT_COUNT = 50;

// 中文数字映射
const CHINESE_NUM_MAP: Record<string, number> = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
  '十一': 11, '十二': 12, '十三': 13, '十四': 14, '十五': 15,
  '十六': 16, '十七': 17, '十八': 18, '十九': 19, '二十': 20,
  '二十一': 21, '二十二': 22, '二十三': 23, '二十四': 24, '二十五': 25,
  '二十六': 26, '二十七': 27, '二十八': 28, '二十九': 29, '三十': 30,
  '三十一': 31, '三十二': 32, '三十三': 33, '三十四': 34, '三十五': 35,
  '三十六': 36, '三十七': 37, '三十八': 38, '三十九': 39, '四十': 40,
  '四十一': 41, '四十二': 42, '四十三': 43, '四十四': 44, '四十五': 45,
  '四十六': 46, '四十七': 47, '四十八': 48, '四十九': 49, '五十': 50,
};

/**
 * 分镜脚本解析器 - 支持自定义参考格式，默认按多种格式优先级匹配
 *
 * 自定义格式: 用户输入 "分镜1"、"镜头1"、"#1"、"|**1**|" 等样例时，按该样例中的编号位置识别后续编号
 * 优先级1: "分镜一"、"分镜二" 等中文数字格式
 * 优先级2: "分镜1"、"分镜2" 等阿拉伯数字格式
 * 优先级3: 大标题 "# 分镜" 或 "## 分镜" 后跟数字
 * 优先级4: Markdown 表格格式 |**1**| 或 | **1** |
 */
function parseStoryboardScript(text: string, splitFormat?: string): string[] {
  if (!text || !text.trim()) return [];

  const customFormat = splitFormat?.trim();
  if (customFormat) {
    return parseStoryboardScriptByFormat(text, customFormat);
  }

  // 优先级1: 分镜+中文数字（分镜一、分镜二...分镜五十）
  const chineseNumPattern = /分镜(一|二|三|四|五|六|七|八|九|十|十一|十二|十三|十四|十五|十六|十七|十八|十九|二十|二十一|二十二|二十三|二十四|二十五|二十六|二十七|二十八|二十九|三十|三十一|三十二|三十三|三十四|三十五|三十六|三十七|三十八|三十九|四十|四十一|四十二|四十三|四十四|四十五|四十六|四十七|四十八|四十九|五十)/g;
  const chineseMatches = [...text.matchAll(chineseNumPattern)];
  if (chineseMatches.length >= 2) {
    // 按中文数字排序
    const sorted = chineseMatches.sort((a, b) => {
      const numA = CHINESE_NUM_MAP[a[1]] || 0;
      const numB = CHINESE_NUM_MAP[b[1]] || 0;
      return (a.index! + numA * 0.001) - (b.index! + numB * 0.001);
    });
    return extractSegmentsByMatches(text, sorted);
  }

  // 优先级2: 分镜+阿拉伯数字（分镜1、分镜2...）
  const arabicPattern = /分镜\s*(\d{1,2})/g;
  const arabicMatches = [...text.matchAll(arabicPattern)];
  if (arabicMatches.length >= 2) {
    return extractSegmentsByMatches(text, arabicMatches);
  }

  // 优先级3: Markdown 标题格式（# 分镜1、## 分镜 2、### 分镜一）
  const headingPattern = /^#{1,6}\s*分镜\s*(\d{1,2}|一|二|三|四|五|六|七|八|九|十|十一|十二|十三|十四|十五|十六|十七|十八|十九|二十|二十一|二十二|二十三|二十四|二十五|二十六|二十七|二十八|二十九|三十|三十一|三十二|三十三|三十四|三十五|三十六|三十七|三十八|三十九|四十|四十一|四十二|四十三|四十四|四十五|四十六|四十七|四十八|四十九|五十)/gm;
  const headingMatches = [...text.matchAll(headingPattern)];
  if (headingMatches.length >= 2) {
    return extractSegmentsByMatches(text, headingMatches);
  }

  // 优先级4: Markdown 表格格式 |**XX**| 或 | **XX** |（支持1-99，含或不含空格）
  const mdPattern = /\|\s?\*\*(\d{1,2})\*\*\s?\|/g;
  const mdMatches = [...text.matchAll(mdPattern)];
  if (mdMatches.length >= 2) {
    return extractSegmentsByMatches(text, mdMatches);
  }

  // 优先级5: 纯数字编号格式（行首 "1."、"2." 等）
  const numberedPattern = /^(\d{1,2})\.\s/gm;
  const numberedMatches = [...text.matchAll(numberedPattern)];
  if (numberedMatches.length >= 2) {
    return extractSegmentsByMatches(text, numberedMatches);
  }

  return []; // 没找到任何分镜格式，返回空
}

const CHINESE_NUM_WORDS = Object.keys(CHINESE_NUM_MAP).sort((a, b) => b.length - a.length);
const CHINESE_NUM_TOKEN_PATTERN = CHINESE_NUM_WORDS.map((word) => escapeRegExp(word)).join('|');

function parseStoryboardScriptByFormat(text: string, splitFormat: string): string[] {
  const pattern = buildCustomSplitPattern(splitFormat);
  if (!pattern) return [];
  const matches = [...text.matchAll(pattern)];
  if (matches.length === 0) return [];
  return extractSegmentsByMatches(text, matches);
}

function buildCustomSplitPattern(splitFormat: string): RegExp | null {
  const normalized = splitFormat.trim().replace(/｜/g, '|');
  if (!normalized) return null;

  const compact = normalized.replace(/\s+/g, '');
  if (/^\|\*\*\d+\*\*\|$/.test(compact)) {
    return /[|｜]\s*\*\*\s*\d{1,3}\s*\*\*\s*[|｜]/g;
  }

  if (/^#+\d+$/.test(compact)) {
    return /^#{1,6}\s*\d{1,3}\b/gm;
  }

  const tokenPattern = new RegExp(`\\d+|${CHINESE_NUM_TOKEN_PATTERN}`);
  const tokenMatch = normalized.match(tokenPattern);

  if (!tokenMatch || tokenMatch.index === undefined) {
    const literal = formatLiteralToRegex(normalized);
    return literal ? new RegExp(literal, 'g') : null;
  }

  const token = tokenMatch[0];
  const tokenRegex = /^\d+$/.test(token) ? '\\d{1,3}' : `(?:${CHINESE_NUM_TOKEN_PATTERN})`;
  const prefix = normalized.slice(0, tokenMatch.index);
  const suffix = normalized.slice(tokenMatch.index + token.length);
  const prefixPattern = formatLiteralToRegex(prefix);
  const suffixPattern = formatLiteralToRegex(suffix);

  if (!prefixPattern && !suffixPattern) {
    return new RegExp(`^\\s*${tokenRegex}\\s*$`, 'gm');
  }

  const leadingBoundary = prefixPattern ? '' : '^\\s*';
  return new RegExp(`${leadingBoundary}${prefixPattern}\\s*${tokenRegex}\\s*${suffixPattern}`, prefixPattern ? 'g' : 'gm');
}

function formatLiteralToRegex(value: string): string {
  return escapeRegExp(value)
    .replace(/\\\|/g, '[|｜]')
    .replace(/\s+/g, '\\s*');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function countSegmentsForOutputs(value: unknown): number {
  return Array.isArray(value) ? Math.min(MAX_OUTPUT_COUNT, value.length) : 0;
}

function clearPromptOutputPatch(patch: Record<string, unknown>): void {
  for (let i = 0; i < MAX_OUTPUT_COUNT; i++) {
    patch[`prompt${i + 1}`] = undefined;
  }
}

function getPromptHandleIndex(handleId?: string | null): number | null {
  if (typeof handleId !== 'string') return null;
  const match = /^prompt(\d+)$/.exec(handleId);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  return Number.isFinite(index) && index >= 0 ? index : null;
}

function StoryboardSplitNodeInner({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const isFlowDark = useFlowNodeDarkTheme();
  const rf = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const edges = useStore((state: ReactFlowState) => state.edges);
  const edgesRef = React.useRef<Edge[]>(edges);
  const isComposingSplitFormatRef = React.useRef(false);
  const committedSplitFormatRef = React.useRef(data.splitFormat || '');

  const [inputText, setInputText] = React.useState<string>(data.inputText || '');
  const [segments, setSegments] = React.useState<string[]>(data.segments || []);
  const [outputCount, setOutputCount] = React.useState<number>(
    countSegmentsForOutputs(data.segments)
  );
  const [splitFormat, setSplitFormat] = React.useState<string>(data.splitFormat || '');
  const [hover, setHover] = React.useState<string | null>(null);

  const shell = flowNodeShellChrome(isFlowDark, !!selected);
  const controlField = flowNodeControlField(isFlowDark);
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
  }, [data.inputText, inputText]);

  React.useEffect(() => {
    if (data.segments && JSON.stringify(data.segments) !== JSON.stringify(segments)) {
      setSegments(data.segments);
      setOutputCount(countSegmentsForOutputs(data.segments));
    }
  }, [data.segments, segments]);

  React.useEffect(() => {
    if (data.segments === undefined) {
      setSegments([]);
      setOutputCount(0);
    }
  }, [data.segments]);

  React.useEffect(() => {
    if (data.splitFormat === undefined || data.splitFormat === committedSplitFormatRef.current) return;
    committedSplitFormatRef.current = data.splitFormat;
    if (!isComposingSplitFormatRef.current) {
      setSplitFormat(data.splitFormat);
    }
  }, [data.splitFormat]);

  // 更新节点数据
  const updateNodeData = React.useCallback((patch: Record<string, unknown>) => {
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch }
    }));
  }, [id]);

  const commitSplitFormat = React.useCallback((value: string) => {
    if (value === committedSplitFormatRef.current) return;
    committedSplitFormatRef.current = value;
    updateNodeData({ splitFormat: value });
  }, [updateNodeData]);

  const pruneOutgoingPromptEdges = React.useCallback((nextOutputCount: number) => {
    rf.setEdges((currentEdges) =>
      currentEdges.filter((edge) => {
        if (edge.source !== id) return true;
        const handleIndex = getPromptHandleIndex(edge.sourceHandle);
        return handleIndex === null || handleIndex < nextOutputCount;
      })
    );
  }, [rf, id]);

  // 处理输入文本
  const applyIncomingText = React.useCallback((text: string) => {
    setInputText(text);
    updateNodeData({ inputText: text });
  }, [updateNodeData]);

  // 从源节点同步文本
  const syncFromSource = React.useCallback((
    sourceId: string,
    sourceHandle?: string | null,
    optimisticPatch?: Record<string, unknown>
  ) => {
    const srcNode = rf.getNode(sourceId);
    if (!srcNode) return;
    const sourceForRead = optimisticPatch
      ? { ...srcNode, data: { ...(srcNode.data as Record<string, unknown>), ...optimisticPatch } }
      : srcNode;
    const text = resolveTextFromSourceNode(sourceForRead, sourceHandle) || '';
    if (text !== inputText) {
      applyIncomingText(text);
    }
  }, [rf, applyIncomingText, inputText]);

  // 监听上游节点连接变化
  React.useEffect(() => {
    const incoming = edges.find((e) => e.target === id && e.targetHandle === 'text');
    if (incoming?.source) {
      syncFromSource(incoming.source, incoming.sourceHandle);
    }
  }, [edges, id, syncFromSource]);

  // 监听上游数据更新事件
  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; patch: Record<string, unknown> }>).detail;
      if (!detail?.id || detail.id === id) return;

      const incoming = edgesRef.current.find((e) => e.target === id && e.targetHandle === 'text');
      if (!incoming || incoming.source !== detail.id) return;

      syncFromSource(detail.id, incoming.sourceHandle, detail.patch || {});
    };

    window.addEventListener('flow:updateNodeData', handler as EventListener);
    return () => window.removeEventListener('flow:updateNodeData', handler as EventListener);
  }, [id, applyIncomingText, syncFromSource]);

  // 执行拆分
  const handleSplit = React.useCallback(() => {
    if (!inputText.trim()) {
      const patch: Record<string, unknown> = {
        status: 'failed',
        error: lt('输入文本为空', 'Input text is empty'),
        segments: [],
        outputCount: 0,
      };
      clearPromptOutputPatch(patch);
      updateNodeData(patch);
      setSegments([]);
      setOutputCount(0);
      pruneOutgoingPromptEdges(0);
      return;
    }

    try {
      commitSplitFormat(splitFormat);
      const parsed = parseStoryboardScript(inputText, splitFormat).slice(0, MAX_OUTPUT_COUNT);
      setSegments(parsed);
      setOutputCount(parsed.length);

      const segmentPatch: Record<string, unknown> = {
        status: 'succeeded',
        segments: parsed,
        outputCount: parsed.length,
        error: undefined
      };

      clearPromptOutputPatch(segmentPatch);

      // 为每个 segment 创建对应的 promptX 字段
      parsed.forEach((seg, i) => {
        segmentPatch[`prompt${i + 1}`] = seg;
      });

      updateNodeData(segmentPatch);
      pruneOutgoingPromptEdges(parsed.length);
    } catch (err) {
      const patch: Record<string, unknown> = {
        status: 'failed',
        error: err instanceof Error ? err.message : lt('解析失败', 'Parse failed'),
        segments: [],
        outputCount: 0,
      };
      clearPromptOutputPatch(patch);
      updateNodeData(patch);
      setSegments([]);
      setOutputCount(0);
      pruneOutgoingPromptEdges(0);
    }
  }, [inputText, splitFormat, commitSplitFormat, updateNodeData, pruneOutgoingPromptEdges, lt]);

  const handleSplitFormatChange = React.useCallback((value: string) => {
    setSplitFormat(value);
  }, []);

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

  // 当输出端口数量变化时，强制 React Flow 重新计算句柄位置，确保连线与句柄对齐
  React.useEffect(() => {
    updateNodeInternals(id);
  }, [id, outputCount, boxW, boxH, updateNodeInternals]);

  // 一键生成 Prompt 节点并连接
  const handleGeneratePromptNodes = React.useCallback(() => {
    if (segments.length === 0 || outputCount === 0) return;

    const currentNode = rf.getNode(id);
    if (!currentNode) return;

    const nodeX = currentNode.position.x;
    const nodeY = currentNode.position.y;
    const nodeWidth = boxW;
    const promptNodeWidth = 280;
    const promptNodeHeight = 200;
    const gapX = 100; // 水平间距
    const gapY = 20;  // 垂直间距

    const startX = nodeX + nodeWidth + gapX;
    const count = Math.min(segments.length, outputCount);

    // 计算总高度，使 Prompt 节点垂直居中对齐
    const totalHeight = count * promptNodeHeight + (count - 1) * gapY;
    const startY = nodeY + (boxH - totalHeight) / 2;

    const newNodes: Array<{
      id: string;
      type: string;
      position: { x: number; y: number };
      data: { text: string; title: string; boxW: number; boxH: number };
    }> = [];

    const newEdges: Array<{
      id: string;
      source: string;
      sourceHandle: string;
      target: string;
      targetHandle: string;
    }> = [];

    for (let i = 0; i < count; i++) {
      const promptNodeId = `prompt-${id}-${i + 1}-${Date.now()}`;
      const y = startY + i * (promptNodeHeight + gapY);

      newNodes.push({
        id: promptNodeId,
        type: 'textPrompt',
        position: { x: startX, y },
        data: {
          text: segments[i] || '',
          title: lt(`分镜 ${i + 1}`, `Storyboard ${i + 1}`),
          boxW: promptNodeWidth,
          boxH: promptNodeHeight,
        },
      });

      newEdges.push({
        id: `edge-${id}-${promptNodeId}`,
        source: id,
        sourceHandle: `prompt${i + 1}`,
        target: promptNodeId,
        targetHandle: 'text',
      });
    }

    // 批量添加节点和边
    rf.setNodes((nodes) => [...nodes, ...newNodes]);
    rf.setEdges((edges) => [...edges, ...newEdges]);
  }, [rf, id, segments, outputCount, boxW, boxH, lt]);

  return (
    <div style={{
      width: boxW,
      minHeight: boxH,
      padding: 12,
      background: shell.background,
      border: `1px solid ${shell.borderColor}`,
      color: shell.color,
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
        handleStyle={{ background: 'transparent', border: 'none', width: 16, height: 16, opacity: 0 }}
        onResize={(_, params) => {
          rf.setNodes(ns => ns.map(n => n.id === id
            ? { ...n, data: { ...n.data, boxW: params.width, boxH: params.height } }
            : n
          ));
        }}
      />

      {/* 标题栏 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontWeight: 600, color: shell.color }}>Split</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={handleGeneratePromptNodes}
            disabled={segments.length === 0}
            style={{
              fontSize: 12,
              padding: '4px 10px',
              background: segments.length > 0 ? '#059669' : (isFlowDark ? '#3f3f46' : '#9ca3af'),
              color: '#fff',
              borderRadius: 6,
              border: 'none',
              cursor: segments.length > 0 ? 'pointer' : 'not-allowed',
              opacity: segments.length > 0 ? 1 : 0.6,
            }}
            title={lt("一键生成 Prompt 节点并连接", "Generate Prompt nodes and connect in one click")}
          >
            {lt("生成节点", "Generate nodes")}
          </button>
          <button
            onClick={handleSplit}
            style={{
              fontSize: 12,
              padding: '4px 10px',
              background: isFlowDark ? '#2563eb' : '#111827',
              color: '#fff',
              borderRadius: 6,
              border: isFlowDark ? '1px solid rgba(96,165,250,0.7)' : 'none',
              cursor: 'pointer',
            }}
          >
            Split
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: isFlowDark ? '#9ca3af' : '#6b7280' }}>{lt('输出端口', 'Output ports')}</span>
        <span style={{ fontSize: 12, color: shell.color }}>{outputCount}</span>
        <span style={{ fontSize: 11, color: isFlowDark ? '#6b7280' : '#9ca3af' }}>{lt('(自动，最多50)', '(auto, max 50)')}</span>
      </div>

      <div className="nodrag nopan" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: isFlowDark ? '#9ca3af' : '#6b7280', flex: '0 0 auto' }}>{lt('参考格式', 'Format')}</label>
        <input
          type="text"
          value={splitFormat}
          onChange={(e) => handleSplitFormatChange(e.target.value)}
          onCompositionStart={() => {
            isComposingSplitFormatRef.current = true;
          }}
          onCompositionEnd={(e) => {
            isComposingSplitFormatRef.current = false;
            const value = e.currentTarget.value;
            setSplitFormat(value);
            commitSplitFormat(value);
          }}
          onBlur={(e) => commitSplitFormat(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !isComposingSplitFormatRef.current && !(e.nativeEvent as KeyboardEvent).isComposing) {
              commitSplitFormat(e.currentTarget.value);
              e.currentTarget.blur();
            }
          }}
          placeholder={lt('分镜1 / #1 / |**1**|', 'Scene1 / #1 / |**1**|')}
          onPointerDown={stopNodeDrag}
          onPointerDownCapture={stopNodeDrag}
          onMouseDown={stopNodeDrag}
          onMouseDownCapture={stopNodeDrag}
          onClick={stopNodeDrag}
          onClickCapture={stopNodeDrag}
          className="nodrag nopan"
          style={{
            minWidth: 0,
            flex: 1,
            fontSize: 12,
            padding: '3px 6px',
            borderRadius: 6,
            ...controlField,
          }}
        />
      </div>

      {/* 输入预览 */}
      <div style={{
        background: flowNodeMutedWellBackground(isFlowDark),
        border: `1px solid ${isFlowDark ? '#333333' : '#eef0f2'}`,
        borderRadius: 6,
        padding: 8,
        marginBottom: 8,
        maxHeight: 100,
        overflow: 'auto',
      }}>
        <div style={{ fontSize: 11, color: isFlowDark ? '#9ca3af' : '#6b7280', marginBottom: 4 }}>{lt('输入预览', 'Input preview')}</div>
        <div style={{ fontSize: 12, color: isFlowDark ? '#d1d5db' : '#374151', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {inputText ? inputText.substring(0, 200) + (inputText.length > 200 ? '...' : '') : lt('等待输入...', 'Waiting for input...')}
        </div>
      </div>

      {/* 状态显示 */}
      <div style={{ fontSize: 12, color: isFlowDark ? '#9ca3af' : '#6b7280', marginBottom: 8 }}>
        {lt('状态', 'Status')}: {data.status === 'succeeded'
          ? lt(`已拆分 ${segments.length} 个分镜`, `Split into ${segments.length} storyboards`)
          : data.status === 'failed'
            ? lt(`失败`, `Failed`)
            : 'idle'}
      </div>

      {/* 错误信息 */}
      {data.status === 'failed' && data.error && (
        <div style={{
          fontSize: 12,
          color: '#ef4444',
          marginBottom: 8,
          padding: '6px 8px',
          borderRadius: 6,
          border: `1px solid ${isFlowDark ? 'rgba(239,68,68,0.35)' : '#fecaca'}`,
          background: isFlowDark ? 'rgba(127,29,29,0.22)' : '#fef2f2',
        }}>{data.error}</div>
      )}

      {/* 拆分结果预览 */}
      {segments.length > 0 && (
        <div style={{
          flex: 1,
          minHeight: 80,
          maxHeight: 150,
          overflow: 'auto',
          fontSize: 11,
          color: isFlowDark ? '#d1d5db' : '#374151',
          background: isFlowDark ? 'rgba(16,185,129,0.1)' : '#f0fdf4',
          border: `1px solid ${isFlowDark ? 'rgba(16,185,129,0.28)' : '#d1fae5'}`,
          borderRadius: 6,
          padding: 8,
        }}>
          {segments.slice(0, outputCount).map((seg, i) => (
            <div key={i} style={{
              marginBottom: 4,
              borderBottom: i < segments.length - 1 ? `1px dashed ${isFlowDark ? '#3f3f46' : '#d1d5db'}` : 'none',
              paddingBottom: 4
            }}>
              <strong style={{ color: isFlowDark ? '#34d399' : '#059669' }}>#{i + 1}:</strong>{' '}
              {seg.substring(0, 60)}{seg.length > 60 ? '...' : ''}
            </div>
          ))}
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

export default React.memo(StoryboardSplitNodeInner);
