import React from 'react';
import { Handle, Position, useStore, type ReactFlowState } from 'reactflow';
import { AlertTriangle, Download, Link2, Mic } from 'lucide-react';
import GenerationProgressBar from './GenerationProgressBar';
import { useLocaleText } from '@/utils/localeText';
import {
  flowAudioPlayerShell,
  flowSpeechDownloadButton,
  flowSpeechHistoryMetaColor,
  flowSpeechHistoryPromptColor,
  flowSpeechHistoryRow,
  flowSpeechHistorySectionDivider,
  useFlowNodeDarkTheme,
} from './flowNodeDarkTheme';
import { TENCENT_SYSTEM_VOICES } from './tencentSystemVoices';
import RunCreditBadge from './RunCreditBadge';

const LANGUAGE_OPTIONS = [
  { value: 'zh', zh: '中文 (zh)', en: 'Chinese (zh)' },
  { value: 'yue', zh: '粤语 (yue)', en: 'Cantonese (yue)' },
  { value: 'en', zh: '英语 (en)', en: 'English (en)' },
  { value: 'ja', zh: '日语 (ja)', en: 'Japanese (ja)' },
  { value: 'de', zh: '德语 (de)', en: 'German (de)' },
  { value: 'fr', zh: '法语 (fr)', en: 'French (fr)' },
  { value: 'ko', zh: '韩语 (ko)', en: 'Korean (ko)' },
  { value: 'ru', zh: '俄语 (ru)', en: 'Russian (ru)' },
  { value: 'uk', zh: '乌克兰语 (uk)', en: 'Ukrainian (uk)' },
  { value: 'pt', zh: '葡萄牙语 (pt)', en: 'Portuguese (pt)' },
  { value: 'it', zh: '意大利语 (it)', en: 'Italian (it)' },
  { value: 'es', zh: '西班牙语 (es)', en: 'Spanish (es)' },
  { value: 'id', zh: '印尼语 (id)', en: 'Indonesian (id)' },
  { value: 'nl', zh: '荷兰语 (nl)', en: 'Dutch (nl)' },
  { value: 'tr', zh: '土耳其语 (tr)', en: 'Turkish (tr)' },
  { value: 'fil', zh: '菲律宾语 (fil)', en: 'Filipino (fil)' },
  { value: 'ms', zh: '马来语 (ms)', en: 'Malay (ms)' },
  { value: 'el', zh: '希腊语 (el)', en: 'Greek (el)' },
  { value: 'fi', zh: '芬兰语 (fi)', en: 'Finnish (fi)' },
  { value: 'hr', zh: '克罗地亚语 (hr)', en: 'Croatian (hr)' },
  { value: 'sk', zh: '斯洛伐克语 (sk)', en: 'Slovak (sk)' },
  { value: 'pl', zh: '波兰语 (pl)', en: 'Polish (pl)' },
  { value: 'sv', zh: '瑞典语 (sv)', en: 'Swedish (sv)' },
  { value: 'hi', zh: '印地语 (hi)', en: 'Hindi (hi)' },
  { value: 'bg', zh: '保加利亚语 (bg)', en: 'Bulgarian (bg)' },
  { value: 'ro', zh: '罗马尼亚语 (ro)', en: 'Romanian (ro)' },
  { value: 'ar', zh: '阿拉伯语 (ar)', en: 'Arabic (ar)' },
  { value: 'cs', zh: '捷克语 (cs)', en: 'Czech (cs)' },
  { value: 'da', zh: '丹麦语 (da)', en: 'Danish (da)' },
  { value: 'ta', zh: '泰米尔语 (ta)', en: 'Tamil (ta)' },
  { value: 'hun', zh: '匈牙利语 (hun)', en: 'Hungarian (hun)' },
  { value: 'vi', zh: '越南语 (vi)', en: 'Vietnamese (vi)' },
] as const;

const FONT_SUGGESTIONS = [
  'auto',
  'SimHei',
  'SimSun',
  'Microsoft YaHei',
  'PingFang SC',
  'KaiTi',
  'FangSong',
] as const;

type SpeechHistoryItem = {
  id: string;
  prompt: string;
  audioUrl: string;
  videoUrl?: string;
  createdAt: number;
};

type Props = {
  id: string;
  data: {
    status?: 'idle' | 'running' | 'succeeded' | 'failed';
    audioUrl?: string;
    videoUrl?: string;
    error?: string;
    inputVideoUrl?: string;
    text?: string;
    speakerUrlInput?: string;
    voiceId?: string;
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
    history?: SpeechHistoryItem[];
    selectedHistoryId?: string;
    creditsPerCall?: number;
    onRun?: (id: string) => void;
  };
  selected?: boolean;
};

function TencentSpeechNode({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const isFlowDark = useFlowNodeDarkTheme();
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [downloadingId, setDownloadingId] = React.useState<string | null>(null);
  const [voiceKeyword, setVoiceKeyword] = React.useState('');
  const [handleHover, setHandleHover] = React.useState<string | null>(null);
  const hasPromptInput = useStore((state: ReactFlowState) =>
    state.edges.some((edge) => edge.target === id && edge.targetHandle === 'text'),
  );
  const hasVideoInput = useStore((state: ReactFlowState) =>
    state.edges.some((edge) => edge.target === id && edge.targetHandle === 'video'),
  );
  const borderColor = selected ? '#2563eb' : '#e5e7eb';
  const boxShadow = selected ? '0 0 0 2px rgba(37,99,235,0.12)' : '0 1px 2px rgba(0,0,0,0.04)';

  const updateNodeData = React.useCallback(
    (patch: Record<string, unknown>) => {
      window.dispatchEvent(
        new CustomEvent('flow:updateNodeData', {
          detail: { id, patch },
        }),
      );
    },
    [id],
  );

  const stopNodeDrag = React.useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
    const nativeEvent = (event as React.SyntheticEvent<any, Event>).nativeEvent as Event & {
      stopImmediatePropagation?: () => void;
    };
    nativeEvent.stopImmediatePropagation?.();
  }, []);

  const handleRun = React.useCallback(() => {
    data.onRun?.(id);
  }, [data.onRun, id]);

  const handleInputChange = React.useCallback(
    (key: string, value: unknown) => {
      updateNodeData({ [key]: value });
    },
    [updateNodeData],
  );

  const selectedVoice = React.useMemo(() => {
    const voiceId = typeof data.voiceId === 'string' ? data.voiceId.trim() : '';
    if (!voiceId) return null;
    return TENCENT_SYSTEM_VOICES.find((voice) => voice.voiceId === voiceId) || null;
  }, [data.voiceId]);

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
      const label = `${voice.index} ${voice.langZh} ${voice.nameZh} ${voice.genderZh} ${voice.ageZh} ${voice.sampleLabel} ${voice.voiceId}`.toLowerCase();
      return label.includes(keyword);
    });
  }, [languageMatchedVoices, voiceKeyword]);

  const handleVoiceSelect = React.useCallback(
    (voiceId: string) => {
      if (!voiceId) {
        updateNodeData({ voiceId: '' });
        return;
      }
      const matched = TENCENT_SYSTEM_VOICES.find((voice) => voice.voiceId === voiceId);
      updateNodeData({
        voiceId,
        speakerGender: matched?.gender || data.speakerGender || 'male',
      });
    },
    [data.speakerGender, updateNodeData],
  );

  const historyItems = React.useMemo<SpeechHistoryItem[]>(() => {
    const normalized = Array.isArray(data.history)
      ? data.history
          .filter((item) => item && typeof item.audioUrl === 'string' && item.audioUrl.trim().length > 0)
          .map((item) => ({
            id: item.id || `tencent-item-${item.createdAt}-${item.audioUrl}`,
            prompt: typeof item.prompt === 'string' ? item.prompt : '',
            audioUrl: item.audioUrl.trim(),
            videoUrl: typeof item.videoUrl === 'string' ? item.videoUrl.trim() : undefined,
            createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
          }))
      : [];
    if (normalized.length > 0) return normalized;
    if (typeof data.audioUrl === 'string' && data.audioUrl.trim().length > 0) {
      return [
        {
          id: data.selectedHistoryId || `tencent-legacy-${id}`,
          prompt: '',
          audioUrl: data.audioUrl.trim(),
          videoUrl: typeof data.videoUrl === 'string' ? data.videoUrl.trim() : undefined,
          createdAt: Date.now(),
        },
      ];
    }
    return [];
  }, [data.audioUrl, data.history, data.selectedHistoryId, data.videoUrl, id]);

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
    if (data.videoUrl !== selectedHistory.videoUrl) {
      patch.videoUrl = selectedHistory.videoUrl;
    }
    if (data.selectedHistoryId !== selectedHistory.id) {
      patch.selectedHistoryId = selectedHistory.id;
    }
    if (Object.keys(patch).length > 0) {
      updateNodeData(patch);
    }
  }, [data.audioUrl, data.selectedHistoryId, data.videoUrl, selectedHistory, updateNodeData]);

  const selectHistory = React.useCallback(
    (item: SpeechHistoryItem) => {
      updateNodeData({
        selectedHistoryId: item.id,
        audioUrl: item.audioUrl,
        videoUrl: item.videoUrl,
      });
    },
    [updateNodeData],
  );

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
      anchor.download = `tencent-speech-${timestamp}.mp4`;
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

  const baseInputStyle: React.CSSProperties = {
    width: '100%',
    height: 28,
    padding: '0 6px',
    fontSize: 12,
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    background: '#fff',
  };

  const hasSpeakerUrl = typeof data.speakerUrlInput === 'string' && data.speakerUrlInput.trim().length > 0;
  const hasSubtitleUrls =
    typeof data.srcSubtitleUrl === 'string' &&
    data.srcSubtitleUrl.trim().length > 0 &&
    typeof data.dstSubtitleUrl === 'string' &&
    data.dstSubtitleUrl.trim().length > 0;
  const runDisabled = data.status === 'running' || !hasVideoInput || (!hasPromptInput && !hasSpeakerUrl && !hasSubtitleUrls);

  return (
    <div
      style={{
        width: 280,
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
          <Mic size={20} color="#0ea5e9" strokeWidth={2.2} />
          <span>
            {lt('腾讯语音合成', 'Tencent Speech')}
            <RunCreditBadge credits={data.creditsPerCall} inline />
          </span>
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
        <input
          className="nodrag"
          type="text"
          value={data.speakerUrlInput || ''}
          placeholder={lt('Speaker 文件 URL（优先）', 'Speaker file URL (preferred)')}
          onChange={(event) => handleInputChange('speakerUrlInput', event.target.value)}
          onPointerDownCapture={stopNodeDrag}
          onMouseDownCapture={stopNodeDrag}
          style={baseInputStyle}
        />

        <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.35 }}>
          {lt(
            '模式：Prompt / voiceId / speakerUrl / 字幕 URL。',
            'Mode: prompt / voiceId / speakerUrl / subtitle URLs.',
          )}
        </div>

        <div style={{ marginTop: 2, paddingTop: 6, borderTop: '1px solid #f0f0f0' }}>
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
            <span
              style={{
                transform: showAdvanced ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s',
              }}
            >
              ▼
            </span>
          </button>

          {showAdvanced && (
            <div style={{ marginTop: 6, display: 'grid', gap: 6 }}>
              <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.35, fontWeight: 500 }}>
                {lt('源语言 -> 目标语言', 'Source -> Target')}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <select
                  className="nodrag"
                  value={data.srcLang || 'zh'}
                  onChange={(event) => handleInputChange('srcLang', event.target.value)}
                  onPointerDownCapture={stopNodeDrag}
                  onMouseDownCapture={stopNodeDrag}
                  style={baseInputStyle}
                >
                  {LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {lt(option.zh, option.en)}
                    </option>
                  ))}
                </select>
                <select
                  className="nodrag"
                  value={data.dstLang || 'zh'}
                  onChange={(event) => handleInputChange('dstLang', event.target.value)}
                  onPointerDownCapture={stopNodeDrag}
                  onMouseDownCapture={stopNodeDrag}
                  style={baseInputStyle}
                >
                  {LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {lt(option.zh, option.en)}
                    </option>
                  ))}
                </select>
              </div>

              <div
                style={{
                  display: 'grid',
                  gap: 6,
                  border: isFlowDark ? '1px solid #333333' : '1px solid #f0f0f0',
                  borderRadius: 6,
                  padding: 6,
                  background: isFlowDark ? '#1d1d1d' : '#fafafa',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>
                    {lt('系统音色 voiceId', 'System VoiceId')}
                  </div>
                  <div style={{ fontSize: 10, color: '#6b7280' }}>
                    {filteredVoiceOptions.length}/{TENCENT_SYSTEM_VOICES.length}
                  </div>
                </div>

                <input
                  className="nodrag"
                  type="text"
                  value={voiceKeyword}
                  placeholder={lt('搜索音色：序号/语种/名称', 'Search voices')}
                  onChange={(event) => setVoiceKeyword(event.target.value)}
                  onPointerDownCapture={stopNodeDrag}
                  onMouseDownCapture={stopNodeDrag}
                  style={baseInputStyle}
                />

                <select
                  className="nodrag"
                  value={selectedVoice?.voiceId || ''}
                  onChange={(event) => handleVoiceSelect(event.target.value)}
                  onPointerDownCapture={stopNodeDrag}
                  onMouseDownCapture={stopNodeDrag}
                  style={baseInputStyle}
                >
                  <option value="">
                    {lt('不指定系统音色（可走默认/字幕模式）', 'No system voice (default/subtitle mode)')}
                  </option>
                  {filteredVoiceOptions.slice(0, 200).map((voice) => (
                    <option key={voice.voiceId} value={voice.voiceId}>
                      {`${voice.index}. ${voice.nameZh} (${voice.langZh}/${voice.genderZh}/${voice.ageZh})`}
                    </option>
                  ))}
                </select>

                {filteredVoiceOptions.length > 200 ? (
                  <div style={{ fontSize: 10, color: '#6b7280' }}>
                    {lt('结果过多，请继续输入关键词缩小范围', 'Too many results, keep typing to narrow down')}
                  </div>
                ) : null}

                {selectedVoice ? (
                  <div style={{ fontSize: 10, color: '#0f766e' }}>
                    {lt(
                      `已选：${selectedVoice.nameZh}（${selectedVoice.langZh}/${selectedVoice.genderZh}/${selectedVoice.ageZh}）`,
                      `Selected: ${selectedVoice.nameZh} (${selectedVoice.langZh}/${selectedVoice.genderZh}/${selectedVoice.ageZh})`,
                    )}
                  </div>
                ) : null}

                <input
                  className="nodrag"
                  type="text"
                  value={data.voiceId || ''}
                  placeholder={lt('手动输入 voiceId（可覆盖下拉）', 'Manual voiceId override')}
                  onChange={(event) => handleInputChange('voiceId', event.target.value)}
                  onPointerDownCapture={stopNodeDrag}
                  onMouseDownCapture={stopNodeDrag}
                  style={baseInputStyle}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6 }}>
                <select
                  className="nodrag"
                  value={data.speakerGender || 'male'}
                  onChange={(event) =>
                    handleInputChange(
                      'speakerGender',
                      event.target.value === 'female' ? 'female' : 'male',
                    )
                  }
                  onPointerDownCapture={stopNodeDrag}
                  onMouseDownCapture={stopNodeDrag}
                  style={baseInputStyle}
                >
                  <option value="male">{lt('男声', 'Male')}</option>
                  <option value="female">{lt('女声', 'Female')}</option>
                </select>
              </div>

              <input
                className="nodrag"
                type="text"
                value={data.srcSubtitleUrl || ''}
                placeholder={lt('源字幕 URL (srcSubtitleUrl)', 'Source subtitle URL (srcSubtitleUrl)')}
                onChange={(event) => handleInputChange('srcSubtitleUrl', event.target.value)}
                onPointerDownCapture={stopNodeDrag}
                onMouseDownCapture={stopNodeDrag}
                style={baseInputStyle}
              />

              <input
                className="nodrag"
                type="text"
                value={data.dstSubtitleUrl || ''}
                placeholder={lt('目标字幕 URL (dstSubtitleUrl)', 'Target subtitle URL (dstSubtitleUrl)')}
                onChange={(event) => handleInputChange('dstSubtitleUrl', event.target.value)}
                onPointerDownCapture={stopNodeDrag}
                onMouseDownCapture={stopNodeDrag}
                style={baseInputStyle}
              />

              <div
                style={{
                  display: 'grid',
                  gap: 6,
                  border: isFlowDark ? '1px solid #333333' : '1px solid #f0f0f0',
                  borderRadius: 6,
                  padding: 6,
                  background: isFlowDark ? '#1d1d1d' : '#fafafa',
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>{lt('字体 font', 'Font')}</div>
                <input
                  className="nodrag"
                  type="text"
                  list={`tencent-font-suggestions-${id}`}
                  value={data.font || 'auto'}
                  placeholder={lt('字体名称，默认 auto', 'Font name, default auto')}
                  onChange={(event) => handleInputChange('font', event.target.value)}
                  onPointerDownCapture={stopNodeDrag}
                  onMouseDownCapture={stopNodeDrag}
                  style={baseInputStyle}
                />
                <datalist id={`tencent-font-suggestions-${id}`}>
                  {FONT_SUGGESTIONS.map((font) => (
                    <option key={font} value={font} />
                  ))}
                </datalist>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <div style={{ display: 'grid', gap: 4 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>
                    {lt('字号 fontSize', 'fontSize')}
                  </div>
                  <input
                    className="nodrag"
                    type="number"
                    min={1}
                    value={typeof data.fontSize === 'number' ? data.fontSize : 50}
                    placeholder="50"
                    onChange={(event) => handleInputChange('fontSize', Number(event.target.value))}
                    onPointerDownCapture={stopNodeDrag}
                    onMouseDownCapture={stopNodeDrag}
                    style={baseInputStyle}
                  />
                </div>

                <div style={{ display: 'grid', gap: 4 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>
                    {lt('离底部距离 marginV', 'marginV')}
                  </div>
                  <input
                    className="nodrag"
                    type="number"
                    min={0}
                    value={typeof data.marginV === 'number' ? data.marginV : 50}
                    placeholder="50"
                    onChange={(event) => handleInputChange('marginV', Number(event.target.value))}
                    onPointerDownCapture={stopNodeDrag}
                    onMouseDownCapture={stopNodeDrag}
                    style={baseInputStyle}
                  />
                </div>
              </div>

              <input
                className="nodrag"
                type="text"
                value={data.outputPattern || ''}
                placeholder={lt('输出文件前缀 (outputPattern)', 'Output prefix (outputPattern)')}
                onChange={(event) => handleInputChange('outputPattern', event.target.value)}
                onPointerDownCapture={stopNodeDrag}
                onMouseDownCapture={stopNodeDrag}
                style={baseInputStyle}
              />

              <label
                className="nodrag"
                onPointerDownCapture={stopNodeDrag}
                onMouseDownCapture={stopNodeDrag}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 12,
                  color: '#374151',
                }}
              >
                <input
                  type="checkbox"
                  checked={data.embedSubtitle ?? true}
                  onChange={(event) => handleInputChange('embedSubtitle', event.target.checked)}
                />
                {lt('压制字幕 (subtitle.embed)', 'Burn subtitles (subtitle.embed)')}
              </label>
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
        <div style={flowAudioPlayerShell(isFlowDark)}>
          <audio key={selectedHistory.audioUrl} controls style={{ width: '100%' }}>
            <source src={selectedHistory.audioUrl} />
          </audio>
        </div>
      ) : null}

      {selectedHistory?.videoUrl ? (
        <a
          href={selectedHistory.videoUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 12, color: '#2563eb', display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <Link2 size={12} />
          {lt('查看输出视频', 'Open output video')}
        </a>
      ) : null}

      {historyItems.length > 0 ? (
        <div
          style={{
            borderTop: `1px solid ${flowSpeechHistorySectionDivider(isFlowDark)}`,
            marginTop: 2,
            paddingTop: 6,
            display: 'grid',
            gap: 6,
          }}
        >
          <div style={{ fontSize: 11, color: flowSpeechHistoryMetaColor(isFlowDark), fontWeight: 600 }}>
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
                    borderRadius: 6,
                    padding: '6px 8px',
                    cursor: 'pointer',
                    ...flowSpeechHistoryRow(isFlowDark, isActive),
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 10, color: flowSpeechHistoryMetaColor(isFlowDark), marginBottom: 2 }}>
                      {formatHistoryTime(item.createdAt)}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: flowSpeechHistoryPromptColor(isFlowDark),
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={item.prompt || lt('腾讯语音任务', 'Tencent speech task')}
                    >
                      {item.prompt || lt('腾讯语音任务', 'Tencent speech task')}
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
                      fontSize: 11,
                      cursor: downloadingId === item.id ? 'not-allowed' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      ...flowSpeechDownloadButton(isFlowDark),
                    }}
                    title={lt('下载媒体', 'Download media')}
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
        style={{ top: '28%' }}
        onMouseEnter={() => setHandleHover('text-in')}
        onMouseLeave={() => setHandleHover(null)}
      />
      <Handle
        id="video"
        type="target"
        position={Position.Left}
        style={{ top: '44%' }}
        onMouseEnter={() => setHandleHover('video-in')}
        onMouseLeave={() => setHandleHover(null)}
      />
      <Handle
        id="audio"
        type="source"
        position={Position.Right}
        style={{ top: '48%' }}
        onMouseEnter={() => setHandleHover('audio-out')}
        onMouseLeave={() => setHandleHover(null)}
      />
      <Handle
        id="video"
        type="source"
        position={Position.Right}
        style={{ top: '62%' }}
        onMouseEnter={() => setHandleHover('video-out')}
        onMouseLeave={() => setHandleHover(null)}
      />
      {handleHover === 'text-in' ? (
        <div className="flow-tooltip" style={{ left: -8, top: '28%', transform: 'translate(-100%, -50%)' }}>text</div>
      ) : null}
      {handleHover === 'video-in' ? (
        <div className="flow-tooltip" style={{ left: -8, top: '44%', transform: 'translate(-100%, -50%)' }}>video</div>
      ) : null}
      {handleHover === 'audio-out' ? (
        <div className="flow-tooltip" style={{ right: -8, top: '48%', transform: 'translate(100%, -50%)' }}>audio</div>
      ) : null}
      {handleHover === 'video-out' ? (
        <div className="flow-tooltip" style={{ right: -8, top: '62%', transform: 'translate(100%, -50%)' }}>video</div>
      ) : null}
    </div>
  );
}

export default React.memo(TencentSpeechNode);
