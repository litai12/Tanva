// @ts-nocheck
import React from "react";
import { Handle, Position, useReactFlow, useStore } from "@xyflow/react";
import { useProjectContentStore } from "@/stores/projectContentStore";
import { useLocaleText } from "@/utils/localeText";
import { proxifyRemoteAssetUrl } from "@/utils/assetProxy";
import { VideoComposeContent } from "./VideoComposeContent";
import { VideoComposeEditorModal } from "./VideoComposeEditorModal";
import {
  collectUpstreamComposeSources,
  collectUpstreamComposeAudioTracks,
} from "./collectUpstreamComposeSources";
import {
  buildComposeInitialPatch,
  buildComposeUrlSwapPatch,
} from "./composeWriteback";

type Props = {
  id: string;
  data: {
    videoUrl?: string;
    videoName?: string;
    label?: string;
    boxW?: number;
    boxH?: number;
    status?: "idle" | "uploading" | "ready" | "error";
    error?: string;
  };
  selected?: boolean;
};

/** 从 React Flow 12 store 取节点数组。 */
function getNodesFromState(state: any): any[] {
  if (Array.isArray(state?.nodes)) return state.nodes;
  if (state?.nodeLookup && typeof state.nodeLookup.values === "function") {
    return Array.from(state.nodeLookup.values());
  }
  return [];
}

function VideoComposeNodeInner({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const rf = useReactFlow();
  const projectId = useProjectContentStore((state) => state.projectId);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [hover, setHover] = React.useState<string | null>(null);

  // 订阅上游视频/音频源；用 sig 做相等性判断，仅在相关数据变化时重渲染。
  const { videos: upstreamVideos, audios: upstreamAudioTracks } = useStore(
    (state: any) => {
      const edges = Array.isArray(state?.edges) ? state.edges : [];
      const nodes = getNodesFromState(state);
      const videos = collectUpstreamComposeSources(id, nodes, edges);
      const audios = collectUpstreamComposeAudioTracks(id, nodes, edges);
      const sig = JSON.stringify([
        videos.map((v) => v.url),
        audios.map((a) => [a.url, a.volume, a.loop]),
      ]);
      return { videos, audios, sig };
    },
    (a, b) => a.sig === b.sig
  );

  const updateNodeData = React.useCallback(
    (patch: Record<string, any>) => {
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", { detail: { id, patch } })
      );
    },
    [id]
  );

  const handleComposeDone = React.useCallback(
    async (blob: Blob) => {
      const blobUrl = URL.createObjectURL(blob);
      // 1) 立即写回 blob: URL，合成即可见
      updateNodeData(buildComposeInitialPatch(blobUrl));

      // 2) 后台转存 OSS，成功后把临时 URL 换成持久 URL
      try {
        const { ossUploadService } = await import("@/services/ossUploadService");
        const fileName = `compose-${Date.now()}.mp4`;
        const file = new File([blob], fileName, { type: "video/mp4" });
        const dir = projectId ? `projects/${projectId}/videos/` : "videos/";
        const result = await ossUploadService.uploadToOSS(file, {
          dir,
          projectId: null,
          fileName,
          contentType: "video/mp4",
          maxSize: 500 * 1024 * 1024,
        });
        if (result?.success && result.url) {
          const fresh = rf.getNode(id)?.data;
          const patch = buildComposeUrlSwapPatch(fresh, blobUrl, result.url);
          if (patch) updateNodeData(patch);
          setTimeout(() => {
            try {
              URL.revokeObjectURL(blobUrl);
            } catch {
              /* ignore */
            }
          }, 2000);
        } else {
          console.error("❌ Compose video upload failed:", result?.error);
        }
      } catch (err) {
        console.error("❌ Compose video upload failed:", err);
      }
    },
    [id, projectId, rf, updateNodeData]
  );

  const handleDownload = React.useCallback(() => {
    const url = data.videoUrl;
    if (!url) return;
    const a = document.createElement("a");
    // blob: 直接下载；http(s) 强制走代理避开跨域 download 限制
    a.href = url.startsWith("blob:")
      ? url
      : proxifyRemoteAssetUrl(url, { forceProxy: true });
    a.download = data.videoName || "合成视频.mp4";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [data.videoUrl, data.videoName]);

  const borderColor = selected ? "#2563eb" : "#e5e7eb";
  const boxShadow = selected
    ? "0 0 0 2px rgba(37,99,235,0.12)"
    : "0 1px 2px rgba(0,0,0,0.04)";

  return (
    <div
      className="flow-video-compose-node"
      style={{
        width: data.boxW || 320,
        height: data.boxH || 360,
        padding: 8,
        background: "#fff",
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        boxShadow,
        transition: "border-color 0.15s ease, box-shadow 0.15s ease",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        outline: "none",
      }}
    >
      {/* 标题栏 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <div style={{ fontWeight: 600 }}>{data.label || lt("视频合成", "Video Compose")}</div>
        <div style={{ fontSize: 11, color: "#9ca3af" }}>
          {upstreamVideos.length} {lt("段视频", "clips")}
          {upstreamAudioTracks.length > 0
            ? ` · ${upstreamAudioTracks.length} ${lt("音轨", "audio")}`
            : ""}
        </div>
      </div>

      {/* 内容区域 */}
      <VideoComposeContent
        upstreamCount={upstreamVideos.length}
        composedVideoUrl={data.videoUrl || null}
        onOpenEditor={() => setEditorOpen(true)}
        onDownload={handleDownload}
        lt={lt}
      />

      {/* 全屏编辑器 */}
      <VideoComposeEditorModal
        opened={editorOpen}
        onClose={() => setEditorOpen(false)}
        upstreamVideos={upstreamVideos}
        upstreamAudioTracks={upstreamAudioTracks}
        onComposeDone={handleComposeDone}
      />

      {/* 入口：视频（多条） */}
      <Handle
        type="target"
        position={Position.Left}
        id="video"
        style={{ top: "38%" }}
        onMouseEnter={() => setHover("video-in")}
        onMouseLeave={() => setHover(null)}
      />
      {hover === "video-in" && (
        <div
          className="flow-tooltip"
          style={{ left: -8, top: "38%", transform: "translate(-100%, -50%)" }}
        >
          video
        </div>
      )}

      {/* 入口：音频（配音/BGM） */}
      <Handle
        type="target"
        position={Position.Left}
        id="audio"
        style={{ top: "62%" }}
        onMouseEnter={() => setHover("audio-in")}
        onMouseLeave={() => setHover(null)}
      />
      {hover === "audio-in" && (
        <div
          className="flow-tooltip"
          style={{ left: -8, top: "62%", transform: "translate(-100%, -50%)" }}
        >
          audio
        </div>
      )}

      {/* 出口：合成视频 */}
      <Handle
        type="source"
        position={Position.Right}
        id="video"
        onMouseEnter={() => setHover("video-out")}
        onMouseLeave={() => setHover(null)}
      />
      {hover === "video-out" && (
        <div
          className="flow-tooltip"
          style={{ right: -8, top: "50%", transform: "translate(100%, -50%)" }}
        >
          video
        </div>
      )}
    </div>
  );
}

export default React.memo(VideoComposeNodeInner);
