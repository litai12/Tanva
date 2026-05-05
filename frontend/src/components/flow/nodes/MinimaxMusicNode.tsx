import React from "react";
import { Handle, Position, useStore, type ReactFlowState } from "reactflow";
import { AlertTriangle, Download, Music2 } from "lucide-react";
import GenerationProgressBar from "./GenerationProgressBar";
import { useLocaleText } from "@/utils/localeText";
import {
  flowAudioPlayerShell,
  flowSpeechDownloadButton,
  flowSpeechHistoryMetaColor,
  flowSpeechHistoryPromptColor,
  flowSpeechHistoryRow,
  flowSpeechHistorySectionDivider,
  flowNodeControlField,
  flowNodeShellChrome,
  useFlowNodeDarkTheme,
} from "./flowNodeDarkTheme";
import RunCreditBadge from "./RunCreditBadge";
import { useImeSafeTextValue } from "../hooks/useImeSafeTextInput";

const PROMPT_MAX_LENGTH = 2000;
const LYRICS_MAX_LENGTH = 3500;

type MusicHistoryItem = {
  id: string;
  prompt: string;
  lyrics?: string;
  isInstrumental: boolean;
  lyricsOptimizer: boolean;
  audioUrl: string;
  createdAt: number;
};

type Props = {
  id: string;
  data: {
    status?: "idle" | "running" | "succeeded" | "failed";
    progressStartedAt?: number | string | null;
    audioUrl?: string;
    error?: string;
    prompt?: string;
    lyrics?: string;
    isInstrumental?: boolean;
    lyricsOptimizer?: boolean;
    model?: "music-2.5+" | "music-2.5";
    history?: MusicHistoryItem[];
    selectedHistoryId?: string;
    creditsPerCall?: number;
    onRun?: (id: string) => void;
  };
  selected?: boolean;
};

function MinimaxMusicNode({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const isFlowDark = useFlowNodeDarkTheme();
  const [downloadingId, setDownloadingId] = React.useState<string | null>(null);
  const [handleHover, setHandleHover] = React.useState<string | null>(null);
  const hasPromptInput = useStore((state: ReactFlowState) =>
    state.edges.some((edge) => edge.target === id && edge.targetHandle === "text")
  );
  const shell = flowNodeShellChrome(isFlowDark, !!selected);
  const controlField = flowNodeControlField(isFlowDark);
  const boxShadow = selected ? "0 0 0 2px rgba(37,99,235,0.12)" : "0 1px 2px rgba(0,0,0,0.04)";

  const updateNodeData = React.useCallback(
    (patch: Record<string, unknown>) => {
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: { id, patch },
        })
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

  const commitPrompt = React.useCallback(
    (next: string) => updateNodeData({ prompt: next }),
    [updateNodeData]
  );

  const commitLyrics = React.useCallback(
    (next: string) => updateNodeData({ lyrics: next }),
    [updateNodeData]
  );

  const handleInstrumentalToggle = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const enabled = event.target.checked;
      updateNodeData({
        isInstrumental: enabled,
      });
    },
    [updateNodeData]
  );

  const handleLyricsOptimizerToggle = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const enabled = event.target.checked;
      updateNodeData({ lyricsOptimizer: enabled });
    },
    [updateNodeData]
  );

  const onRunCallback = data.onRun;
  const handleRun = React.useCallback(() => {
    onRunCallback?.(id);
  }, [id, onRunCallback]);

  const prompt = typeof data.prompt === "string" ? data.prompt : "";
  const lyrics = typeof data.lyrics === "string" ? data.lyrics : "";
  const promptInput = useImeSafeTextValue(prompt, commitPrompt, {
    maxLength: PROMPT_MAX_LENGTH,
  });
  const lyricsInput = useImeSafeTextValue(lyrics, commitLyrics, {
    maxLength: LYRICS_MAX_LENGTH,
  });
  const isInstrumental = data.isInstrumental === true;
  const lyricsOptimizer = data.lyricsOptimizer === true;

  const historyItems = React.useMemo<MusicHistoryItem[]>(() => {
    const normalized = Array.isArray(data.history)
      ? data.history
          .filter(
            (item) =>
              item &&
              typeof item.audioUrl === "string" &&
              item.audioUrl.trim().length > 0
          )
          .map((item) => ({
            id: item.id || `minimax-music-${item.createdAt}-${item.audioUrl}`,
            prompt: typeof item.prompt === "string" ? item.prompt : "",
            lyrics: typeof item.lyrics === "string" ? item.lyrics : undefined,
            isInstrumental: item.isInstrumental === true,
            lyricsOptimizer: item.lyricsOptimizer === true,
            audioUrl: item.audioUrl.trim(),
            createdAt:
              typeof item.createdAt === "number" ? item.createdAt : Date.now(),
          }))
      : [];

    if (normalized.length > 0) {
      return normalized;
    }

    if (typeof data.audioUrl === "string" && data.audioUrl.trim().length > 0) {
      return [
        {
          id: data.selectedHistoryId || `minimax-music-legacy-${id}`,
          prompt,
          lyrics,
          isInstrumental,
          lyricsOptimizer,
          audioUrl: data.audioUrl.trim(),
          createdAt: Date.now(),
        },
      ];
    }
    return [];
  }, [
    data.audioUrl,
    data.history,
    data.selectedHistoryId,
    id,
    isInstrumental,
    lyrics,
    lyricsOptimizer,
    prompt,
  ]);

  const selectedHistory = React.useMemo(() => {
    if (historyItems.length === 0) return null;
    if (
      typeof data.selectedHistoryId === "string" &&
      data.selectedHistoryId.trim().length > 0
    ) {
      const matched = historyItems.find(
        (item) => item.id === data.selectedHistoryId
      );
      if (matched) return matched;
    }
    if (typeof data.audioUrl === "string" && data.audioUrl.trim().length > 0) {
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

  const selectHistory = React.useCallback(
    (item: MusicHistoryItem) => {
      updateNodeData({
        selectedHistoryId: item.id,
        audioUrl: item.audioUrl,
        prompt: item.prompt,
        lyrics: item.lyrics || "",
        isInstrumental: item.isInstrumental,
        lyricsOptimizer: item.lyricsOptimizer,
      });
    },
    [updateNodeData]
  );

  const formatHistoryTime = React.useCallback((timestamp: number) => {
    if (!Number.isFinite(timestamp)) return "";
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }, []);

  const handleDownload = React.useCallback(async (item: MusicHistoryItem) => {
    setDownloadingId(item.id);
    try {
      const response = await fetch(item.audioUrl);
      if (!response.ok) {
        throw new Error("download-failed");
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      const timestamp = new Date(item.createdAt).toISOString().replace(/[:.]/g, "-");
      anchor.download = `minimax-music-${timestamp}.mp3`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      window.open(item.audioUrl, "_blank", "noopener,noreferrer");
    } finally {
      setDownloadingId(null);
    }
  }, []);

  const hasPromptReady = prompt.trim().length > 0 || hasPromptInput;
  const hasLyricsReady = lyrics.trim().length > 0;
  const runDisabled =
    data.status === "running" ||
    (isInstrumental && !hasPromptReady) ||
    (!isInstrumental && !hasLyricsReady && !lyricsOptimizer);

  const switchLabelStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    border: controlField.border as string,
    borderRadius: 6,
    padding: "6px 8px",
    fontSize: 12,
    color: controlField.color as string,
    background: controlField.background as string,
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
        transition: "border-color 0.15s ease, box-shadow 0.15s ease",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
          <Music2 size={20} color="#14b8a6" strokeWidth={2.2} />
          <span>
            {lt("MiniMax 音乐生成", "MiniMax Music")}
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
            padding: "4px 8px",
            background: runDisabled ? "#e5e7eb" : "#111827",
            color: runDisabled ? "#9ca3af" : "#fff",
            borderRadius: 6,
            border: "none",
            cursor: runDisabled ? "not-allowed" : "pointer",
          }}
        >
          {data.status === "running" ? lt("运行中...", "Running...") : "Run"}
        </button>
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <label style={{ fontSize: 11, color: isFlowDark ? "#9ca3af" : "#6b7280" }}>
          {lt("曲风提示词", "Prompt")} ({promptInput.value.length}/{PROMPT_MAX_LENGTH})
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
          placeholder={lt(
            "流行音乐, 难过, 适合在下雨的晚上",
            "Pop music, sad mood, suitable for rainy night"
          )}
          style={{
            width: "100%",
            minHeight: 68,
            resize: "vertical",
            fontSize: 12,
            lineHeight: 1.45,
            borderRadius: 6,
            padding: "8px 10px",
            ...controlField,
          }}
        />

        <label style={switchLabelStyle}>
          <span>{lt("纯音乐模式（is_instrumental）", "Instrumental Mode")}</span>
          <input
            type="checkbox"
            checked={isInstrumental}
            onChange={handleInstrumentalToggle}
            onPointerDownCapture={stopNodeDrag}
            onMouseDownCapture={stopNodeDrag}
          />
        </label>

        <label style={switchLabelStyle}>
          <span>{lt("AI 自动填词（lyrics_optimizer）", "AI Lyrics Optimizer")}</span>
          <input
            type="checkbox"
            checked={lyricsOptimizer}
            onChange={handleLyricsOptimizerToggle}
            onPointerDownCapture={stopNodeDrag}
            onMouseDownCapture={stopNodeDrag}
          />
        </label>

        {!isInstrumental ? (
          <>
            <label style={{ fontSize: 11, color: isFlowDark ? "#9ca3af" : "#6b7280" }}>
              {lt("歌词", "Lyrics")} ({lyricsInput.value.length}/{LYRICS_MAX_LENGTH})
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
              placeholder={lt(
                "支持 [Verse], [Chorus], [Bridge] 等结构标签",
                "Supports [Verse], [Chorus], [Bridge] structure tags"
              )}
              style={{
                width: "100%",
                minHeight: 92,
                resize: "vertical",
                fontSize: 12,
                lineHeight: 1.45,
                borderRadius: 6,
                padding: "8px 10px",
                ...controlField,
              }}
            />
          </>
        ) : (
          <div
            style={{
              border: isFlowDark ? "1px dashed rgba(52,211,153,0.4)" : "1px dashed #d1fae5",
              background: isFlowDark ? "rgba(16,185,129,0.12)" : "#f0fdfa",
              color: isFlowDark ? "#6ee7b7" : "#0f766e",
              borderRadius: 6,
              fontSize: 11,
              padding: "8px 10px",
              lineHeight: 1.45,
            }}
          >
            {lt("纯音乐模式已开启：歌词输入已隐藏。", "Instrumental mode enabled: lyrics input hidden.")}
          </div>
        )}
      </div>

      <GenerationProgressBar
        status={data.status}
        startedAt={data.progressStartedAt}
        runKey={id}
      />

      {runDisabled && (
        <div style={{ fontSize: 11, color: "#b45309" }}>
          {isInstrumental && !hasPromptReady
            ? lt("纯音乐模式需要填写曲风提示词。", "Instrumental mode requires a prompt.")
            : !isInstrumental && !hasLyricsReady && !lyricsOptimizer
            ? lt("请填写歌词，或开启 AI 自动填词。", "Please provide lyrics or enable AI lyrics optimizer.")
            : null}
        </div>
      )}

      {data.status === "failed" && data.error ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#ef4444", fontSize: 12 }}>
          <AlertTriangle size={14} />
          <span style={{ whiteSpace: "pre-wrap" }}>{data.error}</span>
        </div>
      ) : null}

      {selectedHistory?.audioUrl ? (
        <div style={flowAudioPlayerShell(isFlowDark)}>
          <audio key={selectedHistory.audioUrl} controls style={{ width: "100%" }}>
            <source src={selectedHistory.audioUrl} type="audio/mpeg" />
          </audio>
        </div>
      ) : null}

      {historyItems.length > 0 ? (
        <div
          style={{
            borderTop: `1px solid ${flowSpeechHistorySectionDivider(isFlowDark)}`,
            marginTop: 2,
            paddingTop: 6,
            display: "grid",
            gap: 6,
          }}
        >
          <div style={{ fontSize: 11, color: flowSpeechHistoryMetaColor(isFlowDark), fontWeight: 600 }}>
            {lt("生成记录", "History")}
          </div>
          <div style={{ display: "grid", gap: 4, maxHeight: 168, overflowY: "auto", paddingRight: 2 }}>
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
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    borderRadius: 6,
                    padding: "6px 8px",
                    cursor: "pointer",
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
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                      title={item.prompt || lt("空 Prompt", "Empty prompt")}
                    >
                      {item.prompt || lt("空 Prompt", "Empty prompt")}
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
                      padding: "0 8px",
                      borderRadius: 6,
                      fontSize: 11,
                      cursor: downloadingId === item.id ? "not-allowed" : "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      ...flowSpeechDownloadButton(isFlowDark),
                    }}
                    title={lt("下载音频", "Download audio")}
                  >
                    <Download size={12} />
                    {lt("下载", "DL")}
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
        style={{ top: "50%" }}
        onMouseEnter={() => setHandleHover("text-in")}
        onMouseLeave={() => setHandleHover(null)}
      />
      <Handle
        id="audio"
        type="source"
        position={Position.Right}
        style={{ top: "50%" }}
        onMouseEnter={() => setHandleHover("audio-out")}
        onMouseLeave={() => setHandleHover(null)}
      />
      {handleHover === "text-in" ? (
        <div className="flow-tooltip" style={{ left: -8, top: "50%", transform: "translate(-100%, -50%)" }}>text</div>
      ) : null}
      {handleHover === "audio-out" ? (
        <div className="flow-tooltip" style={{ right: -8, top: "50%", transform: "translate(100%, -50%)" }}>audio</div>
      ) : null}
    </div>
  );
}

export default React.memo(MinimaxMusicNode);
