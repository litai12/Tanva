import React from 'react';
import { Handle, Position } from 'reactflow';
import { Mic, AlertTriangle, Play } from 'lucide-react';
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

type Props = {
  id: string;
  data: {
    status?: 'idle' | 'running' | 'succeeded' | 'failed';
    audioUrl?: string;
    error?: string;
    text?: string;
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

  const handleTextChange = React.useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateNodeData({ text: e.target.value });
  }, [updateNodeData]);

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

  const handleButtonMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const selectedVoice = data.voiceId || 'male-qn-qingse';
  const selectedEmotion = data.emotion || '';
  const selectedOutputFormat = data.outputFormat === 'hex' ? 'hex' : 'url';
  const selectedAudioMode = data.audioMode === 'hex' ? 'hex' : 'json';
  const selectedSoundEffects = Array.isArray(data.soundEffects) ? data.soundEffects : [];

  const baseInputStyle: React.CSSProperties = {
    width: '100%',
    height: 28,
    padding: '0 8px',
    fontSize: 12,
    border: '1px solid #e5e7eb',
    borderRadius: 4,
    background: '#fff',
  };

  return (
    <div
      style={{
        minWidth: 280,
        background: '#fff',
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        boxShadow,
        transition: 'all 0.15s ease',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: '#555' }} />

      <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Mic size={16} color="#8b5cf6" />
          <span style={{ fontSize: 13, fontWeight: 500 }}>
            {lt('MiniMax 语音合成', 'MiniMax Speech')}
          </span>
        </div>
      </div>

      <div style={{ padding: 16 }}>
        <textarea
          className="nodrag"
          value={data.text || ''}
          onChange={handleTextChange}
          placeholder={lt('输入要合成的文本...', 'Enter text to synthesize...')}
          style={{
            width: '100%',
            minHeight: 80,
            padding: 8,
            fontSize: 12,
            border: '1px solid #e5e7eb',
            borderRadius: 4,
            resize: 'vertical',
          }}
        />

        <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
          <select
            className="nodrag"
            value={selectedVoice}
            onChange={handleVoiceChange}
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
              marginTop: 4,
              paddingTop: 8,
              borderTop: '1px solid #f0f0f0',
            }}
          >
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              onMouseDown={handleButtonMouseDown}
              style={{
                width: '100%',
                padding: '6px 8px',
                background: 'transparent',
                border: '1px solid #e5e7eb',
                borderRadius: 4,
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
                    style={baseInputStyle}
                  >
                    <option value="url">{lt('返回 URL', 'Output URL')}</option>
                    <option value="hex">{lt('返回 HEX', 'Output HEX')}</option>
                  </select>
                  <select
                    className="nodrag"
                    value={selectedAudioMode}
                    onChange={handleAudioModeChange}
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

        <button
          onClick={handleRun}
          onMouseDown={handleButtonMouseDown}
          disabled={data.status === 'running' || !data.text?.trim()}
          style={{
            marginTop: 8,
            width: '100%',
            padding: '8px 12px',
            background: data.status === 'running' || !data.text?.trim() ? '#e5e7eb' : '#8b5cf6',
            color: data.status === 'running' || !data.text?.trim() ? '#9ca3af' : '#fff',
            border: 'none',
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 500,
            cursor: data.status === 'running' || !data.text?.trim() ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <Play size={14} />
          {lt('生成语音', 'Generate Speech')}
        </button>

        {data.status === 'running' && <GenerationProgressBar />}

        {data.status === 'failed' && data.error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#ef4444', fontSize: 12, marginTop: 8 }}>
            <AlertTriangle size={14} />
            <span>{data.error}</span>
          </div>
        )}

        {data.audioUrl && (
          <audio key={data.audioUrl} controls style={{ width: '100%', marginTop: 8 }}>
            <source src={data.audioUrl} type="audio/mpeg" />
          </audio>
        )}
      </div>

      <Handle type="source" position={Position.Right} style={{ background: '#555' }} />
    </div>
  );
}

export default React.memo(MinimaxSpeechNode);
