import React from 'react';
import { Download, Link2 } from 'lucide-react';
import {
  flowAudioPlayerShell,
  flowSpeechDownloadButton,
  flowSpeechHistoryMetaColor,
  flowSpeechHistoryPromptColor,
  flowSpeechHistoryRow,
  flowSpeechHistorySectionDivider,
} from './flowNodeDarkTheme';

export type AudioResultHistoryItem = {
  id: string;
  prompt: string;
  audioUrl: string;
  videoUrl?: string;
  createdAt: number;
};

type Props = {
  isFlowDark: boolean;
  items: AudioResultHistoryItem[];
  selected: AudioResultHistoryItem | null;
  onSelect: (item: AudioResultHistoryItem) => void;
  lt: (zhText: string, enText: string) => string;
  /** 下载文件名前缀，例如 minimax / tencent-speech */
  downloadPrefix?: string;
  /** 下载文件扩展名（含点），默认 .mp3 */
  downloadExt?: string;
  /** <source> 的 type，留空交给浏览器嗅探 */
  audioType?: string;
  /** 空 prompt 占位文案 */
  emptyPromptZh?: string;
  emptyPromptEn?: string;
  stopNodeDrag?: (event: React.SyntheticEvent) => void;
};

/**
 * 统一音频结果区：选中音频播放器 + （可选）输出视频链接 + 生成记录列表 + 下载。
 * 抽取自 MinimaxSpeechNode / MinimaxMusicNode / TencentSpeechNode 的重复实现。
 */
function AudioResultPanel({
  isFlowDark,
  items,
  selected,
  onSelect,
  lt,
  downloadPrefix = 'audio',
  downloadExt = '.mp3',
  audioType,
  emptyPromptZh = '空 Prompt',
  emptyPromptEn = 'Empty prompt',
  stopNodeDrag,
}: Props) {
  const [downloadingId, setDownloadingId] = React.useState<string | null>(null);

  const formatHistoryTime = React.useCallback((timestamp: number) => {
    if (!Number.isFinite(timestamp)) return '';
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }, []);

  const handleDownload = React.useCallback(
    async (item: AudioResultHistoryItem) => {
      const url = item.videoUrl?.trim() || item.audioUrl;
      if (!url) return;
      setDownloadingId(item.id);
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error('download-failed');
        }
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        const timestamp = new Date(item.createdAt).toISOString().replace(/[:.]/g, '-');
        anchor.download = `${downloadPrefix}-${timestamp}${downloadExt}`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      } catch {
        window.open(url, '_blank', 'noopener,noreferrer');
      } finally {
        setDownloadingId(null);
      }
    },
    [downloadExt, downloadPrefix]
  );

  if (items.length === 0) return null;

  return (
    <>
      {selected?.audioUrl ? (
        <div style={flowAudioPlayerShell(isFlowDark)}>
          <audio key={selected.audioUrl} controls style={{ width: '100%' }}>
            <source src={selected.audioUrl} type={audioType} />
          </audio>
        </div>
      ) : null}

      {selected?.videoUrl ? (
        <a
          href={selected.videoUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: 12,
            color: '#2563eb',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <Link2 size={12} />
          {lt('查看输出视频', 'Open output video')}
        </a>
      ) : null}

      <div
        style={{
          borderTop: `1px solid ${flowSpeechHistorySectionDivider(isFlowDark)}`,
          marginTop: 2,
          paddingTop: 6,
          display: 'grid',
          gap: 6,
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: flowSpeechHistoryMetaColor(isFlowDark),
            fontWeight: 600,
          }}
        >
          {lt('生成记录', 'History')}
        </div>
        <div
          style={{
            display: 'grid',
            gap: 4,
            maxHeight: 168,
            overflowY: 'auto',
            paddingRight: 2,
          }}
        >
          {items.map((item) => {
            const isActive = selected?.id === item.id;
            return (
              <div
                key={item.id}
                className="nodrag"
                onPointerDownCapture={stopNodeDrag}
                onMouseDownCapture={stopNodeDrag}
                onClick={() => onSelect(item)}
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
                  <div
                    style={{
                      fontSize: 10,
                      color: flowSpeechHistoryMetaColor(isFlowDark),
                      marginBottom: 2,
                    }}
                  >
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
                    title={item.prompt || lt(emptyPromptZh, emptyPromptEn)}
                  >
                    {item.prompt || lt(emptyPromptZh, emptyPromptEn)}
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
                  title={lt('下载', 'Download')}
                >
                  <Download size={12} />
                  {lt('下载', 'DL')}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

export default React.memo(AudioResultPanel);
