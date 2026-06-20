// @ts-nocheck
import React from "react";
import { createPortal } from "react-dom";
import {
  X,
  Play,
  Pause,
  Scissors,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Magnet,
  Trash2,
} from "lucide-react";
import { MP4Clip } from "@webav/av-cliper";
import type { ComposeVideoSource } from "./useVideoCompose";
import { useVideoCompose } from "./useVideoCompose";
import type { ComposeAudioTrack } from "./composeVideosCore";
import { fetchClip } from "./reliableClipFetch";

const US_PER_S = 1_000_000;
const MIN_USED_US = 500_000; // 0.5 s minimum per clip
const HANDLE_W = 10;
const SNAP_THRESHOLD_PX = 10;
const BASE_PX_PER_SEC = 80; // pixels per second at zoom level 1

function usToDisplay(us: number): string {
  const s = Math.floor(us / US_PER_S);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function usToSecs(us: number): string {
  return (us / US_PER_S).toFixed(2) + "s";
}

/** Compute a nice ruler step (in µs) based on actual px/sec density. */
function rulerStep(pxPerSec: number): number {
  const secsPerTick = 70 / pxPerSec;
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60];
  return (steps.find((s) => s >= secsPerTick) ?? 60) * US_PER_S;
}

function drawContain(canvas: HTMLCanvasElement, frame: VideoFrame): void {
  const ctx = canvas.getContext("2d")!;
  const fw = frame.displayWidth;
  const fh = frame.displayHeight;
  if (!fw || !fh) return;
  const scale = Math.min(canvas.width / fw, canvas.height / fh);
  const dw = fw * scale;
  const dh = fh * scale;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(frame, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
}

// ── Small unstyled control primitives (replace Mantine ActionIcon/Button) ──────
function IconBtn({ active, color, disabled, title, onClick, children }: any) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 28,
        height: 28,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 6,
        border: "1px solid transparent",
        background: active ? (color === "blue" ? "#2563eb" : "#3a3a3a") : "transparent",
        color: disabled ? "#555" : color === "red" ? "#f87171" : active ? "#fff" : "#ccc",
        cursor: disabled ? "not-allowed" : "pointer",
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

function PrimaryBtn({ disabled, onClick, children }: any) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 12px",
        borderRadius: 6,
        border: "none",
        background: disabled ? "#1f3a6b" : "#2563eb",
        color: disabled ? "#7e97c4" : "#fff",
        fontSize: 12,
        cursor: disabled ? "not-allowed" : "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

const VDivider = () => (
  <div style={{ width: 1, height: 18, background: "#333", margin: "0 4px", flexShrink: 0 }} />
);

// ─────────────────────────────────────────────────────────────────────────────
// Data model
// ─────────────────────────────────────────────────────────────────────────────

type EditableClip = {
  id: string;
  clip: MP4Clip;
  sourceUrl: string;
  sourceMeta: { title?: string; thumbnailUrl?: string };
  duration: number; // full duration of this specific clip (µs)
  trimStart: number; // µs to skip at beginning
  trimEnd: number; // µs to skip at end
  thumbs: { ts: number; url: string }[];
};

const usedDur = (ec: EditableClip) =>
  Math.max(MIN_USED_US, ec.duration - ec.trimStart - ec.trimEnd);

type TrimRecord = { id: string; trimStart: number; trimEnd: number };

let _clipIdCounter = 0;
const newClipId = () => `clip-${++_clipIdCounter}`;

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export type VideoComposeEditorModalProps = {
  opened: boolean;
  onClose: () => void;
  upstreamVideos: ComposeVideoSource[];
  /** 上游音频节点的配音/BGM 轨，合成时从 0 时刻混入 */
  upstreamAudioTracks?: ComposeAudioTrack[];
  onComposeDone: (blob: Blob) => void;
};

export function VideoComposeEditorModal({
  opened,
  onClose,
  upstreamVideos,
  upstreamAudioTracks,
  onComposeDone,
}: VideoComposeEditorModalProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const editClipsRef = React.useRef<EditableClip[]>([]);

  const [editClips, setEditClips] = React.useState<EditableClip[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [currentUs, setCurrentUs] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [selectedIdx, setSelectedIdx] = React.useState<number | null>(null);
  const [zoomLevel, setZoomLevel] = React.useState(1);
  const [snapEnabled, setSnapEnabled] = React.useState(false);

  const renderingRef = React.useRef(false);
  const trimUndoRef = React.useRef<TrimRecord[][]>([]);
  const trimRedoRef = React.useRef<TrimRecord[][]>([]);
  const scrubActiveRef = React.useRef(false);
  const scrubStartXRef = React.useRef(0);
  const wasPlayingRef = React.useRef(false);
  const pointerIsDownRef = React.useRef(false);
  type TrimDrag = {
    clipId: string;
    side: "start" | "end";
    startX: number;
    startTrimUs: number;
    usPerPx: number;
  };
  const trimDragRef = React.useRef<TrimDrag | null>(null);
  const [activeTrimInfo, setActiveTrimInfo] = React.useState<{
    id: string;
    side: "start" | "end";
    durationUs: number;
  } | null>(null);

  const {
    compose,
    cancel: cancelCompose,
    composing,
    progress: composeProgress,
    error: composeError,
  } = useVideoCompose();

  React.useEffect(() => {
    editClipsRef.current = editClips;
  }, [editClips]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const clipPositions = React.useMemo(() => {
    let off = 0;
    return editClips.map((ec) => {
      const s = off;
      off += usedDur(ec);
      return s;
    });
  }, [editClips]);

  const totalUs = React.useMemo(
    () => editClips.reduce((acc, ec) => acc + usedDur(ec), 0),
    [editClips]
  );

  // ── Load ──────────────────────────────────────────────────────────────────
  const destroyEditClips = React.useCallback((clips: EditableClip[]) => {
    clips.forEach(({ clip, thumbs }) => {
      clip.destroy();
      thumbs.forEach(({ url }) => URL.revokeObjectURL(url));
    });
  }, []);

  React.useEffect(() => {
    if (!opened || upstreamVideos.length === 0) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);
      setPlaying(false);
      setCurrentUs(0);
      setSelectedIdx(null);
      trimUndoRef.current = [];
      trimRedoRef.current = [];

      const newClips: EditableClip[] = [];
      try {
        for (const src of upstreamVideos) {
          if (cancelled) break;
          const res = await fetchClip(src.url);
          if (!res.body) throw new Error(`无法加载：${src.title || src.url}`);
          const clip = new MP4Clip(res.body);
          await clip.ready;
          if (cancelled) {
            clip.destroy();
            break;
          }

          const { duration } = clip.meta;
          const thumbCount = Math.max(
            4,
            Math.min(20, Math.ceil(duration / US_PER_S) * 2)
          );
          const step = Math.floor(duration / thumbCount);
          let thumbs: { ts: number; url: string }[] = [];
          try {
            const raw = await clip.thumbnails(120, { start: 0, end: duration, step });
            thumbs = raw.map(({ ts, img }) => ({ ts, url: URL.createObjectURL(img) }));
          } catch {
            /* optional */
          }

          newClips.push({
            id: newClipId(),
            clip,
            sourceUrl: src.url,
            sourceMeta: { title: src.title, thumbnailUrl: src.thumbnailUrl },
            duration,
            trimStart: 0,
            trimEnd: 0,
            thumbs,
          });
        }

        if (cancelled) {
          destroyEditClips(newClips);
          return;
        }

        destroyEditClips(editClipsRef.current);
        setEditClips(newClips);

        if (newClips.length > 0 && canvasRef.current) {
          const { video } = await newClips[0].clip.tick(0);
          if (video && canvasRef.current) {
            drawContain(canvasRef.current, video);
            video.close();
          }
        }
      } catch (err) {
        destroyEditClips(newClips);
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, upstreamVideos]);

  // ── Cleanup on close ──────────────────────────────────────────────────────
  React.useEffect(() => {
    if (!opened) {
      setPlaying(false);
      setCurrentUs(0);
      setSelectedIdx(null);
      trimUndoRef.current = [];
      trimRedoRef.current = [];
      destroyEditClips(editClipsRef.current);
      setEditClips([]);
      editClipsRef.current = [];
    }
  }, [opened, destroyEditClips]);

  // ── Playback ──────────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (!playing || editClips.length === 0) return;
    const startWall = performance.now();
    const startUs = currentUs;
    const id = setInterval(() => {
      const next = startUs + (performance.now() - startWall) * 1000;
      if (next >= totalUs) {
        setPlaying(false);
        setCurrentUs(totalUs);
      } else setCurrentUs(next);
    }, 50);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, totalUs]);

  // ── Auto-scroll to keep playhead visible ──────────────────────────────────
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    const pxPerUs = (BASE_PX_PER_SEC * zoomLevel) / US_PER_S;
    const ph = currentUs * pxPerUs;
    const margin = el.clientWidth * 0.15;
    if (ph < el.scrollLeft + margin || ph > el.scrollLeft + el.clientWidth - margin) {
      el.scrollLeft = ph - el.clientWidth / 2;
    }
  }, [currentUs, playing, zoomLevel]);

  // ── Render frame ──────────────────────────────────────────────────────────
  React.useEffect(() => {
    const clips = editClipsRef.current;
    if (!clips.length || !canvasRef.current || renderingRef.current) return;

    let target: EditableClip | null = null;
    let localUs = 0;
    let cum = 0;
    for (const ec of clips) {
      const ud = usedDur(ec);
      if (currentUs >= cum && currentUs < cum + ud) {
        target = ec;
        localUs = currentUs - cum + ec.trimStart;
        break;
      }
      cum += ud;
    }
    if (!target) {
      const last = clips[clips.length - 1];
      target = last;
      localUs = last.duration - last.trimEnd - 1000;
    }

    renderingRef.current = true;
    target.clip
      .tick(Math.max(0, localUs))
      .then(({ video }) => {
        if (!video || !canvasRef.current) return;
        drawContain(canvasRef.current, video);
        video.close();
      })
      .catch(() => {})
      .finally(() => {
        renderingRef.current = false;
      });
  }, [currentUs, editClips]);

  React.useEffect(() => {
    if (currentUs > totalUs && totalUs > 0) setCurrentUs(totalUs);
  }, [totalUs, currentUs]);

  // ── Trim history helpers ──────────────────────────────────────────────────
  const saveTrimSnapshot = React.useCallback(() => {
    trimUndoRef.current.push(
      editClipsRef.current.map((ec) => ({
        id: ec.id,
        trimStart: ec.trimStart,
        trimEnd: ec.trimEnd,
      }))
    );
    trimRedoRef.current = [];
  }, []);

  const applyTrimRecords = React.useCallback((records: TrimRecord[]) => {
    setEditClips((prev) =>
      prev.map((ec) => {
        const rec = records.find((r) => r.id === ec.id);
        return rec ? { ...ec, trimStart: rec.trimStart, trimEnd: rec.trimEnd } : ec;
      })
    );
  }, []);

  const handleUndo = React.useCallback(() => {
    const prev = trimUndoRef.current.pop();
    if (!prev) return;
    trimRedoRef.current.push(
      editClipsRef.current.map((ec) => ({
        id: ec.id,
        trimStart: ec.trimStart,
        trimEnd: ec.trimEnd,
      }))
    );
    applyTrimRecords(prev);
  }, [applyTrimRecords]);

  const handleRedo = React.useCallback(() => {
    const next = trimRedoRef.current.pop();
    if (!next) return;
    trimUndoRef.current.push(
      editClipsRef.current.map((ec) => ({
        id: ec.id,
        trimStart: ec.trimStart,
        trimEnd: ec.trimEnd,
      }))
    );
    applyTrimRecords(next);
  }, [applyTrimRecords]);

  // ── In-point / Out-point ──────────────────────────────────────────────────
  const handleMarkIn = React.useCallback(() => {
    if (selectedIdx === null) return;
    const ec = editClipsRef.current[selectedIdx];
    if (!ec) return;
    const pos = clipPositions[selectedIdx];
    const localUs = currentUs - pos + ec.trimStart;
    const newTrimStart = Math.max(
      0,
      Math.min(ec.duration - ec.trimEnd - MIN_USED_US, localUs)
    );
    saveTrimSnapshot();
    setEditClips((prev) =>
      prev.map((c, i) =>
        i === selectedIdx ? { ...c, trimStart: Math.round(newTrimStart) } : c
      )
    );
  }, [selectedIdx, clipPositions, currentUs, saveTrimSnapshot]);

  const handleMarkOut = React.useCallback(() => {
    if (selectedIdx === null) return;
    const ec = editClipsRef.current[selectedIdx];
    if (!ec) return;
    const pos = clipPositions[selectedIdx];
    const localUs = currentUs - pos + ec.trimStart;
    const newTrimEnd = Math.max(
      0,
      Math.min(ec.duration - ec.trimStart - MIN_USED_US, ec.duration - localUs)
    );
    saveTrimSnapshot();
    setEditClips((prev) =>
      prev.map((c, i) =>
        i === selectedIdx ? { ...c, trimEnd: Math.round(newTrimEnd) } : c
      )
    );
  }, [selectedIdx, clipPositions, currentUs, saveTrimSnapshot]);

  // ── Split ─────────────────────────────────────────────────────────────────
  const handleSplit = React.useCallback(async () => {
    const idx =
      selectedIdx ??
      editClipsRef.current.findIndex(
        (_, i) =>
          currentUs >= clipPositions[i] &&
          currentUs < clipPositions[i] + usedDur(editClipsRef.current[i])
      );
    if (idx < 0) return;
    const ec = editClipsRef.current[idx];
    if (!ec) return;

    const pos = clipPositions[idx];
    const splitAbsUs = currentUs - pos + ec.trimStart;
    if (
      splitAbsUs <= ec.trimStart + 100_000 ||
      splitAbsUs >= ec.duration - ec.trimEnd - 100_000
    )
      return;

    const [before, after] = await ec.clip.split(splitAbsUs);
    const beforeClip: EditableClip = {
      id: newClipId(),
      clip: before,
      sourceUrl: ec.sourceUrl,
      sourceMeta: ec.sourceMeta,
      duration: splitAbsUs,
      trimStart: ec.trimStart,
      trimEnd: 0,
      thumbs: ec.thumbs.filter((t) => t.ts < splitAbsUs),
    };
    const afterClip: EditableClip = {
      id: newClipId(),
      clip: after,
      sourceUrl: ec.sourceUrl,
      sourceMeta: ec.sourceMeta,
      duration: ec.duration - splitAbsUs,
      trimStart: 0,
      trimEnd: ec.trimEnd,
      thumbs: ec.thumbs
        .filter((t) => t.ts >= splitAbsUs)
        .map((t) => ({ ...t, ts: t.ts - splitAbsUs })),
    };

    ec.clip.destroy();
    setEditClips((prev) => {
      const next = [...prev];
      next.splice(idx, 1, beforeClip, afterClip);
      return next;
    });
    setSelectedIdx(idx);
    trimUndoRef.current = [];
    trimRedoRef.current = [];
  }, [selectedIdx, currentUs, clipPositions]);

  // ── Delete clip ──────────────────────────────────────────────────────────
  const handleDeleteClip = React.useCallback(() => {
    const idx = selectedIdx;
    if (idx === null) return;
    const clips = editClipsRef.current;
    if (clips.length <= 1) return;
    const ec = clips[idx];
    if (!ec) return;

    ec.clip.destroy();
    ec.thumbs.forEach(({ url }) => URL.revokeObjectURL(url));

    setEditClips((prev) => {
      const next = [...prev];
      next.splice(idx, 1);
      return next;
    });
    setSelectedIdx(null);
    trimUndoRef.current = [];
    trimRedoRef.current = [];
  }, [selectedIdx]);

  // Intercept Delete/Backspace inside modal so canvas doesn't receive them
  React.useEffect(() => {
    if (!opened) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        e.stopPropagation();
        handleDeleteClip();
      }
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [opened, handleDeleteClip]);

  // ── Snap helper ───────────────────────────────────────────────────────────
  const snapToClipBoundary = React.useCallback(
    (us: number, pxPerUs: number): number => {
      if (!snapEnabled || totalUs === 0) return us;
      const thresholdUs = SNAP_THRESHOLD_PX / pxPerUs;
      for (let i = 0; i < editClipsRef.current.length; i++) {
        const pos = clipPositions[i];
        const end = pos + usedDur(editClipsRef.current[i]);
        if (Math.abs(us - pos) < thresholdUs) return pos;
        if (Math.abs(us - end) < thresholdUs) return end;
      }
      return us;
    },
    [snapEnabled, totalUs, clipPositions]
  );

  // ── Scrub ─────────────────────────────────────────────────────────────────
  const pxToUs = React.useCallback(
    (px: number, pxPerUs: number) => Math.max(0, Math.min(totalUs, px / pxPerUs)),
    [totalUs]
  );

  const handleRulerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointerIsDownRef.current = true;
    scrubActiveRef.current = false;
    scrubStartXRef.current = e.clientX;
    wasPlayingRef.current = playing;
  };

  const handleRulerPointerMove = (
    e: React.PointerEvent<HTMLDivElement>,
    pxPerUs: number
  ) => {
    if (!pointerIsDownRef.current) return;
    const moved = Math.abs(e.clientX - scrubStartXRef.current) > 4;
    if (!moved && !scrubActiveRef.current) return;
    if (!scrubActiveRef.current) {
      scrubActiveRef.current = true;
      setPlaying(false);
    }
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    setCurrentUs(snapToClipBoundary(pxToUs(px, pxPerUs), pxPerUs));
  };

  const handleRulerPointerUp = () => {
    pointerIsDownRef.current = false;
    const wasScrubbing = scrubActiveRef.current;
    scrubActiveRef.current = false;
    if (wasPlayingRef.current && wasScrubbing) setPlaying(true);
  };

  const handleClipTrackPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    pxPerUs: number
  ) => {
    pointerIsDownRef.current = true;
    scrubStartXRef.current = e.clientX;
    scrubActiveRef.current = false;
    wasPlayingRef.current = playing;
    e.currentTarget.setPointerCapture(e.pointerId);
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    const clickedUs = pxToUs(px, pxPerUs);
    let cum = 0;
    let foundIdx: number | null = null;
    for (let i = 0; i < editClipsRef.current.length; i++) {
      const ud = usedDur(editClipsRef.current[i]);
      if (clickedUs >= cum && clickedUs < cum + ud) {
        foundIdx = i;
        break;
      }
      cum += ud;
    }
    setSelectedIdx(foundIdx);
  };

  const handleClipTrackPointerMove = (
    e: React.PointerEvent<HTMLDivElement>,
    pxPerUs: number
  ) => {
    if (!pointerIsDownRef.current) return;
    const moved = Math.abs(e.clientX - scrubStartXRef.current) > 4;
    if (!moved) return;
    if (!scrubActiveRef.current) {
      scrubActiveRef.current = true;
      setPlaying(false);
    }
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    setCurrentUs(snapToClipBoundary(pxToUs(px, pxPerUs), pxPerUs));
  };

  const handleClipTrackPointerUp = () => {
    pointerIsDownRef.current = false;
    if (scrubActiveRef.current && wasPlayingRef.current) setPlaying(true);
    scrubActiveRef.current = false;
  };

  // ── Trim drag ─────────────────────────────────────────────────────────────
  const handleTrimDown = (
    e: React.PointerEvent<HTMLDivElement>,
    clipId: string,
    side: "start" | "end",
    pxPerUs: number
  ) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const usPerPx = 1 / pxPerUs;
    const ec = editClipsRef.current.find((c) => c.id === clipId)!;
    saveTrimSnapshot();
    trimDragRef.current = {
      clipId,
      side,
      startX: e.clientX,
      startTrimUs: side === "start" ? ec.trimStart : ec.trimEnd,
      usPerPx,
    };
    setPlaying(false);
    setActiveTrimInfo({ id: clipId, side, durationUs: usedDur(ec) });
  };

  const handleTrimMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = trimDragRef.current;
    if (!drag) return;
    e.stopPropagation();
    const { clipId, side, startX, startTrimUs, usPerPx } = drag;
    const ec = editClipsRef.current.find((c) => c.id === clipId)!;
    if (!ec) return;
    const otherTrim = side === "start" ? ec.trimEnd : ec.trimStart;
    const deltaUs = (e.clientX - startX) * usPerPx;
    let newTrim = startTrimUs + (side === "start" ? deltaUs : -deltaUs);
    newTrim = Math.max(0, Math.min(ec.duration - otherTrim - MIN_USED_US, newTrim));
    setEditClips((prev) =>
      prev.map((c) =>
        c.id === clipId
          ? { ...c, [side === "start" ? "trimStart" : "trimEnd"]: Math.round(newTrim) }
          : c
      )
    );
    const updated = editClipsRef.current.find((c) => c.id === clipId)!;
    setActiveTrimInfo({
      id: clipId,
      side,
      durationUs: usedDur({
        ...updated,
        [side === "start" ? "trimStart" : "trimEnd"]: Math.round(newTrim),
      }),
    });
  };

  const handleTrimUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!trimDragRef.current) return;
    e.stopPropagation();
    trimDragRef.current = null;
    setActiveTrimInfo(null);
  };

  // ── Compose ───────────────────────────────────────────────────────────────
  const handleCompose = async () => {
    setPlaying(false);
    const sources: ComposeVideoSource[] = editClipsRef.current.map((ec) => ({
      url: ec.sourceUrl,
      title: ec.sourceMeta.title,
      thumbnailUrl: ec.sourceMeta.thumbnailUrl,
      trimStart: ec.trimStart,
      trimEnd: ec.trimEnd,
    }));
    const blob = await compose(sources, { audioTracks: upstreamAudioTracks });
    if (blob) {
      onComposeDone(blob);
      onClose();
    }
  };

  // ── Toolbar button states ─────────────────────────────────────────────────
  const canUndo = trimUndoRef.current.length > 0;
  const canRedo = trimRedoRef.current.length > 0;
  const canMarkIn = selectedIdx !== null && currentUs > clipPositions[selectedIdx];
  const canMarkOut =
    selectedIdx !== null &&
    currentUs < clipPositions[selectedIdx] + usedDur(editClips[selectedIdx] ?? editClips[0]);
  const canSplit = (() => {
    const idx =
      selectedIdx ??
      editClips.findIndex(
        (_, i) =>
          currentUs >= clipPositions[i] &&
          currentUs < clipPositions[i] + usedDur(editClips[i])
      );
    if (idx < 0) return false;
    const ec = editClips[idx];
    if (!ec) return false;
    const pos = clipPositions[idx];
    const splitAbs = currentUs - pos + ec.trimStart;
    return (
      splitAbs > ec.trimStart + 100_000 &&
      splitAbs < ec.duration - ec.trimEnd - 100_000
    );
  })();

  // ── Pixel-based timeline layout ───────────────────────────────────────────
  const pxPerSec = BASE_PX_PER_SEC * zoomLevel;
  const pxPerUs = pxPerSec / US_PER_S;
  const contentWidthPx = Math.max(400, (totalUs / US_PER_S) * pxPerSec);
  const playheadPx = currentUs * pxPerUs;
  const step = rulerStep(pxPerSec);

  if (!opened) return null;

  const glyphStyle = (enabled: boolean) => ({
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 1,
    color: enabled ? "#ccc" : "#555",
  });

  const overlay = (
    <div
      className="nodrag nopan nowheel"
      onPointerDownCapture={(e) => e.stopPropagation()}
      onWheelCapture={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 8200,
        background: "#1a1a1a",
        display: "flex",
        flexDirection: "column",
        color: "#fff",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 20px",
          borderBottom: "1px solid #2e2e2e",
          flexShrink: 0,
          minHeight: 44,
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Scissors size={15} color="#999" />
          <span style={{ fontSize: 14, fontWeight: 500, color: "#fff" }}>视频合成</span>
        </div>
        <IconBtn title="关闭" onClick={onClose}>
          <X size={14} />
        </IconBtn>
      </div>

      {/* Preview */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0d0d0d",
          minHeight: 0,
          padding: 16,
        }}
      >
        {loading ? (
          <span style={{ fontSize: 12, color: "#888" }}>加载视频…</span>
        ) : loadError ? (
          <span style={{ fontSize: 13, color: "#f87171" }}>{loadError}</span>
        ) : (
          <canvas
            ref={canvasRef}
            width={960}
            height={540}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              display: "block",
              background: "#000",
              borderRadius: 4,
            }}
          />
        )}
      </div>

      {/* Toolbar + controls */}
      <div
        style={{
          padding: "8px 16px",
          background: "#1e1e1e",
          borderTop: "1px solid #2e2e2e",
          flexShrink: 0,
        }}
      >
        {composing ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12, color: "#888", textAlign: "center" }}>
              合成中… {composeProgress}%
            </span>
            <div style={{ height: 4, borderRadius: 2, background: "#333", overflow: "hidden" }}>
              <div
                style={{
                  width: `${composeProgress}%`,
                  height: "100%",
                  background: "#2563eb",
                  transition: "width 0.2s",
                }}
              />
            </div>
            <button
              type="button"
              onClick={cancelCompose}
              style={{
                fontSize: 12,
                color: "#f87171",
                background: "transparent",
                border: "none",
                cursor: "pointer",
              }}
            >
              取消
            </button>
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "nowrap",
            }}
          >
            {/* Left: edit actions */}
            <div style={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "nowrap" }}>
              <IconBtn title="撤销" disabled={!canUndo} onClick={handleUndo}>
                <Undo2 size={15} />
              </IconBtn>
              <IconBtn title="重做" disabled={!canRedo} onClick={handleRedo}>
                <Redo2 size={15} />
              </IconBtn>
              <VDivider />
              <IconBtn title="分割" disabled={!canSplit || loading} onClick={() => void handleSplit()}>
                <span style={{ ...glyphStyle(canSplit), letterSpacing: "-2px" }}>][</span>
              </IconBtn>
              <IconBtn title="设置入点" disabled={!canMarkIn} onClick={handleMarkIn}>
                <span style={glyphStyle(canMarkIn)}>[|</span>
              </IconBtn>
              <IconBtn title="设置出点" disabled={!canMarkOut} onClick={handleMarkOut}>
                <span style={glyphStyle(canMarkOut)}>|]</span>
              </IconBtn>
              <VDivider />
              <IconBtn
                title="删除片段"
                color="red"
                disabled={selectedIdx === null || editClips.length <= 1}
                onClick={handleDeleteClip}
              >
                <Trash2 size={14} />
              </IconBtn>
            </div>

            {/* Center: playback */}
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "nowrap" }}>
              <span
                style={{
                  fontSize: 12,
                  color: "#888",
                  fontFamily: "monospace",
                  minWidth: 40,
                  textAlign: "right",
                }}
              >
                {usToDisplay(currentUs)}
              </span>
              <IconBtn
                title={playing ? "暂停" : "播放"}
                active
                disabled={!editClips.length || loading}
                onClick={() => {
                  if (playing) {
                    setPlaying(false);
                  } else {
                    if (currentUs >= totalUs) setCurrentUs(0);
                    setPlaying(true);
                  }
                }}
              >
                {playing ? <Pause size={15} /> : <Play size={15} />}
              </IconBtn>
              <span
                style={{ fontSize: 12, color: "#888", fontFamily: "monospace", minWidth: 40 }}
              >
                {usToDisplay(totalUs)}
              </span>
            </div>

            {/* Right: zoom + snap + compose */}
            <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "nowrap" }}>
              <IconBtn
                title="磁力吸附"
                active={snapEnabled}
                color="blue"
                onClick={() => setSnapEnabled(!snapEnabled)}
              >
                <Magnet size={14} />
              </IconBtn>
              <IconBtn
                title="缩小"
                onClick={() => setZoomLevel((z) => Math.max(1, z / 1.5))}
              >
                <ZoomOut size={14} />
              </IconBtn>
              <input
                type="range"
                min={1}
                max={8}
                step={0.5}
                value={zoomLevel}
                onChange={(e) => setZoomLevel(Number(e.target.value))}
                style={{ width: 70 }}
              />
              <IconBtn
                title="放大"
                onClick={() => setZoomLevel((z) => Math.min(8, z * 1.5))}
              >
                <ZoomIn size={14} />
              </IconBtn>
              <IconBtn title="适配窗口" onClick={() => setZoomLevel(1)}>
                <Maximize2 size={14} />
              </IconBtn>
              <VDivider />
              <PrimaryBtn
                disabled={upstreamVideos.length < 2 || composing || loading}
                onClick={() => void handleCompose()}
              >
                <Scissors size={12} />
                合成视频
              </PrimaryBtn>
            </div>
          </div>
        )}
        {composeError && (
          <div style={{ fontSize: 12, color: "#f87171", marginTop: 6 }}>{composeError}</div>
        )}
      </div>

      {/* Timeline */}
      {!loading && !loadError && editClips.length > 0 && (
        <div
          style={{
            background: "#141414",
            borderTop: "1px solid #2e2e2e",
            flexShrink: 0,
            userSelect: "none",
          }}
        >
          <div
            ref={scrollRef}
            style={{
              overflowX: "auto",
              paddingLeft: 24,
              paddingRight: 24,
              paddingBottom: 48,
            }}
          >
            <div style={{ width: contentWidthPx, position: "relative" }}>
              {/* Ruler */}
              <div
                style={{
                  position: "relative",
                  height: 32,
                  cursor: "ew-resize",
                  borderBottom: "1px solid #2e2e2e",
                }}
                onPointerDown={handleRulerPointerDown}
                onPointerMove={(e) => handleRulerPointerMove(e, pxPerUs)}
                onPointerUp={handleRulerPointerUp}
              >
                {totalUs > 0 &&
                  Array.from({ length: Math.floor(totalUs / step) + 2 }, (_, i) => {
                    const tickPx = i * step * pxPerUs;
                    if (tickPx > contentWidthPx) return null;
                    return (
                      <div
                        key={i}
                        style={{
                          position: "absolute",
                          left: tickPx,
                          top: 0,
                          transform: "translateX(-50%)",
                          pointerEvents: "none",
                        }}
                      >
                        <div style={{ width: 1, height: 6, background: "#555", margin: "0 auto" }} />
                        <span
                          style={{
                            fontSize: 10,
                            color: "#888",
                            fontFamily: "monospace",
                            lineHeight: 1.3,
                            textAlign: "center",
                            whiteSpace: "nowrap",
                            display: "block",
                          }}
                        >
                          {usToDisplay(i * step)}
                        </span>
                      </div>
                    );
                  })}
              </div>

              {/* Clip track */}
              <div
                style={{ position: "relative", height: 80, cursor: "default", background: "#111" }}
                onPointerDown={(e) => handleClipTrackPointerDown(e, pxPerUs)}
                onPointerMove={(e) => handleClipTrackPointerMove(e, pxPerUs)}
                onPointerUp={handleClipTrackPointerUp}
              >
                {editClips.map((ec, idx) => {
                  const ud = usedDur(ec);
                  const leftPx = clipPositions[idx] * pxPerUs;
                  const widthPx = Math.max(2, ud * pxPerUs);
                  const isSelected = selectedIdx === idx;
                  const isActiveTrim = activeTrimInfo?.id === ec.id;
                  const clipEnd = ec.duration - ec.trimEnd;
                  const visibleThumbs = ec.thumbs.filter((t) => t.ts < clipEnd);

                  return (
                    <div
                      key={ec.id}
                      style={{
                        position: "absolute",
                        left: leftPx,
                        width: widthPx,
                        height: "100%",
                        overflow: "hidden",
                        borderRight:
                          idx < editClips.length - 1 ? "2px solid #0d0d0d" : undefined,
                        outline: isSelected ? "2px solid rgba(255,255,255,0.75)" : undefined,
                        outlineOffset: "-2px",
                        borderRadius: 2,
                        background: "#1a2a3a",
                      }}
                    >
                      {/* Thumbnail strip */}
                      {visibleThumbs.map((thumb, ti) => {
                        const tStart = Math.max(thumb.ts, ec.trimStart);
                        const tEnd = visibleThumbs[ti + 1]?.ts ?? clipEnd;
                        if (tStart >= clipEnd) return null;
                        const lPct = ud > 0 ? ((tStart - ec.trimStart) / ud) * 100 : 0;
                        const wPct =
                          ud > 0 ? ((Math.min(tEnd, clipEnd) - tStart) / ud) * 100 : 0;
                        if (wPct <= 0) return null;
                        return (
                          <img
                            key={thumb.ts}
                            src={thumb.url}
                            style={{
                              position: "absolute",
                              left: `${lPct}%`,
                              width: `${wPct}%`,
                              height: "100%",
                              objectFit: "cover",
                              opacity: 0.85,
                              pointerEvents: "none",
                            }}
                          />
                        );
                      })}

                      {/* Trim handles — selected only */}
                      {isSelected && (
                        <>
                          <div
                            style={{
                              position: "absolute",
                              left: 0,
                              top: 0,
                              bottom: 0,
                              width: HANDLE_W,
                              background: "rgba(255,255,255,0.28)",
                              cursor: "ew-resize",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              zIndex: 2,
                            }}
                            onPointerDown={(e) => handleTrimDown(e, ec.id, "start", pxPerUs)}
                            onPointerMove={handleTrimMove}
                            onPointerUp={handleTrimUp}
                          >
                            <div
                              style={{
                                width: 2,
                                height: 22,
                                background: "rgba(255,255,255,0.9)",
                                borderRadius: 1,
                              }}
                            />
                          </div>
                          <div
                            style={{
                              position: "absolute",
                              right: 0,
                              top: 0,
                              bottom: 0,
                              width: HANDLE_W,
                              background: "rgba(255,255,255,0.28)",
                              cursor: "ew-resize",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              zIndex: 2,
                            }}
                            onPointerDown={(e) => handleTrimDown(e, ec.id, "end", pxPerUs)}
                            onPointerMove={handleTrimMove}
                            onPointerUp={handleTrimUp}
                          >
                            <div
                              style={{
                                width: 2,
                                height: 22,
                                background: "rgba(255,255,255,0.9)",
                                borderRadius: 1,
                              }}
                            />
                          </div>
                        </>
                      )}

                      {/* Duration tooltip during trim drag */}
                      {isActiveTrim && (
                        <div
                          style={{
                            position: "absolute",
                            top: "50%",
                            left: "50%",
                            transform: "translate(-50%, -50%)",
                            background: "rgba(0,0,0,0.85)",
                            borderRadius: 4,
                            padding: "2px 8px",
                            pointerEvents: "none",
                            zIndex: 10,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 12,
                              color: "#fff",
                              fontFamily: "monospace",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {usToSecs(activeTrimInfo!.durationUs)}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Playhead */}
              <div
                style={{
                  position: "absolute",
                  left: playheadPx,
                  top: 0,
                  bottom: -48,
                  width: 2,
                  background: "white",
                  transform: "translateX(-50%)",
                  pointerEvents: "none",
                  zIndex: 10,
                  boxShadow: "0 0 4px rgba(255,255,255,0.3)",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: playheadPx,
                  top: 20,
                  transform: "translateX(-50%)",
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  background: "white",
                  boxShadow: "0 0 4px rgba(0,0,0,0.6)",
                  pointerEvents: "none",
                  zIndex: 11,
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return createPortal(overlay, document.body);
}
