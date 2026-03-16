import React from 'react';
import { Handle, Position, useStore, type ReactFlowState } from 'reactflow';
import { AlertTriangle, Download, Mic } from 'lucide-react';
import GenerationProgressBar from './GenerationProgressBar';
import { useLocaleText } from '@/utils/localeText';

const VOICE_OPTIONS = [
  { value: 'echo', zh: 'echo（男声青年-清色）', en: 'echo (male youth clear)' },
  { value: 'alloy', zh: 'alloy（女声成熟）', en: 'alloy (female mature)' },
  { value: 'fable', zh: 'fable（男声青年-精英）', en: 'fable (male youth elite)' },
  { value: 'onyx', zh: 'onyx（男主持）', en: 'onyx (presenter male)' },
  { value: 'nova', zh: 'nova（女主持）', en: 'nova (presenter female)' },
  { value: 'shimmer', zh: 'shimmer（有声书女声）', en: 'shimmer (audiobook female)' },
  { value: 'male-qn-qingse', zh: 'male-qn-qingse（实际音色）', en: 'male-qn-qingse (raw voice id)' },
  { value: 'female-chengshu', zh: 'female-chengshu（实际音色）', en: 'female-chengshu (raw voice id)' },
] as const;

const EMOTION_OPTIONS = [
  { value: 'happy', label: 'happy（开心）' },
  { value: 'sad', label: 'sad（悲伤）' },
  { value: 'angry', label: 'angry（愤怒）' },
  { value: 'fearful', label: 'fearful（恐惧）' },
  { value: 'disgusted', label: 'disgusted（厌恶）' },
  { value: 'surprised', label: 'surprised（惊讶）' },
  { value: 'calm', label: 'calm（平静）' },
  { value: 'fluent', label: 'fluent（流畅）' },
  { value: 'whisper', label: 'whisper（耳语）' },
] as const;

const SOUND_EFFECT_OPTIONS = [
  { value: 'spacious_echo', label: '空旷回音 (Spacious)' },
  { value: 'auditorium_echo', label: '大礼堂回音 (Auditorium)' },
  { value: 'lofi_telephone', label: '复古电话音 (Lofi Phone)' },
  { value: 'robotic', label: '机器人电音 (Robotic)' },
] as const;

type SpeechHistoryItem = {
  id: string;
  prompt: string;
  audioUrl: string;
  createdAt: number;
};

type Props = {
  id: string;
  data: {
    status?: 'idle' | 'running' | 'succeeded' | 'failed';
    audioUrl?: string;
    error?: string;
    text?: string;
    history?: SpeechHistoryItem[];
    selectedHistoryId?: string;
    voiceId?: string;
    model?: string;
    outputFormat?: 'hex' | 'url';
    audioMode?: 'json' | 'hex';
    emotion?:
      | 'happy'
      | 'sad'
      | 'angry'
      | 'fearful'
      | 'disgusted'
      | 'surprised'
      | 'calm'
      | 'fluent'
      | 'whisper';
    soundEffects?: Array<'spacious_echo' | 'auditorium_echo' | 'lofi_telephone' | 'robotic'>;
    onRun?: (id: string) => void;
  };
  selected?: boolean;
};

function MinimaxSpeechNode({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [downloadingId, setDownloadingId] = React.useState<string | null>(null);
  const hasPromptInput = useStore((state: ReactFlowState) =>
    state.edges.some((edge) => edge.target === id && edge.targetHandle === 'text')
  );
  const borderColor = selected ? '#2563eb' : '#e5e7eb';
  const boxShadow = selected ? '0 0 0 2px rgba(37,99,235,0.12)' : '0 1px 2px rgba(0,0,0,0.04)';

  const updateNodeData = React.useCallback(
    (patch: Record<string, unknown>) => {
      window.dispatchEvent(
        new CustomEvent('flow:updateNodeData', {
          detail: { id, patch },
        })
      );
    },
    [id]
  );

  const handleVoiceChange = React.useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    updateNodeData({ voiceId: e.target.value });
  }, [updateNodeData]);

  const handleEmotionChange = React.useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value.trim();
    updateNodeData({ emotion: next || undefined });
  }, [updateNodeData]);

  const handleOutputFormatChange = React.useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value === 'hex' ? 'hex' : 'url';
    updateNodeData({ outputFormat: next });
  }, [updateNodeData]);

  const handleAudioModeChange = React.useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value === 'hex' ? 'hex' : 'json';
    updateNodeData({ audioMode: next });
  }, [updateNodeData]);

  const handleSoundEffectsChange = React.useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = Array.from(e.target.selectedOptions).map(opt => opt.value);
    updateNodeData({ soundEffects: selected });
  }, [updateNodeData]);

  const handleRun = React.useCallback(() => {
    if (data.onRun) {
      data.onRun(id);
    }
  }, [id, data.onRun]);

  const stopNodeDrag = React.useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
    const nativeEvent = (event as React.SyntheticEvent<any, Event>).nativeEvent as Event & {
      stopImmediatePropagation?: () => void;
    };
    nativeEvent.stopImmediatePropagation?.();
  }, []);

  const selectedVoice = data.voiceId || 'male-qn-qingse';
  const selectedEmotion = data.emotion || '';
  const selectedOutputFormat = data.outputFormat === 'hex' ? 'hex' : 'url';
  const selectedAudioMode = data.audioMode === 'hex' ? 'hex' : 'json';
  const selectedSoundEffects = Array.isArray(data.soundEffects) ? data.soundEffects : [];
  const runDisabled = data.status === 'running' || !hasPromptInput;
  const historyItems = React.useMemo<SpeechHistoryItem[]>(() => {
    const normalized = Array.isArray(data.history)
      ? data.history
          .filter((item) => item && typeof item.audioUrl === 'string' && item.audioUrl.trim().length > 0)
          .map((item) => ({
            id: item.id || `minimax-item-${item.createdAt}-${item.audioUrl}`,
            prompt: typeof item.prompt === 'string' ? item.prompt : '',
            audioUrl: item.audioUrl.trim(),
            createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
          }))
      : [];
    if (normalized.length > 0) {
      return normalized;
    }
    if (typeof data.audioUrl === 'string' && data.audioUrl.trim().length > 0) {
      return [
        {
          id: data.selectedHistoryId || `minimax-legacy-${id}`,
          prompt: typeof data.text === 'string' ? data.text : '',
          audioUrl: data.audioUrl.trim(),
          createdAt: Date.now(),
        },
      ];
    }
    return [];
  }, [data.audioUrl, data.history, data.selectedHistoryId, data.text, id]);

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
    if (data.audioUrl !== selectedHistory.audioUrl) {
      patch.audioUrl = selectedHistory.audioUrl;
    }
    if (data.selectedHistoryId !== selectedHistory.id) {
      patch.selectedHistoryId = selectedHistory.id;
    }
    if (Object.keys(patch).length > 0) {
      updateNodeData(patch);
    }
  }, [data.audioUrl, data.selectedHistoryId, selectedHistory, updateNodeData]);

  const baseInputStyle: React.CSSProperties = {
    width: '100%',
    height: 28,
    padding: '0 6px',
    fontSize: 12,
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    background: '#fff',
  };

  const selectHistory = React.useCallback((item: SpeechHistoryItem) => {
    updateNodeData({
      selectedHistoryId: item.id,
      audioUrl: item.audioUrl,
      text: item.prompt,
    });
  }, [updateNodeData]);

  const formatHistoryTime = React.useCallback((timestamp: number) => {
    if (!Number.isFinite(timestamp)) return '';
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, []);

  const handleDownload = React.useCallback(async (item: SpeechHistoryItem) => {
    setDownloadingId(item.id);
    try {
      const response = await fetch(item.audioUrl);
      if (!response.ok) {
        throw new Error('download-failed');
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      const timestamp = new Date(item.createdAt).toISOString().replace(/[:.]/g, '-');
      anchor.download = `minimax-${timestamp}.mp3`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      window.open(item.audioUrl, '_blank', 'noopener,noreferrer');
    } finally {
      setDownloadingId(null);
    }
  }, []);

  return (
    <div
      style={{
        width: 260,
        padding: 8,
        background: '#fff',
        border: `1px solid ${borderColor}`,
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
          <Mic size={20} color="#8b5cf6" strokeWidth={2.2} />
          <span>{lt('MiniMax 语音合成', 'MiniMax Speech')}</span>
        </div>
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
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <select
          className="nodrag"
          value={selectedVoice}
          onChange={handleVoiceChange}
          onPointerDownCapture={stopNodeDrag}
          onMouseDownCapture={stopNodeDrag}
          style={baseInputStyle}
        >
          {VOICE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {lt(option.zh, option.en)}
            </option>
          ))}
        </select>

        <select
          className="nodrag"
          value={selectedEmotion}
          onChange={handleEmotionChange}
          onPointerDownCapture={stopNodeDrag}
          onMouseDownCapture={stopNodeDrag}
          style={baseInputStyle}
        >
          <option value="">{lt('情感：默认', 'Emotion: default')}</option>
          {EMOTION_OPTIONS.map((emotion) => (
            <option key={emotion.value} value={emotion.value}>
              {emotion.label}
            </option>
          ))}
        </select>

        <div
          style={{
            marginTop: 2,
            paddingTop: 6,
            borderTop: '1px solid #f0f0f0',
          }}
        >
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            onPointerDownCapture={stopNodeDrag}
            onMouseDownCapture={stopNodeDrag}
            style={{
              width: '100%',
              padding: '6px 8px',
              background: 'transparent',
              border: '1px solid #e5e7eb',
              borderRadius: 6,
              fontSize: 11,
              color: '#6b7280',
              cursor: 'pointer',
              textAlign: 'left',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>{lt('高级设置', 'Advanced Settings')}</span>
            <span style={{ transform: showAdvanced ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▼</span>
          </button>

          {showAdvanced && (
            <div style={{ marginTop: 6, display: 'grid', gap: 6 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <select
                  className="nodrag"
                  value={selectedOutputFormat}
                  onChange={handleOutputFormatChange}
                  onPointerDownCapture={stopNodeDrag}
                  onMouseDownCapture={stopNodeDrag}
                  style={baseInputStyle}
                >
                  <option value="url">{lt('返回 URL', 'Output URL')}</option>
                  <option value="hex">{lt('返回 HEX', 'Output HEX')}</option>
                </select>
                <select
                  className="nodrag"
                  value={selectedAudioMode}
                  onChange={handleAudioModeChange}
                  onPointerDownCapture={stopNodeDrag}
                  onMouseDownCapture={stopNodeDrag}
                  style={baseInputStyle}
                >
                  <option value="json">{lt('JSON 模式', 'JSON mode')}</option>
                  <option value="hex">{lt('裸流模式', 'Raw stream mode')}</option>
                </select>
              </div>

              <select
                className="nodrag"
                multiple
                value={selectedSoundEffects}
                onChange={handleSoundEffectsChange}
                onPointerDownCapture={stopNodeDrag}
                onMouseDownCapture={stopNodeDrag}
                style={{
                  ...baseInputStyle,
                  height: 'auto',
                  minHeight: 60,
                  padding: '4px',
                }}
              >
                {SOUND_EFFECT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      <GenerationProgressBar status={data.status} />

      {data.status === 'failed' && data.error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#ef4444', fontSize: 12 }}>
          <AlertTriangle size={14} />
          <span style={{ whiteSpace: 'pre-wrap' }}>{data.error}</span>
        </div>
      )}

      {selectedHistory?.audioUrl ? (
        <audio key={selectedHistory.audioUrl} controls style={{ width: '100%' }}>
          <source src={selectedHistory.audioUrl} type="audio/mpeg" />
        </audio>
      ) : null}

      {historyItems.length > 0 ? (
        <div
          style={{
            borderTop: '1px solid #f0f0f0',
            marginTop: 2,
            paddingTop: 6,
            display: 'grid',
            gap: 6,
          }}
        >
          <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>
            {lt('生成记录', 'History')}
          </div>
          <div style={{ display: 'grid', gap: 4, maxHeight: 168, overflowY: 'auto', paddingRight: 2 }}>
            {historyItems.map((item) => {
              const isActive = selectedHistory?.id === item.id;
              return (
                <div
                  key={item.id}
                  className="nodrag"
                  onPointerDownCapture={stopNodeDrag}
                  onMouseDownCapture={stopNodeDrag}
                  onClick={() => selectHistory(item)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    border: isActive ? '1px solid #93c5fd' : '1px solid #e5e7eb',
                    background: isActive ? '#eff6ff' : '#fff',
                    borderRadius: 6,
                    padding: '6px 8px',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 2 }}>
                      {formatHistoryTime(item.createdAt)}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: '#111827',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={item.prompt || lt('空 Prompt', 'Empty prompt')}
                    >
                      {item.prompt || lt('空 Prompt', 'Empty prompt')}
                    </div>
                  </div>
                  <button
                    type="button"
                    onPointerDownCapture={stopNodeDrag}
                    onMouseDownCapture={stopNodeDrag}
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleDownload(item);
                    }}
                    disabled={downloadingId === item.id}
                    style={{
                      flexShrink: 0,
                      height: 26,
                      padding: '0 8px',
                      borderRadius: 6,
                      border: '1px solid #d1d5db',
                      background: '#fff',
                      color: '#374151',
                      fontSize: 11,
                      cursor: downloadingId === item.id ? 'not-allowed' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                    title={lt('下载音频', 'Download audio')}
                  >
                    <Download size={12} />
                    {lt('下载', 'DL')}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <Handle
        id="text"
        type="target"
        position={Position.Left}
        style={{ top: '50%' }}
      />
      <Handle
        id="audio"
        type="source"
        position={Position.Right}
        style={{ top: '50%' }}
      />
    </div>
  );
}

export default React.memo(MinimaxSpeechNode);
