import React from 'react';
import {
  flowNodeControlField,
  flowNodeMutedWellBackground,
  flowSpeechHistoryRow,
} from './flowNodeDarkTheme';
import { fetchSeedAudioVoices, type SeedAudioVoice } from '../../../services/seedAudioVoiceService';

type LocaleTextFn = (zh: string, en: string) => string;

type Props = {
  value: string;
  onChange: (id: string) => void;
  isDark: boolean;
  lt: LocaleTextFn;
  stopNodeDrag: (event: React.SyntheticEvent) => void;
  nodeId: string;
};

const HOVER_PLAY_DELAY_MS = 150;

/**
 * seed-audio（豆包）富音色选择器：
 * 头部按钮显示当前选中音色，点击展开内联面板（搜索框 + 头像/名称/描述行列表）。
 * 支持悬停自动试听（150ms 防抖，单个共享 <audio>）、行内 ▶️ 按钮、选中高亮，
 * 顶部固定“不指定音色”高亮卡片。浅色/暗色双主题。
 */
export default function DoubaoVoicePicker({
  value,
  onChange,
  isDark,
  lt,
  stopNodeDrag,
  nodeId,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [keyword, setKeyword] = React.useState('');
  const [voices, setVoices] = React.useState<SeedAudioVoice[]>([]);
  const [playingId, setPlayingId] = React.useState<string>('');

  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const hoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollingRef = React.useRef(false);
  const scrollTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // 当前鼠标悬停的音色：滚动结束后用它补一次自动试听（滚动时鼠标停在某行不会再触发 mouseEnter）
  const hoveredVoiceRef = React.useRef<SeedAudioVoice | null>(null);

  const controlField = flowNodeControlField(isDark);
  const accent = isDark ? '#3b82f6' : '#2563eb';
  const metaColor = isDark ? '#9ca3af' : '#6b7280';
  const descColor = isDark ? '#8b8b8b' : '#9ca3af';
  const nameColor = isDark ? '#e5e7eb' : '#111827';
  const panelBg = flowNodeMutedWellBackground(isDark);

  // 拉取动态音色目录（失败回落静态库）
  React.useEffect(() => {
    let alive = true;
    fetchSeedAudioVoices()
      .then((list) => {
        if (alive) setVoices(list);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // 卸载清理
  React.useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.src = '';
      }
    };
  }, []);

  const ensureAudio = (): HTMLAudioElement => {
    if (!audioRef.current) {
      const el = new Audio();
      el.preload = 'none';
      el.onended = () => setPlayingId('');
      el.onpause = () => setPlayingId((cur) => cur);
      audioRef.current = el;
    }
    return audioRef.current;
  };

  const stopPlayback = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      try {
        audio.currentTime = 0;
      } catch {
        /* ignore */
      }
    }
    setPlayingId('');
  };

  const playVoice = (voice: SeedAudioVoice) => {
    if (!voice.trialUrl) return;
    const audio = ensureAudio();
    if (audio.src !== voice.trialUrl) {
      audio.src = voice.trialUrl;
    }
    try {
      audio.currentTime = 0;
    } catch {
      /* ignore */
    }
    audio.play().then(() => setPlayingId(voice.id)).catch(() => setPlayingId(''));
  };

  // 悬停自动试听（防抖；滚动时不触发，滚动结束后由 handleListScroll 补播）
  const handleRowEnter = (voice: SeedAudioVoice) => {
    hoveredVoiceRef.current = voice;
    if (!voice.trialUrl || scrollingRef.current) return;
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      if (scrollingRef.current) return;
      playVoice(voice);
    }, HOVER_PLAY_DELAY_MS);
  };

  const handleRowLeave = () => {
    hoveredVoiceRef.current = null;
    stopPlayback();
  };

  // ▶️ 按钮：切换播放/暂停（独立于选中）
  const togglePlay = (event: React.MouseEvent, voice: SeedAudioVoice) => {
    event.stopPropagation();
    if (!voice.trialUrl) return;
    if (playingId === voice.id) {
      stopPlayback();
    } else {
      playVoice(voice);
    }
  };

  const handleListScroll = () => {
    scrollingRef.current = true;
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      scrollingRef.current = false;
      // 滚动停下后，鼠标若仍停在某行上（不会再触发 mouseEnter），补一次自动试听
      const hovered = hoveredVoiceRef.current;
      if (hovered?.trialUrl) playVoice(hovered);
    }, 200);
  };

  const selectVoice = (id: string) => {
    stopPlayback();
    onChange(id);
    setOpen(false);
  };

  const filtered = React.useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return voices;
    return voices.filter((v) =>
      `${v.name} ${v.id} ${v.scene} ${v.description} ${v.gender} ${v.age}`
        .toLowerCase()
        .includes(kw),
    );
  }, [voices, keyword]);

  const selectedVoice = React.useMemo(
    () => voices.find((v) => v.id === value),
    [voices, value],
  );

  const headerLabel = value
    ? selectedVoice
      ? `${selectedVoice.name}${selectedVoice.scene ? `（${selectedVoice.scene}）` : ''}`
      : value
    : lt('不指定音色（用文本/参考生成）', 'No voice (use text/reference)');

  const baseControl: React.CSSProperties = {
    width: '100%',
    minHeight: 28,
    padding: '4px 8px',
    fontSize: 12,
    borderRadius: 6,
    boxSizing: 'border-box',
    ...controlField,
  };

  return (
    <div
      className="nodrag"
      onPointerDownCapture={stopNodeDrag}
      onMouseDownCapture={stopNodeDrag}
      style={{ display: 'grid', gap: 4 }}
    >
      {/* 头部触发按钮 */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          ...baseControl,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          cursor: 'pointer',
          textAlign: 'left',
          border: value ? `1px solid ${accent}` : (controlField.border as string),
        }}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: controlField.color as string,
          }}
        >
          {headerLabel}
        </span>
        <span style={{ color: metaColor, fontSize: 10 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div
          style={{
            border: controlField.border as string,
            borderRadius: 8,
            background: panelBg,
            padding: 6,
            display: 'grid',
            gap: 6,
          }}
        >
          {/* 搜索框 */}
          <input
            className="nodrag"
            type="text"
            value={keyword}
            placeholder={lt('搜索音色（名称/场景/ID/描述）', 'Search voices (name/scene/id/description)')}
            onChange={(e) => setKeyword(e.target.value)}
            onPointerDownCapture={stopNodeDrag}
            onMouseDownCapture={stopNodeDrag}
            style={baseControl}
          />

          {/* 顶部固定：不指定音色 高亮卡片 */}
          <div
            role="button"
            onClick={() => selectVoice('')}
            style={{
              border: `1px solid ${accent}`,
              borderRadius: 8,
              padding: '8px 10px',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              color: nameColor,
              background: value === '' ? (isDark ? 'rgba(37,99,235,0.18)' : '#eff6ff') : 'transparent',
              boxShadow: `0 0 0 1px ${accent}22, 0 0 6px ${accent}33`,
            }}
          >
            {lt('不指定音色（用文本/参考生成）', 'No voice (use text/reference)')}
          </div>

          {/* 滚动列表 */}
          <div
            onScroll={handleListScroll}
            style={{ maxHeight: 280, overflowY: 'auto', display: 'grid', gap: 4 }}
          >
            {filtered.length === 0 && (
              <div style={{ fontSize: 11, color: metaColor, padding: '8px 4px' }}>
                {lt('暂无匹配音色', 'No matching voices')}
              </div>
            )}
            {filtered.map((voice) => {
              const isSelected = voice.id === value;
              const rowTheme = flowSpeechHistoryRow(isDark, isSelected);
              const isPlaying = playingId === voice.id;
              return (
                <div
                  key={voice.id}
                  role="button"
                  onClick={() => selectVoice(voice.id)}
                  onMouseEnter={() => handleRowEnter(voice)}
                  onMouseLeave={handleRowLeave}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: 6,
                    borderRadius: 8,
                    cursor: 'pointer',
                    border: rowTheme.border as string,
                    background: rowTheme.background as string,
                  }}
                >
                  {/* 头像 */}
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: '50%',
                      flexShrink: 0,
                      overflow: 'hidden',
                      background: isDark ? '#2a2a2a' : '#e5e7eb',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 14,
                      color: metaColor,
                    }}
                  >
                    {voice.avatar ? (
                      <img
                        src={voice.avatar}
                        alt={voice.name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      (voice.name || '?').slice(0, 1)
                    )}
                  </div>

                  {/* 名称 + 元信息 + 描述 */}
                  <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 2 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: nameColor,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {voice.name}
                      </span>
                      {(voice.gender || voice.age || voice.scene) && (
                        <span
                          style={{
                            fontSize: 10,
                            color: metaColor,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {[voice.gender, voice.age, voice.scene].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </div>
                    {voice.description && (
                      <span
                        style={{
                          fontSize: 11,
                          color: descColor,
                          lineHeight: 1.35,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {voice.description}
                      </span>
                    )}
                  </div>

                  {/* ▶️ 试听按钮（无 trialUrl 不显示） */}
                  {voice.trialUrl && (
                    <button
                      type="button"
                      onClick={(e) => togglePlay(e, voice)}
                      title={lt('试听', 'Preview')}
                      style={{
                        flexShrink: 0,
                        width: 26,
                        height: 26,
                        borderRadius: '50%',
                        border: `1px solid ${accent}`,
                        background: isPlaying ? accent : 'transparent',
                        color: isPlaying ? '#fff' : accent,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                        lineHeight: 1,
                      }}
                    >
                      {isPlaying ? '❚❚' : '▶'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
