import React from 'react';
import {
  Handle,
  Position,
  useReactFlow,
  useStore,
  type ReactFlowState,
} from '@xyflow/react';
import { fetchWithAuth } from '@/services/authFetch';
import { useCanvasStore } from '@/stores';
import { useLocaleText } from '@/utils/localeText';
import RunCreditBadge from './RunCreditBadge';
import {
  flowNodeControlField,
  flowNodeMutedWellBackground,
  flowNodeShellChrome,
  useFlowNodeDarkTheme,
} from './flowNodeDarkTheme';
import { useImeSafeTextValue } from '../hooks/useImeSafeTextInput';
import {
  DEFAULT_VIDEO_STORYBOARD_PROMPT,
  parseStoryboardAnalysis,
} from '../storyboardPromptTable';

type VideoAnalyzeModel =
  | 'doubao-seed-2-0-mini-260428'
  | 'doubao-seed-2-0-lite-260428'
  | 'doubao-seed-2-0-pro-260215'
  | 'gemini-2.5-flash'
  | 'gemini-3.5-flash'
  | 'gemini-3.1-pro';

type Props = {
  id: string;
  data: {
    status?: 'idle' | 'running' | 'succeeded' | 'failed';
    videoUrl?: string;
    prompt?: string;
    error?: string;
    analysisPrompt?: string;
    analysisModel?: VideoAnalyzeModel | string;
    text?: string;
    creditsPerCall?: number;
    storyboardPromptNodeId?: string;
    storyboardRowCount?: number;
    storyboardColumnCount?: number;
    analysisMode?: string;
  };
  selected?: boolean;
};

const DEFAULT_VIDEO_ANALYZE_MODEL: VideoAnalyzeModel =
  'doubao-seed-2-0-lite-260428';

const VIDEO_ANALYZE_MODELS: Array<{
  value: VideoAnalyzeModel;
  label: string;
  descriptionZh: string;
  descriptionEn: string;
}> = [
  {
    value: 'doubao-seed-2-0-lite-260428',
    label: '豆包 Seed 2.0 Lite',
    descriptionZh: '推荐 · 速度与细节均衡',
    descriptionEn: 'Recommended · balanced speed and detail',
  },
  {
    value: 'doubao-seed-2-0-pro-260215',
    label: '豆包 Seed 2.0 Pro',
    descriptionZh: '高精度复杂镜头分析',
    descriptionEn: 'High-precision complex shot analysis',
  },
  {
    value: 'doubao-seed-2-0-mini-260428',
    label: '豆包 Seed 2.0 Mini',
    descriptionZh: '快速分析',
    descriptionEn: 'Fast analysis',
  },
  {
    value: 'gemini-3.5-flash',
    label: 'Gemini 3.5 Flash',
    descriptionZh: 'Gemini 均衡模型',
    descriptionEn: 'Balanced Gemini model',
  },
  {
    value: 'gemini-3.1-pro',
    label: 'Gemini 3.1 Pro',
    descriptionZh: 'Gemini 高精度模型',
    descriptionEn: 'High-precision Gemini model',
  },
  {
    value: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    descriptionZh: 'Gemini 快速模型',
    descriptionEn: 'Fast Gemini model',
  },
];

const LEGACY_VIDEO_ANALYSIS_PROMPTS = new Set([
  '分析这个视频，描述场景、动作和关键信息。',
  'Analyze this video and describe the scenes, actions, and key information.',
  '分析这个视频的内容，描述视频中的场景、动作和关键信息。',
]);

const shouldPassWheelToCanvas = (
  event: { ctrlKey: boolean; metaKey: boolean },
) => {
  const store = useCanvasStore.getState();
  const isModifierWheel = event.ctrlKey || event.metaKey;
  return store.wheelZoomMode === 'direct' ? !isModifierWheel : isModifierWheel;
};

function VideoAnalyzeNodeInner({ id, data, selected = false }: Props) {
  const { lt } = useLocaleText();
  const isFlowDark = useFlowNodeDarkTheme();
  const rf = useReactFlow();
  const { status, error } = data;
  const hasRunCredits =
    typeof data.creditsPerCall === 'number' && data.creditsPerCall > 0;
  const [hover, setHover] = React.useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = React.useState(false);

  const connectedVideoUrl = useStore(
    React.useCallback(
      (state: ReactFlowState) => {
        const edge = state.edges.find(
          (candidate) => candidate.target === id && candidate.targetHandle === 'video',
        );
        if (!edge) return undefined;
        const sourceNode = state.nodes.find((node) => node.id === edge.source);
        const videoUrl = sourceNode?.data?.videoUrl;
        return typeof videoUrl === 'string' ? videoUrl : undefined;
      },
      [id],
    ),
  );
  const hasVideoConnection = useStore(
    React.useCallback(
      (state: ReactFlowState) => state.edges.some(
        (edge) => edge.target === id && edge.targetHandle === 'video',
      ),
      [id],
    ),
  );
  const effectiveVideoUrl = connectedVideoUrl || data.videoUrl;

  const updateNodeData = React.useCallback((patch: Record<string, unknown>) => {
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch },
    }));
  }, [id]);

  const selectedModel = VIDEO_ANALYZE_MODELS.some(
    (option) => option.value === data.analysisModel,
  )
    ? data.analysisModel as VideoAnalyzeModel
    : DEFAULT_VIDEO_ANALYZE_MODEL;
  const selectedModelOption =
    VIDEO_ANALYZE_MODELS.find((option) => option.value === selectedModel) ||
    VIDEO_ANALYZE_MODELS[0];

  React.useEffect(() => {
    if (data.analysisModel === selectedModel) return;
    updateNodeData({ analysisModel: selectedModel });
  }, [data.analysisModel, selectedModel, updateNodeData]);

  const storedAnalysisPrompt =
    typeof data.analysisPrompt === 'string' ? data.analysisPrompt : '';
  const shouldUseStoryboardDefault =
    !storedAnalysisPrompt.trim() ||
    LEGACY_VIDEO_ANALYSIS_PROMPTS.has(storedAnalysisPrompt.trim());
  const promptInput = shouldUseStoryboardDefault
    ? DEFAULT_VIDEO_STORYBOARD_PROMPT
    : storedAnalysisPrompt;

  React.useEffect(() => {
    if (
      shouldUseStoryboardDefault &&
      data.analysisPrompt !== DEFAULT_VIDEO_STORYBOARD_PROMPT
    ) {
      updateNodeData({ analysisPrompt: DEFAULT_VIDEO_STORYBOARD_PROMPT });
    }
  }, [
    data.analysisPrompt,
    shouldUseStoryboardDefault,
    updateNodeData,
  ]);

  const commitAnalysisPrompt = React.useCallback((value: string) => {
    updateNodeData({ analysisPrompt: value });
  }, [updateNodeData]);
  const analysisPromptInput = useImeSafeTextValue(
    promptInput,
    commitAnalysisPrompt,
  );
  const analysisPromptDraft = analysisPromptInput.value;

  const upsertStoryboardPromptNode = React.useCallback((analysisText: string) => {
    const storyboardTable = parseStoryboardAnalysis(analysisText);
    const storedOutputId =
      typeof data.storyboardPromptNodeId === 'string' &&
      data.storyboardPromptNodeId.trim()
        ? data.storyboardPromptNodeId.trim()
        : '';
    const deterministicOutputId = `storyboard-prompt-${id}`;
    const currentEdges = rf.getEdges();
    const linkedOutputId = currentEdges.find((edge) => (
      edge.source === id &&
      edge.sourceHandle === 'text' &&
      edge.targetHandle === 'text' &&
      rf.getNode(edge.target)?.data?.variant === 'storyboard-table'
    ))?.target;
    const storedNode = storedOutputId ? rf.getNode(storedOutputId) : undefined;
    const storedNodeBelongsToThisAnalyzer = currentEdges.some((edge) => (
      edge.source === id &&
      edge.sourceHandle === 'text' &&
      edge.target === storedOutputId &&
      edge.targetHandle === 'text'
    ));
    const canReuseStoredOutputId =
      Boolean(storedOutputId) &&
      (
        !storedNode ||
        storedNodeBelongsToThisAnalyzer ||
        storedOutputId === deterministicOutputId
      );
    const outputNodeId =
      linkedOutputId ||
      (canReuseStoredOutputId ? storedOutputId : deterministicOutputId);
    const sourceNode = rf.getNode(id);
    const existingNode = rf.getNode(outputNodeId);
    const sourceWidth =
      sourceNode?.measured?.width ||
      (typeof sourceNode?.data?.boxW === 'number' ? sourceNode.data.boxW : 320);
    const position = existingNode?.position || {
      x: (sourceNode?.position.x || 0) + sourceWidth + 80,
      y: sourceNode?.position.y || 0,
    };
    const existingData =
      existingNode?.data && typeof existingNode.data === 'object'
        ? existingNode.data
        : {};
    const nextData = {
      ...existingData,
      text: analysisText,
      mentions: [],
      title:
        typeof existingData.title === 'string' && existingData.title.trim()
          ? existingData.title
          : lt('分镜表', 'Storyboard Table'),
      variant: 'storyboard-table' as const,
      storyboardTable,
      storyboardSourceText: analysisText,
      storyboardViewMode: 'table' as const,
      boxW:
        typeof existingData.boxW === 'number' && existingData.boxW > 0
          ? existingData.boxW
          : 920,
      boxH:
        typeof existingData.boxH === 'number' && existingData.boxH > 0
          ? existingData.boxH
          : 520,
    };

    rf.setNodes((nodes) => {
      const exists = nodes.some((node) => node.id === outputNodeId);
      if (exists) {
        return nodes.map((node) => (
          node.id === outputNodeId
            ? {
                ...node,
                type: 'textPrompt',
                data: nextData,
              }
            : node
        ));
      }
      return [
        ...nodes,
        {
          id: outputNodeId,
          type: 'textPrompt',
          position,
          data: nextData,
          ...(sourceNode?.parentId ? { parentId: sourceNode.parentId } : {}),
        },
      ];
    });

    rf.setEdges((edges) => {
      const exists = edges.some(
        (edge) =>
          edge.source === id &&
          edge.sourceHandle === 'text' &&
          edge.target === outputNodeId &&
          edge.targetHandle === 'text',
      );
      if (exists) return edges;
      return [
        ...edges,
        {
          id: `edge-${id}-${outputNodeId}`,
          source: id,
          sourceHandle: 'text',
          target: outputNodeId,
          targetHandle: 'text',
        },
      ];
    });

    return {
      outputNodeId,
      rowCount: storyboardTable.rows.length,
      columnCount: storyboardTable.columns.length,
    };
  }, [data.storyboardPromptNodeId, id, lt, rf]);

  const onAnalyze = React.useCallback(async () => {
    if (!effectiveVideoUrl) {
      updateNodeData({
        status: 'failed',
        error: lt(
          '没有可分析的视频输入，请先连接视频节点',
          'No video input to analyze. Please connect a video node first',
        ),
      });
      return;
    }
    if (status === 'running' || isAnalyzing) return;

    const promptToUse = analysisPromptDraft.trim();
    if (!promptToUse) {
      updateNodeData({
        status: 'failed',
        error: lt('提示词不能为空', 'Prompt cannot be empty'),
      });
      return;
    }

    updateNodeData({
      status: 'running',
      error: undefined,
    });

    try {
      setIsAnalyzing(true);
      const apiBase =
        import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '') ||
        'http://localhost:4000';
      const response = await fetchWithAuth(`${apiBase}/api/ai/analyze-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptToUse,
          videoUrl: effectiveVideoUrl,
          model: selectedModel,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const message = Array.isArray(errorData.message)
          ? errorData.message.join('; ')
          : errorData.message;
        throw new Error(message || `HTTP ${response.status}`);
      }

      const result = await response.json();
      const analysisText = String(
        result.analysis || result.text || result.data?.analysis || '',
      ).trim();
      if (!analysisText) {
        throw new Error(lt(
          '模型没有返回可解析的分析结果',
          'The model returned no parseable analysis result',
        ));
      }

      updateNodeData({
        status: 'succeeded',
        error: undefined,
        prompt: analysisText,
        text: analysisText,
        analysisModel: selectedModel,
        analysisMode: result.analysisMode,
      });
      const output = upsertStoryboardPromptNode(analysisText);
      updateNodeData({
        storyboardPromptNodeId: output.outputNodeId,
        storyboardRowCount: output.rowCount,
        storyboardColumnCount: output.columnCount,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      updateNodeData({
        status: 'failed',
        error: message,
      });
    } finally {
      setIsAnalyzing(false);
    }
  }, [
    analysisPromptDraft,
    effectiveVideoUrl,
    isAnalyzing,
    lt,
    selectedModel,
    status,
    updateNodeData,
    upsertStoryboardPromptNode,
  ]);

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (
        event as CustomEvent<{ id?: string; done?: (result?: boolean) => void }>
      ).detail;
      if (!detail || detail.id !== id) return;
      void onAnalyze()
        .then(() => detail.done?.(true))
        .catch(() => detail.done?.(false));
    };
    window.addEventListener('flow:run-node', handler as EventListener);
    return () => window.removeEventListener(
      'flow:run-node',
      handler as EventListener,
    );
  }, [id, onAnalyze]);

  const locateStoryboardPrompt = React.useCallback(() => {
    const outputNodeId = data.storyboardPromptNodeId;
    if (!outputNodeId || !rf.getNode(outputNodeId)) return;
    void rf.fitView({
      nodes: [{ id: outputNodeId }],
      padding: 0.18,
      duration: 450,
      maxZoom: 1,
    });
  }, [data.storyboardPromptNodeId, rf]);

  const canRun =
    Boolean(effectiveVideoUrl) && status !== 'running' && !isAnalyzing;
  const shell = flowNodeShellChrome(isFlowDark, Boolean(selected));
  const controlField = flowNodeControlField(isFlowDark);
  const boxShadow = selected
    ? '0 0 0 2px rgba(37,99,235,0.12)'
    : '0 1px 2px rgba(0,0,0,0.04)';

  return (
    <div
      style={{
        width: 320,
        padding: 8,
        background: shell.background,
        color: shell.color,
        border: `1px solid ${shell.borderColor}`,
        borderRadius: 8,
        boxShadow,
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 7,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div style={{ fontWeight: 600, color: shell.color }}>
          {lt('视频分析', 'Video Analysis')}
        </div>
        <button
          className="tanva-video-analyze-run-btn run-btn-with-credit"
          onClick={onAnalyze}
          disabled={!canRun}
          style={{ cursor: canRun ? 'pointer' : 'not-allowed' }}
        >
          {status === 'running' || isAnalyzing ? (
            <span className="run-text-trigger">
              {lt('分析中...', 'Analyzing...')}
            </span>
          ) : (
            <>
              <span className="run-text-trigger">{lt('分析', 'Analyze')}</span>
              {hasRunCredits ? (
                <RunCreditBadge credits={data.creditsPerCall} runButton />
              ) : null}
            </>
          )}
        </button>
      </div>

      <div
        style={{
          width: '100%',
          height: 116,
          background: '#000',
          borderRadius: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          border: `1px solid ${isFlowDark ? '#333333' : '#eef0f2'}`,
        }}
      >
        {effectiveVideoUrl ? (
          <video
            src={effectiveVideoUrl}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            controls
            preload="metadata"
          />
        ) : (
          <span style={{ fontSize: 12, color: '#9ca3af' }}>
            {hasVideoConnection
              ? lt('等待视频输入', 'Waiting for video input')
              : lt('请连接视频节点', 'Please connect a video node')}
          </span>
        )}
      </div>

      <label style={{ display: 'block' }}>
        <span
          style={{
            display: 'block',
            fontSize: 11,
            fontWeight: 600,
            marginBottom: 4,
            color: shell.color,
          }}
        >
          {lt('分析模型', 'Analysis model')}
        </span>
        <select
          className="nodrag nopan"
          value={selectedModel}
          disabled={status === 'running' || isAnalyzing}
          onChange={(event) => {
            updateNodeData({
              analysisModel: event.target.value as VideoAnalyzeModel,
            });
          }}
          onPointerDownCapture={(event) => event.stopPropagation()}
          style={{
            width: '100%',
            height: 32,
            borderRadius: 6,
            padding: '0 8px',
            fontFamily: 'inherit',
            fontSize: 12,
            ...controlField,
          }}
        >
          {VIDEO_ANALYZE_MODELS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span
          style={{
            display: 'block',
            marginTop: 3,
            fontSize: 10,
            color: isFlowDark ? '#a3a3a3' : '#64748b',
          }}
        >
          {lt(
            selectedModelOption.descriptionZh,
            selectedModelOption.descriptionEn,
          )}
        </span>
      </label>

      <div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            marginBottom: 4,
            color: shell.color,
          }}
        >
          {lt('分镜分析提示词', 'Storyboard analysis prompt')}
        </div>
        <textarea
          className="nodrag nopan nowheel"
          value={analysisPromptInput.value}
          onChange={analysisPromptInput.onChange}
          onCompositionStart={analysisPromptInput.onCompositionStart}
          onCompositionEnd={analysisPromptInput.onCompositionEnd}
          onWheelCapture={(event) => {
            if (shouldPassWheelToCanvas(event)) return;
            event.stopPropagation();
          }}
          onPointerDownCapture={(event) => event.stopPropagation()}
          placeholder={lt('输入分析提示词', 'Enter analysis prompt')}
          style={{
            width: '100%',
            minHeight: 108,
            maxHeight: 180,
            resize: 'vertical',
            fontSize: 11,
            lineHeight: 1.45,
            padding: '6px 8px',
            borderRadius: 6,
            fontFamily: 'inherit',
            ...controlField,
          }}
          disabled={status === 'running' || isAnalyzing}
        />
      </div>

      <div
        style={{
          minHeight: 56,
          background: flowNodeMutedWellBackground(isFlowDark),
          borderRadius: 6,
          padding: 8,
          fontSize: 11,
          color: isFlowDark ? '#d1d5db' : '#374151',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 6,
        }}
      >
        {status === 'succeeded' && data.storyboardPromptNodeId ? (
          <>
            <span>
              {lt(
                `已生成分镜表 Prompt（${data.storyboardRowCount || 0} 行 × ${data.storyboardColumnCount || 0} 列）`,
                `Storyboard Prompt created (${data.storyboardRowCount || 0} rows × ${data.storyboardColumnCount || 0} columns)`,
              )}
            </span>
            <button
              type="button"
              className="nodrag nopan"
              onClick={(event) => {
                event.stopPropagation();
                locateStoryboardPrompt();
              }}
              style={{
                alignSelf: 'flex-start',
                border: `1px solid ${isFlowDark ? '#3a3a3a' : '#dbeafe'}`,
                borderRadius: 5,
                background: isFlowDark ? '#252525' : '#eff6ff',
                color: isFlowDark ? '#bfdbfe' : '#1d4ed8',
                padding: '3px 8px',
                fontSize: 10,
                cursor: 'pointer',
              }}
            >
              {lt('定位分镜表', 'Locate table')}
            </button>
          </>
        ) : (
          <span style={{ color: '#9ca3af' }}>
            {status === 'running' || isAnalyzing
              ? lt('正在解析镜头与时间轴…', 'Parsing shots and timeline…')
              : lt(
                  '分析完成后将自动生成可连线的分镜表 Prompt',
                  'A connectable storyboard Prompt will be created after analysis',
                )}
          </span>
        )}
      </div>

      {status === 'failed' && error && (
        <div style={{ fontSize: 12, color: '#ef4444', whiteSpace: 'pre-wrap' }}>
          {error}
        </div>
      )}

      <Handle
        type="target"
        position={Position.Left}
        id="video"
        style={{ top: '50%' }}
        onMouseEnter={() => setHover('video-in')}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="text"
        style={{ top: '50%' }}
        onMouseEnter={() => setHover('text-out')}
        onMouseLeave={() => setHover(null)}
      />

      {hover === 'video-in' && (
        <div
          className="flow-tooltip"
          style={{
            left: -8,
            top: '50%',
            transform: 'translate(-100%, -50%)',
          }}
        >
          video
        </div>
      )}
      {hover === 'text-out' && (
        <div
          className="flow-tooltip"
          style={{
            right: -8,
            top: '50%',
            transform: 'translate(100%, -50%)',
          }}
        >
          text
        </div>
      )}
    </div>
  );
}

export default React.memo(VideoAnalyzeNodeInner);
