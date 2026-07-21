import React from 'react';
import { Handle, Position, useStore, type ReactFlowState } from '@xyflow/react';
import { AlertTriangle, AudioLines } from 'lucide-react';
import GenerationProgressBar from './GenerationProgressBar';
import RunCreditBadge from './RunCreditBadge';
import AudioResultPanel, { type AudioResultHistoryItem } from './AudioResultPanel';
import { useLocaleText } from '@/utils/localeText';
import { useProjectContentStore } from '@/stores/projectContentStore';
import {
  flowNodeControlField,
  flowNodeShellChrome,
  useFlowNodeDarkTheme,
} from './flowNodeDarkTheme';
import {
  getManagedRoutesMetadata,
  getManagedRouteOption,
  resolveManagedRoutePricing,
} from '../managedRoutePricing';
import AudioSpecForm from './AudioSpecForm';
import { getAudioSpecFromManagedRoute, MODE_DEFAULT_MODEL } from './audioSpec';
import { type AudioStudioMode } from './audioStudioModes';

const MAX_AUDIO_SIZE = 100 * 1024 * 1024; // 100MB

const SUPPORTED_AUDIO_EXTENSIONS = [
  'mp3', 'wav', 'aac', 'm4a', 'ogg', 'opus', 'flac', 'webm', 'weba', 'amr', 'aiff', 'aif', 'wma',
];
const SUPPORTED_AUDIO_PATTERN = new RegExp(
  `\\.(${SUPPORTED_AUDIO_EXTENSIONS.join('|')})$`,
  'i'
);
const SUPPORTED_EXTENSIONS = SUPPORTED_AUDIO_EXTENSIONS.map((ext) => `.${ext}`).join(',');

const UPLOAD_MODEL_KEY = 'upload';

const isSupportedAudioFile = (file: File): boolean => {
  const name = (file?.name || '').trim();
  const mime = (file?.type || '').trim().toLowerCase();
  if (mime.startsWith('audio/')) return true;
  return SUPPORTED_AUDIO_PATTERN.test(name);
};

type AudioStudioNodeData = {
  mode?: AudioStudioMode;
  managedModelKey?: string;
  nodeConfigMetadata?: Record<string, any>;
  status?: string;
  progressStartedAt?: number | string | null;
  error?: string;
  audioUrl?: string;
  videoUrl?: string;
  history?: AudioResultHistoryItem[];
  selectedHistoryId?: string;
  creditsPerCall?: number;
  onRun?: (id: string) => void;
  // spec-driven fields are stored on data by their AudioGenerateDto key
  [key: string]: unknown;
  // upload
  audioName?: string;
  mimeType?: string;
  duration?: number;
};

type Props = {
  id: string;
  data: AudioStudioNodeData;
  selected?: boolean;
};

function AudioStudioNode({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const isFlowDark = useFlowNodeDarkTheme();
  const projectId = useProjectContentStore((state) => state.projectId);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [handleHover, setHandleHover] = React.useState<string | null>(null);

  const shell = flowNodeShellChrome(isFlowDark, !!selected);
  const controlField = flowNodeControlField(isFlowDark);
  const boxShadow = selected ? '0 0 0 2px rgba(37,99,235,0.12)' : '0 1px 2px rgba(0,0,0,0.04)';

  // ---- 模型注册表（后端 managedRoutes 驱动）----
  const nodeConfigMetadata =
    data.nodeConfigMetadata && typeof data.nodeConfigMetadata === 'object'
      ? data.nodeConfigMetadata
      : undefined;
  const managedRoutes = React.useMemo(
    () => getManagedRoutesMetadata(nodeConfigMetadata),
    [nodeConfigMetadata]
  );

  const modelOptions = React.useMemo(() => {
    const vendors = managedRoutes?.vendors || [];
    const opts = vendors.map((vendor) => ({
      value: vendor.vendorKey,
      label: vendor.label || vendor.vendorKey,
    }));
    opts.push({ value: UPLOAD_MODEL_KEY, label: lt('导入', 'Import') });
    return opts;
  }, [managedRoutes, lt]);

  const selectedModelKey = React.useMemo(() => {
    const raw =
      typeof data.managedModelKey === 'string' && data.managedModelKey.trim()
        ? data.managedModelKey.trim()
        : '';
    if (raw && modelOptions.some((o) => o.value === raw)) return raw;
    if (data.mode === 'upload') return UPLOAD_MODEL_KEY;
    const byMode = data.mode ? MODE_DEFAULT_MODEL[data.mode] : '';
    if (byMode && modelOptions.some((o) => o.value === byMode)) return byMode;
    return (
      managedRoutes?.defaultVendor ||
      managedRoutes?.vendors[0]?.vendorKey ||
      UPLOAD_MODEL_KEY
    );
  }, [data.managedModelKey, data.mode, managedRoutes, modelOptions]);

  const isUpload = selectedModelKey === UPLOAD_MODEL_KEY;

  const selectedRoute = React.useMemo(
    () => (isUpload ? null : getManagedRouteOption(nodeConfigMetadata, selectedModelKey)),
    [isUpload, nodeConfigMetadata, selectedModelKey]
  );
  const selectedSpec = React.useMemo(
    () => getAudioSpecFromManagedRoute(selectedRoute),
    [selectedRoute]
  );
  const effectiveMode: AudioStudioMode = isUpload
    ? 'upload'
    : selectedSpec?.mode || (data.mode as AudioStudioMode) || 'seed-audio';

  // ---- 动态句柄 ----
  const inputHandles = React.useMemo(() => {
    if (isUpload) return ['audio'];
    const handles = (selectedSpec?.inputs || []).map((input) => input.handle);
    return Array.from(new Set(handles));
  }, [isUpload, selectedSpec]);
  const outputHandles = React.useMemo(() => {
    if (isUpload) return ['audio'];
    return Array.from(new Set(selectedSpec?.outputs || ['audio']));
  }, [isUpload, selectedSpec]);

  // 已连接的输入句柄集合（稳定字符串，避免无谓重渲染）
  const connectedHandleKey = useStore((state: ReactFlowState) => {
    const set = new Set<string>();
    state.edges.forEach((edge) => {
      if (edge.target === id && typeof edge.targetHandle === 'string') {
        set.add(edge.targetHandle);
      }
    });
    return Array.from(set).sort().join(',');
  });
  const connectedHandles = React.useMemo(
    () => new Set(connectedHandleKey.split(',').filter(Boolean)),
    [connectedHandleKey]
  );

  const updateNodeData = React.useCallback(
    (patch: Record<string, unknown>) => {
      window.dispatchEvent(
        new CustomEvent('flow:updateNodeData', { detail: { id, patch } })
      );
    },
    [id]
  );

  const stopNodeDrag = React.useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
    const nativeEvent = (event as React.SyntheticEvent<unknown, Event>).nativeEvent as Event & {
      stopImmediatePropagation?: () => void;
    };
    nativeEvent.stopImmediatePropagation?.();
  }, []);

  const handleModelChange = React.useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const nextKey = event.target.value;
      if (nextKey === UPLOAD_MODEL_KEY) {
        updateNodeData({ managedModelKey: UPLOAD_MODEL_KEY, mode: 'upload', status: 'idle', error: undefined });
        return;
      }
      const route = getManagedRouteOption(nodeConfigMetadata, nextKey);
      const spec = getAudioSpecFromManagedRoute(route);
      updateNodeData({
        managedModelKey: nextKey,
        mode: spec?.mode || data.mode || 'seed-audio',
        status: 'idle',
        error: undefined,
      });
    },
    [data.mode, nodeConfigMetadata, updateNodeData]
  );

  const onRunCallback = data.onRun;
  const handleRun = React.useCallback(() => {
    onRunCallback?.(id);
  }, [id, onRunCallback]);

  // ---- 历史记录归一化（所有模式共用） ----
  const historyItems = React.useMemo<AudioResultHistoryItem[]>(() => {
    const normalized = Array.isArray(data.history)
      ? data.history
          .filter(
            (item) =>
              item &&
              ((typeof item.audioUrl === 'string' && item.audioUrl.trim().length > 0) ||
                (typeof item.videoUrl === 'string' && item.videoUrl.trim().length > 0))
          )
          .map((item) => ({
            id: item.id || `audio-${item.createdAt}-${item.audioUrl}`,
            prompt: typeof item.prompt === 'string' ? item.prompt : '',
            audioUrl: typeof item.audioUrl === 'string' ? item.audioUrl.trim() : '',
            videoUrl: typeof item.videoUrl === 'string' ? item.videoUrl.trim() : undefined,
            createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
          }))
      : [];
    if (normalized.length > 0) return normalized;
    if (typeof data.audioUrl === 'string' && data.audioUrl.trim().length > 0) {
      return [
        {
          id: data.selectedHistoryId || `audio-legacy-${id}`,
          prompt: typeof data.text === 'string' ? data.text : '',
          audioUrl: data.audioUrl.trim(),
          videoUrl: typeof data.videoUrl === 'string' ? data.videoUrl.trim() : undefined,
          createdAt: Date.now(),
        },
      ];
    }
    return [];
  }, [data.audioUrl, data.history, data.selectedHistoryId, data.text, data.videoUrl, id]);

  const selectedHistory = React.useMemo(() => {
    if (historyItems.length === 0) return null;
    if (typeof data.selectedHistoryId === 'string' && data.selectedHistoryId.trim().length > 0) {
      const matched = historyItems.find((item) => item.id === data.selectedHistoryId);
      if (matched) return matched;
    }
    if (typeof data.audioUrl === 'string' && data.audioUrl.trim().length > 0) {
      const matched = historyItems.find((item) => item.audioUrl === data.audioUrl);
      if (matched) return matched;
    }
    return historyItems[0] || null;
  }, [data.audioUrl, data.selectedHistoryId, historyItems]);

  React.useEffect(() => {
    if (!selectedHistory) return;
    const patch: Record<string, unknown> = {};
    if (data.audioUrl !== selectedHistory.audioUrl) patch.audioUrl = selectedHistory.audioUrl;
    if (data.videoUrl !== selectedHistory.videoUrl) patch.videoUrl = selectedHistory.videoUrl;
    if (data.selectedHistoryId !== selectedHistory.id) patch.selectedHistoryId = selectedHistory.id;
    if (Object.keys(patch).length > 0) updateNodeData(patch);
  }, [data.audioUrl, data.videoUrl, data.selectedHistoryId, selectedHistory, updateNodeData]);

  const selectHistory = React.useCallback(
    (item: AudioResultHistoryItem) => {
      updateNodeData({
        selectedHistoryId: item.id,
        audioUrl: item.audioUrl,
        videoUrl: item.videoUrl,
      });
    },
    [updateNodeData]
  );

  // ---- upload 模式：文件 → OSS ----
  const uploadAudioToOSS = React.useCallback(
    async (file: File): Promise<string> => {
      const { ossUploadService } = await import('@/services/ossUploadService');
      const fallbackName = `audio-${Date.now()}.mp3`;
      const dir = projectId ? `projects/${projectId}/audios/` : 'uploads/audios/';
      const result = await ossUploadService.uploadToOSS(file, {
        dir,
        projectId: null,
        fileName: file.name || fallbackName,
        contentType: file.type || 'audio/mpeg',
        maxSize: MAX_AUDIO_SIZE,
      });
      if (!result.success || !result.url) {
        throw new Error(result.error || lt('上传失败', 'Upload failed'));
      }
      return result.url;
    },
    [lt, projectId]
  );

  const handleUploadFiles = React.useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files[0];
      if (!isSupportedAudioFile(file)) {
        updateNodeData({ status: 'error', error: lt('不支持的语音格式', 'Unsupported audio format') });
        return;
      }
      const audioName = file.name || lt('未命名语音', 'Untitled audio');
      updateNodeData({ status: 'uploading', audioName, mimeType: file.type || undefined, error: undefined });
      try {
        const audioUrl = await uploadAudioToOSS(file);
        const historyItemId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        updateNodeData({
          status: 'ready',
          audioUrl,
          audioName,
          mimeType: file.type || undefined,
          selectedHistoryId: historyItemId,
          history: [
            { id: historyItemId, prompt: audioName, audioUrl, createdAt: Date.now() },
            ...(Array.isArray(data.history) ? data.history.slice(0, 29) : []),
          ],
          error: undefined,
        });
      } catch (err: any) {
        updateNodeData({ status: 'error', error: err?.message || lt('上传失败', 'Upload failed') });
      }
    },
    [data.history, lt, updateNodeData, uploadAudioToOSS]
  );

  const baseInputStyle: React.CSSProperties = {
    width: '100%',
    height: 28,
    padding: '0 6px',
    fontSize: 12,
    borderRadius: 6,
    ...controlField,
  };

  // ---- run disabled 判定（按 spec 必填输入 + 模式）----
  const localText = typeof data.text === 'string' ? data.text.trim() : '';
  const localPrompt = typeof data.prompt === 'string' ? data.prompt.trim() : '';
  const localLyrics = typeof data.lyrics === 'string' ? data.lyrics.trim() : '';
  const runDisabled = React.useMemo(() => {
    if (data.status === 'running' || data.status === 'uploading') return true;
    if (isUpload) return true; // 导入模式没有 Run（通过上传按钮）
    if (effectiveMode === 'minimax-music') {
      if (data.isInstrumental === true) {
        return !(localPrompt || connectedHandles.has('text'));
      }
      return !(localLyrics || data.lyricsOptimizer === true || connectedHandles.has('text'));
    }
    for (const input of selectedSpec?.inputs || []) {
      if (!input.required) continue;
      if (input.handle === 'text') {
        if (!connectedHandles.has('text') && !localText) return true;
      } else if (!connectedHandles.has(input.handle)) {
        return true;
      }
    }
    return false;
  }, [
    data.status, data.isInstrumental, data.lyricsOptimizer, isUpload, effectiveMode,
    selectedSpec, connectedHandles, localText, localPrompt, localLyrics,
  ]);

  // ---- 价格展示 ----
  const priceLabel = React.useMemo(() => {
    if (isUpload) return null;
    if (effectiveMode === 'seed-audio') {
      return lt('≈2积分/秒，按实际时长结算', '≈2 credits/sec, billed by actual duration');
    }
    const resolved = resolveManagedRoutePricing(nodeConfigMetadata, selectedModelKey, {});
    if (typeof resolved?.credits === 'number') {
      return lt(`${resolved.credits} 积分/次`, `${resolved.credits} credits / run`);
    }
    return null;
  }, [isUpload, effectiveMode, nodeConfigMetadata, selectedModelKey, lt]);

  // 句柄垂直分布
  const handleTop = (index: number, total: number): string => {
    if (total <= 1) return '50%';
    const start = 30;
    const span = 40;
    return `${start + (span / (total - 1)) * index}%`;
  };

  return (
    <div
      style={{
        width: 300,
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
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
          <AudioLines size={20} color="#8b5cf6" strokeWidth={2.2} />
          <span>
            {lt('音频工作台', 'Audio Studio')}
            <RunCreditBadge credits={data.creditsPerCall} inline />
          </span>
        </div>
        {!isUpload ? (
          <button
            onClick={handleRun}
            onPointerDownCapture={stopNodeDrag}
            onMouseDownCapture={stopNodeDrag}
            disabled={runDisabled}
            style={{
              fontSize: 12,
              padding: '4px 8px',
              background: runDisabled ? '#e5e7eb' : '#111827',
              color: runDisabled ? '#9ca3af' : '#fff',
              borderRadius: 6,
              border: 'none',
              cursor: runDisabled ? 'not-allowed' : 'pointer',
            }}
          >
            {data.status === 'running' ? lt('运行中...', 'Running...') : 'Run'}
          </button>
        ) : null}
      </div>

      {/* 模型选择 */}
      <select
        className="nodrag"
        value={selectedModelKey}
        onChange={handleModelChange}
        onPointerDownCapture={stopNodeDrag}
        onMouseDownCapture={stopNodeDrag}
        style={{ ...baseInputStyle, fontWeight: 600 }}
      >
        {modelOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {priceLabel ? (
        <div style={{ fontSize: 11, color: isFlowDark ? '#9ca3af' : '#6b7280' }}>{priceLabel}</div>
      ) : null}

      {/* spec 驱动表单 */}
      {!isUpload && selectedSpec ? (
        <AudioSpecForm
          spec={selectedSpec}
          data={data}
          isDark={isFlowDark}
          lt={lt}
          onChange={updateNodeData}
          stopNodeDrag={stopNodeDrag}
          nodeId={id}
        />
      ) : null}

      {/* upload 模式 */}
      {isUpload ? (
        <div style={{ display: 'grid', gap: 6 }}>
          <input
            ref={inputRef}
            type="file"
            accept={SUPPORTED_EXTENSIONS}
            style={{ display: 'none' }}
            onChange={(e) => handleUploadFiles(e.target.files)}
          />
          <div
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleUploadFiles(e.dataTransfer.files); }}
            onDragOver={(e) => e.preventDefault()}
            onDoubleClick={() => inputRef.current?.click()}
            style={{
              minHeight: 72,
              background: isFlowDark ? '#1a1a1a' : '#f8fafc',
              borderRadius: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: isFlowDark ? '1px solid #333333' : '1px solid #e5e7eb',
              cursor: 'pointer', padding: 12, textAlign: 'center',
            }}
            title={lt('拖拽语音到此或双击上传', 'Drag audio here or double click to upload')}
          >
            {data.status === 'uploading' ? (
              <span style={{ fontSize: 12, color: '#6b7280' }}>{lt('上传中...', 'Uploading...')}</span>
            ) : (
              <div style={{ color: '#6b7280' }}>
                <div style={{ fontSize: 12 }}>{lt('拖拽语音到此或双击上传', 'Drag audio here or double click to upload')}</div>
                <div style={{ fontSize: 10, marginTop: 4, color: '#94a3b8' }}>MP3, WAV, M4A, AAC, OGG, FLAC, OPUS</div>
              </div>
            )}
          </div>
          {data.audioName ? (
            <div style={{ fontSize: 11, color: isFlowDark ? '#9ca3af' : '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={data.audioName}>
              {data.audioName}
            </div>
          ) : null}
        </div>
      ) : null}

      <GenerationProgressBar status={data.status as any} startedAt={data.progressStartedAt} runKey={id} />

      {(data.status === 'failed' || data.status === 'error') && data.error ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#ef4444', fontSize: 12 }}>
          <AlertTriangle size={14} />
          <span style={{ whiteSpace: 'pre-wrap' }}>{data.error}</span>
        </div>
      ) : null}

      <AudioResultPanel
        isFlowDark={isFlowDark}
        items={historyItems}
        selected={selectedHistory}
        onSelect={selectHistory}
        lt={lt}
        downloadPrefix={effectiveMode === 'tencent-dub' ? 'tencent-dub' : 'audio'}
        downloadExt={effectiveMode === 'tencent-dub' ? '.mp4' : '.mp3'}
        stopNodeDrag={stopNodeDrag}
        emptyPromptZh={effectiveMode === 'tencent-dub' ? '配音任务' : '空 Prompt'}
        emptyPromptEn={effectiveMode === 'tencent-dub' ? 'Dubbing task' : 'Empty prompt'}
      />

      {/* 输入句柄 */}
      {inputHandles.map((handle, index) => {
        const top = handleTop(index, inputHandles.length);
        return (
          <React.Fragment key={`in-${handle}`}>
            <Handle
              id={handle}
              type="target"
              position={Position.Left}
              style={{ top }}
              onMouseEnter={() => setHandleHover(`in-${handle}`)}
              onMouseLeave={() => setHandleHover(null)}
            />
            {handleHover === `in-${handle}` ? (
              <div className="flow-tooltip" style={{ left: -8, top, transform: 'translate(-100%, -50%)' }}>{handle}</div>
            ) : null}
          </React.Fragment>
        );
      })}

      {/* 输出句柄 */}
      {outputHandles.map((handle, index) => {
        const top = handleTop(index, outputHandles.length);
        return (
          <React.Fragment key={`out-${handle}`}>
            <Handle
              id={handle}
              type="source"
              position={Position.Right}
              style={{ top }}
              onMouseEnter={() => setHandleHover(`out-${handle}`)}
              onMouseLeave={() => setHandleHover(null)}
            />
            {handleHover === `out-${handle}` ? (
              <div className="flow-tooltip" style={{ right: -8, top, transform: 'translate(100%, -50%)' }}>{handle}</div>
            ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default React.memo(AudioStudioNode);
