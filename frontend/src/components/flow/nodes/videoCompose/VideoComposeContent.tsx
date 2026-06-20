// @ts-nocheck
import React from "react";
import { Scissors, Download, RefreshCw } from "lucide-react";

type VideoComposeContentProps = {
  upstreamCount: number;
  composedVideoUrl: string | null;
  onOpenEditor: () => void;
  onDownload: () => void;
  lt: (zh: string, en: string) => string;
};

const stopMediaInteraction = (event: React.SyntheticEvent) => {
  event.stopPropagation();
  event.nativeEvent.stopImmediatePropagation();
};

export function VideoComposeContent({
  upstreamCount,
  composedVideoUrl,
  onOpenEditor,
  onDownload,
  lt,
}: VideoComposeContentProps): JSX.Element {
  const ready = upstreamCount >= 2;

  if (composedVideoUrl) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minHeight: 0 }}>
        <div
          style={{
            position: "relative",
            borderRadius: 8,
            overflow: "hidden",
            background: "#000",
            flex: 1,
            minHeight: 80,
          }}
        >
          <video
            className="nodrag nopan nowheel"
            src={composedVideoUrl}
            crossOrigin="anonymous"
            controls
            preload="metadata"
            onPointerDownCapture={stopMediaInteraction}
            onMouseDownCapture={stopMediaInteraction}
            onTouchStartCapture={stopMediaInteraction}
            onDoubleClickCapture={stopMediaInteraction}
            style={{ width: "100%", height: "100%", display: "block", objectFit: "contain" }}
          />
        </div>
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexShrink: 0 }}>
          <button
            type="button"
            title={lt("下载合成视频", "Download composed video")}
            onClick={onDownload}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              borderRadius: 6,
              border: "1px solid #e5e7eb",
              background: "#fff",
              cursor: "pointer",
            }}
          >
            <Download size={14} />
          </button>
          <button
            type="button"
            disabled={!ready}
            onClick={onOpenEditor}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              padding: "4px 10px",
              borderRadius: 6,
              border: "1px solid #e5e7eb",
              background: "#fff",
              color: ready ? "#111" : "#9ca3af",
              cursor: ready ? "pointer" : "not-allowed",
            }}
          >
            <RefreshCw size={12} />
            {lt("重新合成", "Recompose")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        flex: 1,
        minHeight: 120,
        background: "#f8fafc",
        borderRadius: 10,
        border: "1px dashed #e5e7eb",
        padding: "20px 16px",
      }}
    >
      <Scissors size={30} style={{ opacity: 0.25, color: "#64748b" }} />
      {ready ? (
        <button
          type="button"
          onClick={onOpenEditor}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            padding: "6px 14px",
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            background: "#fff",
            cursor: "pointer",
          }}
        >
          <Scissors size={12} />
          {lt("合成视频", "Compose video")}
        </button>
      ) : (
        <span style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", maxWidth: 180 }}>
          {lt("连接 2 个及以上视频节点", "Connect 2 or more video nodes")}
        </span>
      )}
    </div>
  );
}
