import React from 'react';
import {
  Handle,
  Position,
  useReactFlow,
  useStore,
  type ReactFlowState,
} from '@xyflow/react';
import { fetchWithAuth } from '@/services/authFetch';
import {
  createVideoAnalysisTaskClient,
  hasUnconfirmedVideoAnalysisSubmission,
  VideoAnalysisRequestError,
  videoAnalysisAttemptHistory,
  videoAnalysisResumeTaskId,
  type VideoAnalysisTask,
  type VideoAnalysisTaskNodeData,
  type VideoAnalysisTaskRequest,
} from '@/services/videoAnalysisTasks';
import { useCanvasStore } from '@/stores';
import { useProjectStore } from '@/stores/projectStore';
import { useTeamStore } from '@/stores/teamStore';
import { useLocaleText } from '@/utils/localeText';
import RunCreditBadge from './RunCreditBadge';
import {
  flowNodeControlField,
  flowNodeMutedWellBackground,
  flowNodeShellChrome,
  useFlowNodeDarkTheme,
} from './flowNodeDarkTheme';
import { useImeSafeTextValue } from '../hooks/useImeSafeTextInput';
import { useBackendCreditsPreview } from '../hooks/useBackendCreditsPreview';
import { useAIChatStore } from '@/stores/aiChatStore';
import {
  DEFAULT_VIDEO_STORYBOARD_PROMPT,
  parseStoryboardAnalysis,
} from '../storyboardPromptTable';

import {
  getVideoAnalyzeModelOptions,
  isDurationPricedVideoAnalyzeModel,
  resolveVideoAnalyzeModel,
  type VideoAnalyzeModel,
} from '@/services/videoAnalysisModels';

type Props = {
  id: string;
  data: VideoAnalysisTaskNodeData & {
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

const normalizeVideoDuration = (value: unknown): number | undefined => {
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0
    ? Number(duration.toFixed(3))
    : undefined;
};

const taskClient = createVideoAnalysisTaskClient(
  fetchWithAuth,
  import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '') || 'http://localhost:4000',
);

function VideoAnalyzeNodeInner({ id, data, selected = false }: Props) {
  const { lt } = useLocaleText();
  const isFlowDark = useFlowNodeDarkTheme();
  const rf = useReactFlow();
  const { status, error } = data;
  const [hover, setHover] = React.useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = React.useState(false);
  const [taskId, setTaskId] = React.useState(data.analysisTaskId);
  const [taskSnapshot, setTaskSnapshot] = React.useState<VideoAnalysisTask | null>(null);
  const [pollRevision, setPollRevision] = React.useState(0);
  const [pollError, setPollError] = React.useState('');
  const mountedRef = React.useRef(true);
  const submissionBusyRef = React.useRef(false);
  const completionWaiters = React.useRef<((success: boolean) => void)[]>([]);
  const settleWaiters = React.useCallback((success: boolean) => {
    completionWaiters.current.splice(0).forEach((resolve) => resolve(success));
  }, []);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      settleWaiters(false);
    };
  }, [settleWaiters]);
  React.useEffect(() => {
    setTaskId(data.analysisTaskId);
  }, [data.analysisTaskId]);
  const [loadedVideoDuration, setLoadedVideoDuration] = React.useState<
    number | undefined
  >(undefined);

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
  const connectedVideoDuration = useStore(
    React.useCallback(
      (state: ReactFlowState) => {
        const edge = state.edges.find(
          (candidate) => candidate.target === id && candidate.targetHandle === 'video',
        );
        if (!edge) return undefined;
        const sourceNode = state.nodes.find((node) => node.id === edge.source);
        const sourceData = sourceNode?.data as Record<string, unknown> | undefined;
        return normalizeVideoDuration(
          sourceData?.duration ??
            sourceData?.videoDuration ??
            sourceData?.mediaDuration,
        );
      },
      [id],
    ),
  );
  const effectiveVideoUrl = connectedVideoUrl || data.videoUrl;

  React.useEffect(() => {
    setLoadedVideoDuration(undefined);
  }, [effectiveVideoUrl]);

  const updateNodeData = React.useCallback((patch: Record<string, unknown>) => {
    window.dispatchEvent(new CustomEvent('flow:updateNodeData', {
      detail: { id, patch },
    }));
  }, [id]);

  const modelOptions = getVideoAnalyzeModelOptions(data.analysisModel);
  const selectedModel = resolveVideoAnalyzeModel(data.analysisModel);
  const selectedModelOption = modelOptions.find((option) => option.value === selectedModel)!;
  const usesDurationPricing = isDurationPricedVideoAnalyzeModel(selectedModel);
  const bananaImageRoute = useAIChatStore((state) => state.bananaImageRoute);
  const effectiveVideoDuration =
    connectedVideoDuration ?? loadedVideoDuration;
  const durationPreviewParams = React.useMemo(
    () =>
      usesDurationPricing && effectiveVideoDuration
        ? {
            durationSec: effectiveVideoDuration,
            billingDurationSec: effectiveVideoDuration,
          }
        : null,
    [effectiveVideoDuration, usesDurationPricing],
  );
  const creditPreviewRequestParams = React.useMemo(
    () => ({
      ...(durationPreviewParams || {}),
      bananaImageRoute,
      channelHint:
        bananaImageRoute === 'stable'
          ? 'tencent'
          : bananaImageRoute === 'ultra'
            ? 'beqlee'
            : 'apimart',
      providerOptions: {
        banana: { imageRoute: bananaImageRoute },
      },
    }),
    [bananaImageRoute, durationPreviewParams],
  );
  const creditPreview = useBackendCreditsPreview({
    serviceType: 'gemini-video-analyze',
    model: selectedModel,
    requestParams: creditPreviewRequestParams,
    enabled: !usesDurationPricing || Boolean(durationPreviewParams),
  });
  const runCredits = creditPreview.credits;
  const hasRunCredits =
    typeof runCredits === 'number' && runCredits > 0;

  React.useEffect(() => {
    if (data.analysisModel === selectedModel) return;
    updateNodeData({ analysisModel: selectedModel });
  }, [data.analysisModel, selectedModel, updateNodeData]);

  React.useEffect(() => {
    const legacyData = data as typeof data & {
      lastBillingPriceYuan?: unknown;
      lastBillingTier?: unknown;
      lastCreditsUsed?: unknown;
    };
    if (
      legacyData.lastBillingPriceYuan === undefined &&
      legacyData.lastBillingTier === undefined &&
      legacyData.lastCreditsUsed === undefined
    ) {
      return;
    }
    updateNodeData({
      lastBillingPriceYuan: undefined,
      lastBillingTier: undefined,
      lastCreditsUsed: undefined,
    });
  }, [data, updateNodeData]);

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

  const latestTaskContext = React.useRef({ data, updateNodeData, upsertStoryboardPromptNode });
  latestTaskContext.current = { data, updateNodeData, upsertStoryboardPromptNode };

  React.useEffect(() => {
    if (!taskId) return;
    const saved = latestTaskContext.current.data;
    if (pollRevision === 0 && (
      saved.analysisTaskStatus === 'failed' ||
      (saved.analysisTaskStatus === 'succeeded' && saved.analysisTaskAppliedId === taskId)
    )) return;

    const controller = new AbortController();
    setPollError('');
    void taskClient.observe(taskId, controller.signal, (task) => {
      setTaskSnapshot(task);
      latestTaskContext.current.updateNodeData({
        analysisTaskId: task.taskId,
        analysisTaskStatus: task.status,
        analysisTaskProgress: task.progress,
        analysisTaskStage: task.stage,
      });
    }).then((task) => {
      if (controller.signal.aborted) return;
      const context = latestTaskContext.current;
      if (task.status === 'failed') {
        context.updateNodeData({ status: 'failed', error: task.error || lt('视频分析失败', 'Video analysis failed') });
        settleWaiters(false);
        return;
      }
      const analysisText = String(task.result?.analysis || task.result?.text || '').trim();
      if (!analysisText) {
        throw new Error(lt('模型没有返回可解析的分析结果', 'The model returned no parseable analysis result'));
      }
      const output = context.upsertStoryboardPromptNode(analysisText);
      context.updateNodeData({
        status: 'succeeded', error: undefined,
        prompt: analysisText, text: analysisText,
        analysisMode: task.result?.analysisMode,
        analysisTaskAppliedId: task.taskId,
        storyboardPromptNodeId: output.outputNodeId,
        storyboardRowCount: output.rowCount,
        storyboardColumnCount: output.columnCount,
      });
      window.dispatchEvent(new CustomEvent('refresh-credits'));
      settleWaiters(true);
    }).catch((err: unknown) => {
      if (controller.signal.aborted) return;
      // A lost GET response says nothing about the backend task's outcome.
      // Keep the same task identity; the next click only resumes observation.
      setPollError(err instanceof Error ? err.message : String(err));
      settleWaiters(false);
    });
    return () => controller.abort();
  }, [taskId, pollRevision, lt, settleWaiters]);

  const onAnalyze = React.useCallback(async (): Promise<boolean> => {
    if (submissionBusyRef.current) return false;
    const current = latestTaskContext.current.data;
    const knownStatus = taskSnapshot && taskSnapshot.taskId === taskId ? taskSnapshot.status : current.analysisTaskStatus;
    if (taskId && (knownStatus === 'queued' || knownStatus === 'processing' || pollError)) {
      const completion = new Promise<boolean>((resolve) => completionWaiters.current.push(resolve));
      if (pollError) setPollRevision((value) => value + 1);
      return completion;
    }

    const currentTeamId = useTeamStore.getState().activeTeamId;
    const currentProjectId = useProjectStore.getState().currentProjectId || undefined;
    const unconfirmed = hasUnconfirmedVideoAnalysisSubmission(current) &&
      (current.analysisTaskTeamId || null) === (currentTeamId || null) &&
      (current.analysisTaskRequest?.projectId || undefined) === currentProjectId;
    if (!effectiveVideoUrl && !unconfirmed) {
      updateNodeData({
        status: 'failed',
        error: lt(
          '没有可分析的视频输入，请先连接视频节点',
          'No video input to analyze. Please connect a video node first',
        ),
      });
      return false;
    }

    const promptToUse = analysisPromptDraft.trim();
    if (!promptToUse && !unconfirmed) {
      updateNodeData({
        status: 'failed',
        error: lt('提示词不能为空', 'Prompt cannot be empty'),
      });
      return false;
    }

    // Persist the request identity before submitting. If the receipt is lost,
    // an explicit retry sends this frozen request with the same key.
    const request: VideoAnalysisTaskRequest = unconfirmed
      ? current.analysisTaskRequest!
      : {
          prompt: promptToUse,
          videoUrl: effectiveVideoUrl!,
          model: selectedModel,
          bananaImageRoute,
          channelHint: bananaImageRoute === 'stable' ? 'tencent' : bananaImageRoute === 'ultra' ? 'beqlee' : 'apimart',
          providerOptions: { banana: { imageRoute: bananaImageRoute } },
          clientRequestId: crypto.randomUUID(),
          nodeId: id,
          projectId: currentProjectId,
        };
    if (!unconfirmed) request.resumeTaskId = videoAnalysisResumeTaskId(current, request, currentTeamId);
    submissionBusyRef.current = true;
    setIsAnalyzing(true);
    setPollError('');
    updateNodeData({
      status: 'running',
      error: undefined,
      analysisTaskRequest: request,
      analysisTaskTeamId: currentTeamId,
      analysisTaskHistory: unconfirmed ? current.analysisTaskHistory : videoAnalysisAttemptHistory(current),
      analysisTaskId: undefined,
      analysisTaskStatus: undefined,
      analysisTaskProgress: undefined,
      analysisTaskStage: undefined,
      analysisTaskAppliedId: undefined,
      analysisSubmissionState: 'submitting',
    });

    try {
      const task = await taskClient.submit(request);
      updateNodeData({
        analysisTaskId: task.taskId,
        analysisTaskStatus: task.status,
        analysisTaskProgress: task.progress,
        analysisTaskStage: task.stage,
        analysisSubmissionState: 'accepted',
        analysisModel: request.model,
      });
      if (!mountedRef.current) return false;
      const completion = new Promise<boolean>((resolve) => completionWaiters.current.push(resolve));
      setTaskSnapshot(task);
      setTaskId(task.taskId);
      setPollRevision((value) => value + 1);
      return completion;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const rejected = err instanceof VideoAnalysisRequestError && err.submissionRejected;
      updateNodeData({
        status: rejected ? 'failed' : 'running',
        error: message,
        analysisSubmissionState: rejected ? 'rejected' : 'unknown',
      });
      return false;
    } finally {
      submissionBusyRef.current = false;
      if (mountedRef.current) setIsAnalyzing(false);
    }
  }, [
    analysisPromptDraft,
    bananaImageRoute,
    effectiveVideoUrl,
    id,
    lt,
    selectedModel,
    taskId,
    taskSnapshot,
    pollError,
    updateNodeData,
  ]);

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (
        event as CustomEvent<{ id?: string; done?: (result?: boolean) => void }>
      ).detail;
      if (!detail || detail.id !== id) return;
      void onAnalyze()
        .then((success) => detail.done?.(success))
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

  const currentTaskStatus = taskSnapshot && taskSnapshot.taskId === taskId
    ? taskSnapshot.status : data.analysisTaskStatus;
  const hasPendingTask = Boolean(taskId) && currentTaskStatus !== 'succeeded' && currentTaskStatus !== 'failed';
  const unconfirmedSubmission = hasUnconfirmedVideoAnalysisSubmission(data);
  const controlsLocked = isAnalyzing || hasPendingTask || unconfirmedSubmission;
  const canRun = !isAnalyzing && (
    Boolean(pollError) || unconfirmedSubmission || (Boolean(effectiveVideoUrl) && !hasPendingTask)
  );
  const taskProgress = taskSnapshot && taskSnapshot.taskId === taskId ? taskSnapshot.progress : data.analysisTaskProgress;
  const usesSegmentedAnalysis = (data.analysisTaskRequest?.model || selectedModel).startsWith('doubao-seed-');
  const progressLabel = taskProgress && taskProgress.total > 0
    ? lt(`已处理 ${taskProgress.completed}/${taskProgress.total} 段`, `Processed ${taskProgress.completed}/${taskProgress.total} clips`)
    : usesSegmentedAnalysis
      ? lt('正在探测视频并拆分短片…', 'Inspecting video and preparing clips…')
      : lt('后台分析中…', 'Analyzing in the background…');
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
          onClick={() => { void onAnalyze(); }}
          disabled={!canRun}
          style={{ cursor: canRun ? 'pointer' : 'not-allowed' }}
        >
          {isAnalyzing || (hasPendingTask && !pollError) ? (
            <span className="run-text-trigger">
              {lt('分析中...', 'Analyzing...')}
            </span>
          ) : (
            <>
              <span className="run-text-trigger">{
                pollError ? lt('恢复查询', 'Reconnect') :
                unconfirmedSubmission ? lt('继续提交', 'Recover submission') :
                currentTaskStatus === 'failed' || status === 'failed' ? lt('重试', 'Retry') :
                status === 'succeeded' ? lt('重新分析', 'Analyze again') : lt('分析', 'Analyze')
              }</span>
              {hasRunCredits && !pollError && !unconfirmedSubmission ? (
                <RunCreditBadge credits={runCredits} runButton />
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
            onLoadedMetadata={(event) => {
              setLoadedVideoDuration(
                normalizeVideoDuration(event.currentTarget.duration),
              );
            }}
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
          disabled={controlsLocked}
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
          {modelOptions.map((option) => (
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
        {usesDurationPricing &&
        effectiveVideoDuration &&
        creditPreview.hasCredits ? (
          <span
            style={{
              display: 'block',
              marginTop: 3,
              fontSize: 10,
              color: isFlowDark ? '#bfdbfe' : '#1d4ed8',
            }}
          >
            {lt(
              `按 ${Number(effectiveVideoDuration.toFixed(3))} 秒预估 ${creditPreview.credits} 积分；实扣以后端识别时长为准`,
              `Estimated ${creditPreview.credits} credits for ${Number(effectiveVideoDuration.toFixed(3))}s; final billing uses the server-detected duration`,
            )}
          </span>
        ) : null}
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
          disabled={controlsLocked}
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
        {unconfirmedSubmission ? (
          <span>{lt('提交回执待确认；点击继续提交将找回同一次分析，不会自动重提。', 'Submission is unconfirmed. Recover submission to retrieve the same analysis attempt.')}</span>
        ) : hasPendingTask || (taskProgress && status === 'failed') ? (
          <>
            <span aria-live="polite">{progressLabel}</span>
            {pollError ? <span>{lt('查询已暂停，后台任务继续处理。', 'Updates paused; the task continues in the background.')}</span> :
              hasPendingTask && <span>{usesSegmentedAnalysis
                ? lt('短片分别分析后将合并为同一份分镜表。', 'Clip analyses will be combined into one storyboard table.')
                : lt('完成后将生成分镜表。', 'A storyboard table will be created when analysis completes.')}</span>}
            {currentTaskStatus === 'failed' && <span>{lt('重试将复用已完成片段。修改输入后将新建分析。', 'Retry reuses completed clips. Changed inputs start a new analysis.')}</span>}
          </>
        ) : status === 'succeeded' && data.storyboardPromptNodeId ? (
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
            {isAnalyzing
              ? lt('正在解析镜头与时间轴…', 'Parsing shots and timeline…')
              : lt(
                  '分析完成后将自动生成可连线的分镜表 Prompt',
                  'A connectable storyboard Prompt will be created after analysis',
                )}
          </span>
        )}
      </div>

      {(pollError || error) && (
        <div style={{ fontSize: 12, color: '#ef4444', whiteSpace: 'pre-wrap' }}>
          {pollError || error}
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
