import React from "react";
import { Handle, Position, useStore, type Node, type ReactFlowState } from "@xyflow/react";
import { fetchWithAuth } from "@/services/authFetch";
import { getApiBaseUrl } from "@/utils/assetProxy";
import { useLocaleText } from "@/utils/localeText";
import RunCreditBadge from "./RunCreditBadge";
import GenerationProgressBar from "./GenerationProgressBar";
import { useBackendCreditsPreview } from "../hooks/useBackendCreditsPreview";
import { useNodeRunCredits } from "../hooks/useNodeRunCredits";
import { markVideoTaskSuccess, refundVideoTask } from "@/services/videoProviderAPI";

type VolcEnhanceStatus = "idle" | "running" | "succeeded" | "failed";
type VolcEnhanceMode = "preset" | "limit";
type VolcEnhanceHistoryItem = {
  id: string;
  taskId?: string;
  videoUrl: string;
  createdAt: string;
};

type Props = {
  id: string;
  data: {
    status?: VolcEnhanceStatus;
    error?: string;
    videoUrl?: string;
    taskId?: string;
    apiUsageId?: string;
    upstreamStatus?: string;
    toolVersion?: "standard" | "professional";
    scene?: "aigc" | "short_series" | "ugc" | "old_film" | "";
    resolutionMode?: VolcEnhanceMode;
    resolution?: "720p" | "1080p" | "4k" | "";
    resolutionLimit?: number;
    fps?: number;
    creditsPerCall?: number;
    videoVersion?: number;
    progress?: number;
    progressStartedAt?: number | string | null;
    history?: VolcEnhanceHistoryItem[];
    currentHistoryId?: string;
  };
  selected?: boolean;
};

const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 360;
const MAX_HISTORY_ITEMS = 20;

const sanitizeMediaUrl = (raw?: string | null | undefined): string | undefined => {
  if (!raw || typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : undefined;
};

const resolveVideoUrlFromNode = (node?: Node<any> | null): string | undefined => {
  if (!node) return undefined;
  const nodeData = (node.data ?? {}) as any;
  const candidates = [
    nodeData.videoUrl,
    nodeData.video_url,
    nodeData.videoSourceUrl,
    nodeData.video_source_url,
    nodeData.video,
    nodeData.videoSource,
    nodeData.output?.video_url,
    Array.isArray(nodeData.output) ? nodeData.output[0]?.video_url : undefined,
    nodeData.output?.url,
    nodeData.raw?.output?.video_url,
    nodeData.raw?.video_url,
    Array.isArray(nodeData.history) ? nodeData.history[0]?.videoUrl : undefined,
    nodeData.videoSource?.url,
  ];
  for (const candidate of candidates) {
    const value = sanitizeMediaUrl(candidate);
    if (value) return value;
  }
  return undefined;
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

function VolcEnhanceVideoNodeInner({ id, data, selected = false }: Props) {
  const { lt } = useLocaleText();
  const [hover, setHover] = React.useState<string | null>(null);
  const [showHistory, setShowHistory] = React.useState(false);
  const runSeqRef = React.useRef(0);

  const connectedVideoUrl = useStore(
    React.useCallback(
      (state: ReactFlowState) => {
        const edge = state.edges.find(
          (e) =>
            e.target === id &&
            typeof e.targetHandle === "string" &&
            e.targetHandle.startsWith("video"),
        );
        if (!edge) return undefined;
        const sourceNode = state.nodes.find((n: Node<any>) => n.id === edge.source);
        return resolveVideoUrlFromNode(sourceNode);
      },
      [id],
    ),
  );

  const hasVideoConnection = useStore(
    React.useCallback(
      (state: ReactFlowState) =>
        state.edges.some(
          (edge) =>
            edge.target === id &&
            typeof edge.targetHandle === "string" &&
            edge.targetHandle.startsWith("video"),
        ),
      [id],
    ),
  );

  const status = data.status ?? "idle";
  const inputVideoUrl = connectedVideoUrl;
  const outputVideoUrl = sanitizeMediaUrl(data.videoUrl);
  const historyItems = React.useMemo<VolcEnhanceHistoryItem[]>(
    () => (Array.isArray(data.history) ? data.history : []),
    [data.history],
  );

  const previewRequestParams = React.useMemo(() => {
    const params: Record<string, any> = {
      toolVersion: data.toolVersion || "standard",
      scene: data.scene || "aigc",
    };
    const mode = data.resolutionMode || "preset";
    if (mode === "limit") {
      const limit = Number(data.resolutionLimit);
      if (Number.isFinite(limit)) {
        params.resolutionLimit = Math.max(64, Math.min(2160, Math.round(limit)));
      }
    } else {
      params.resolution = data.resolution || "1080p";
    }
    if (typeof data.fps === "number" && Number.isFinite(data.fps)) {
      params.fps = Math.max(1, Math.min(120, Math.round(data.fps)));
    }
    return params;
  }, [
    data.fps,
    data.resolution,
    data.resolutionLimit,
    data.resolutionMode,
    data.scene,
    data.toolVersion,
  ]);

  const { credits: backendCredits } = useBackendCreditsPreview({
    serviceType: "volc-enhance-video",
    model: data.toolVersion || "standard",
    requestParams: previewRequestParams,
    enabled: true,
  });
  const resolvedRunCredits =
    typeof backendCredits === "number" ? backendCredits : data.creditsPerCall;
  const { credits: runCredits, hasCredits: hasRunCredits } =
    useNodeRunCredits(resolvedRunCredits);

  const isRunning = status === "running";

  const borderColor = selected ? "#2563eb" : "#e5e7eb";
  const boxShadow = selected ? "0 0 0 2px rgba(37,99,235,0.12)" : "0 1px 2px rgba(0,0,0,0.04)";

  const outputVideoPreviewUrl = React.useMemo(() => {
    if (!outputVideoUrl) return undefined;
    const version = Number(data.videoVersion || 0);
    const separator = outputVideoUrl.includes("?") ? "&" : "?";
    return `${outputVideoUrl}${separator}v=${version}&_ts=${Date.now()}`;
  }, [outputVideoUrl, data.videoVersion]);

  const updateNodeData = React.useCallback(
    (patch: Record<string, any>) => {
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: { id, patch },
        }),
      );
    },
    [id],
  );

  React.useEffect(() => {
    const patch: Record<string, any> = {};
    if (!data.toolVersion) patch.toolVersion = "standard";
    if (!data.scene) patch.scene = "aigc";
    if (!data.resolutionMode) patch.resolutionMode = "preset";
    if (typeof data.resolution === "undefined") patch.resolution = "1080p";
    if (typeof data.resolutionLimit === "undefined") patch.resolutionLimit = 720;
    if (Object.keys(patch).length > 0) updateNodeData(patch);
  }, [
    data.resolution,
    data.resolutionLimit,
    data.resolutionMode,
    data.scene,
    data.toolVersion,
    updateNodeData,
  ]);

  const runEnhance = React.useCallback(async (): Promise<boolean> => {
    const sourceVideoUrl = sanitizeMediaUrl(inputVideoUrl);
    if (!sourceVideoUrl) {
      updateNodeData({
        status: "failed",
        progress: undefined,
        error: lt("未找到可增强的视频输入，请先连接视频节点。", "No video input found. Connect a video node first."),
      });
      return false;
    }

    if (isRunning) return false;

    const apiBase = getApiBaseUrl();
    const seq = ++runSeqRef.current;
    const runStartedAt = Date.now();

    updateNodeData({
      status: "running",
      error: undefined,
      taskId: undefined,
      apiUsageId: undefined,
      upstreamStatus: "queued",
      progressStartedAt: runStartedAt,
      progress: 5,
      videoUrl: undefined,
      currentHistoryId: undefined,
    });

    let apiUsageId: string | undefined;
    const tryRefundIfNeeded = async () => {
      if (!apiUsageId) return;
      const usageId = apiUsageId;
      apiUsageId = undefined;
      try {
        await refundVideoTask(usageId);
      } catch (refundError) {
        console.warn("Failed to refund volc enhance video credits", refundError);
      }
    };

    try {
      const payload: Record<string, any> = {
        videoUrl: sourceVideoUrl,
        toolVersion: data.toolVersion || "standard",
        scene: data.scene || "aigc",
      };

      const resolutionMode = data.resolutionMode || "preset";
      if (resolutionMode === "limit") {
        const limit = Number(data.resolutionLimit);
        if (!Number.isFinite(limit) || limit < 64 || limit > 2160) {
          updateNodeData({
            status: "failed",
            progress: undefined,
            error: lt("短边像素限制必须在 64 到 2160 之间。", "Short-side limit must be between 64 and 2160."),
          });
          return false;
        }
        payload.resolutionLimit = Math.round(limit);
      } else {
        const resolution = String(data.resolution || "").trim();
        if (resolution) payload.resolution = resolution;
      }

      if (typeof data.fps === "number" && Number.isFinite(data.fps)) {
        payload.fps = Math.max(1, Math.min(120, Math.round(data.fps)));
      }

      const submitResp = await fetchWithAuth(`${apiBase}/api/ai/volc-enhance-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!submitResp.ok) {
        const err = await submitResp.json().catch(() => ({}));
        throw new Error(err?.message || `HTTP ${submitResp.status}`);
      }

      const submitResult = await submitResp.json().catch(() => ({}));
      const taskId = String(submitResult?.taskId || "").trim();
      const submitApiUsageId = String(submitResult?.apiUsageId || "").trim();
      if (submitApiUsageId) {
        apiUsageId = submitApiUsageId;
      }
      if (!taskId) {
        await tryRefundIfNeeded();
        throw new Error(lt("未返回任务 ID", "Task ID not returned"));
      }

      updateNodeData({
        taskId,
        apiUsageId: apiUsageId || undefined,
        upstreamStatus: "queued",
        progress: 8,
      });

      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
        if (seq !== runSeqRef.current) {
          await tryRefundIfNeeded();
          return false;
        }
        await sleep(POLL_INTERVAL_MS);
        if (seq !== runSeqRef.current) {
          await tryRefundIfNeeded();
          return false;
        }

        const queryResp = await fetchWithAuth(
          `${apiBase}/api/ai/volc-enhance-video/${encodeURIComponent(taskId)}`,
        );
        if (!queryResp.ok) {
          const err = await queryResp.json().catch(() => ({}));
          throw new Error(err?.message || `HTTP ${queryResp.status}`);
        }

        const query = await queryResp.json().catch(() => ({}));
        const taskStatus = String(query?.status || "").trim().toLowerCase();
        const upstreamStatus = String(query?.upstreamStatus || "").trim();
        const enhancedVideoUrl = sanitizeMediaUrl(query?.videoUrl);
        const errorMessage = query?.error;

        if (taskStatus === "succeeded") {
          if (!enhancedVideoUrl) {
            throw new Error(lt("任务成功但未返回输出视频地址。", "Task succeeded but no output video URL was returned."));
          }
          const historyId = `${taskId}-${Date.now()}`;
          const nextHistory: VolcEnhanceHistoryItem[] = [
            {
              id: historyId,
              taskId,
              videoUrl: enhancedVideoUrl,
              createdAt: new Date().toISOString(),
            },
            ...historyItems.filter((item) => item.videoUrl !== enhancedVideoUrl),
          ].slice(0, MAX_HISTORY_ITEMS);

          if (apiUsageId) {
            try {
              await markVideoTaskSuccess(apiUsageId, Math.max(0, Date.now() - runStartedAt));
            } catch (markError) {
              console.warn("Failed to mark volc enhance video task success", markError);
            }
          }

          updateNodeData({
            status: "succeeded",
            error: undefined,
            taskId,
            apiUsageId: apiUsageId || undefined,
            upstreamStatus,
            videoUrl: enhancedVideoUrl,
            videoVersion: Number(data.videoVersion || 0) + 1,
            progressStartedAt: runStartedAt,
            progress: 100,
            history: nextHistory,
            currentHistoryId: historyId,
          });
          return true;
        }

        if (taskStatus === "failed") {
          await tryRefundIfNeeded();
          updateNodeData({
            status: "failed",
            taskId,
            upstreamStatus,
            progressStartedAt: runStartedAt,
            apiUsageId: undefined,
            error:
              errorMessage ||
              lt("视频画质增强失败，请稍后重试。", "Video enhancement failed. Please try again later."),
          });
          return false;
        }

        const progress = Math.min(95, 10 + Math.round(((attempt + 1) / MAX_POLL_ATTEMPTS) * 85));
        updateNodeData({
          status: "running",
          taskId,
          upstreamStatus: upstreamStatus || "processing",
          progressStartedAt: runStartedAt,
          progress,
        });
      }

      await tryRefundIfNeeded();
      updateNodeData({
        status: "failed",
        taskId,
        progressStartedAt: runStartedAt,
        apiUsageId: undefined,
        error: lt("任务轮询超时，请稍后重试。", "Task polling timed out. Please try again later."),
      });
      return false;
    } catch (err: any) {
      await tryRefundIfNeeded();
      updateNodeData({
        status: "failed",
        progress: undefined,
        apiUsageId: undefined,
        error: err?.message || lt("视频画质增强失败", "Video enhancement failed"),
      });
      return false;
    }
  }, [
    data.fps,
    data.resolution,
    data.resolutionLimit,
    data.resolutionMode,
    data.scene,
    data.toolVersion,
    data.videoVersion,
    historyItems,
    inputVideoUrl,
    isRunning,
    lt,
    updateNodeData,
  ]);

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; done?: (result?: boolean) => void }>).detail;
      if (!detail || detail.id !== id) return;
      void runEnhance().then((ok) => detail.done?.(ok));
    };

    window.addEventListener("flow:run-node", handler as EventListener);
    return () => window.removeEventListener("flow:run-node", handler as EventListener);
  }, [id, runEnhance]);

  React.useEffect(() => {
    return () => {
      runSeqRef.current += 1;
    };
  }, []);

  const handleApplyHistory = React.useCallback(
    (item: VolcEnhanceHistoryItem) => {
      const patch: Record<string, any> = {
        videoUrl: item.videoUrl,
        currentHistoryId: item.id,
        videoVersion: Number(data.videoVersion || 0) + 1,
      };
      if (status !== "running") {
        patch.status = "succeeded";
        patch.error = undefined;
      }
      updateNodeData(patch);
    },
    [data.videoVersion, status, updateNodeData],
  );

  const triggerDownload = React.useCallback(async (url?: string) => {
    if (!url) return;
    try {
      const response = await fetch(url, { mode: "cors", credentials: "omit" });
      if (response.ok) {
        const blob = await response.blob();
        const videoBlob = blob.type.startsWith("video/") ? blob : new Blob([blob], { type: "video/mp4" });
        const blobUrl = URL.createObjectURL(videoBlob);
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = `enhanced-video-${new Date().toISOString().slice(0, 10)}.mp4`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 300);
        return;
      }
      window.open(url, "_blank");
    } catch {
      window.open(url, "_blank");
    }
  }, []);

  const formatHistoryTime = React.useCallback((value: string) => {
    if (!value) return "-";
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
  }, []);

  const canRun = Boolean(inputVideoUrl) && !isRunning;
  const resolutionMode = data.resolutionMode || "preset";
  const fpsInput = typeof data.fps === "number" ? String(data.fps) : "";

  return (
    <div
      style={{
        width: 320,
        padding: 10,
        background: "#fff",
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        boxShadow,
        transition: "border-color 0.15s ease, box-shadow 0.15s ease",
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontWeight: 600 }}>{lt("Video Enhance", "Video Enhance")}</div>
        <button
          className="run-btn-with-credit"
          onClick={() => {
            void runEnhance();
          }}
          disabled={!canRun}
          style={{
            fontSize: 12,
            padding: "4px 10px",
            minWidth: 82,
            background: canRun ? "#111827" : "#e5e7eb",
            color: "#fff",
            borderRadius: 6,
            border: "none",
            cursor: canRun ? "pointer" : "not-allowed",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          {isRunning ? (
            <span className="run-text-trigger">{lt("Running...", "Running...")}</span>
          ) : (
            <>
              <span className="run-text-trigger">{lt("Run", "Run")}</span>
              {hasRunCredits ? <RunCreditBadge credits={runCredits} runButton /> : null}
            </>
          )}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 6 }}>
        <div style={{ fontSize: 11, color: "#374151", fontWeight: 600 }}>
          {lt("输入视频", "Input Video")}
        </div>
        <div
          style={{
            width: "100%",
            height: 118,
            background: "#000",
            borderRadius: 6,
            border: "1px solid #eef0f2",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {inputVideoUrl ? (
            <video
              src={inputVideoUrl}
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
              preload="metadata"
              controls
            />
          ) : (
            <span style={{ fontSize: 12, color: "#9ca3af" }}>
              {hasVideoConnection
                ? lt("等待视频输入", "Waiting for video input")
                : lt("请连接视频节点", "Please connect a video node")}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6 }}>
        <label style={{ fontSize: 11, color: "#374151" }}>
          {lt("版本", "Version")}
          <select
            className="nodrag nopan"
            value={data.toolVersion || "standard"}
            onChange={(e) =>
              updateNodeData({
                toolVersion: (e.target.value || "standard") as "standard" | "professional",
              })
            }
            style={{
              marginTop: 4,
              width: "100%",
              fontSize: 12,
              padding: "4px 6px",
              borderRadius: 4,
              border: "1px solid #d1d5db",
            }}
          >
            <option value="standard">{lt("标准版", "Standard")}</option>
            <option value="professional">{lt("专业版", "Professional")}</option>
          </select>
        </label>

        <label style={{ fontSize: 11, color: "#374151" }}>
          {lt("场景", "Scene")}
          <select
            className="nodrag nopan"
            value={data.scene || "aigc"}
            onChange={(e) =>
              updateNodeData({
                scene: (e.target.value || "aigc") as "aigc" | "short_series" | "ugc" | "old_film",
              })
            }
            style={{
              marginTop: 4,
              width: "100%",
              fontSize: 12,
              padding: "4px 6px",
              borderRadius: 4,
              border: "1px solid #d1d5db",
            }}
          >
            <option value="aigc">AIGC</option>
            <option value="ugc">UGC</option>
            <option value="short_series">{lt("短剧", "Short Series")}</option>
            <option value="old_film">{lt("老片修复", "Old Film")}</option>
          </select>
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <label style={{ fontSize: 11, color: "#374151" }}>
          {lt("分辨率模式", "Resolution Mode")}
          <select
            className="nodrag nopan"
            value={resolutionMode}
            onChange={(e) =>
              updateNodeData({
                resolutionMode: (e.target.value || "preset") as VolcEnhanceMode,
              })
            }
            style={{
              marginTop: 4,
              width: "100%",
              fontSize: 12,
              padding: "4px 6px",
              borderRadius: 4,
              border: "1px solid #d1d5db",
            }}
          >
            <option value="preset">{lt("预设", "Preset")}</option>
            <option value="limit">{lt("短边像素", "Short Side")}</option>
          </select>
        </label>

        {resolutionMode === "limit" ? (
          <label style={{ fontSize: 11, color: "#374151" }}>
            {lt("短边像素", "Short Side")}
            <input
              type="number"
              className="nodrag nopan"
              value={Number(data.resolutionLimit || 720)}
              min={64}
              max={2160}
              step={1}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (!Number.isFinite(value)) return;
                updateNodeData({ resolutionLimit: Math.max(64, Math.min(2160, Math.round(value))) });
              }}
              style={{
                marginTop: 4,
                width: "100%",
                fontSize: 12,
                padding: "4px 6px",
                borderRadius: 4,
                border: "1px solid #d1d5db",
              }}
            />
          </label>
        ) : (
          <label style={{ fontSize: 11, color: "#374151" }}>
            {lt("分辨率", "Resolution")}
            <select
              className="nodrag nopan"
              value={data.resolution || "1080p"}
              onChange={(e) =>
                updateNodeData({
                  resolution: (e.target.value || "1080p") as "720p" | "1080p" | "4k",
                })
              }
              style={{
                marginTop: 4,
                width: "100%",
                fontSize: 12,
                padding: "4px 6px",
                borderRadius: 4,
                border: "1px solid #d1d5db",
              }}
            >
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
              <option value="4k">4K</option>
            </select>
          </label>
        )}
      </div>

      <label style={{ fontSize: 11, color: "#374151" }}>
        {lt("帧率（可选）", "FPS (Optional)")}
        <input
          type="number"
          className="nodrag nopan"
          value={fpsInput}
          placeholder={lt("保持原始帧率", "Keep source FPS")}
          min={1}
          max={120}
          step={1}
          onChange={(e) => {
            const value = e.target.value.trim();
            if (!value) {
              updateNodeData({ fps: undefined });
              return;
            }
            const parsed = Number(value);
            if (!Number.isFinite(parsed)) return;
            updateNodeData({ fps: Math.max(1, Math.min(120, Math.round(parsed))) });
          }}
          style={{
            marginTop: 4,
            width: "100%",
            fontSize: 12,
            padding: "4px 6px",
            borderRadius: 4,
            border: "1px solid #d1d5db",
          }}
        />
      </label>

      <div style={{ fontSize: 11, color: "#6b7280", minHeight: 16 }}>
        {data.taskId
          ? `Task: ${data.taskId}`
          : lt("输出为增强后视频，可继续连接到其他视频节点。", "Output is the enhanced video and can be chained to other video nodes.")}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 6 }}>
        <div style={{ fontSize: 11, color: "#374151", fontWeight: 600 }}>
          {lt("增强结果", "Enhanced Video")}
        </div>
        <div
          style={{
            width: "100%",
            height: 118,
            background: "#000",
            borderRadius: 6,
            border: "1px solid #eef0f2",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {outputVideoPreviewUrl ? (
            <video
              key={`${outputVideoPreviewUrl}-${data.videoVersion || 0}`}
              src={outputVideoPreviewUrl}
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
              preload="metadata"
              controls
            />
          ) : (
            <span style={{ fontSize: 12, color: "#9ca3af" }}>
              {lt("运行成功后将在此显示增强视频", "Enhanced result will appear here after success")}
            </span>
          )}
        </div>
      </div>

      {historyItems.length > 0 ? (
        <div
          style={{
            marginTop: 2,
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid #e2e8f0",
            background: "#f8fafc",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
            onClick={() => setShowHistory((v) => !v)}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>{lt("历史记录", "History")}</span>
            <span style={{ fontSize: 11, color: "#64748b" }}>
              {historyItems.length} {lt("条", "items")} {showHistory ? "▲" : "▼"}
            </span>
          </div>
          {showHistory
            ? historyItems.map((item, index) => {
                const isActive =
                  (data.currentHistoryId && item.id === data.currentHistoryId) || item.videoUrl === outputVideoUrl;
                return (
                  <div
                    key={`${item.id}-${index}`}
                    style={{
                      borderRadius: 6,
                      border: `1px solid ${isActive ? "#c7d2fe" : "#e2e8f0"}`,
                      background: isActive ? "#eef2ff" : "#fff",
                      padding: "6px 8px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <span style={{ fontSize: 11, color: "#334155" }}>
                      #{index + 1} · {formatHistoryTime(item.createdAt)}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {!isActive ? (
                        <button
                          type="button"
                          onClick={() => handleApplyHistory(item)}
                          style={{
                            padding: "4px 8px",
                            borderRadius: 6,
                            border: "1px solid #94a3b8",
                            background: "#fff",
                            fontSize: 11,
                            cursor: "pointer",
                          }}
                        >
                          {lt("设为当前", "Set current")}
                        </button>
                      ) : (
                        <span style={{ fontSize: 10, color: "#1d4ed8", fontWeight: 600 }}>{lt("当前", "Current")}</span>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          void triggerDownload(item.videoUrl);
                        }}
                        style={{
                          padding: "4px 8px",
                          borderRadius: 6,
                          border: "1px solid #94a3b8",
                          background: "#fff",
                          fontSize: 11,
                          cursor: "pointer",
                        }}
                      >
                        {lt("下载", "Download")}
                      </button>
                    </div>
                  </div>
                );
              })
            : null}
        </div>
      ) : null}

      {status === "failed" && data.error ? (
        <div
          style={{
            fontSize: 12,
            color: "#ef4444",
            padding: "4px 8px",
            background: "#fef2f2",
            borderRadius: 4,
          }}
        >
          {data.error}
        </div>
      ) : null}

      <GenerationProgressBar
        status={status}
        progress={typeof data.progress === "number" ? data.progress : undefined}
        simulateDurationMs={120 * 1000}
        startedAt={data.progressStartedAt}
        runKey={`${id}:${data.taskId || "local"}`}
      />

      <Handle
        type="target"
        position={Position.Left}
        id="video"
        style={{ top: "50%" }}
        onMouseEnter={() => setHover("video-in")}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="video"
        style={{ top: "50%" }}
        onMouseEnter={() => setHover("video-out")}
        onMouseLeave={() => setHover(null)}
      />

      {hover === "video-in" ? (
        <div className="flow-tooltip" style={{ left: -8, top: "50%", transform: "translate(-100%, -50%)" }}>
          video
        </div>
      ) : null}
      {hover === "video-out" ? (
        <div className="flow-tooltip" style={{ right: -8, top: "50%", transform: "translate(100%, -50%)" }}>
          video
        </div>
      ) : null}
    </div>
  );
}

export default React.memo(VolcEnhanceVideoNodeInner);
