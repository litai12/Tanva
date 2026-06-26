import React from 'react';
import { Handle, Position, useStore, type ReactFlowState } from 'reactflow';
import { AlertTriangle, AudioLines } from 'lucide-react';
import GenerationProgressBar from './GenerationProgressBar';
import RunCreditBadge from './RunCreditBadge';
import AudioResultPanel, { type AudioResultHistoryItem } from './AudioResultPanel';
import { useLocaleText } from '@/utils/localeText';
import { useProjectContentStore } from '@/stores/projectContentStore';
import { useImeSafeTextValue } from '../hooks/useImeSafeTextInput';
import {
  flowNodeControlField,
  flowNodeShellChrome,
  useFlowNodeDarkTheme,
} from './flowNodeDarkTheme';
import { TENCENT_SYSTEM_VOICES } from './tencentSystemVoices';
import {
  AUDIO_STUDIO_MODES,
  getAudioStudioModeConfig,
  type AudioStudioMode,
} from './audioStudioModes';

const MAX_AUDIO_SIZE = 100 * 1024 * 1024; // 100MB

const SUPPORTED_AUDIO_EXTENSIONS = [
  'mp3', 'wav', 'aac', 'm4a', 'ogg', 'opus', 'flac', 'webm', 'weba', 'amr', 'aiff', 'aif', 'wma',
];
const SUPPORTED_AUDIO_PATTERN = new RegExp(
  `\\.(${SUPPORTED_AUDIO_EXTENSIONS.join('|')})$`,
  'i'
);
const SUPPORTED_EXTENSIONS = SUPPORTED_AUDIO_EXTENSIONS.map((ext) => `.${ext}`).join(',');

const MINIMAX_VOICE_OPTIONS = [
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

const SEED_FORMAT_OPTIONS = ['wav', 'mp3', 'pcm', 'ogg_opus'] as const;

const LANGUAGE_OPTIONS = [
  { value: 'zh', zh: '中文 (zh)', en: 'Chinese (zh)' },
  { value: 'yue', zh: '粤语 (yue)', en: 'Cantonese (yue)' },
  { value: 'en', zh: '英语 (en)', en: 'English (en)' },
  { value: 'ja', zh: '日语 (ja)', en: 'Japanese (ja)' },
  { value: 'ko', zh: '韩语 (ko)', en: 'Korean (ko)' },
  { value: 'es', zh: '西班牙语 (es)', en: 'Spanish (es)' },
  { value: 'fr', zh: '法语 (fr)', en: 'French (fr)' },
  { value: 'de', zh: '德语 (de)', en: 'German (de)' },
  { value: 'ru', zh: '俄语 (ru)', en: 'Russian (ru)' },
  { value: 'pt', zh: '葡萄牙语 (pt)', en: 'Portuguese (pt)' },
  { value: 'it', zh: '意大利语 (it)', en: 'Italian (it)' },
  { value: 'id', zh: '印尼语 (id)', en: 'Indonesian (id)' },
  { value: 'vi', zh: '越南语 (vi)', en: 'Vietnamese (vi)' },
] as const;

const FONT_SUGGESTIONS = ['auto', 'SimHei', 'SimSun', 'Microsoft YaHei', 'PingFang SC', 'KaiTi', 'FangSong'] as const;

const PROMPT_MAX_LENGTH = 2000;
const LYRICS_MAX_LENGTH = 3500;

const isSupportedAudioFile = (file: File): boolean => {
  const name = (file?.name || '').trim();
  const mime = (file?.type || '').trim().toLowerCase();
  if (mime.startsWith('audio/')) return true;
  return SUPPORTED_AUDIO_PATTERN.test(name);
};

type AudioStudioNodeData = {
  mode?: AudioStudioMode;
  status?: string;
  progressStartedAt?: number | string | null;
  error?: string;
  audioUrl?: string;
  videoUrl?: string;
  history?: AudioResultHistoryItem[];
  selectedHistoryId?: string;
  creditsPerCall?: number;
  onRun?: (id: string) => void;
  // seed-audio
  text?: string;
  voice?: string;
  format?: string;
  sampleRate?: number;
  speechRate?: number;
  pitchRate?: number;
  loudnessRate?: number;
  // minimax-speech
  voiceId?: string;
  model?: string;
  outputFormat?: 'hex' | 'url';
  audioMode?: 'json' | 'hex';
  emotion?: string;
  soundEffects?: string[];
  // minimax-music
  prompt?: string;
  lyrics?: string;
  isInstrumental?: boolean;
  lyricsOptimizer?: boolean;
  musicModel?: string;
  // tencent-dub
  inputVideoUrl?: string;
  speakerUrlInput?: string;
  speakerGender?: 'male' | 'female';
  srcLang?: string;
  dstLang?: string;
  srcSubtitleUrl?: string;
  dstSubtitleUrl?: string;
  embedSubtitle?: boolean;
  font?: string;
  fontSize?: number;
  marginV?: number;
  outputPattern?: string;
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
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [voiceKeyword, setVoiceKeyword] = React.useState('');
  const [handleHover, setHandleHover] = React.useState<string | null>(null);

  const mode = getAudioStudioModeConfig(data.mode).key;

  const hasTextInput = useStore((state: ReactFlowState) =>
    state.edges.some((edge) => edge.target === id && edge.targetHandle === 'text')
  );
  const hasVideoInput = useStore((state: ReactFlowState) =>
    state.edges.some((edge) => edge.target === id && edge.targetHandle === 'video')
  );

  const shell = flowNodeShellChrome(isFlowDark, !!selected);
  const controlField = flowNodeControlField(isFlowDark);
  const boxShadow = selected ? '0 0 0 2px rgba(37,99,235,0.12)' : '0 1px 2px rgba(0,0,0,0.04)';

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

  const handleInputChange = React.useCallback(
    (key: string, value: unknown) => updateNodeData({ [key]: value }),
    [updateNodeData]
  );

  const handleModeChange = React.useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const next = event.target.value as AudioStudioMode;
      updateNodeData({ mode: next, status: 'idle', error: undefined });
    },
    [updateNodeData]
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

  // ---- minimax-music 文本输入（IME 安全） ----
  const prompt = typeof data.prompt === 'string' ? data.prompt : '';
  const lyrics = typeof data.lyrics === 'string' ? data.lyrics : '';
  const promptInput = useImeSafeTextValue(
    prompt,
    (next: string) => updateNodeData({ prompt: next }),
    { maxLength: PROMPT_MAX_LENGTH }
  );
  const lyricsInput = useImeSafeTextValue(
    lyrics,
    (next: string) => updateNodeData({ lyrics: next }),
    { maxLength: LYRICS_MAX_LENGTH }
  );

  // ---- tencent 音色筛选 ----
  const voiceLanguageCode = React.useMemo(() => {
    const srcLang = typeof data.srcLang === 'string' ? data.srcLang.trim().toLowerCase() : '';
    return srcLang || 'zh';
  }, [data.srcLang]);
  const languageMatchedVoices = React.useMemo(() => {
    const matched = TENCENT_SYSTEM_VOICES.filter((voice) => voice.langCode === voiceLanguageCode);
    return matched.length > 0 ? matched : TENCENT_SYSTEM_VOICES;
  }, [voiceLanguageCode]);
  const filteredVoiceOptions = React.useMemo(() => {
    const keyword = voiceKeyword.trim().toLowerCase();
    if (!keyword) return languageMatchedVoices;
    return languageMatchedVoices.filter((voice) => {
      const label = `${voice.index} ${voice.langZh} ${voice.nameZh} ${voice.genderZh} ${voice.ageZh} ${voice.voiceId}`.toLowerCase();
      return label.includes(keyword);
    });
  }, [languageMatchedVoices, voiceKeyword]);
  const handleTencentVoiceSelect = React.useCallback(
    (voiceId: string) => {
      if (!voiceId) {
        updateNodeData({ voiceId: '' });
        return;
      }
      const matched = TENCENT_SYSTEM_VOICES.find((voice) => voice.voiceId === voiceId);
      updateNodeData({ voiceId, speakerGender: matched?.gender || data.speakerGender || 'male' });
    },
    [data.speakerGender, updateNodeData]
  );

  const baseInputStyle: React.CSSProperties = {
    width: '100%',
    height: 28,
    padding: '0 6px',
    fontSize: 12,
    borderRadius: 6,
    ...controlField,
  };

  // ---- run disabled 判定（按 mode） ----
  const isInstrumental = data.isInstrumental === true;
  const lyricsOptimizer = data.lyricsOptimizer === true;
  const hasSpeakerUrl =
    typeof data.speakerUrlInput === 'string' && data.speakerUrlInput.trim().length > 0;
  const hasSubtitleUrls =
    typeof data.srcSubtitleUrl === 'string' &&
    data.srcSubtitleUrl.trim().length > 0 &&
    typeof data.dstSubtitleUrl === 'string' &&
    data.dstSubtitleUrl.trim().length > 0;
  const localText = typeof data.text === 'string' ? data.text.trim() : '';

  const runDisabled = React.useMemo(() => {
    if (data.status === 'running' || data.status === 'uploading') return true;
    switch (mode) {
      case 'seed-audio':
        return !hasTextInput && !localText;
      case 'minimax-speech':
        return !hasTextInput && !localText;
      case 'minimax-music':
        if (isInstrumental) return !(prompt.trim() || hasTextInput);
        return !(lyrics.trim() || lyricsOptimizer);
      case 'tencent-dub':
        return !hasVideoInput || (!hasTextInput && !hasSpeakerUrl && !hasSubtitleUrls);
      case 'upload':
        return true; // 导入模式没有 Run（通过上传按钮）
      default:
        return false;
    }
  }, [
    data.status, mode, hasTextInput, localText, isInstrumental, prompt, lyrics,
    lyricsOptimizer, hasVideoInput, hasSpeakerUrl, hasSubtitleUrls,
  ]);

  const modeConfig = getAudioStudioModeConfig(mode);
  const inputHandles = modeConfig.inputHandles;
  const outputHandles = modeConfig.outputHandles;

  const labelStyle: React.CSSProperties = { fontSize: 11, color: isFlowDark ? '#9ca3af' : '#6b7280' };
  const switchLabelStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    border: controlField.border as string, borderRadius: 6, padding: '6px 8px',
    fontSize: 12, color: controlField.color as string, background: controlField.background as string,
  };

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
        {mode !== 'upload' ? (
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

      {/* 模式选择 */}
      <select
        className="nodrag"
        value={mode}
        onChange={handleModeChange}
        onPointerDownCapture={stopNodeDrag}
        onMouseDownCapture={stopNodeDrag}
        style={{ ...baseInputStyle, fontWeight: 600 }}
      >
        {AUDIO_STUDIO_MODES.map((m) => (
          <option key={m.key} value={m.key}>
            {lt(m.zh, m.en)}
          </option>
        ))}
      </select>

      {/* ===== seed-audio ===== */}
      {mode === 'seed-audio' ? (
        <div style={{ display: 'grid', gap: 6 }}>
          <input
            className="nodrag"
            type="text"
            value={data.voice || ''}
            placeholder={lt('音色 speaker（留空走参考）', 'Speaker id (blank = reference)')}
            onChange={(e) => handleInputChange('voice', e.target.value)}
            onPointerDownCapture={stopNodeDrag}
            onMouseDownCapture={stopNodeDrag}
            style={baseInputStyle}
          />
          <div style={{ fontSize: 11, color: isFlowDark ? '#9ca3af' : '#6b7280', lineHeight: 1.35 }}>
            {lt(
              '连 text 输入合成文本；可选连接 audio（参考音频 @音频N）或 image（参考图，二选一）。',
              'Connect text; optionally audio (reference @音频N) or image (mutually exclusive).'
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <select
              className="nodrag"
              value={data.format || 'mp3'}
              onChange={(e) => handleInputChange('format', e.target.value)}
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
              style={baseInputStyle}
            >
              {SEED_FORMAT_OPTIONS.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
            <input
              className="nodrag"
              type="number"
              value={typeof data.sampleRate === 'number' ? data.sampleRate : ''}
              placeholder={lt('采样率', 'sampleRate')}
              onChange={(e) => handleInputChange('sampleRate', e.target.value ? Number(e.target.value) : undefined)}
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
              style={baseInputStyle}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
            <input
              className="nodrag"
              type="number"
              value={typeof data.speechRate === 'number' ? data.speechRate : ''}
              placeholder={lt('语速', 'speed')}
              title={lt('语速 [-50,100]', 'speechRate [-50,100]')}
              onChange={(e) => handleInputChange('speechRate', e.target.value ? Number(e.target.value) : undefined)}
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
              style={baseInputStyle}
            />
            <input
              className="nodrag"
              type="number"
              value={typeof data.pitchRate === 'number' ? data.pitchRate : ''}
              placeholder={lt('音调', 'pitch')}
              title={lt('音调 [-12,12]', 'pitchRate [-12,12]')}
              onChange={(e) => handleInputChange('pitchRate', e.target.value ? Number(e.target.value) : undefined)}
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
              style={baseInputStyle}
            />
            <input
              className="nodrag"
              type="number"
              value={typeof data.loudnessRate === 'number' ? data.loudnessRate : ''}
              placeholder={lt('响度', 'loud')}
              title={lt('响度 [-50,100]', 'loudnessRate [-50,100]')}
              onChange={(e) => handleInputChange('loudnessRate', e.target.value ? Number(e.target.value) : undefined)}
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
              style={baseInputStyle}
            />
          </div>
        </div>
      ) : null}

      {/* ===== minimax-speech ===== */}
      {mode === 'minimax-speech' ? (
        <div style={{ display: 'grid', gap: 6 }}>
          <select
            className="nodrag"
            value={data.voiceId || 'male-qn-qingse'}
            onChange={(e) => handleInputChange('voiceId', e.target.value)}
            onPointerDownCapture={stopNodeDrag}
            onMouseDownCapture={stopNodeDrag}
            style={baseInputStyle}
          >
            {MINIMAX_VOICE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {lt(option.zh, option.en)}
              </option>
            ))}
          </select>
          <select
            className="nodrag"
            value={data.emotion || ''}
            onChange={(e) => handleInputChange('emotion', e.target.value.trim() || undefined)}
            onPointerDownCapture={stopNodeDrag}
            onMouseDownCapture={stopNodeDrag}
            style={baseInputStyle}
          >
            <option value="">{lt('情感：默认', 'Emotion: default')}</option>
            {EMOTION_OPTIONS.map((emotion) => (
              <option key={emotion.value} value={emotion.value}>{emotion.label}</option>
            ))}
          </select>
          <div style={{ marginTop: 2, paddingTop: 6, borderTop: `1px solid ${isFlowDark ? '#333333' : '#f0f0f0'}` }}>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
              style={{
                width: '100%', padding: '6px 8px', background: 'transparent',
                border: controlField.border as string, borderRadius: 6, fontSize: 11,
                color: isFlowDark ? '#9ca3af' : '#6b7280', cursor: 'pointer', textAlign: 'left',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}
            >
              <span>{lt('高级设置', 'Advanced Settings')}</span>
              <span style={{ transform: showAdvanced ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▼</span>
            </button>
            {showAdvanced ? (
              <div style={{ marginTop: 6, display: 'grid', gap: 6 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <select
                    className="nodrag"
                    value={data.outputFormat === 'hex' ? 'hex' : 'url'}
                    onChange={(e) => handleInputChange('outputFormat', e.target.value === 'hex' ? 'hex' : 'url')}
                    onPointerDownCapture={stopNodeDrag}
                    onMouseDownCapture={stopNodeDrag}
                    style={baseInputStyle}
                  >
                    <option value="url">{lt('返回 URL', 'Output URL')}</option>
                    <option value="hex">{lt('返回 HEX', 'Output HEX')}</option>
                  </select>
                  <select
                    className="nodrag"
                    value={data.audioMode === 'hex' ? 'hex' : 'json'}
                    onChange={(e) => handleInputChange('audioMode', e.target.value === 'hex' ? 'hex' : 'json')}
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
                  value={Array.isArray(data.soundEffects) ? data.soundEffects : []}
                  onChange={(e) =>
                    handleInputChange('soundEffects', Array.from(e.target.selectedOptions).map((opt) => opt.value))
                  }
                  onPointerDownCapture={stopNodeDrag}
                  onMouseDownCapture={stopNodeDrag}
                  style={{ ...baseInputStyle, height: 'auto', minHeight: 60, padding: '4px' }}
                >
                  {SOUND_EFFECT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* ===== minimax-music ===== */}
      {mode === 'minimax-music' ? (
        <div style={{ display: 'grid', gap: 6 }}>
          <label style={labelStyle}>
            {lt('曲风提示词', 'Prompt')} ({promptInput.value.length}/{PROMPT_MAX_LENGTH})
          </label>
          <textarea
            className="nodrag"
            value={promptInput.value}
            onChange={promptInput.onChange}
            onCompositionStart={promptInput.onCompositionStart}
            onCompositionEnd={promptInput.onCompositionEnd}
            onPointerDownCapture={stopNodeDrag}
            onMouseDownCapture={stopNodeDrag}
            maxLength={PROMPT_MAX_LENGTH}
            placeholder={lt('流行音乐, 难过, 适合在下雨的晚上', 'Pop music, sad mood, rainy night')}
            style={{ width: '100%', minHeight: 60, resize: 'vertical', fontSize: 12, lineHeight: 1.45, borderRadius: 6, padding: '8px 10px', ...controlField }}
          />
          <label style={switchLabelStyle}>
            <span>{lt('纯音乐模式', 'Instrumental Mode')}</span>
            <input
              type="checkbox"
              checked={isInstrumental}
              onChange={(e) => handleInputChange('isInstrumental', e.target.checked)}
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
            />
          </label>
          <label style={switchLabelStyle}>
            <span>{lt('AI 自动填词', 'AI Lyrics Optimizer')}</span>
            <input
              type="checkbox"
              checked={lyricsOptimizer}
              onChange={(e) => handleInputChange('lyricsOptimizer', e.target.checked)}
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
            />
          </label>
          {!isInstrumental ? (
            <>
              <label style={labelStyle}>
                {lt('歌词', 'Lyrics')} ({lyricsInput.value.length}/{LYRICS_MAX_LENGTH})
              </label>
              <textarea
                className="nodrag"
                value={lyricsInput.value}
                onChange={lyricsInput.onChange}
                onCompositionStart={lyricsInput.onCompositionStart}
                onCompositionEnd={lyricsInput.onCompositionEnd}
                onPointerDownCapture={stopNodeDrag}
                onMouseDownCapture={stopNodeDrag}
                maxLength={LYRICS_MAX_LENGTH}
                placeholder={lt('支持 [Verse], [Chorus], [Bridge] 等结构标签', 'Supports [Verse], [Chorus], [Bridge]')}
                style={{ width: '100%', minHeight: 80, resize: 'vertical', fontSize: 12, lineHeight: 1.45, borderRadius: 6, padding: '8px 10px', ...controlField }}
              />
            </>
          ) : null}
        </div>
      ) : null}

      {/* ===== tencent-dub ===== */}
      {mode === 'tencent-dub' ? (
        <div style={{ display: 'grid', gap: 6 }}>
          <input
            className="nodrag"
            type="text"
            value={data.speakerUrlInput || ''}
            placeholder={lt('Speaker 文件 URL（优先）', 'Speaker file URL (preferred)')}
            onChange={(e) => handleInputChange('speakerUrlInput', e.target.value)}
            onPointerDownCapture={stopNodeDrag}
            onMouseDownCapture={stopNodeDrag}
            style={baseInputStyle}
          />
          <div style={{ fontSize: 11, color: isFlowDark ? '#9ca3af' : '#6b7280', lineHeight: 1.35 }}>
            {lt('连 video 输入；模式：Prompt / voiceId / speakerUrl / 字幕 URL。', 'Connect video; mode: prompt / voiceId / speakerUrl / subtitle URLs.')}
          </div>
          <div style={{ marginTop: 2, paddingTop: 6, borderTop: `1px solid ${isFlowDark ? '#333333' : '#f0f0f0'}` }}>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
              style={{
                width: '100%', padding: '6px 8px', background: 'transparent',
                border: controlField.border as string, borderRadius: 6, fontSize: 11,
                color: isFlowDark ? '#9ca3af' : '#6b7280', cursor: 'pointer', textAlign: 'left',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}
            >
              <span>{lt('高级设置', 'Advanced Settings')}</span>
              <span style={{ transform: showAdvanced ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▼</span>
            </button>
            {showAdvanced ? (
              <div style={{ marginTop: 6, display: 'grid', gap: 6 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <select
                    className="nodrag"
                    value={data.srcLang || 'zh'}
                    onChange={(e) => handleInputChange('srcLang', e.target.value)}
                    onPointerDownCapture={stopNodeDrag}
                    onMouseDownCapture={stopNodeDrag}
                    style={baseInputStyle}
                  >
                    {LANGUAGE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{lt(option.zh, option.en)}</option>
                    ))}
                  </select>
                  <select
                    className="nodrag"
                    value={data.dstLang || 'en'}
                    onChange={(e) => handleInputChange('dstLang', e.target.value)}
                    onPointerDownCapture={stopNodeDrag}
                    onMouseDownCapture={stopNodeDrag}
                    style={baseInputStyle}
                  >
                    {LANGUAGE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{lt(option.zh, option.en)}</option>
                    ))}
                  </select>
                </div>
                <input
                  className="nodrag"
                  type="text"
                  value={voiceKeyword}
                  placeholder={lt('搜索系统音色', 'Search system voices')}
                  onChange={(e) => setVoiceKeyword(e.target.value)}
                  onPointerDownCapture={stopNodeDrag}
                  onMouseDownCapture={stopNodeDrag}
                  style={baseInputStyle}
                />
                <select
                  className="nodrag"
                  value={data.voiceId || ''}
                  onChange={(e) => handleTencentVoiceSelect(e.target.value)}
                  onPointerDownCapture={stopNodeDrag}
                  onMouseDownCapture={stopNodeDrag}
                  style={baseInputStyle}
                >
                  <option value="">{lt('不指定系统音色', 'No system voice')}</option>
                  {filteredVoiceOptions.slice(0, 200).map((voice) => (
                    <option key={voice.voiceId} value={voice.voiceId}>
                      {`${voice.index}. ${voice.nameZh} (${voice.langZh}/${voice.genderZh}/${voice.ageZh})`}
                    </option>
                  ))}
                </select>
                <select
                  className="nodrag"
                  value={data.speakerGender || 'male'}
                  onChange={(e) => handleInputChange('speakerGender', e.target.value === 'female' ? 'female' : 'male')}
                  onPointerDownCapture={stopNodeDrag}
                  onMouseDownCapture={stopNodeDrag}
                  style={baseInputStyle}
                >
                  <option value="male">{lt('男声', 'Male')}</option>
                  <option value="female">{lt('女声', 'Female')}</option>
                </select>
                <input
                  className="nodrag"
                  type="text"
                  value={data.srcSubtitleUrl || ''}
                  placeholder={lt('源字幕 URL', 'Source subtitle URL')}
                  onChange={(e) => handleInputChange('srcSubtitleUrl', e.target.value)}
                  onPointerDownCapture={stopNodeDrag}
                  onMouseDownCapture={stopNodeDrag}
                  style={baseInputStyle}
                />
                <input
                  className="nodrag"
                  type="text"
                  value={data.dstSubtitleUrl || ''}
                  placeholder={lt('目标字幕 URL', 'Target subtitle URL')}
                  onChange={(e) => handleInputChange('dstSubtitleUrl', e.target.value)}
                  onPointerDownCapture={stopNodeDrag}
                  onMouseDownCapture={stopNodeDrag}
                  style={baseInputStyle}
                />
                <input
                  className="nodrag"
                  type="text"
                  list={`audiostudio-font-${id}`}
                  value={data.font || 'auto'}
                  placeholder={lt('字体，默认 auto', 'Font, default auto')}
                  onChange={(e) => handleInputChange('font', e.target.value)}
                  onPointerDownCapture={stopNodeDrag}
                  onMouseDownCapture={stopNodeDrag}
                  style={baseInputStyle}
                />
                <datalist id={`audiostudio-font-${id}`}>
                  {FONT_SUGGESTIONS.map((font) => (<option key={font} value={font} />))}
                </datalist>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <input
                    className="nodrag"
                    type="number"
                    min={1}
                    value={typeof data.fontSize === 'number' ? data.fontSize : 50}
                    placeholder="50"
                    onChange={(e) => handleInputChange('fontSize', Number(e.target.value))}
                    onPointerDownCapture={stopNodeDrag}
                    onMouseDownCapture={stopNodeDrag}
                    style={baseInputStyle}
                  />
                  <input
                    className="nodrag"
                    type="number"
                    min={0}
                    value={typeof data.marginV === 'number' ? data.marginV : 50}
                    placeholder="50"
                    onChange={(e) => handleInputChange('marginV', Number(e.target.value))}
                    onPointerDownCapture={stopNodeDrag}
                    onMouseDownCapture={stopNodeDrag}
                    style={baseInputStyle}
                  />
                </div>
                <input
                  className="nodrag"
                  type="text"
                  value={data.outputPattern || ''}
                  placeholder={lt('输出文件前缀', 'Output prefix')}
                  onChange={(e) => handleInputChange('outputPattern', e.target.value)}
                  onPointerDownCapture={stopNodeDrag}
                  onMouseDownCapture={stopNodeDrag}
                  style={baseInputStyle}
                />
                <label
                  className="nodrag"
                  onPointerDownCapture={stopNodeDrag}
                  onMouseDownCapture={stopNodeDrag}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: controlField.color as string }}
                >
                  <input
                    type="checkbox"
                    checked={data.embedSubtitle ?? true}
                    onChange={(e) => handleInputChange('embedSubtitle', e.target.checked)}
                  />
                  {lt('压制字幕', 'Burn subtitles')}
                </label>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* ===== upload ===== */}
      {mode === 'upload' ? (
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
        downloadPrefix={mode === 'tencent-dub' ? 'tencent-dub' : 'audio'}
        downloadExt={mode === 'tencent-dub' ? '.mp4' : '.mp3'}
        stopNodeDrag={stopNodeDrag}
        emptyPromptZh={mode === 'tencent-dub' ? '配音任务' : '空 Prompt'}
        emptyPromptEn={mode === 'tencent-dub' ? 'Dubbing task' : 'Empty prompt'}
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
