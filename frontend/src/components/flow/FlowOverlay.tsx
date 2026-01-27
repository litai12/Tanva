// @ts-nocheck
// Flow 主画布与节点调度入口。
import React from "react";
import { Trash2, Plus, Upload, Download } from "lucide-react";
import { fetchTemplateCategories } from "@/services/publicTemplateService";
import { fetchWithAuth } from "@/services/authFetch";
import SharedTemplateCard from "@/components/template/SharedTemplateCard";
import SmartImage from "@/components/ui/SmartImage";
import paper from "paper";
import ReactFlow, {
  MiniMap,
  Background,
  BackgroundVariant,
  type Connection,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "reactflow";
import { ReactFlowProvider } from "reactflow";
import { useCanvasStore } from "@/stores";
import { useToolStore } from "@/stores";
import "reactflow/dist/style.css";
import "./flow.css";
import type {
  FlowTemplate,
  TemplateIndexEntry,
  TemplateNode,
  TemplateEdge,
} from "@/types/template";
import {
  loadBuiltInTemplateIndex,
  loadBuiltInTemplateById,
  listUserTemplates,
  getUserTemplate,
  saveUserTemplate,
  deleteUserTemplate,
  generateId,
} from "@/services/templateStore";

import TextPromptNode from "./nodes/TextPromptNode";
import TextPromptProNode from "./nodes/TextPromptProNode";
import TextChatNode from "./nodes/TextChatNode";
import ImageNode from "./nodes/ImageNode";
import GenerateNode from "./nodes/GenerateNode";
import Generate4Node from "./nodes/Generate4Node";
import GenerateReferenceNode from "./nodes/GenerateReferenceNode";
import ThreeNode from "./nodes/ThreeNode";
import CameraNode from "./nodes/CameraNode";
import PromptOptimizeNode from "./nodes/PromptOptimizeNode";
import AnalysisNode from "./nodes/AnalyzeNode";
import Sora2VideoNode from "./nodes/Sora2VideoNode";
import Wan26Node from "./nodes/Wan26Node";
import Wan2R2VNode from "./nodes/Wan2R2VNode";
import TextNoteNode from "./nodes/TextNoteNode";
import StoryboardSplitNode from "./nodes/StoryboardSplitNode";
import GenerateProNode from "./nodes/GenerateProNode";
import GeneratePro4Node from "./nodes/GeneratePro4Node";
import ImageProNode from "./nodes/ImageProNode";
import MidjourneyNode from "./nodes/MidjourneyNode";
import KlingVideoNode from "./nodes/KlingVideoNode";
import ViduVideoNode from "./nodes/ViduVideoNode";
import DoubaoVideoNode from "./nodes/DoubaoVideoNode";
import VideoNode from "./nodes/VideoNode";
import VideoAnalyzeNode from "./nodes/VideoAnalyzeNode";
import VideoFrameExtractNode from "./nodes/VideoFrameExtractNode";
import ImageGridNode from "./nodes/ImageGridNode";
import ImageSplitNode from "./nodes/ImageSplitNode";
import { FLOW_IMAGE_ASSET_PREFIX } from "@/services/flowImageAssetStore";
import { recordImageHistoryEntry } from "@/services/imageHistoryService";
import { useFlowStore, FlowBackgroundVariant } from "@/stores/flowStore";
import { useProjectContentStore } from "@/stores/projectContentStore";
import { useImageHistoryStore } from "@/stores/imageHistoryStore";
import { useUIStore } from "@/stores";
import {
  useAIChatStore,
  getImageModelForProvider,
  uploadImageToOSS,
  uploadVideoToOSS,
  requestSora2VideoGeneration,
  DEFAULT_SORA2_VIDEO_QUALITY,
} from "@/stores/aiChatStore";
import type { Sora2VideoQuality } from "@/stores/aiChatStore";
import { historyService } from "@/services/historyService";
import {
  clipboardService,
  type ClipboardFlowNode,
} from "@/services/clipboardService";
import { proxifyRemoteAssetUrl } from "@/utils/assetProxy";
import {
  isPersistableImageRef,
  normalizePersistableImageRef,
  resolveImageToBlob,
  resolveImageToDataUrl,
} from "@/utils/imageSource";
import {
  blobToDataUrl,
  canvasToBlob,
  createImageBitmapLimited,
  responseToBlob,
} from "@/utils/imageConcurrency";
import { aiImageService } from "@/services/aiImageService";
import {
  generateImageViaAPI,
  editImageViaAPI,
  blendImagesViaAPI,
  generateWan26ViaAPI,
  generateWan26R2VViaAPI,
  midjourneyActionViaAPI,
} from "@/services/aiBackendAPI";
import {
  generateVideoByProvider,
  queryVideoTask,
  type VideoProvider,
} from "@/services/videoProviderAPI";
import { imageUploadService } from "@/services/imageUploadService";
import { personalLibraryApi } from "@/services/personalLibraryApi";
import {
  createPersonalAssetId,
  usePersonalLibraryStore,
  type PersonalImageAsset,
} from "@/stores/personalLibraryStore";
import { normalizeWheelDelta, computeSmoothZoom } from "@/lib/zoomUtils";
import type { AIImageGenerateRequest, AIImageResult } from "@/types/ai";
import MiniMapImageOverlay from "./MiniMapImageOverlay";
import PersonalLibraryPanel from "./PersonalLibraryPanel";
import { resolveTextFromSourceNode } from "./utils/textSource";

type RFNode = Node<any>;

type EdgeLabelEditorState = {
  visible: boolean;
  edgeId: string | null;
  value: string;
  position: { x: number; y: number };
};

const createEdgeLabelEditorState = (): EdgeLabelEditorState => ({
  visible: false,
  edgeId: null,
  value: "",
  position: { x: 0, y: 0 },
});

const ensureDataUrl = (imageData: string): string =>
  imageData.startsWith("data:image")
    ? imageData
    : `data:image/png;base64,${imageData}`;

const createThumbnailDataUrl = async (
  source: string,
  maxSize = 256
): Promise<string | null> => {
  try {
    const trimmed = typeof source === "string" ? source.trim() : "";
    if (!trimmed) return null;

    const toAbsoluteUrl = (value: string): string => {
      if (
        value.startsWith("data:") ||
        value.startsWith("blob:") ||
        (typeof FLOW_IMAGE_ASSET_PREFIX === "string" &&
          value.startsWith(FLOW_IMAGE_ASSET_PREFIX)) ||
        /^https?:\/\//i.test(value)
      ) {
        return value;
      }

      if (
        value.startsWith("/") ||
        value.startsWith("./") ||
        value.startsWith("../")
      ) {
        try {
          return new URL(value, window.location.origin).toString();
        } catch {
          return value;
        }
      }

      // 兜底：认为是裸 base64
      return ensureDataUrl(value);
    };

    const src = toAbsoluteUrl(trimmed);
    const blob = await resolveImageToBlob(src, { preferProxy: true });
    if (!blob) return null;

    const makeCanvas = (w: number, h: number): any => {
      if (typeof OffscreenCanvas !== "undefined") {
        return new OffscreenCanvas(w, h);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      return canvas;
    };

    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmapLimited(blob);
      try {
        const w0 = bitmap.width || 1;
        const h0 = bitmap.height || 1;
        const scale = Math.min(1, maxSize / Math.max(w0, h0));
        const w = Math.max(1, Math.round(w0 * scale));
        const h = Math.max(1, Math.round(h0 * scale));
        const canvas = makeCanvas(w, h);
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(bitmap, 0, 0, w, h);
        const outBlob = await canvasToBlob(canvas, {
          type: "image/jpeg",
          quality: 0.82,
        });
        return await blobToDataUrl(outBlob);
      } finally {
        try {
          bitmap.close();
        } catch {}
      }
    }

    // 回退：不做缩略图（极少数环境无 createImageBitmap）
    return await blobToDataUrl(blob);
  } catch {
    return null;
  }
};

const FLOW_CLIPBOARD_MIME = "application/x-tanva-flow";
const FLOW_CLIPBOARD_FALLBACK_TEXT = "Tanva flow selection";
const FLOW_CLIPBOARD_TYPE = "tanva-flow";

const nodeTypes = {
  textPrompt: TextPromptNode,
  textPromptPro: TextPromptProNode,
  textChat: TextChatNode,
  promptOptimize: PromptOptimizeNode,
  textNote: TextNoteNode,
  image: ImageNode,
  imagePro: ImageProNode,
  generate: GenerateNode,
  generate4: Generate4Node,
  generatePro: GenerateProNode,
  generatePro4: GeneratePro4Node,
  generateRef: GenerateReferenceNode,
  three: ThreeNode,
  camera: CameraNode,
  analysis: AnalysisNode,
  sora2Video: Sora2VideoNode,
  wan26: Wan26Node,
  wan2R2V: Wan2R2VNode,
  klingVideo: KlingVideoNode,
  viduVideo: ViduVideoNode,
  doubaoVideo: DoubaoVideoNode,
  storyboardSplit: StoryboardSplitNode,
  midjourney: MidjourneyNode,
  video: VideoNode,
  videoAnalyze: VideoAnalyzeNode,
  videoFrameExtract: VideoFrameExtractNode,
  imageGrid: ImageGridNode,
  imageSplit: ImageSplitNode,
};

// 自定义边组件 - 选中时在终点显示删除按钮
const EDGE_DELETE_BUTTON_STYLE: React.CSSProperties = {
  width: 16,
  height: 16,
  borderRadius: "50%",
  background: "#ef4444",
  border: "2px solid #fff",
  color: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: "bold",
  lineHeight: 0,
  boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
  position: "relative",
  zIndex: 10000,
  padding: 0,
};

const CustomEdge = React.memo(function CustomEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  style,
  markerEnd,
  data,
}: EdgeProps) {
  const { setEdges } = useReactFlow();

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const handleDelete = React.useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      setEdges((edges) => edges.filter((e) => e.id !== id));
    },
    [id, setEdges]
  );

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      {selected && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              left: targetX + 4,
              top: targetY,
              transform: "translate(-50%, -50%)",
              pointerEvents: "all",
              zIndex: 10000,
            }}
            className='nodrag nopan'
          >
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={handleDelete}
              style={EDGE_DELETE_BUTTON_STYLE}
              title='删除连线'
            >
              <span style={{ marginTop: -2 }}>−</span>
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

const edgeTypes = {
  default: CustomEdge,
};

const DEFAULT_REFERENCE_PROMPT = "请参考第二张图的内容";
const SORA2_MAX_REFERENCE_IMAGES = 1;
const VIDU_MAX_REFERENCE_IMAGES = 7; // Vidu viduq2 模型支持最多 7 张参考图
const KLING_MAX_REFERENCE_IMAGES = 4; // Kling 支持最多 4 张参考图

// 模板分类由后端维护，前端会在面板打开时请求；若后端无数据则从 tplIndex 推断或回退到 ['其他']

const ADD_PANEL_TAB_STORAGE_KEY = "tanva-add-panel-tab";

const SORA2_HISTORY_LIMIT = 5;

type Sora2VideoHistoryItem = {
  id: string;
  videoUrl: string;
  thumbnail?: string;
  prompt: string;
  quality: Sora2VideoQuality;
  createdAt: string;
  elapsedSeconds?: number;
};

type AddPanelTab = "nodes" | "beta" | "custom" | "templates" | "personal";
const ALL_ADD_TABS: AddPanelTab[] = [
  "nodes",
  "beta",
  "custom",
  "templates",
  "personal",
];

const getStoredAddPanelTab = (): AddPanelTab => {
  if (typeof window === "undefined") {
    return "nodes";
  }
  try {
    const saved = window.localStorage.getItem(ADD_PANEL_TAB_STORAGE_KEY);
    return saved === "templates" ||
      saved === "personal" ||
      saved === "nodes" ||
      saved === "beta" ||
      saved === "custom"
      ? saved
      : "nodes";
  } catch {
    return "nodes";
  }
};

// 节点积分消耗映射
const NODE_CREDITS_MAP: Record<string, number | string> = {
  // 普通节点
  textPrompt: 0, // 提示词节点 - 不消耗积分
  textChat: 2, // 纯文本交互节点 - gemini-text
  textNote: 0, // 纯文本节点 - 不消耗积分
  promptOptimize: 2, // 提示词优化节点 - gemini-text
  analysis: 6, // 图像分析节点 - gemini-image-analyze
  image: 0, // 图片节点 - 不消耗积分
  generate: "10-30", // 生成节点 - gemini-2.5-image (10) 或 gemini-3-pro-image (30)
  generateRef: 30, // 参考图生成节点 - gemini-image-edit 或 gemini-image-blend
  generate4: 40, // 生成多张图片节点 - 4次 × 10积分
  midjourney: 20, // Midjourney生成 - midjourney-imagine
  three: 30, // 三维节点 - convert-2d-to-3d
  sora2Video: "40-400", // 视频生成节点 - sora-sd (40) 或 sora-hd (400)
  wan26: 600, // Wan2.6生成视频 - wan26-video
  wan2R2V: 600, // 视频融合 - wan26-r2v
  klingVideo: "40-400", // 可灵视频生成 - 可能使用 sora-sd 或 sora-hd
  viduVideo: "40-400", // Vidu视频生成 - 可能使用 sora-sd 或 sora-hd
  doubaoVideo: "40-400", // 豆包视频生成 - 可能使用 sora-sd 或 sora-hd
  camera: 0, // 截图节点 - 不消耗积分
  storyboardSplit: 0, // 分镜拆分节点 - 不消耗积分

  // Beta 节点
  textPromptPro: 2, // 专业提示词节点 - gemini-text
  imagePro: 0, // 专业图片节点 - 不消耗积分
  generatePro: 30, // 专业生成节点 - gemini-3-pro-image
  generatePro4: 120, // 四图专业生成节点 - 4次 × 30积分
};

// 普通节点列表（不包含 Beta 节点）
const NODE_PALETTE_ITEMS = [
  { key: "textPrompt", zh: "提示词节点", en: "Prompt Node" },
  { key: "textChat", zh: "纯文本交互节点", en: "Text Chat Node" },
  { key: "textNote", zh: "纯文本节点", en: "Text Note Node" },
  { key: "promptOptimize", zh: "提示词优化节点", en: "Prompt Optimizer" },
  { key: "analysis", zh: "图像分析节点", en: "Analysis Node" },
  { key: "image", zh: "图片节点", en: "Image Node" },
  { key: "video", zh: "视频节点", en: "Video Node" },
  { key: "videoAnalyze", zh: "视频分析节点", en: "Video Analysis" },
  { key: "videoFrameExtract", zh: "视频抽帧节点", en: "Video Frame Extract" },
  { key: "imageGrid", zh: "图片拼合节点", en: "Image Grid" },
  { key: "imageSplit", zh: "图片分割节点", en: "Image Split" },
  { key: "generate", zh: "生成节点", en: "Generate Node" },
  { key: "generateRef", zh: "参考图生成节点", en: "Generate Refer" },
  { key: "generate4", zh: "生成多张图片节点", en: "Multi Generate" },
  { key: "midjourney", zh: "Midjourney生成", en: "Midjourney" },
  { key: "three", zh: "三维节点", en: "3D Node" },
  { key: "sora2Video", zh: "Sora2视频生成", en: "Sora2" },
  { key: "wan26", zh: "Wan2.6生成视频", en: "Wan2.6" },
  { key: "wan2R2V", zh: "视频融合", en: "Wan2.6 R2V" },
  { key: "klingVideo", zh: "Kling视频生成", en: "Kling" },
  { key: "viduVideo", zh: "Vidu视频生成", en: "Vidu" },
  {
    key: "doubaoVideo",
    zh: "Seedance 1.5 Pro视频生成",
    en: "Seedance 1.5 Pro",
  },
  { key: "camera", zh: "截图节点", en: "Shot Node" },
  { key: "storyboardSplit", zh: "分镜拆分节点", en: "Storyboard Split" },
];

// Beta 节点列表（实验性功能）
const BETA_NODE_ITEMS = [
  {
    key: "textPromptPro",
    zh: "专业提示词节点",
    en: "Prompt Pro",
    badge: "Beta",
  },
  { key: "imagePro", zh: "专业图片节点", en: "Image Pro", badge: "Beta" },
  { key: "generatePro", zh: "专业生成节点", en: "Generate Pro", badge: "Beta" },
  {
    key: "generatePro4",
    zh: "四图专业生成节点",
    en: "Generate Pro 4",
    badge: "Beta",
  },
];

const nodePaletteButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  fontSize: 13,
  fontWeight: 500,
  padding: "14px 16px",
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  background: "#fff",
  color: "#0f172a",
  cursor: "pointer",
  transition: "all 0.18s ease",
  width: "100%",
  textAlign: "left",
};

const nodePaletteZhStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "6px 10px",
  borderRadius: 12,
  background: "#f1f5f9",
  color: "#0f172a",
  fontSize: 14,
  fontWeight: 500,
  letterSpacing: "0.02em",
};

const nodePaletteEnCodeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  color: "#111827",
  background: "transparent",
  border: "none",
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: "0.01em",
  padding: 0,
  borderRadius: 0,
  fontFamily: 'Inter, "Helvetica Neue", Arial, ui-sans-serif',
  whiteSpace: "nowrap",
};

const nodePaletteBadgeStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "#18181b",
  background: "#f4f4f5",
  padding: "4px 8px",
  borderRadius: 999,
  border: "1px solid #d4d4d8",
  letterSpacing: "0.04em",
  whiteSpace: "nowrap",
};

const nodePaletteCreditsStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
  color: "#059669",
  background: "#ecfdf5",
  padding: "2px 6px",
  borderRadius: 4,
  letterSpacing: "0.01em",
  whiteSpace: "nowrap",
};

const setNodePaletteHover = (target: HTMLElement, hovered: boolean) => {
  target.style.background = hovered ? "#f8fafc" : "#fff";
  target.style.borderColor = hovered ? "#d5dae3" : "#e5e7eb";
  target.style.transform = hovered ? "translateY(-1px)" : "translateY(0)";
  target.style.boxShadow = hovered
    ? "0 12px 26px rgba(15, 23, 42, 0.12)"
    : "none";
};

const NodePaletteButton: React.FC<{
  zh: string;
  en: string;
  badge?: string;
  credits?: number | string;
  onClick: () => void;
}> = ({ zh, en, badge, credits, onClick }) => {
  const creditsDisplay =
    credits !== undefined && credits !== 0
      ? typeof credits === "string"
        ? credits
        : credits.toString()
      : null;

  return (
    <button
      onClick={onClick}
      style={nodePaletteButtonStyle}
      onMouseEnter={(e) => setNodePaletteHover(e.currentTarget, true)}
      onMouseLeave={(e) => setNodePaletteHover(e.currentTarget, false)}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
        <span style={nodePaletteEnCodeStyle}>{en}</span>
        {badge ? <span style={nodePaletteBadgeStyle}>{badge}</span> : null}
        {/* {creditsDisplay && (
          <span style={nodePaletteCreditsStyle}>消耗{creditsDisplay}积分</span>
        )} */}
      </div>
      <span style={nodePaletteZhStyle}>{zh}</span>
    </button>
  );
};

// 用户模板卡片组件
const UserTemplateCard: React.FC<{
  item: {
    id: string;
    name: string;
    category?: string;
    tags?: string[];
    thumbnail?: string;
    createdAt: string;
    updatedAt: string;
  };
  onInstantiate: () => Promise<void>;
  onDelete: () => Promise<void>;
}> = ({ item, onInstantiate, onDelete }) => {
  const [isHovered, setIsHovered] = React.useState(false);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        gap: 18,
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: "18px 20px",
        background: "#fff",
        cursor: "pointer",
        transition: "all 0.2s ease",
        position: "relative",
        minHeight: 130,
        height: 130,
        overflow: "hidden",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "#18181b";
        e.currentTarget.style.background = "#f4f4f5";
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 16px 32px rgba(0, 0, 0, 0.12)";
        setIsHovered(true);
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "#e5e7eb";
        e.currentTarget.style.background = "#fff";
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "none";
        setIsHovered(false);
      }}
      onClick={async (e) => {
        if ((e.target as HTMLElement).closest(".delete-btn")) return;
        await onInstantiate();
      }}
    >
      <div
        style={{
          flex: "0 0 50%",
          maxWidth: "50%",
          height: "100%",
          background: item.thumbnail ? "transparent" : "#f3f4f6",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {item.thumbnail ? (
          <SmartImage
            src={item.thumbnail}
            alt={item.name}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div style={{ fontSize: 12, color: "#9ca3af" }}>暂无预览</div>
        )}
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          justifyContent: "center",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: "#111827",
              marginBottom: 6,
            }}
          >
            {item.name}
          </div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>
            更新于 {new Date(item.updatedAt).toLocaleString()}
          </div>
        </div>
        {item.category ? (
          <div style={{ fontSize: 12, color: "#9ca3af" }}>
            分类：{item.category}
          </div>
        ) : null}
        {item.tags?.length ? (
          <div style={{ fontSize: 12, color: "#9ca3af" }}>
            标签：{item.tags.join(" / ")}
          </div>
        ) : null}
      </div>
      {isHovered && (
        <button
          className='delete-btn'
          style={{
            position: "absolute",
            right: 16,
            top: 16,
            width: 28,
            height: 28,
            borderRadius: 6,
            border: "1px solid #fecaca",
            background: "#fff",
            color: "#ef4444",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
          onClick={async (e) => {
            e.stopPropagation();
            await onDelete();
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#fee2e2";
            e.currentTarget.style.borderColor = "#fca5a5";
            e.currentTarget.style.transform = "scale(1.05)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "#fff";
            e.currentTarget.style.borderColor = "#fecaca";
            e.currentTarget.style.transform = "scale(1)";
          }}
          title='删除模板'
        >
          <Trash2 size={16} strokeWidth={2} />
        </button>
      )}
    </div>
  );
};

const AddTemplateCard: React.FC<{
  onAdd: () => Promise<void>;
  label?: string;
}> = ({ onAdd, label }) => {
  const [isLoading, setIsLoading] = React.useState(false);

  return (
    <button
      type='button'
      onClick={async () => {
        if (isLoading) return;
        setIsLoading(true);
        try {
          await onAdd();
        } finally {
          setIsLoading(false);
        }
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        border: "1px dashed #a1a1aa",
        borderRadius: 12,
        padding: "18px 20px",
        minHeight: 130,
        height: 130,
        background: "#fafafa",
        color: "#18181b",
        cursor: isLoading ? "wait" : "pointer",
        transition: "all 0.15s ease",
        gap: 10,
        fontSize: 13,
        fontWeight: 500,
      }}
      onMouseEnter={(e) => {
        if (isLoading) return;
        e.currentTarget.style.background = "#f4f4f5";
        e.currentTarget.style.borderColor = "#71717a";
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.boxShadow = "0 12px 24px rgba(0, 0, 0, 0.12)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "#fafafa";
        e.currentTarget.style.borderColor = "#a1a1aa";
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "none";
      }}
      disabled={isLoading}
    >
      <Plus size={24} strokeWidth={2.5} />
      <div>{isLoading ? "保存中…" : label || "保存为模板"}</div>
    </button>
  );
};

const TemplatePlaceholder: React.FC<{ label?: string }> = ({ label }) => (
  <div
    style={{
      display: "flex",
      alignItems: "stretch",
      gap: 18,
      border: "1px dashed #d1d5db",
      borderRadius: 12,
      padding: "15px",
      minHeight: 160,
      height: 160,
      background: "#f9fafb",
      transition: "all 0.2s ease",
    }}
  >
    <div
      style={{
        flex: "0 0 50%",
        maxWidth: "50%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f3f4f6",
        borderRadius: 8,
        color: "#94a3b8",
      }}
    >
      <Plus size={28} strokeWidth={2} />
    </div>
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        justifyContent: "center",
        color: "#94a3b8",
        fontSize: 13,
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600 }}>
        {label || "敬请期待更多模板"}
      </div>
      <div>我们正在准备更多创意模板</div>
    </div>
  </div>
);

// Flow独立的视口管理，不再与Canvas同步
function useFlowViewport() {
  const { flowZoom, flowPanX, flowPanY, setFlowZoom, setFlowPan } =
    useFlowStore();
  const rf = useReactFlow();

  const updateViewport = React.useCallback(
    (x: number, y: number, zoom: number) => {
      try {
        rf.setViewport({ x, y, zoom }, { duration: 0 });
        setFlowPan(x, y);
        setFlowZoom(zoom);
      } catch (_) {}
    },
    [rf, setFlowPan, setFlowZoom]
  );

  return {
    zoom: flowZoom,
    panX: flowPanX,
    panY: flowPanY,
    updateViewport,
  };
}

// 默认节点配置 - 暂时注释，后面再用
// const initialNodes: RFNode[] = [
//   {
//     id: 'prompt-1',
//     type: 'textPrompt',
//     position: { x: 50, y: 200 },
//     data: {
//       text: '画一只猫'
//     },
//   },
//   {
//     id: 'generate-1',
//     type: 'generate',
//     position: { x: 350, y: 150 },
//     data: {
//       status: 'idle'
//     },
//   },
//   {
//     id: 'image-1',
//     type: 'image',
//     position: { x: 650, y: 200 },
//     data: {
//       label: 'Image'
//     },
//   },
// ];

// 默认连线配置 - 暂时注释，后面再用
// const initialEdges: Edge[] = [
//   {
//     id: 'prompt-generate',
//     source: 'prompt-1',
//     target: 'generate-1',
//     sourceHandle: 'text',
//     targetHandle: 'text',
//     type: 'default',
//   },
//   {
//     id: 'generate-image',
//     source: 'generate-1',
//     target: 'image-1',
//     sourceHandle: 'img',
//     targetHandle: 'img',
//     type: 'default',
//   },
// ];

function FlowInner() {
  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  // Alt+拖拽复制相关状态（在 onNodesChange 中做位置重映射，让“副本在动、原节点不动”）
  const altDragStartRef = React.useRef<any>(null);
  const aiProvider = useAIChatStore((state) => state.aiProvider);
  const imageSize = useAIChatStore((state) => state.imageSize);
  const imageModel = React.useMemo(
    () => getImageModelForProvider(aiProvider),
    [aiProvider]
  );

  // 获取当前工具模式
  const drawMode = useToolStore((state) => state.drawMode);
  const isPointerMode = drawMode === "pointer";
  const isMarqueeMode = drawMode === "marquee";

  const addPersonalAsset = usePersonalLibraryStore((state) => state.addAsset);

  const onNodesChangeWithHistory = React.useCallback(
    (changes: any) => {
      const altState = altDragStartRef.current;
      const isAltDragCloning =
        !!altState?.altPressed &&
        !!altState?.cloned &&
        altState?.idMap instanceof Map;

      if (isAltDragCloning && Array.isArray(changes)) {
        // ReactFlow 仍会尝试拖拽原节点；这里把“原节点的位置变化”重定向到副本，
        // 并把原节点强制回到起始位置，保证原有连线不被“带走”。
        const posChange =
          changes.find(
            (c: any) =>
              c?.type === "position" &&
              c?.id === altState?.nodeId &&
              altState?.startPositions?.has?.(c.id)
          ) ||
          changes.find(
            (c: any) =>
              c?.type === "position" && altState?.startPositions?.has?.(c.id)
          );

        if (posChange) {
          const base = altState.startPositions.get(posChange.id);
          const baseAbs = altState.startAbsPositions?.get?.(posChange.id);
          const hasPosition =
            typeof posChange.position !== "undefined" ||
            typeof posChange.positionAbsolute !== "undefined";
          if (!base) {
            onNodesChange(changes);
            return;
          }

          // ReactFlow 在 dragStop 会再派发一次 position(dragging:false)，但不带 position/positionAbsolute；
          // 这里不要把 dx/dy 误算成 0 导致副本回弹，只更新 dragging 标记即可。
          const dx =
            typeof posChange.position !== "undefined"
              ? posChange.position.x - base.x
              : typeof posChange.positionAbsolute !== "undefined" && baseAbs
              ? posChange.positionAbsolute.x - baseAbs.x
              : 0;
          const dy =
            typeof posChange.position !== "undefined"
              ? posChange.position.y - base.y
              : typeof posChange.positionAbsolute !== "undefined" && baseAbs
              ? posChange.positionAbsolute.y - baseAbs.y
              : 0;
          const dragging = !!posChange.dragging;

          const remapped: any[] = [];
          // 先保留非 position 变更（如 select/dimensions/remove/add）
          for (const c of changes) {
            if (c?.type !== "position") remapped.push(c);
          }

          // 对参与复制的所有节点应用相同 delta：副本移动，原节点回位
          for (const [origId, cloneId] of altState.idMap.entries()) {
            const startPos = altState.startPositions.get(origId);
            const startAbs = altState.startAbsPositions?.get?.(origId);
            if (!startPos) continue;
            const cloneChange: any = {
              id: cloneId,
              type: "position",
              dragging,
            };
            const origChange: any = {
              id: origId,
              type: "position",
              dragging: false,
            };

            if (hasPosition) {
              cloneChange.position = { x: startPos.x + dx, y: startPos.y + dy };
              origChange.position = { x: startPos.x, y: startPos.y };

              if (startAbs) {
                cloneChange.positionAbsolute = {
                  x: startAbs.x + dx,
                  y: startAbs.y + dy,
                };
                origChange.positionAbsolute = { x: startAbs.x, y: startAbs.y };
              }
            }

            remapped.push(cloneChange);
            remapped.push(origChange);
          }
          onNodesChange(remapped);
          // Alt+拖拽复制的历史提交由 onNodeDragStop 统一处理，避免重复 commit
          return;
        }
      }

      onNodesChange(changes);
      try {
        const needCommit =
          Array.isArray(changes) &&
          changes.some(
            (c: any) =>
              (c?.type === "position" && c?.dragging === false) ||
              c?.type === "remove" ||
              c?.type === "add" ||
              c?.type === "dimensions"
          );
        if (needCommit)
          historyService.commit("flow-nodes-change").catch(() => {});
      } catch {}
    },
    [onNodesChange]
  );

  const onEdgesChangeWithHistory = React.useCallback(
    (changes: any) => {
      onEdgesChange(changes);
      try {
        const needCommit =
          Array.isArray(changes) &&
          changes.some((c: any) => c?.type === "remove" || c?.type === "add");
        if (needCommit) {
          historyService.commit("flow-edges-change").catch(() => {});
          // 通知节点边已变化（用于刷新外部提示词预览等）
          // 使用 setTimeout 确保在状态更新后再触发
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent("flow:edgesChange"));
          }, 0);
        }
      } catch {}
    },
    [onEdgesChange]
  );
  const rf = useReactFlow();
  const rfRef = React.useRef(rf);
  React.useEffect(() => {
    rfRef.current = rf;
  }, [rf]);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [isConnecting, setIsConnecting] = React.useState(false);
  const [edgeLabelEditor, setEdgeLabelEditor] =
    React.useState<EdgeLabelEditorState>(() => createEdgeLabelEditorState());
  const edgeLabelInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (edgeLabelEditor.visible) {
      const id = window.setTimeout(() => edgeLabelInputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [edgeLabelEditor.visible]);

  React.useEffect(() => {
    if (!edgeLabelEditor.visible || !edgeLabelEditor.edgeId) return;
    if (!edges.some((edge) => edge.id === edgeLabelEditor.edgeId)) {
      setEdgeLabelEditor(createEdgeLabelEditorState());
    }
  }, [edges, edgeLabelEditor.visible, edgeLabelEditor.edgeId]);
  // 统一画板：节点橡皮已禁用

  // —— 项目内容（文件）中的 Flow 图谱持久化 ——
  const projectId = useProjectContentStore((s) => s.projectId);
  const hydrated = useProjectContentStore((s) => s.hydrated);
  const contentFlow = useProjectContentStore((s) => s.content?.flow);
  const prevProjectIdRef = React.useRef<string | null>(null);
  const hasHydratedFlowRef = React.useRef(false);
  const updateProjectPartial = useProjectContentStore((s) => s.updatePartial);
  const hydratingFromStoreRef = React.useRef(false);
  const lastSyncedJSONRef = React.useRef<string | null>(null);
  const nodeDraggingRef = React.useRef(false);
  const [isNodeDragging, setIsNodeDragging] = React.useState(false);
  const commitTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (isNodeDragging) {
      document.body.classList.add("tanva-flow-node-dragging");
    } else {
      document.body.classList.remove("tanva-flow-node-dragging");
    }
    return () => document.body.classList.remove("tanva-flow-node-dragging");
  }, [isNodeDragging]);

  const getFlowSnapshotSignature = React.useCallback(
    (nodesSnapshot: any, edgesSnapshot: any): string | null => {
      try {
        return JSON.stringify(
          { n: nodesSnapshot, e: edgesSnapshot },
          (_key, value) => {
            if (typeof value === "function") return undefined;
            if (typeof value === "string" && value.length > 1024) {
              const head = value.slice(0, 64);
              const tail = value.slice(-64);
              return `__trim_len=${value.length}__${head}__${tail}`;
            }
            return value;
          }
        );
      } catch {
        return null;
      }
    },
    []
  );

  const sanitizeNodeData = React.useCallback((input: any) => {
    const BASE64_IMAGE_MAGIC_PREFIXES = [
      "iVBORw0KGgo", // png
      "/9j/", // jpeg
      "R0lGOD", // gif
      "UklGR", // webp
      "PHN2Zy", // svg
    ];

    const looksLikeBase64 = (value: string): boolean => {
      const compact = value.replace(/\s+/g, "");
      if (compact.length < 4096) return false;
      if (compact.length % 4 !== 0) return false;
      return /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
    };

    const shouldDropPersistedString = (value: string): boolean => {
      const trimmed = value?.trim?.() || "";
      if (!trimmed) return false;
      if (/^data:/i.test(trimmed)) return true;
      if (/^blob:/i.test(trimmed)) return true;
      if (
        typeof FLOW_IMAGE_ASSET_PREFIX === "string" &&
        trimmed.startsWith(FLOW_IMAGE_ASSET_PREFIX)
      ) {
        return true;
      }
      const compact = trimmed.replace(/\s+/g, "");
      if (
        BASE64_IMAGE_MAGIC_PREFIXES.some((p) => compact.startsWith(p)) &&
        compact.length >= 32
      ) {
        return true;
      }
      return looksLikeBase64(compact);
    };

    const seen = new WeakMap<object, any>();

    const walk = (value: any): any => {
      if (typeof value === "function") return undefined;
      if (!value || typeof value !== "object") {
        if (typeof value === "string" && shouldDropPersistedString(value))
          return undefined;
        return value;
      }

      // 兼容 JSON.stringify(Date) 的行为
      if (value instanceof Date) return value.toISOString();

      if (Array.isArray(value)) {
        const arr = new Array(value.length);
        for (let i = 0; i < value.length; i += 1) {
          arr[i] = walk(value[i]);
        }
        return arr;
      }

      const cached = seen.get(value as object);
      if (cached) return cached;

      const result: Record<string, any> = {};
      seen.set(value as object, result);
      Object.entries(value).forEach(([key, child]) => {
        if (typeof child === "function") return;
        const sanitized = walk(child);
        if (sanitized === undefined) return;
        result[key] = sanitized;
      });
      return result;
    };

    return walk(input);
  }, []);

  const rfNodesToTplNodes = React.useCallback(
    (ns: RFNode[]): ClipboardFlowNode[] => {
      return ns.map((n: any) => {
        const rawData = { ...(n.data || {}) } as any;
        delete rawData.onRun;
        delete rawData.onSend;
        const data = sanitizeNodeData(rawData);
        if (data) {
          delete data.status;
          delete data.error;
        }
        return {
          id: n.id,
          type: n.type || "default",
          position: { x: n.position.x, y: n.position.y },
          data,
          boxW: data?.boxW,
          boxH: data?.boxH,
          width: n.width,
          height: n.height,
          style: n.style ? { ...n.style } : undefined,
        } as ClipboardFlowNode;
      });
    },
    [sanitizeNodeData]
  );

  const rfEdgesToTplEdges = React.useCallback(
    (es: Edge[]): TemplateEdge[] =>
      es.map((e: any) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        type: e.type || "default",
        label: typeof e.label === "string" ? e.label : undefined,
      })),
    []
  );

  const tplNodesToRfNodes = React.useCallback(
    (ns: TemplateNode[]): RFNode[] =>
      ns.map((n) => ({
        id: n.id,
        type: (n as any).type || "default",
        position: { x: n.position.x, y: n.position.y },
        data: { ...(n.data || {}) },
      })) as any,
    []
  );

  const tplEdgesToRfEdges = React.useCallback(
    (es: TemplateEdge[]): Edge[] =>
      es.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        type: e.type || "default",
        label: e.label,
      })) as any,
    []
  );

  // Flow -> Canvas：将含有图片的节点转换为可在画板粘贴的剪贴板数据
  const buildCanvasClipboardFromFlowNodes = React.useCallback(
    (selected: RFNode[]) => {
      if (!Array.isArray(selected) || selected.length === 0) return null;

      const normalizeImageSource = (value?: string): string | null => {
        const trimmed = value?.trim();
        if (!trimmed) return null;
        if (
          /^data:/i.test(trimmed) ||
          /^blob:/i.test(trimmed) ||
          /^https?:\/\//i.test(trimmed)
        )
          return trimmed;
        return `data:image/png;base64,${trimmed}`;
      };

      const safeFileStem = (value: string): string =>
        value
          .trim()
          .replace(/[\\/:*?"<>|]+/g, "_")
          .slice(0, 80) || "image";

      const getNodeImageSources = (
        node: any
      ): Array<{
        source: string;
        fileName: string;
        contentType?: string;
        w?: number;
        h?: number;
      }> => {
        const data = (node?.data || {}) as any;
        const titleCandidate =
          data.imageName || data.label || data.title || node?.type || "flow";
        const baseName =
          typeof titleCandidate === "string"
            ? titleCandidate.trim()
            : String(titleCandidate || "flow");

        const preferredWRaw =
          (typeof data.boxW === "number" ? data.boxW : undefined) ??
          (typeof data.imageWidth === "number" ? data.imageWidth : undefined) ??
          undefined;
        const preferredHRaw =
          (typeof data.boxH === "number" ? data.boxH : undefined) ??
          (typeof data.imageWidth === "number"
            ? data.imageWidth * 0.75
            : undefined) ??
          undefined;

        const clamp = (n: number, min: number, max: number) =>
          Math.max(min, Math.min(max, n));
        const preferredW =
          typeof preferredWRaw === "number" &&
          Number.isFinite(preferredWRaw) &&
          preferredWRaw > 0
            ? clamp(preferredWRaw, 220, 1200)
            : 360;
        const preferredH =
          typeof preferredHRaw === "number" &&
          Number.isFinite(preferredHRaw) &&
          preferredHRaw > 0
            ? clamp(preferredHRaw, 160, 1200)
            : 270;

        // 多图节点（generate4 / generatePro4）
        if (node?.type === "generate4" || node?.type === "generatePro4") {
          const imgs = Array.isArray(data.imageUrls)
            ? (data.imageUrls as string[])
            : Array.isArray(data.images)
            ? (data.images as string[])
            : [];
          return imgs
            .map((img, idx) => {
              const source = normalizeImageSource(img);
              if (!source) return null;
              return {
                source,
                fileName: `${safeFileStem(baseName)}_${node.id}_${idx + 1}.png`,
                contentType: "image/png",
                w: preferredW,
                h: preferredH,
              };
            })
            .filter(Boolean) as any;
        }

        const single = normalizeImageSource(
          typeof data.imageUrl === "string" && data.imageUrl.trim()
            ? data.imageUrl
            : data.imageData
        );
        if (!single) return [];
        return [
          {
            source: single,
            fileName: `${safeFileStem(baseName)}_${node.id}.png`,
            contentType: "image/png",
            w: preferredW,
            h: preferredH,
          },
        ];
      };

      const images: Array<{
        source: string;
        fileName: string;
        contentType?: string;
        w: number;
        h: number;
      }> = [];
      selected.forEach((node: any) => {
        try {
          const list = getNodeImageSources(node);
          list.forEach((item: any) => {
            if (item?.source)
              images.push({
                source: item.source,
                fileName: item.fileName,
                contentType: item.contentType,
                w: item.w || 360,
                h: item.h || 270,
              });
          });
        } catch {}
      });
      if (images.length === 0) return null;

      const center = (() => {
        try {
          const c = (paper?.view as any)?.center;
          if (c && Number.isFinite(c.x) && Number.isFinite(c.y))
            return { x: c.x, y: c.y };
        } catch {}
        return { x: 0, y: 0 };
      })();

      // 画板粘贴会额外偏移 (32, 32)，这里预先抵消以便默认落在视口中心附近
      const pasteOffset = { x: 32, y: 32 };
      const gap = 24;
      const cols = images.length >= 4 ? 2 : images.length;
      const rows = Math.ceil(images.length / cols);
      const cellW = Math.max(...images.map((x) => x.w || 0), 360);
      const cellH = Math.max(...images.map((x) => x.h || 0), 270);
      const totalW = cols * cellW + (cols - 1) * gap;
      const totalH = rows * cellH + (rows - 1) * gap;
      const startX = center.x - totalW / 2;
      const startY = center.y - totalH / 2;

      const now = Date.now();
      const snapshots = images.map((item, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const cellX = startX + col * (cellW + gap);
        const cellY = startY + row * (cellH + gap);
        const x = cellX + (cellW - item.w) / 2 - pasteOffset.x;
        const y = cellY + (cellH - item.h) / 2 - pasteOffset.y;
        const localDataUrl = /^data:/i.test(item.source)
          ? item.source
          : undefined;

        return {
          id: `flow_clip_img_${now}_${idx}_${Math.random()
            .toString(36)
            .slice(2, 8)}`,
          url: item.source,
          src: item.source,
          fileName: item.fileName,
          width: item.w,
          height: item.h,
          contentType: item.contentType,
          localDataUrl,
          pendingUpload: false,
          bounds: { x, y, width: item.w, height: item.h },
          layerId: null,
        };
      });

      return {
        images: snapshots,
        models: [],
        texts: [],
        paths: [],
      };
    },
    []
  );

  const handleCopyFlow = React.useCallback(() => {
    const allNodes = rf.getNodes();
    const selectedNodes = allNodes.filter((node: any) => node.selected);
    if (!selectedNodes.length) return false;

    // 同步一份“可粘贴到画板”的数据（仅对含图片节点生效）
    try {
      const canvasPayload = buildCanvasClipboardFromFlowNodes(
        selectedNodes as any
      );
      if (canvasPayload) clipboardService.setCanvasData(canvasPayload);
    } catch {}

    const nodeSnapshots = rfNodesToTplNodes(selectedNodes as any);
    const selectedIds = new Set(selectedNodes.map((node: any) => node.id));
    const relatedEdges = rf
      .getEdges()
      .filter(
        (edge: any) =>
          selectedIds.has(edge.source) && selectedIds.has(edge.target)
      );
    const edgeSnapshots = rfEdgesToTplEdges(relatedEdges);

    const minX = Math.min(
      ...selectedNodes.map((node: any) => node.position?.x ?? 0)
    );
    const minY = Math.min(
      ...selectedNodes.map((node: any) => node.position?.y ?? 0)
    );

    clipboardService.setFlowData({
      nodes: nodeSnapshots,
      edges: edgeSnapshots,
      origin: { x: minX, y: minY },
    });
    return true;
  }, [
    rf,
    rfNodesToTplNodes,
    rfEdgesToTplEdges,
    buildCanvasClipboardFromFlowNodes,
  ]);

  const handlePasteFlow = React.useCallback(() => {
    const payload = clipboardService.getFlowData();
    if (!payload || !Array.isArray(payload.nodes) || payload.nodes.length === 0)
      return false;

    const OFFSET = 40;
    const idMap = new Map<string, string>();

    const newNodes = payload.nodes.map((node) => {
      const newId = generateId(node.type || "n");
      idMap.set(node.id, newId);
      const data: any = sanitizeNodeData(node.data || {});
      return {
        id: newId,
        type: node.type || "default",
        position: {
          x: node.position.x + OFFSET,
          y: node.position.y + OFFSET,
        },
        data,
        selected: true,
        width: node.width,
        height: node.height,
        style: node.style ? { ...node.style } : undefined,
      } as any;
    });

    if (!newNodes.length) return false;

    const newEdges = (payload.edges || [])
      .map((edge) => {
        const source = idMap.get(edge.source);
        const target = idMap.get(edge.target);
        if (!source || !target) return null;
        return {
          id: generateId("e"),
          source,
          target,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
          type: edge.type || "default",
          label: edge.label,
        } as any;
      })
      .filter(Boolean) as Edge[];

    setNodes((prev: any[]) =>
      prev.map((node) => ({ ...node, selected: false })).concat(newNodes)
    );
    if (newEdges.length) {
      setEdges((prev: any[]) => prev.concat(newEdges));
    }

    try {
      historyService.commit("flow-paste").catch(() => {});
    } catch {}
    return true;
  }, [sanitizeNodeData, setEdges, setNodes]);

  // Flow 复制：写入系统剪贴板（覆盖系统截图内容），以便粘贴时能优先恢复节点而非图片
  React.useEffect(() => {
    const handleCopyEvent = (event: ClipboardEvent) => {
      try {
        const active = document.activeElement as Element | null;
        const tagName = active?.tagName?.toLowerCase();
        const isEditable =
          !!active &&
          (tagName === "input" ||
            tagName === "textarea" ||
            (active as any).isContentEditable);
        if (isEditable) return;

        // 仅在 Flow 区域或当前 zone 为 Flow 时接管 copy，避免影响画布复制
        const path =
          typeof event.composedPath === "function" ? event.composedPath() : [];
        const fromFlowOverlay = path.some(
          (el) =>
            el instanceof Element &&
            el.classList?.contains("tanva-flow-overlay")
        );
        const zone = clipboardService.getZone();
        if (zone !== "flow" && !fromFlowOverlay) return;

        const handled = handleCopyFlow();
        if (!handled) return;

        const payload = clipboardService.getFlowData();
        if (!payload) return;

        const serialized = JSON.stringify({
          type: FLOW_CLIPBOARD_TYPE,
          version: 1,
          data: payload,
        });

        if (event.clipboardData) {
          event.clipboardData.setData(FLOW_CLIPBOARD_MIME, serialized);
          event.clipboardData.setData("application/json", serialized);
          event.clipboardData.setData(
            "text/plain",
            FLOW_CLIPBOARD_FALLBACK_TEXT
          );
          event.preventDefault();
        } else if (
          typeof navigator !== "undefined" &&
          navigator.clipboard?.writeText
        ) {
          void navigator.clipboard.writeText(serialized).catch(() => {});
        }
      } catch (error) {
        console.warn("复制 Flow 到系统剪贴板失败", error);
      }
    };

    window.addEventListener("copy", handleCopyEvent);
    return () => window.removeEventListener("copy", handleCopyEvent);
  }, [handleCopyFlow]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      const isCopy =
        (event.key === "c" || event.key === "C") &&
        (event.metaKey || event.ctrlKey);
      const isPaste =
        (event.key === "v" || event.key === "V") &&
        (event.metaKey || event.ctrlKey);
      if (!isCopy && !isPaste) return;

      const active = document.activeElement as Element | null;
      const tagName = active?.tagName?.toLowerCase();
      const isEditable =
        !!active &&
        (tagName === "input" ||
          tagName === "textarea" ||
          (active as any).isContentEditable);
      if (isEditable) return;

      const anySelected = rf.getNodes().some((n: any) => n.selected);
      const canPasteFlow = !!clipboardService.getFlowData();
      const path =
        typeof event.composedPath === "function" ? event.composedPath() : [];
      const fromFlowOverlay = path.some(
        (el) =>
          el instanceof Element && el.classList?.contains("tanva-flow-overlay")
      );
      const currentZone = clipboardService.getZone();

      if (isCopy) {
        if (!anySelected) return;
        clipboardService.setActiveZone("flow");
        // 让浏览器触发原生 copy 事件（由上面的 copy 监听器写入系统剪贴板）
        handleCopyFlow();
        return;
      }

      if (isPaste) {
        // 仅在 Flow 区域或当前 zone 为 Flow 时切换，避免抢占画布粘贴图片
        if (fromFlowOverlay || currentZone === "flow") {
          clipboardService.setActiveZone("flow");
        } else {
          return;
        }
        // 粘贴逻辑改为在 clipboard/paste 事件中处理，以便检测剪贴板里是否有图片
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleCopyFlow, handlePasteFlow]);

  // 只在剪贴板中没有图片/文件时才接管 Flow 的粘贴，避免阻止画布粘贴图片
  React.useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented) return;

      const active = document.activeElement as Element | null;
      const tagName = active?.tagName?.toLowerCase();
      const isEditable =
        !!active &&
        (tagName === "input" ||
          tagName === "textarea" ||
          (active as any).isContentEditable);
      if (isEditable) return;

      if (clipboardService.getZone() !== "flow") return;
      const clipboardData = event.clipboardData;

      // 先尝试解析系统剪贴板中的 Flow 数据（支持跨页面/跨实例粘贴）
      const rawFlowData =
        clipboardData?.getData(FLOW_CLIPBOARD_MIME) ||
        clipboardData?.getData("application/json");
      if (rawFlowData) {
        try {
          const parsed = JSON.parse(rawFlowData);
          const flowPayload =
            parsed?.type === FLOW_CLIPBOARD_TYPE
              ? parsed.data
              : parsed?.nodes && parsed?.edges
              ? parsed
              : null;
          if (flowPayload) {
            clipboardService.setFlowData(flowPayload);
            const handled = handlePasteFlow();
            if (handled) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
          }
        } catch {}
      }

      const payload = clipboardService.getFlowData();
      if (
        !payload ||
        !Array.isArray(payload.nodes) ||
        payload.nodes.length === 0
      )
        return;

      const items = clipboardData?.items;
      const hasFileOrImage = items
        ? Array.from(items).some(
            (item) =>
              item &&
              (item.kind === "file" ||
                (typeof item.type === "string" &&
                  item.type.startsWith("image/")))
          )
        : false;
      if (hasFileOrImage) return;

      const handled = handlePasteFlow();
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [handlePasteFlow]);

  // 切换项目时先清空，避免跨项目残留
  React.useEffect(() => {
    if (prevProjectIdRef.current && prevProjectIdRef.current !== projectId) {
      setNodes([]);
      setEdges([]);
      hasHydratedFlowRef.current = false;
      lastSyncedJSONRef.current = null;
    }
    prevProjectIdRef.current = projectId ?? null;
  }, [projectId, setNodes, setEdges]);

  // 当项目内容的 flow 变化时，水合到 ReactFlow
  React.useEffect(() => {
    if (!projectId || !hydrated) return;
    if (nodeDraggingRef.current) return; // 拖拽过程中不从store覆盖本地状态，避免闪烁
    const ns = contentFlow?.nodes || [];
    const es = contentFlow?.edges || [];
    hydratingFromStoreRef.current = true;
    const nextNodes = tplNodesToRfNodes(ns);
    setNodes((prev) => {
      const prevMap = new Map(
        (prev as RFNode[]).map((node) => [node.id, node])
      );
      return nextNodes.map((node) => {
        const prevNode = prevMap.get(node.id);
        if (!prevNode) return node as RFNode;
        return {
          ...prevNode,
          position: node.position,
          data: { ...(prevNode.data || {}), ...(node.data || {}) },
          width: node.width ?? prevNode.width,
          height: node.height ?? prevNode.height,
          style: node.style || prevNode.style,
        } as RFNode;
      });
    });
    setEdges(tplEdgesToRfEdges(es));
    // 记录当前从 store 水合的快照，避免立刻写回造成环路
    lastSyncedJSONRef.current = getFlowSnapshotSignature(ns, es);
    hasHydratedFlowRef.current = true;
    Promise.resolve().then(() => {
      hydratingFromStoreRef.current = false;
    });
  }, [
    projectId,
    hydrated,
    contentFlow,
    setNodes,
    setEdges,
    tplNodesToRfNodes,
    tplEdgesToRfEdges,
    getFlowSnapshotSignature,
  ]);

  // 将 ReactFlow 的更改写回项目内容（触发自动保存）
  const scheduleCommit = React.useCallback(
    (nodesSnapshot: TemplateNode[], edgesSnapshot: TemplateEdge[]) => {
      if (!projectId) return;
      if (!hydrated) return;
      if (hydratingFromStoreRef.current) return;
      if (nodeDraggingRef.current) return; // 拖拽时不高频写回
      if (!hasHydratedFlowRef.current) return;
      const json = getFlowSnapshotSignature(nodesSnapshot, edgesSnapshot);
      if (json && lastSyncedJSONRef.current === json) return;
      if (commitTimerRef.current) window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = window.setTimeout(() => {
        lastSyncedJSONRef.current = json;
        updateProjectPartial(
          { flow: { nodes: nodesSnapshot, edges: edgesSnapshot } },
          { markDirty: true }
        );
        commitTimerRef.current = null;
      }, 120); // 轻微节流，避免频繁渲染
    },
    [projectId, hydrated, updateProjectPartial, getFlowSnapshotSignature]
  );

  React.useEffect(() => {
    if (!projectId) return;
    if (!hydrated) return;
    if (hydratingFromStoreRef.current) return;
    const nodesSnapshot = rfNodesToTplNodes(nodes as any);
    const edgesSnapshot = rfEdgesToTplEdges(edges);
    scheduleCommit(nodesSnapshot, edgesSnapshot);
  }, [
    nodes,
    edges,
    projectId,
    hydrated,
    rfNodesToTplNodes,
    rfEdgesToTplEdges,
    scheduleCommit,
  ]);

  React.useEffect(() => {
    if (hydrated) return;
    if (commitTimerRef.current) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
  }, [hydrated]);

  // 背景设置改为驱动底层 Canvas 网格
  // 使用独立的Flow状态
  // 分别选择，避免一次性取整个 store 导致不必要的重渲染/快照警告
  const backgroundEnabled = useFlowStore((s) => s.backgroundEnabled);
  const backgroundVariant = useFlowStore((s) => s.backgroundVariant);
  const backgroundGap = useFlowStore((s) => s.backgroundGap);
  const backgroundSize = useFlowStore((s) => s.backgroundSize);
  const backgroundColor = useFlowStore((s) => s.backgroundColor);
  const backgroundOpacity = useFlowStore((s) => s.backgroundOpacity);
  const setBackgroundEnabled = useFlowStore((s) => s.setBackgroundEnabled);
  const setBackgroundVariant = useFlowStore((s) => s.setBackgroundVariant);
  const setBackgroundGap = useFlowStore((s) => s.setBackgroundGap);
  const setBackgroundSize = useFlowStore((s) => s.setBackgroundSize);
  const setBackgroundColor = useFlowStore((s) => s.setBackgroundColor);
  const setBackgroundOpacity = useFlowStore((s) => s.setBackgroundOpacity);
  const onlyRenderVisibleElements = useFlowStore(
    (s) => s.onlyRenderVisibleElements
  );
  const setOnlyRenderVisibleElements = useFlowStore(
    (s) => s.setOnlyRenderVisibleElements
  );
  const showFpsOverlay = useFlowStore((s) => s.showFpsOverlay);
  const setShowFpsOverlay = useFlowStore((s) => s.setShowFpsOverlay);

  const [dragFps, setDragFps] = React.useState<number>(0);
  const [dragLongFrames, setDragLongFrames] = React.useState<number>(0);
  const [dragMaxFrameMs, setDragMaxFrameMs] = React.useState<number>(0);
  const [fpsMode, setFpsMode] = React.useState<"Drag" | "Image" | null>(null);

  // 方便性能排查：开发环境默认打开拖拽 FPS 监控（可在面板里随时关掉）
  React.useEffect(() => {
    if (!import.meta.env.DEV) return;
    setShowFpsOverlay(true);
  }, [setShowFpsOverlay]);

  React.useEffect(() => {
    if (!showFpsOverlay) return;
    let rafId = 0;
    let last =
      typeof performance !== "undefined" &&
      typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    let lastReport = last;
    let frames = 0;
    let acc = 0;
    let longFrames = 0;
    let maxDt = 0;
    let lastMode: "Drag" | "Image" | null = null;

    const tick = (nowArg: number) => {
      const now =
        nowArg ||
        (typeof performance !== "undefined" &&
        typeof performance.now === "function"
          ? performance.now()
          : Date.now());
      const dt = Math.max(0, now - last);
      last = now;

      const isImageDragging =
        typeof document !== "undefined" &&
        Boolean(document.body?.classList.contains("tanva-canvas-dragging"));
      const mode: "Drag" | "Image" | null = isImageDragging
        ? "Image"
        : nodeDraggingRef.current
        ? "Drag"
        : null;

      if (mode !== lastMode) {
        frames = 0;
        acc = 0;
        longFrames = 0;
        maxDt = 0;
        lastMode = mode;
      }

      if (mode) {
        frames += 1;
        acc += dt;
        if (dt >= 20) longFrames += 1; // 粗略把 >20ms 视为卡顿帧
        if (dt > maxDt) maxDt = dt;
      } else {
        frames = 0;
        acc = 0;
        longFrames = 0;
        maxDt = 0;
      }

      if (now - lastReport >= 250) {
        if (mode && acc > 0) {
          setDragFps((1000 * frames) / acc);
          setDragLongFrames(longFrames);
          setDragMaxFrameMs(maxDt);
          setFpsMode(mode);
        } else {
          setDragFps(0);
          setDragLongFrames(0);
          setDragMaxFrameMs(0);
          setFpsMode(null);
        }
        frames = 0;
        acc = 0;
        longFrames = 0;
        maxDt = 0;
        lastReport = now;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [showFpsOverlay]);

  // Flow独立的背景状态管理，不再同步到Canvas
  const [bgGapInput, setBgGapInput] = React.useState<string>(
    String(backgroundGap)
  );
  const [bgSizeInput, setBgSizeInput] = React.useState<string>(
    String(backgroundSize)
  );

  // 同步输入框字符串与实际数值
  React.useEffect(() => {
    setBgGapInput(String(backgroundGap));
  }, [backgroundGap]);
  React.useEffect(() => {
    setBgSizeInput(String(backgroundSize));
  }, [backgroundSize]);

  const commitGap = React.useCallback(
    (val: string) => {
      const n = Math.max(
        4,
        Math.min(100, Math.floor(Number(val)) || backgroundGap)
      );
      setBackgroundGap(n);
      setBgGapInput(String(n));
    },
    [backgroundGap, setBackgroundGap]
  );

  const commitSize = React.useCallback(
    (val: string) => {
      const n = Math.max(
        0.5,
        Math.min(10, Math.floor(Number(val)) || backgroundSize)
      );
      setBackgroundSize(n);
      setBgSizeInput(String(n));
    },
    [backgroundSize, setBackgroundSize]
  );

  const initialViewport = React.useMemo(() => {
    try {
      const state = useCanvasStore.getState();
      const z = state.zoom || 1;
      const dpr =
        typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const x = ((state.panX || 0) * z) / dpr;
      const y = ((state.panY || 0) * z) / dpr;
      return { x, y, zoom: z };
    } catch {
      return { x: 0, y: 0, zoom: 1 };
    }
  }, [projectId]);

  // 使用Canvas → Flow 单向同步：保证节点随画布平移/缩放
  // 使用 subscribe 直接订阅状态变化，避免 useEffect 的渲染延迟
  const lastApplied = React.useRef<{ x: number; y: number; z: number } | null>(
    null
  );
  const syncViewportToCanvasStore = () => {
    try {
      const state = useCanvasStore.getState();
      const z = state.zoom || 1;
      const dpr =
        typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const x = ((state.panX || 0) * z) / dpr;
      const y = ((state.panY || 0) * z) / dpr;
      lastApplied.current = { x, y, z };
      rfRef.current.setViewport({ x, y, zoom: z }, { duration: 0 });
    } catch {
      /* noop */
    }
  };
  React.useEffect(() => {
    // 使用 Zustand subscribe 直接监听状态变化，绕过 React 渲染周期
    const unsubscribe = useCanvasStore.subscribe((state) => {
      const z = state.zoom || 1;
      const dpr =
        typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const x = ((state.panX || 0) * z) / dpr;
      const y = ((state.panY || 0) * z) / dpr;
      const prev = lastApplied.current;
      const eps = 1e-6;
      if (
        prev &&
        Math.abs(prev.x - x) < eps &&
        Math.abs(prev.y - y) < eps &&
        Math.abs(prev.z - z) < eps
      )
        return;
      lastApplied.current = { x, y, z };
      // 直接同步更新，不使用 RAF，与 Canvas 平移在同一帧内完成
      try {
        rfRef.current.setViewport({ x, y, zoom: z }, { duration: 0 });
      } catch {
        /* noop */
      }
    });

    // 初始同步
    const state = useCanvasStore.getState();
    const z = state.zoom || 1;
    const dpr =
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const x = ((state.panX || 0) * z) / dpr;
    const y = ((state.panY || 0) * z) / dpr;
    lastApplied.current = { x, y, z };
    try {
      rfRef.current.setViewport({ x, y, zoom: z }, { duration: 0 });
    } catch {
      /* noop */
    }

    return unsubscribe;
  }, []);

  React.useLayoutEffect(() => {
    if (!projectId) return;
    syncViewportToCanvasStore();
  }, [projectId]);

  // 当开始/结束连线拖拽时，全局禁用/恢复文本选择，避免蓝色选区
  React.useEffect(() => {
    if (isConnecting) {
      document.body.classList.add("tanva-no-select", "tanva-flow-connecting");
    } else {
      document.body.classList.remove(
        "tanva-no-select",
        "tanva-flow-connecting"
      );
    }
    return () =>
      document.body.classList.remove(
        "tanva-no-select",
        "tanva-flow-connecting"
      );
  }, [isConnecting]);

  // 擦除模式退出时清除高亮
  React.useEffect(() => {
    // 节点橡皮已禁用，确保无高亮残留
    setNodes((ns) =>
      ns.map((n) =>
        n.className === "eraser-hover" ? { ...n, className: undefined } : n
      )
    );
  }, []);

  // 双击空白处弹出添加面板
  const [addPanel, setAddPanel] = React.useState<{
    visible: boolean;
    screen: { x: number; y: number };
    world: { x: number; y: number };
  }>({ visible: false, screen: { x: 0, y: 0 }, world: { x: 0, y: 0 } });
  const [allowedAddTabs, setAllowedAddTabs] =
    React.useState<AddPanelTab[]>(ALL_ADD_TABS);
  const [addTab, setAddTab] = React.useState<AddPanelTab>(() =>
    getStoredAddPanelTab()
  );
  const clampAddTab = React.useCallback(
    (tab: AddPanelTab, allowed: AddPanelTab[] = allowedAddTabs) => {
      return allowed.includes(tab) ? tab : allowed[0];
    },
    [allowedAddTabs]
  );
  const setAddTabWithMemory = React.useCallback(
    (tab: AddPanelTab, allowedOverride?: AddPanelTab[]) => {
      const allowed = allowedOverride ?? allowedAddTabs;
      const next = clampAddTab(tab, allowed);
      setAddTab(next);
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(ADD_PANEL_TAB_STORAGE_KEY, next);
        } catch (error) {
          console.warn("[FlowOverlay] 无法保存添加面板的页签状态", error);
        }
      }
    },
    [clampAddTab, allowedAddTabs]
  );
  React.useEffect(() => {
    setAddTab((prev) => clampAddTab(prev, allowedAddTabs));
  }, [allowedAddTabs, clampAddTab]);
  const addPanelRef = React.useRef<HTMLDivElement | null>(null);
  const lastPaneClickRef = React.useRef<{
    t: number;
    x: number;
    y: number;
  } | null>(null);
  const lastGlobalClickRef = React.useRef<{
    t: number;
    x: number;
    y: number;
  } | null>(null);
  // 模板相关状态
  const [tplIndex, setTplIndex] = React.useState<TemplateIndexEntry[] | null>(
    null
  );
  const [userTplList, setUserTplList] = React.useState<
    Array<{
      id: string;
      name: string;
      category?: string;
      tags?: string[];
      thumbnail?: string;
      createdAt: string;
      updatedAt: string;
    }>
  >([]);
  const [tplLoading, setTplLoading] = React.useState(false);
  const [templateScope, setTemplateScope] = React.useState<"public" | "mine">(
    "public"
  );
  const [builtinCategories, setBuiltinCategories] = React.useState<string[]>(
    []
  );
  // 单选分类：仅允许选择一个内置分类，空字符串表示未筛选（显示全部）
  const [activeBuiltinCategory, setActiveBuiltinCategory] =
    React.useState<string>("");

  const filteredTplIndex = React.useMemo(() => {
    if (!tplIndex) return [];
    if (!activeBuiltinCategory) return tplIndex;
    return tplIndex.filter(
      (item) => (item.category || "其他") === activeBuiltinCategory
    );
  }, [tplIndex, activeBuiltinCategory]);

  const getPlaceholderCount = React.useCallback(
    (len: number, opts?: { columns?: number; minVisible?: number }) => {
      const columns = opts?.columns ?? 2;
      const minVisible = opts?.minVisible ?? 0;
      const minFill = len < minVisible ? minVisible - len : 0;
      const remainder = len % columns;
      const columnFill = remainder ? columns - remainder : 0;
      return Math.max(minFill, columnFill);
    },
    []
  );

  const openAddPanelAt = React.useCallback(
    (
      clientX: number,
      clientY: number,
      opts?: {
        tab?: AddPanelTab;
        scope?: "public" | "mine";
        allowedTabs?: AddPanelTab[];
      }
    ) => {
      const allowed =
        opts?.allowedTabs && opts.allowedTabs.length
          ? opts.allowedTabs
          : ALL_ADD_TABS;
      setAllowedAddTabs(allowed);
      const targetTab = clampAddTab(opts?.tab ?? addTab, allowed);
      setAddTabWithMemory(targetTab, allowed);
      if (opts?.scope) setTemplateScope(opts.scope);
      const world = rf.screenToFlowPosition({ x: clientX, y: clientY });
      setAddPanel({ visible: true, screen: { x: clientX, y: clientY }, world });
    },
    [rf, addTab, setAddTabWithMemory, setTemplateScope, clampAddTab]
  );

  // 允许外部（如工具栏按钮）打开添加/模板面板
  React.useEffect(() => {
    const handleSet = (event: Event) => {
      const detail = (event as CustomEvent<any>)?.detail || {};
      const shouldOpen = detail.visible !== false;
      if (!shouldOpen) {
        setAddPanel((v) => ({ ...v, visible: false }));
        return;
      }
      const allowed: AddPanelTab[] | undefined = Array.isArray(
        detail.allowedTabs
      )
        ? (detail.allowedTabs.filter((t: any) =>
            ALL_ADD_TABS.includes(t)
          ) as AddPanelTab[])
        : undefined;
      const targetTab: AddPanelTab =
        detail.tab === "personal" || detail.tab === "nodes"
          ? detail.tab
          : "templates";
      const scope: "public" | "mine" | undefined =
        detail.scope === "public" || detail.scope === "mine"
          ? detail.scope
          : undefined;
      const x = detail.screen?.x ?? window.innerWidth / 2;
      const y = detail.screen?.y ?? window.innerHeight / 2;
      openAddPanelAt(x, y, { tab: targetTab, scope, allowedTabs: allowed });
    };
    // 兼容旧事件名称，新的 flow:set-template-panel 支持关闭
    window.addEventListener(
      "flow:open-template-panel",
      handleSet as EventListener
    );
    window.addEventListener(
      "flow:set-template-panel",
      handleSet as EventListener
    );
    return () => {
      window.removeEventListener(
        "flow:open-template-panel",
        handleSet as EventListener
      );
      window.removeEventListener(
        "flow:set-template-panel",
        handleSet as EventListener
      );
    };
  }, [openAddPanelAt, setAddTabWithMemory, setTemplateScope]);

  // 把面板可见性和当前页签通知给外部（例如工具栏按钮同步状态）
  React.useEffect(() => {
    try {
      window.dispatchEvent(
        new CustomEvent("flow:add-panel-visibility-change", {
          detail: {
            visible: addPanel.visible,
            tab: addTab,
            allowedTabs: allowedAddTabs,
          },
        })
      );
    } catch {}
  }, [addPanel.visible, addTab, allowedAddTabs]);

  // ---------- 导出/导入（序列化） ----------
  const cleanNodeData = React.useCallback((data: any) => {
    if (!data) return {};
    // 不导出回调函数/运行时状态字段
    const {
      onRun,
      onSend,
      status,
      error,
      taskId,
      buttons,
      lastHistoryId,
      ...rest
    } = data || {};
    return rest;
  }, []);

  const isRemoteUrl = React.useCallback(
    (value: unknown): value is string =>
      typeof value === "string" && /^https?:\/\//i.test(value.trim()),
    []
  );

  const normalizeStableRemoteUrl = React.useCallback(
    (input: string): string => {
      const value = input.trim();
      if (!value) return input;

      // Avoid exporting environment-dependent proxy URLs; keep the original remote URL.
      try {
        const url = new URL(
          value,
          typeof window !== "undefined"
            ? window.location.origin
            : "http://localhost"
        );
        const isProxy =
          url.pathname === "/api/assets/proxy" ||
          url.pathname === "/assets/proxy" ||
          value.startsWith("/api/assets/proxy") ||
          value.startsWith("/assets/proxy");
        if (isProxy) {
          const raw = url.searchParams.get("url");
          if (raw) return decodeURIComponent(raw);
        }
      } catch {}

      return value;
    },
    []
  );

  const isLikelyBase64Blob = React.useCallback(
    (value: unknown): value is string => {
      if (typeof value !== "string") return false;
      const trimmed = value.trim();
      if (!trimmed) return false;
      if (trimmed.startsWith("data:image/")) return true;
      if (trimmed.startsWith("blob:")) return true;

      // Heuristic: avoid false positives on regular text; only strip very large blobs.
      const compact = trimmed.replace(/\s+/g, "");
      if (compact.length < 2048) return false;
      if (!/^[A-Za-z0-9+/=]+$/.test(compact)) return false;

      const head = compact.slice(0, 16);
      const looksLikeCommonImage =
        head.startsWith("iVBORw0KGgo") || // PNG
        head.startsWith("/9j/") || // JPEG
        head.startsWith("R0lGOD") || // GIF
        head.startsWith("UklGR") || // WEBP
        head.startsWith("Qk"); // BMP

      // Many base64 blobs end with padding; accept either common image prefix or padding.
      const hasPadding = compact.endsWith("=") || compact.endsWith("==");
      return looksLikeCommonImage || hasPadding;
    },
    []
  );

  const stripLargeInlineBlobsInPlace = React.useCallback(
    (obj: any) => {
      if (!obj || typeof obj !== "object") return;
      for (const [key, rawValue] of Object.entries(obj)) {
        if (typeof rawValue !== "string") continue;
        const value = rawValue.trim();
        if (!value) continue;
        if (isRemoteUrl(value)) continue;
        if (!isLikelyBase64Blob(value)) continue;

        const k = String(key).toLowerCase();
        const shouldKeep =
          k.includes("prompt") ||
          k.includes("text") ||
          k.includes("title") ||
          k.includes("name") ||
          k.includes("desc");
        if (shouldKeep) continue;

        delete obj[key];
      }
    },
    [isLikelyBase64Blob, isRemoteUrl]
  );

  // 导出时的状态
  const [isExporting, setIsExporting] = React.useState(false);

  const getHistoryRemoteUrlForNode = React.useCallback(
    (nodeId: string, index?: number): string | null => {
      const history = useImageHistoryStore.getState().history || [];
      const hit = history.find((item) => {
        if (item.nodeId !== nodeId) return false;
        if (typeof index === "number") {
          // GeneratePro4: id is like `${nodeId}-${idx}-${Date.now()}`
          return String(item.id || "").startsWith(`${nodeId}-${index}-`);
        }
        return true;
      });
      const url =
        (typeof hit?.remoteUrl === "string" && hit.remoteUrl.startsWith("http")
          ? hit.remoteUrl
          : undefined) ||
        (typeof hit?.src === "string" && hit.src.startsWith("http")
          ? hit.src
          : undefined) ||
        null;
      return url ? normalizeStableRemoteUrl(url) : null;
    },
    [normalizeStableRemoteUrl]
  );

  // 将运行时图片引用转换为可持久化引用（优先返回 OSS key；已是可持久化引用则规范化后直接返回）
  const uploadImageToStableUrl = React.useCallback(
    async (value: string, fileName: string): Promise<string> => {
      const trimmed = typeof value === "string" ? value.trim() : "";
      if (!trimmed) throw new Error("空的图片数据");

      const normalized = normalizePersistableImageRef(trimmed);
      if (normalized && isPersistableImageRef(normalized)) {
        return normalized;
      }

      const result = await imageUploadService.uploadImageSource(trimmed, {
        dir: "templates/images/",
        projectId,
        fileName,
      });

      const ref = (result.asset?.key || result.asset?.url || "").trim();
      if (!result.success || !ref) {
        throw new Error(result.error || "图片上传失败");
      }
      return ref;
    },
    [
      imageUploadService,
      isPersistableImageRef,
      normalizePersistableImageRef,
      projectId,
    ]
  );

  const exportFlow = React.useCallback(async () => {
    if (isExporting) return;
    setIsExporting(true);

    try {
      const templateId = `tpl_${Date.now()}`;
      const templateName = `导出模板_${new Date().toLocaleString()}`;

      // 处理节点数据：模板导出仅保留稳定的 imageUrl / imageUrls（避免 base64 过大）
      const processedNodes = await Promise.all(
        nodes.map(async (n) => {
          const data = cleanNodeData(n.data);
          const nodeType = String(n.type || "");

          // ImageSplit：只保留可持久化的原图引用 + 裁切矩形（不保存切片图片数据）
          if (nodeType === "imageSplit") {
            const candidateInput =
              (typeof (data as any).inputImageUrl === "string" &&
              (data as any).inputImageUrl.trim()
                ? (data as any).inputImageUrl
                : undefined) ??
              (typeof (data as any).inputImage === "string" &&
              (data as any).inputImage.trim()
                ? (data as any).inputImage
                : undefined);

            if (candidateInput) {
              (data as any).inputImageUrl = await uploadImageToStableUrl(
                String(candidateInput).trim(),
                `flow_template_${templateId}_${n.id}_input.png`
              );
              delete (data as any).inputImage;
            }

            // legacy：splitImages -> splitRects（保留坐标，不保留图片）
            const existingRects = Array.isArray((data as any).splitRects)
              ? (data as any).splitRects
              : [];
            const legacyImages = Array.isArray((data as any).splitImages)
              ? (data as any).splitImages
              : [];
            if (existingRects.length === 0 && legacyImages.length > 0) {
              const rects = legacyImages
                .map((img: any, idx: number) => ({
                  index:
                    typeof img?.index === "number" && Number.isFinite(img.index)
                      ? img.index
                      : idx,
                  x: Number(img?.x ?? 0),
                  y: Number(img?.y ?? 0),
                  width: Number(img?.width ?? 0),
                  height: Number(img?.height ?? 0),
                }))
                .filter(
                  (r: any) =>
                    Number.isFinite(r.x) &&
                    Number.isFinite(r.y) &&
                    Number.isFinite(r.width) &&
                    Number.isFinite(r.height) &&
                    r.width > 0 &&
                    r.height > 0
                );
              if (rects.length > 0) {
                (data as any).splitRects = rects;
              }
            }
            if (Array.isArray((data as any).splitImages)) {
              delete (data as any).splitImages;
            }
          }

          // 多图节点
          const rawImages: unknown[] = Array.isArray((data as any).images)
            ? (data as any).images
            : [];
          const rawImageUrls: unknown[] = Array.isArray((data as any).imageUrls)
            ? (data as any).imageUrls
            : [];
          const rawThumbnails: unknown[] = Array.isArray(
            (data as any).thumbnails
          )
            ? (data as any).thumbnails
            : [];
          if (rawImages.length || rawImageUrls.length || rawThumbnails.length) {
            const len = Math.max(
              rawImages.length,
              rawImageUrls.length,
              rawThumbnails.length
            );
            const urls: string[] = [];
            for (let i = 0; i < len; i += 1) {
              const candidate =
                rawImageUrls[i] ?? rawImages[i] ?? rawThumbnails[i];
              const candidateStr =
                typeof candidate === "string" ? candidate.trim() : "";
              if (!candidateStr) {
                const historyUrl =
                  nodeType === "generatePro4"
                    ? getHistoryRemoteUrlForNode(n.id, i)
                    : null;
                urls.push(historyUrl || "");
                continue;
              }

              urls.push(
                await uploadImageToStableUrl(
                  candidateStr,
                  `flow_template_${templateId}_${n.id}_${i + 1}.png`
                )
              );
            }
            (data as any).imageUrls = urls;
            delete (data as any).images;
            delete (data as any).imageData;
            delete (data as any).thumbnails;
            delete (data as any).thumbnail;
          }

          // 单图节点
          const candidateSingle =
            (typeof (data as any).imageUrl === "string" &&
            (data as any).imageUrl.trim()
              ? (data as any).imageUrl
              : undefined) ??
            (typeof (data as any).imageData === "string" &&
            (data as any).imageData.trim()
              ? (data as any).imageData
              : undefined) ??
            (typeof (data as any).thumbnail === "string" &&
            (data as any).thumbnail.trim()
              ? (data as any).thumbnail
              : undefined);

          if (candidateSingle) {
            const candidateStr = String(candidateSingle).trim();
            (data as any).imageUrl = await uploadImageToStableUrl(
              candidateStr,
              `flow_template_${templateId}_${n.id}.png`
            );
            delete (data as any).imageData;
            delete (data as any).thumbnail;
            delete (data as any).thumbnails;
          } else if (
            typeof (data as any).imageData === "string" ||
            typeof (data as any).imageUrl === "string"
          ) {
            delete (data as any).imageData;
            delete (data as any).thumbnail;
            delete (data as any).thumbnails;
          } else {
            const historyUrl = getHistoryRemoteUrlForNode(n.id);
            if (historyUrl) (data as any).imageUrl = historyUrl;
          }

          stripLargeInlineBlobsInPlace(data);

          return {
            id: n.id,
            type: n.type,
            position: n.position,
            data,
          };
        })
      );

      const payload = {
        schemaVersion: 1 as const,
        id: templateId,
        name: templateName,
        nodes: processedNodes,
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: (e as any).sourceHandle,
          targetHandle: (e as any).targetHandle,
          type: e.type || "default",
        })),
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const a = document.createElement("a");
      const blobUrl = URL.createObjectURL(blob);
      a.href = blobUrl;
      a.download = `tanva-template-${Date.now()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
    } catch (err) {
      console.error("导出失败", err);
      alert("导出失败：图片上传或 JSON 生成失败，请重试");
    } finally {
      setIsExporting(false);
    }
  }, [
    nodes,
    edges,
    cleanNodeData,
    getHistoryRemoteUrlForNode,
    isExporting,
    stripLargeInlineBlobsInPlace,
    isRemoteUrl,
    normalizeStableRemoteUrl,
    uploadImageToStableUrl,
  ]);

  const importInputRef = React.useRef<HTMLInputElement | null>(null);
  const handleImportClick = React.useCallback(() => {
    // 点击导入后立即关闭面板
    setAddPanel((v) => ({ ...v, visible: false }));
    importInputRef.current?.click();
  }, []);

  const handleImportFiles = React.useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const file = files[0];
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const text = String(reader.result || "");
          const obj = JSON.parse(text);
          const rawNodes = Array.isArray(obj?.nodes) ? obj.nodes : [];
          const rawEdges = Array.isArray(obj?.edges) ? obj.edges : [];

          const existing = new Set((rf.getNodes() || []).map((n) => n.id));
          const idMap = new Map<string, string>();

          const now = Date.now();
          const mappedNodes = rawNodes.map((n: any, idx: number) => {
            const origId = String(n.id || `n_${idx}`);
            let newId = origId;
            if (existing.has(newId) || idMap.has(newId))
              newId = `${origId}_${now}_${idx}`;
            idMap.set(origId, newId);
            return {
              id: newId,
              type: n.type,
              position: n.position || { x: 0, y: 0 },
              data: cleanNodeData(n.data) || {},
            } as any;
          });

          const mappedEdges = rawEdges
            .map((e: any, idx: number) => {
              const sid = idMap.get(String(e.source)) || String(e.source);
              const tid = idMap.get(String(e.target)) || String(e.target);
              return {
                id: String(e.id || `e_${now}_${idx}`),
                source: sid,
                target: tid,
                sourceHandle: e.sourceHandle,
                targetHandle: e.targetHandle,
                type: e.type || "default",
              } as any;
            })
            .filter(
              (e: any) =>
                mappedNodes.find((n) => n.id === e.source) &&
                mappedNodes.find((n) => n.id === e.target)
            );

          setNodes((ns) => ns.concat(mappedNodes));
          setEdges((es) => es.concat(mappedEdges));
          console.log(
            `✅ 导入成功：节点 ${mappedNodes.length} 条，连线 ${mappedEdges.length} 条`
          );
          try {
            historyService.commit("flow-import").catch(() => {});
          } catch {}
        } catch (err) {
          console.error("导入失败：JSON 解析错误", err);
        } finally {
          // 确保面板关闭；重置 input 值，允许重复导入同一文件
          setAddPanel((v) => ({ ...v, visible: false }));
          try {
            if (importInputRef.current) importInputRef.current.value = "";
          } catch {}
        }
      };
      reader.readAsText(file);
    },
    [rf, setNodes, setEdges, cleanNodeData]
  );

  // 仅在真正空白处（底层画布）允许触发
  const isBlankArea = React.useCallback((clientX: number, clientY: number) => {
    const container = containerRef.current;
    if (!container) return false;
    const rect = container.getBoundingClientRect();
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    )
      return false;

    // 屏蔽 AI 对话框等区域及其外侧保护带（24px），防止误触发
    try {
      const shield = 24; // 外侧保护带
      const preventEls = Array.from(
        document.querySelectorAll("[data-prevent-add-panel]")
      ) as HTMLElement[];
      for (const el of preventEls) {
        const r = el.getBoundingClientRect();
        if (
          clientX >= r.left - shield &&
          clientX <= r.right + shield &&
          clientY >= r.top - shield &&
          clientY <= r.bottom + shield
        ) {
          return false;
        }
      }
    } catch {}

    const el = document.elementFromPoint(
      clientX,
      clientY
    ) as HTMLElement | null;
    if (!el) return false;
    // 排除：添加面板/工具栏/Flow交互元素/任意标记为不触发的UI
    if (
      el.closest(
        ".tanva-add-panel, .tanva-flow-toolbar, .react-flow__node, .react-flow__edge, .react-flow__handle, .react-flow__controls, .react-flow__minimap, [data-prevent-add-panel]"
      )
    )
      return false;
    // 接受：底层画布 或 ReactFlow 背景/Pane（网格区域）
    const tag = el.tagName.toLowerCase();
    const isCanvas = tag === "canvas";
    const isPane = !!el.closest(".react-flow__pane");
    const isGridBg = !!el.closest(".react-flow__background");
    if (!isCanvas && !isPane && !isGridBg) return false;

    // 进一步：命中检测 Paper.js 物体（文本/图像/形状等）
    let projectPoint: paper.Point | null = null;
    try {
      const canvas = paper?.view?.element as HTMLCanvasElement | undefined;
      if (canvas) {
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        const vx = (clientX - rect.left) * dpr;
        const vy = (clientY - rect.top) * dpr;
        const pt = paper.view.viewToProject(new paper.Point(vx, vy));
        projectPoint = pt;
        const hit = paper.project.hitTest(pt, {
          segments: true,
          stroke: true,
          fill: true,
          bounds: true,
          center: true,
          tolerance: 4,
        } as any);
        if (hit && hit.item) {
          const item: any = hit.item;

          // 向上查找真实内容（例如图片组），避免命中辅助框时被误判为空白
          let current: any = item;
          while (current) {
            const data = current.data || {};
            if (
              (data.type === "image" && data.imageId) ||
              (typeof data.type === "string" &&
                !data.isHelper &&
                data.type !== "grid")
            ) {
              return false; // 命中真实内容，视为非空白
            }
            current = current.parent;
          }

          // 原有的网格/辅助元素检测
          const layerName = item?.layer?.name || "";
          const isGridLayer = layerName === "grid";
          const isHelper =
            !!item?.data?.isAxis || item?.data?.isHelper === true;
          const isGridType =
            typeof item?.data?.type === "string" &&
            item.data.type.startsWith("grid");
          if (isGridLayer || isHelper || isGridType) {
            // 命中网格/坐标轴等辅助元素：视为空白
          } else {
            return false; // 命中真实内容，视为非空白
          }
        }
      }
    } catch {}

    // 兜底：若未命中元素，基于保存的3D模型包围盒再次检查，避免3D区域被误判为空白
    try {
      if (projectPoint && paper?.project) {
        const hitModel = paper.project
          .getItems({
            match: (item: any) =>
              item?.data?.type === "3d-model" && item?.data?.bounds,
          })
          .some((item: any) => {
            try {
              const b = item.data.bounds;
              return (
                projectPoint!.x >= b.x &&
                projectPoint!.x <= b.x + b.width &&
                projectPoint!.y >= b.y &&
                projectPoint!.y <= b.y + b.height
              );
            } catch {
              return false;
            }
          });
        if (hitModel) return false;
      }
    } catch {}
    return true;
  }, []);

  const allowNativeScroll = React.useCallback((target: EventTarget | null) => {
    if (!target || !(target instanceof HTMLElement)) return false;
    const container = containerRef.current;
    if (!container) return false;
    let el: HTMLElement | null = target;
    while (el && container.contains(el)) {
      const tag = el.tagName.toLowerCase();
      if (
        tag === "textarea" ||
        tag === "input" ||
        tag === "select" ||
        el.isContentEditable
      ) {
        return true;
      }
      try {
        const style = window.getComputedStyle(el);
        const canScrollY =
          (style.overflowY === "auto" || style.overflowY === "scroll") &&
          el.scrollHeight > el.clientHeight + 1;
        const canScrollX =
          (style.overflowX === "auto" || style.overflowX === "scroll") &&
          el.scrollWidth > el.clientWidth + 1;
        if (canScrollX || canScrollY) return true;
      } catch {
        // getComputedStyle 可能失败，忽略并继续向上
      }
      el = el.parentElement;
    }
    return false;
  }, []);

  // 中键拖拽以平移 Flow 视口，阻止浏览器的自动滚动
  const middleDragRef = React.useRef<{
    dragging: boolean;
    lastX: number;
    lastY: number;
  }>({
    dragging: false,
    lastX: 0,
    lastY: 0,
  });
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const stopDrag = () => {
      if (!middleDragRef.current.dragging) return;
      middleDragRef.current.dragging = false;
      container.classList.remove("tanva-flow-middle-panning");
      container.style.cursor = "";
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 1) return;
      if (allowNativeScroll(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      middleDragRef.current.dragging = true;
      middleDragRef.current.lastX = event.clientX;
      middleDragRef.current.lastY = event.clientY;
      container.classList.add("tanva-flow-middle-panning");
      container.style.cursor = "grabbing";
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!middleDragRef.current.dragging) return;
      event.preventDefault();
      const store = useCanvasStore.getState();
      const dpr =
        typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const zoom = store.zoom || 1;
      const dx = event.clientX - middleDragRef.current.lastX;
      const dy = event.clientY - middleDragRef.current.lastY;
      if (dx === 0 && dy === 0) return;
      middleDragRef.current.lastX = event.clientX;
      middleDragRef.current.lastY = event.clientY;
      store.setPan(
        store.panX + (dx * dpr) / zoom,
        store.panY + (dy * dpr) / zoom
      );
    };

    const handleMouseUp = () => stopDrag();
    const handleWindowBlur = () => stopDrag();

    container.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove, true);
    window.addEventListener("mouseup", handleMouseUp, true);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      container.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove, true);
      window.removeEventListener("mouseup", handleMouseUp, true);
      window.removeEventListener("blur", handleWindowBlur);
      stopDrag();
    };
  }, [allowNativeScroll]);

  const handleWheelCapture = React.useCallback(
    (event: WheelEvent | React.WheelEvent<HTMLDivElement>) => {
      if (!containerRef.current) return;
      if (allowNativeScroll(event.target)) return;

      const store = useCanvasStore.getState();
      const dpr =
        typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        event.stopPropagation();

        const canvasEl =
          (paper?.view?.element as HTMLCanvasElement | undefined) ||
          containerRef.current;
        const rect = canvasEl?.getBoundingClientRect();
        if (!rect) return;

        const sx = (event.clientX - rect.left) * dpr;
        const sy = (event.clientY - rect.top) * dpr;
        const delta = normalizeWheelDelta(event.deltaY, event.deltaMode);
        if (Math.abs(delta) < 1e-6) return;

        const z1 = store.zoom || 1;
        const z2 = computeSmoothZoom(z1, delta);
        if (z1 === z2) return;

        const pan2x = store.panX + sx * (1 / z2 - 1 / z1);
        const pan2y = store.panY + sy * (1 / z2 - 1 / z1);
        store.setPan(pan2x, pan2y);
        store.setZoom(z2);
        return;
      }

      const hasDelta =
        Math.abs(event.deltaX) > 0.0001 || Math.abs(event.deltaY) > 0.0001;
      if (!hasDelta) return;

      event.preventDefault();
      event.stopPropagation();

      const zoom = store.zoom || 1;
      const worldDeltaX = (-event.deltaX * dpr) / zoom;
      const worldDeltaY = (-event.deltaY * dpr) / zoom;
      store.setPan(store.panX + worldDeltaX, store.panY + worldDeltaY);
    },
    [allowNativeScroll]
  );

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const listener = (event: WheelEvent) => handleWheelCapture(event);
    container.addEventListener("wheel", listener, {
      capture: true,
      passive: false,
    });
    return () => {
      container.removeEventListener("wheel", listener, { capture: true });
    };
  }, [handleWheelCapture]);

  const onPaneClick = React.useCallback(
    (event: React.MouseEvent) => {
      // 基于两次快速点击判定双击（ReactFlow Pane 无原生 onDoubleClick 回调）
      const now = Date.now();
      const x = event.clientX,
        y = event.clientY;
      const last = lastPaneClickRef.current;
      lastPaneClickRef.current = { t: now, x, y };
      if (
        last &&
        now - last.t < 200 &&
        Math.hypot(last.x - x, last.y - y) < 10
      ) {
        if (isBlankArea(x, y))
          openAddPanelAt(x, y, {
            tab: "nodes",
            allowedTabs: ["nodes", "beta", "custom"],
          });
      } else if (!isPointerMode) {
        // 单击空白区域时，取消所有节点的选择（pointer 模式下不自动取消选择）
        setNodes((prev: any[]) =>
          prev.map((node) => ({ ...node, selected: false }))
        );
      }
    },
    [openAddPanelAt, isBlankArea, setNodes, isPointerMode]
  );

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAddPanel((v) => ({ ...v, visible: false }));
    };
    const onDown = (e: MouseEvent) => {
      if (!addPanel.visible) return;
      const el = addPanelRef.current;
      if (el && !el.contains(e.target as HTMLElement))
        setAddPanel((v) => ({ ...v, visible: false }));
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [addPanel.visible]);

  // 监听点击事件，在空白区域点击时取消节点选择
  // 在 window 级别监听，确保能捕获到事件（即使 CSS 阻止了子元素的事件）
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleClick = (e: MouseEvent) => {
      // 在选择相关的模式下（pointer, select, marquee），不通过点击画布空白区域来自动取消选择
      // 因为这些模式下的框选/点击逻辑由 InteractionController 和 SelectionTool 统一协调
      if (isPointerMode || isMarqueeMode || drawMode === "select") return;

      // 检查点击是否在容器内
      const rect = container.getBoundingClientRect();
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) {
        return; // 点击在容器外，不处理
      }

      // 检查是否点击了节点、连线或其他 Flow 交互元素
      const target = e.target as HTMLElement;
      if (
        target.closest(
          ".react-flow__node, .react-flow__edge, .react-flow__handle, .react-flow__controls, .react-flow__minimap, .tanva-add-panel, .tanva-flow-toolbar, [data-prevent-add-panel]"
        )
      ) {
        return; // 点击了 Flow 元素，不处理
      }

      // 检查是否是空白区域
      if (isBlankArea(e.clientX, e.clientY)) {
        // 取消所有节点的选择
        setNodes((prev: any[]) =>
          prev.map((node) => ({ ...node, selected: false }))
        );
      }
    };

    // 在 window 级别监听，使用捕获阶段确保能捕获到事件
    window.addEventListener("click", handleClick, true);
    return () => {
      window.removeEventListener("click", handleClick, true);
    };
  }, [isBlankArea, setNodes, isPointerMode]);

  // 在打开模板页签时加载内置与用户模板
  React.useEffect(() => {
    if (!addPanel.visible || addTab !== "templates") return;
    let cancelled = false;
    (async () => {
      setTplLoading(true);
      try {
        if (!tplIndex) {
          const idx = await loadBuiltInTemplateIndex();
          const normalizedIdx = idx.map((item) => ({
            ...item,
            category: item.category || "其他",
          }));
          if (!cancelled) {
            setTplIndex(normalizedIdx);
          }
        }
        const list = await listUserTemplates();
        if (!cancelled) setUserTplList(list);
      } finally {
        if (!cancelled) setTplLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [addPanel.visible, addTab, tplIndex]);

  // 加载后端维护的分类列表（供公共模板使用）
  React.useEffect(() => {
    if (!addPanel.visible || addTab !== "templates") return;
    let cancelled = false;
    (async () => {
      try {
        const cats = await fetchTemplateCategories();
        if (!cancelled && Array.isArray(cats) && cats.length) {
          setBuiltinCategories(cats);
          return;
        }
        // 如果后端没有返回分类或为空，从 tplIndex 推断分类
        if (!cancelled) {
          const fromTpl = (tplIndex || [])
            .map((t) => t.category)
            .filter(Boolean) as string[];
          const uniq = Array.from(new Set(fromTpl));
          if (uniq.length) {
            setBuiltinCategories(uniq);
          } else {
            setBuiltinCategories(["其他"]);
          }
        }
      } catch (e) {
        // 若请求失败（例如未认证），也从 tplIndex 推断
        if (!cancelled) {
          const fromTpl = (tplIndex || [])
            .map((t) => t.category)
            .filter(Boolean) as string[];
          const uniq = Array.from(new Set(fromTpl));
          if (uniq.length) {
            setBuiltinCategories(uniq);
          } else {
            setBuiltinCategories(["其他"]);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [addPanel.visible, addTab, tplIndex]);

  // 捕获原生点击，通过自定义检测实现双击（300ms 间隔），仅在真正空白 Pane 区域触发；排除 AI 对话框及其保护带
  React.useEffect(() => {
    const DOUBLE_CLICK_INTERVAL = 300; // 双击时间间隔（毫秒）
    const DOUBLE_CLICK_DISTANCE = 10; // 允许的最大移动距离（像素）

    const onNativeClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX,
        y = e.clientY;
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom)
        return;

      // 若事件来源路径中包含受保护元素（AI 对话框等），直接忽略
      try {
        const path = (e.composedPath && e.composedPath()) || [];
        for (const n of path) {
          if (
            n &&
            (n as any).closest &&
            (n as HTMLElement).closest?.("[data-prevent-add-panel]")
          ) {
            return;
          }
          if (
            n instanceof HTMLElement &&
            n.getAttribute &&
            n.getAttribute("data-prevent-add-panel") !== null
          ) {
            return;
          }
        }
      } catch {}

      // 若在屏蔽元素或其外侧保护带内，忽略
      try {
        const shield = 24;
        const preventEls = Array.from(
          document.querySelectorAll("[data-prevent-add-panel]")
        ) as HTMLElement[];
        for (const el of preventEls) {
          const r = el.getBoundingClientRect();
          if (
            x >= r.left - shield &&
            x <= r.right + shield &&
            y >= r.top - shield &&
            y <= r.bottom + shield
          ) {
            return;
          }
        }
      } catch {}

      // 自定义双击检测
      const now = Date.now();
      const last = lastGlobalClickRef.current;

      if (
        last &&
        now - last.t < DOUBLE_CLICK_INTERVAL &&
        Math.hypot(x - last.x, y - last.y) < DOUBLE_CLICK_DISTANCE
      ) {
        // 检测到双击
        if (isBlankArea(x, y)) {
          e.stopPropagation();
          e.preventDefault();
          openAddPanelAt(x, y, {
            tab: "nodes",
            allowedTabs: ["nodes", "beta", "custom"],
          });
        }
        // 重置记录，避免连续三次点击被识别为两次双击
        lastGlobalClickRef.current = null;
      } else {
        // 更新点击记录
        lastGlobalClickRef.current = { t: now, x, y };
      }
    };

    window.addEventListener("click", onNativeClick, true);
    return () => window.removeEventListener("click", onNativeClick, true);
  }, [openAddPanelAt, isBlankArea]);

  // 🔥 备选方案：监听原生 dblclick 事件，解决自定义双击检测在某些模式下失效的问题
  React.useEffect(() => {
    const onNativeDblClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX,
        y = e.clientY;
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom)
        return;

      // 检查是否在受保护元素内（AI 对话框等）
      try {
        const path = (e.composedPath && e.composedPath()) || [];
        for (const n of path) {
          if (
            n instanceof HTMLElement &&
            n.closest?.("[data-prevent-add-panel]")
          ) {
            return;
          }
        }
      } catch {}

      // 检查是否在屏蔽元素或其外侧保护带内
      try {
        const shield = 24;
        const preventEls = Array.from(
          document.querySelectorAll("[data-prevent-add-panel]")
        ) as HTMLElement[];
        for (const el of preventEls) {
          const r = el.getBoundingClientRect();
          if (
            x >= r.left - shield &&
            x <= r.right + shield &&
            y >= r.top - shield &&
            y <= r.bottom + shield
          ) {
            return;
          }
        }
      } catch {}

      if (isBlankArea(x, y)) {
        e.stopPropagation();
        e.preventDefault();
        openAddPanelAt(x, y, {
          tab: "nodes",
          allowedTabs: ["nodes", "beta", "custom"],
        });
      }
    };

    window.addEventListener("dblclick", onNativeDblClick, true);
    return () => window.removeEventListener("dblclick", onNativeDblClick, true);
  }, [openAddPanelAt, isBlankArea]);

  const createNodeAtWorldCenter = React.useCallback(
    (
      type:
        | "textPrompt"
        | "textPromptPro"
        | "textChat"
        | "textNote"
        | "promptOptimize"
        | "image"
        | "imagePro"
        | "generate"
        | "generatePro"
        | "generatePro4"
        | "generate4"
        | "generateRef"
        | "three"
        | "camera"
        | "analysis"
        | "sora2Video"
        | "wan26"
        | "wan2R2V"
        | "klingVideo"
        | "viduVideo"
        | "doubaoVideo"
        | "storyboardSplit"
        | "midjourney"
        | "video"
        | "videoAnalyze"
        | "videoFrameExtract"
        | "imageGrid"
        | "imageSplit",
      world: { x: number; y: number }
    ) => {
      // 以默认尺寸中心对齐放置
      const size = {
        textPrompt: { w: 240, h: 180 },
        textPromptPro: { w: 420, h: 360 },
        textNote: { w: 220, h: 140 },
        textChat: { w: 320, h: 540 },
        promptOptimize: { w: 360, h: 300 },
        image: { w: 260, h: 240 },
        imagePro: { w: 320, h: 240 },
        generate: { w: 260, h: 200 },
        generatePro: { w: 320, h: 400 },
        generatePro4: { w: 380, h: 480 },
        generate4: { w: 300, h: 240 },
        generateRef: { w: 260, h: 240 },
        three: { w: 280, h: 260 },
        camera: { w: 260, h: 220 },
        analysis: { w: 260, h: 280 },
        sora2Video: { w: 280, h: 260 },
        wan26: { w: 300, h: 320 },
        wan2R2V: { w: 300, h: 360 },
        klingVideo: { w: 280, h: 260 },
        viduVideo: { w: 280, h: 260 },
        doubaoVideo: { w: 280, h: 260 },
        storyboardSplit: { w: 320, h: 400 },
        midjourney: { w: 280, h: 320 },
        video: { w: 320, h: 280 },
        videoAnalyze: { w: 280, h: 360 },
        videoFrameExtract: { w: 300, h: 420 },
        imageGrid: { w: 300, h: 380 },
        imageSplit: { w: 320, h: 400 },
      }[type];
      const id = `${type}_${Date.now()}`;
      const pos = { x: world.x - size.w / 2, y: world.y - size.h / 2 };
      const data =
        type === "textPrompt"
          ? { text: "", boxW: size.w, boxH: size.h, title: "Prompt" }
          : type === "textPromptPro"
          ? {
              prompts: [""],
              text: "",
              textMode: "raw",
              boxW: size.w,
              boxH: size.h,
            }
          : type === "textNote"
          ? { text: "", boxW: size.w, boxH: size.h }
          : type === "textChat"
          ? {
              status: "idle" as const,
              manualInput: "",
              responseText: "",
              enableWebSearch: false,
              boxW: size.w,
              boxH: size.h,
            }
          : type === "promptOptimize"
          ? { text: "", expandedText: "", boxW: size.w, boxH: size.h }
          : type === "image"
          ? { imageData: undefined, boxW: size.w, boxH: size.h }
          : type === "imagePro"
          ? { imageData: undefined, imageWidth: 296 }
          : type === "generate"
          ? {
              status: "idle" as const,
              boxW: size.w,
              boxH: size.h,
              presetPrompt: "",
            }
          : type === "generatePro"
          ? {
              status: "idle" as const,
              boxW: size.w,
              boxH: size.h,
              prompts: [""],
            }
          : type === "generatePro4"
          ? {
              status: "idle" as const,
              images: [],
              boxW: size.w,
              boxH: size.h,
              prompts: [""],
            }
          : type === "generate4"
          ? {
              status: "idle" as const,
              images: [],
              count: 4,
              boxW: size.w,
              boxH: size.h,
            }
          : type === "generateRef"
          ? {
              status: "idle" as const,
              referencePrompt: undefined,
              boxW: size.w,
              boxH: size.h,
            }
          : type === "analysis"
          ? {
              status: "idle" as const,
              prompt: "",
              analysisPrompt: undefined,
              boxW: size.w,
              boxH: size.h,
            }
          : type === "sora2Video"
          ? {
              status: "idle" as const,
              videoUrl: undefined,
              thumbnail: undefined,
              videoQuality: DEFAULT_SORA2_VIDEO_QUALITY,
              videoVersion: 0,
              history: [],
              clipDuration: undefined,
              aspectRatio: undefined,
              boxW: size.w,
              boxH: size.h,
            }
          : type === "wan26"
          ? {
              status: "idle" as const,
              videoUrl: undefined,
              thumbnail: undefined,
              size: undefined,
              resolution: "720P",
              duration: 5,
              shotType: "single",
              audioUrl: undefined,
              videoVersion: 0,
              history: [],
              boxW: size.w,
              boxH: size.h,
            }
          : type === "wan2R2V"
          ? {
              status: "idle" as const,
              videoUrl: undefined,
              thumbnail: undefined,
              size: "16:9",
              duration: 5,
              shotType: "single",
              videoVersion: 0,
              history: [],
              boxW: size.w,
              boxH: size.h,
            }
          : type === "storyboardSplit"
          ? {
              status: "idle" as const,
              inputText: "",
              segments: [],
              outputCount: 9,
              boxW: size.w,
              boxH: size.h,
            }
          : type === "midjourney"
          ? {
              status: "idle" as const,
              mode: "FAST",
              presetPrompt: "",
              boxW: size.w,
              boxH: size.h,
            }
          : type === "video"
          ? {
              status: "idle" as const,
              videoUrl: undefined,
              videoName: undefined,
              mimeType: undefined,
              boxW: size.w,
              boxH: size.h,
            }
          : type === "videoAnalyze"
          ? {
              status: "idle" as const,
              videoUrl: undefined,
              prompt: "",
              analysisPrompt: undefined,
              text: "",
              boxW: size.w,
              boxH: size.h,
            }
          : type === "videoFrameExtract"
          ? {
              status: "idle" as const,
              videoUrl: undefined,
              intervalSeconds: 3,
              frames: [],
              totalFrames: 0,
              outputMode: "all" as const,
              boxW: size.w,
              boxH: size.h,
            }
          : type === "imageGrid"
          ? {
              status: "idle" as const,
              images: [],
              outputImage: undefined,
              backgroundColor: "#ffffff",
              padding: 0,
              boxW: size.w,
              boxH: size.h,
            }
          : type === "imageSplit"
          ? {
              status: "idle" as const,
              splitImages: [],
              outputCount: 9,
              boxW: size.w,
              boxH: size.h,
            }
          : type === "klingVideo" ||
            type === "viduVideo" ||
            type === "doubaoVideo"
          ? {
              status: "idle" as const,
              videoUrl: undefined,
              thumbnail: undefined,
              videoVersion: 0,
              history: [],
              clipDuration: undefined,
              aspectRatio: undefined,
              provider:
                type === "klingVideo"
                  ? "kling"
                  : type === "viduVideo"
                  ? "vidu"
                  : "doubao",
              // Vidu 专用参数
              resolution: type === "viduVideo" ? ("720p" as const) : undefined,
              style: type === "viduVideo" ? ("general" as const) : undefined,
              offPeak: type === "viduVideo" ? false : undefined,
              // 豆包专用参数
              camerafixed: type === "doubaoVideo" ? false : undefined,
              watermark: type === "doubaoVideo" ? false : undefined,
              boxW: size.w,
              boxH: size.h,
            }
          : { boxW: size.w, boxH: size.h };
      setNodes((ns) => ns.concat([{ id, type, position: pos, data } as any]));
      try {
        historyService.commit("flow-add-node").catch(() => {});
      } catch {}
      setAddPanel((v) => ({ ...v, visible: false }));
      return id;
    },
    [setNodes]
  );

  const textSourceTypes = React.useMemo(
    () => [
      "textPrompt",
      "textPromptPro",
      "textChat",
      "promptOptimize",
      "analysis",
      "videoAnalyze",
      "textNote",
      "storyboardSplit",
      "generatePro",
      "generatePro4",
    ],
    []
  );
  const TEXT_PROMPT_MAX_CONNECTIONS = 20;
  const isTextHandle = React.useCallback(
    (handle?: string | null) =>
      typeof handle === "string" && handle.startsWith("text"),
    []
  );

  // 辅助函数：检查是否为图片相关的 handle（兼容 "image" 和 "img"）
  const isImageHandle = React.useCallback(
    (handle?: string | null): boolean => {
      if (!handle) return false;
      return handle === "image" || handle === "img";
    },
    []
  );

  const appendSora2History = React.useCallback(
    (
      history: Sora2VideoHistoryItem[] | undefined,
      entry: Sora2VideoHistoryItem
    ): Sora2VideoHistoryItem[] => {
      const base = Array.isArray(history) ? history : [];
      const deduped = base.filter((item) => item.videoUrl !== entry.videoUrl);
      return [entry, ...deduped].slice(0, SORA2_HISTORY_LIMIT);
    },
    []
  );

  // 允许 TextPrompt -> Generate(text); Image/Generate(img) -> Generate(img)
  const isValidConnection = React.useCallback(
    (connection: Connection) => {
      const { source, target, targetHandle, sourceHandle } = connection;
      if (!source || !target || !targetHandle) return false;
      if (source === target) return false;

      const sourceNode = rf.getNode(source);
      const targetNode = rf.getNode(target);
      if (!sourceNode || !targetNode) return false;

      // 检查是否为有效的图片源节点
      const isImageSource = (
        node: typeof sourceNode,
        handle?: string | null
      ) => {
        const imageNodeTypes = [
          "image",
          "imagePro",
          "generate",
          "generate4",
          "generatePro",
          "generatePro4",
          "generateRef",
          "three",
          "camera",
          "imageGrid",
          "imageSplit",
          "midjourney",
        ];
        if (imageNodeTypes.includes(node.type || "")) return true;
        // videoFrameExtract 的 image 句柄输出单张图片
        if (node.type === "videoFrameExtract" && handle === "image")
          return true;
        return false;
      };

      // 允许连接到 Generate / Generate4 / GenerateRef / Image / PromptOptimizer
      if (targetNode.type === "generateRef") {
        if (targetHandle === "text")
          return textSourceTypes.includes(sourceNode.type || "");
        if (targetHandle === "image1" || targetHandle === "refer")
          return isImageSource(sourceNode, sourceHandle);
        if (targetHandle === "image2" || targetHandle === "img")
          return isImageSource(sourceNode, sourceHandle);
        return false;
      }
      if (
        targetNode.type === "generate" ||
        targetNode.type === "generate4" ||
        targetNode.type === "generatePro" ||
        targetNode.type === "generatePro4"
      ) {
        if (targetHandle === "text")
          return textSourceTypes.includes(sourceNode.type || "");
        if (targetHandle === "img")
          return isImageSource(sourceNode, sourceHandle);
        return false;
      }
      if (targetNode.type === "sora2Video") {
        if (isImageHandle(targetHandle)) {
          return isImageSource(sourceNode, sourceHandle);
        }
        if (targetHandle === "text") {
          return textSourceTypes.includes(sourceNode.type || "");
        }
        return false;
      }

      if (targetNode.type === "wan26") {
        if (targetHandle === "text") {
          return textSourceTypes.includes(sourceNode.type || "");
        }
        if (isImageHandle(targetHandle)) {
          return isImageSource(sourceNode, sourceHandle);
        }
        return false;
      }

      if (targetNode.type === "wan2R2V") {
        if (targetHandle === "text") {
          return textSourceTypes.includes(sourceNode.type || "");
        }
        if (
          targetHandle === "video-1" ||
          targetHandle === "video-2" ||
          targetHandle === "video-3"
        ) {
          if (sourceHandle !== "video") return false;
          return [
            "video", // 上传视频
            "sora2Video",
            "wan2R2V",
            "wan26",
            "klingVideo",
            "viduVideo",
            "doubaoVideo",
          ].includes(sourceNode.type || "");
        }
        return false;
      }

      if (
        ["klingVideo", "viduVideo", "doubaoVideo"].includes(
          targetNode.type || ""
        )
      ) {
        if (isImageHandle(targetHandle)) {
          return isImageSource(sourceNode, sourceHandle);
        }
        if (targetHandle === "text") {
          return textSourceTypes.includes(sourceNode.type || "");
        }
        return false;
      }

      // Midjourney 节点连接验证
      if (targetNode.type === "midjourney") {
        if (targetHandle === "text") {
          return textSourceTypes.includes(sourceNode.type || "");
        }
        if (targetHandle === "img") {
          // midjourney 也可以作为图片源
          if (sourceNode.type === "midjourney") return true;
          return isImageSource(sourceNode, sourceHandle);
        }
        return false;
      }

      if (targetNode.type === "image") {
        if (targetHandle === "img")
          return isImageSource(sourceNode, sourceHandle);
        return false;
      }
      if (targetNode.type === "imagePro") {
        if (targetHandle === "img")
          return isImageSource(sourceNode, sourceHandle);
        return false;
      }
      if (targetNode.type === "promptOptimize") {
        if (isTextHandle(targetHandle))
          return textSourceTypes.includes(sourceNode.type || "");
        return false;
      }
      if (targetNode.type === "textPrompt") {
        if (isTextHandle(targetHandle))
          return textSourceTypes.includes(sourceNode.type || "");
        return false;
      }
      if (targetNode.type === "textPromptPro") {
        if (isTextHandle(targetHandle))
          return textSourceTypes.includes(sourceNode.type || "");
        return false;
      }
      if (targetNode.type === "analysis") {
        if (targetHandle === "img")
          return isImageSource(sourceNode, sourceHandle);
        return false;
      }
      if (targetNode.type === "videoAnalyze") {
        if (targetHandle === "video")
          return [
            "video", // 上传视频
            "sora2Video",
            "klingVideo",
            "viduVideo",
            "doubaoVideo",
            "wan26",
            "wan2R2V",
          ].includes(sourceNode.type || "");
        return false;
      }
      if (targetNode.type === "videoFrameExtract") {
        if (targetHandle === "video") {
          // Accept video inputs from any video-producing node types (uploads and provider nodes)
          const allowedVideoSourceTypes = [
            "video", // uploaded/local video node
            "sora2Video",
            "wan26",
            "wan2R2V",
            "klingVideo",
            "viduVideo",
            "doubaoVideo",
            "genericVideo",
            "seedanceVideo",
          ];
          return allowedVideoSourceTypes.includes(sourceNode.type || "");
        }
        return false;
      }
      if (targetNode.type === "imageGrid") {
        if (targetHandle === "images") {
          // videoFrameExtract 支持单帧/多帧输出
          if (sourceNode.type === "videoFrameExtract") {
            return (
              sourceHandle === "image" ||
              sourceHandle === "images" ||
              sourceHandle === "images-range"
            );
          }
          // imageSplit 输出为 image1..imageN
          if (sourceNode.type === "imageSplit") {
            return (
              typeof sourceHandle === "string" &&
              /^image\d+$/.test(sourceHandle)
            );
          }
          return [
            "image",
            "imagePro",
            "camera",
            "three",
            "generate",
            "generate4",
            "generateRef",
            "generatePro",
            "generatePro4",
            "midjourney",
            "imageGrid",
          ].includes(sourceNode.type || "");
        }
        return false;
      }
      if (targetNode.type === "imageSplit") {
        if (targetHandle === "img") {
          return isImageSource(sourceNode, sourceHandle);
        }
        return false;
      }
      if (targetNode.type === "textChat") {
        if (isTextHandle(targetHandle))
          return textSourceTypes.includes(sourceNode.type || "");
        return false;
      }
      if (targetNode.type === "textNote") {
        if (isTextHandle(targetHandle))
          return textSourceTypes.includes(sourceNode.type || "");
        return false;
      }
      if (targetNode.type === "storyboardSplit") {
        if (isTextHandle(targetHandle))
          return textSourceTypes.includes(sourceNode.type || "");
        return false;
      }
      return false;
    },
    [rf, isTextHandle, isImageHandle, textSourceTypes]
  );

  // 限制：Generate(text) 仅一个连接；Generate(img) 最多6条
  const canAcceptConnection = React.useCallback(
    (params: Connection) => {
      if (!params.target || !params.targetHandle) return false;
      const targetNode = rf.getNode(params.target);
      const currentEdges = rf.getEdges();
      const incoming = currentEdges.filter(
        (e) =>
          e.target === params.target && e.targetHandle === params.targetHandle
      );
      if (
        targetNode?.type === "generate" ||
        targetNode?.type === "generate4" ||
        targetNode?.type === "generatePro" ||
        targetNode?.type === "generatePro4"
      ) {
        if (params.targetHandle === "text") return true; // 允许连接，新线会替换旧线
        if (params.targetHandle === "img") return incoming.length < 6;
      }
      if (targetNode?.type === "generateRef") {
        const handle = params.targetHandle;
        if (handle === "text") return true;
        if (handle === "image1" || handle === "refer") return true;
        if (handle === "image2" || handle === "img") return true;
      }
      if (targetNode?.type === "image") {
        if (params.targetHandle === "img") return true; // 允许连接，新线会替换旧线
      }
      if (targetNode?.type === "imagePro") {
        if (params.targetHandle === "img") return true; // 允许连接，新线会替换旧线
      }
      if (targetNode?.type === "promptOptimize") {
        if (isTextHandle(params.targetHandle)) return true; // 仅一条连接，后续替换
      }
      if (targetNode?.type === "textPrompt") {
        if (isTextHandle(params.targetHandle))
          return incoming.length < TEXT_PROMPT_MAX_CONNECTIONS;
      }
      if (targetNode?.type === "textPromptPro") {
        if (isTextHandle(params.targetHandle))
          return incoming.length < TEXT_PROMPT_MAX_CONNECTIONS;
      }
      if (targetNode?.type === "textNote") {
        if (isTextHandle(params.targetHandle)) return true;
      }
      if (targetNode?.type === "sora2Video") {
        // 类型校验由 isValidConnection 负责；这里仅做容量/替换策略控制
        if (isImageHandle(params.targetHandle)) return true;
        if (params.targetHandle === "text") return true;
      }
      if (targetNode?.type === "wan26") {
        if (params.targetHandle === "text") return true; // 新线会替换旧线
        if (isImageHandle(params.targetHandle)) return true; // 新线会替换旧线
      }
      if (targetNode?.type === "wan2R2V") {
        if (params.targetHandle === "text") return true; // 新线会替换旧线
        if (params.targetHandle.startsWith("video-")) return true; // 每个 video-* 句柄最多一个，onConnect 会替换
      }
      // Vidu 视频节点：支持最多 7 张参考图
      if (targetNode?.type === "viduVideo") {
        if (params.targetHandle === "image") {
          return incoming.length < VIDU_MAX_REFERENCE_IMAGES;
        }
        if (params.targetHandle === "text") return true;
      }
      // Kling 视频节点：支持最多 4 张参考图
      if (targetNode?.type === "klingVideo") {
        if (params.targetHandle === "image") {
          return incoming.length < KLING_MAX_REFERENCE_IMAGES;
        }
        if (params.targetHandle === "text") return true;
      }
      // Doubao 视频节点
      if (targetNode?.type === "doubaoVideo") {
        if (params.targetHandle === "image") return true;
        if (params.targetHandle === "text") return true;
      }
      // Midjourney 节点连接容量控制
      if (targetNode?.type === "midjourney") {
        if (params.targetHandle === "text") return true; // 新线会替换旧线
        if (params.targetHandle === "img") return incoming.length < 6; // 最多6张图片输入
      }
      if (targetNode?.type === "analysis") {
        if (params.targetHandle === "img") return true; // 仅一条连接，后续替换
      }
      if (targetNode?.type === "videoAnalyze") {
        if (params.targetHandle === "video") return true; // 仅一条视频连接
      }
      if (targetNode?.type === "videoFrameExtract") {
        if (params.targetHandle === "video") return true; // 仅一条视频连接
      }
      if (targetNode?.type === "imageGrid") {
        if (params.targetHandle === "images") return true; // 允许多条图片连接
      }
      if (targetNode?.type === "imageSplit") {
        if (params.targetHandle === "img") return true; // 仅一条图片连接
      }
      if (targetNode?.type === "textChat") {
        if (isTextHandle(params.targetHandle)) return true;
      }
      if (targetNode?.type === "storyboardSplit") {
        if (isTextHandle(params.targetHandle)) return true;
      }
      return false;
    },
    [rf, isTextHandle, isImageHandle]
  );

  const onConnect = React.useCallback(
    (params: Connection) => {
      if (!isValidConnection(params)) return;
      if (!canAcceptConnection(params)) return;

      setEdges((eds) => {
        let next = eds;
        const tgt = rf.getNode(params.target!);

        // 如果是连接到 Image(img)，先移除旧的输入线，再添加新线
        if (
          (tgt?.type === "image" ||
            tgt?.type === "imagePro" ||
            tgt?.type === "analysis") &&
          params.targetHandle === "img"
        ) {
          next = next.filter(
            (e) => !(e.target === params.target && e.targetHandle === "img")
          );
        }

        // 如果是连接到 videoAnalyze(video)，先移除旧的输入线，再添加新线
        if (tgt?.type === "videoAnalyze" && params.targetHandle === "video") {
          next = next.filter(
            (e) => !(e.target === params.target && e.targetHandle === "video")
          );
        }

        // 如果是连接到 videoFrameExtract(video)，先移除旧的输入线，再添加新线
        if (
          tgt?.type === "videoFrameExtract" &&
          params.targetHandle === "video"
        ) {
          next = next.filter(
            (e) => !(e.target === params.target && e.targetHandle === "video")
          );
        }

        // 如果是连接到 Generate(text) 或 PromptOptimize(text)，先移除旧的输入线，再添加新线
        // 注意：generatePro 和 generatePro4 允许多个 text 输入，不移除旧连接
        const singleTextInputTypes = [
          "generate",
          "generate4",
          "generateRef",
          "promptOptimize",
          "textNote",
          "sora2Video",
          "wan26",
          "wan2R2V",
          "storyboardSplit",
          "midjourney",
          "klingVideo",
          "viduVideo",
          "doubaoVideo",
        ];
        if (
          singleTextInputTypes.includes(tgt?.type || "") &&
          isTextHandle(params.targetHandle)
        ) {
          next = next.filter(
            (e) =>
              !(
                e.target === params.target &&
                e.targetHandle === params.targetHandle
              )
          );
        }
        // Vidu 视频节点：支持最多 7 张参考图
        if (tgt?.type === "viduVideo" && params.targetHandle === "image") {
          let remainingToDrop = Math.max(
            0,
            next.filter(
              (e) => e.target === params.target && e.targetHandle === "image"
            ).length -
              VIDU_MAX_REFERENCE_IMAGES +
              1 // +1 for the incoming edge
          );
          if (remainingToDrop > 0) {
            next = next.filter((e) => {
              if (remainingToDrop <= 0) return true;
              const isImageEdge =
                e.target === params.target && e.targetHandle === "image";
              if (isImageEdge) {
                remainingToDrop -= 1;
                return false;
              }
              return true;
            });
          }
        }
        // Kling 视频节点：支持最多 4 张参考图
        if (tgt?.type === "klingVideo" && params.targetHandle === "image") {
          let remainingToDrop = Math.max(
            0,
            next.filter(
              (e) => e.target === params.target && e.targetHandle === "image"
            ).length -
              KLING_MAX_REFERENCE_IMAGES +
              1 // +1 for the incoming edge
          );
          if (remainingToDrop > 0) {
            next = next.filter((e) => {
              if (remainingToDrop <= 0) return true;
              const isImageEdge =
                e.target === params.target && e.targetHandle === "image";
              if (isImageEdge) {
                remainingToDrop -= 1;
                return false;
              }
              return true;
            });
          }
        }
        // Sora2、Doubao 视频节点：限制参考图数量
        if (
          (tgt?.type === "sora2Video" || tgt?.type === "doubaoVideo") &&
          params.targetHandle === "image"
        ) {
          // 允许多条 image 连接，但限制总数；超过时移除最早的
          let remainingToDrop = Math.max(
            0,
            next.filter(
              (e) => e.target === params.target && isImageHandle(e.targetHandle)
            ).length -
              SORA2_MAX_REFERENCE_IMAGES +
              1 // +1 for the incoming edge
          );
          if (remainingToDrop > 0) {
            next = next.filter((e) => {
              if (remainingToDrop <= 0) return true;
              const isImageEdge =
                e.target === params.target && isImageHandle(e.targetHandle);
              if (isImageEdge) {
                remainingToDrop -= 1;
                return false;
              }
              return true;
            });
          }
        }
        // wan26 只允许单个 image 输入
        if (tgt?.type === "wan26" && isImageHandle(params.targetHandle)) {
          next = next.filter(
            (e) => !(e.target === params.target && isImageHandle(e.targetHandle))
          );
        }
        // wan2R2V: 每个 video-* 句柄只保留 1 条输入线
        if (
          tgt?.type === "wan2R2V" &&
          typeof params.targetHandle === "string" &&
          params.targetHandle.startsWith("video-")
        ) {
          next = next.filter(
            (e) =>
              !(
                e.target === params.target &&
                e.targetHandle === params.targetHandle
              )
          );
        }
        if (tgt?.type === "generateRef") {
          const image1Handles = ["image1", "refer"];
          const image2Handles = ["image2", "img"];
          if (
            params.targetHandle &&
            image1Handles.includes(params.targetHandle)
          ) {
            next = next.filter(
              (e) =>
                !(
                  e.target === params.target &&
                  image1Handles.includes(e.targetHandle || "")
                )
            );
          } else if (
            params.targetHandle &&
            image2Handles.includes(params.targetHandle)
          ) {
            next = next.filter(
              (e) =>
                !(
                  e.target === params.target &&
                  image2Handles.includes(e.targetHandle || "")
                )
            );
          }
        }
        const out = addEdge({ ...params, type: "default" }, next);
        return out;
      });
      try {
        historyService.commit("flow-connect").catch(() => {});
      } catch {}

      // 通知节点边已变化（用于刷新外部提示词预览等）
      // 使用 setTimeout 确保在 setEdges 状态更新后再触发
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("flow:edgesChange"));
      }, 0);

      // 若连接到 Image(img)，立即把源图像写入目标
      try {
        const target = rf.getNode(params.target!);
        if (
          (target?.type === "image" ||
            target?.type === "imagePro" ||
            target?.type === "analysis") &&
          params.targetHandle === "img" &&
          params.source
        ) {
          const src = rf.getNode(params.source);
          let img: string | undefined;
          let incomingImageName: string | undefined;
          let incomingThumbnail: string | undefined;
          if (src?.type === "generate4" || src?.type === "generatePro4") {
            const handle = (params as any).sourceHandle as string | undefined;
            const idx =
              handle && handle.startsWith("img")
                ? Math.max(0, Math.min(3, Number(handle.substring(3)) - 1))
                : 0;
            const imageUrls = (src.data as any)?.imageUrls as
              | string[]
              | undefined;
            const imgs = (src.data as any)?.images as string[] | undefined;
            img = imageUrls?.[idx] || imgs?.[idx];
            const thumbs = (src.data as any)?.thumbnails as
              | string[]
              | undefined;
            if (Array.isArray(thumbs)) {
              incomingThumbnail = thumbs[idx];
            }
            const imageNames = (src.data as any)?.imageNames as
              | string[]
              | undefined;
            if (Array.isArray(imageNames)) {
              incomingImageName = imageNames[idx];
            }
            if (!img) {
              // 回退到 imageData（若实现了镜像）
              img = (src.data as any)?.imageUrl || (src.data as any)?.imageData;
              incomingImageName =
                incomingImageName ?? (src.data as any)?.imageName;
              incomingThumbnail =
                incomingThumbnail ?? (src.data as any)?.thumbnail;
            }
          } else {
            img = (src?.data as any)?.imageUrl || (src?.data as any)?.imageData;
            incomingImageName = (src?.data as any)?.imageName;
            incomingThumbnail = (src?.data as any)?.thumbnail;
          }
          const normalizedIncomingName =
            typeof incomingImageName === "string"
              ? incomingImageName.trim()
              : "";
          const normalizedIncomingThumbnail =
            typeof incomingThumbnail === "string"
              ? incomingThumbnail.trim()
              : "";
          if (img) {
            const isLikelyRemoteImageRef = (value: string): boolean => {
              const trimmed = value?.trim?.() || "";
              if (!trimmed) return false;
              if (/^https?:\/\//i.test(trimmed)) return true;
              if (
                trimmed.startsWith("/api/assets/proxy") ||
                trimmed.startsWith("/assets/proxy")
              )
                return true;
              if (
                trimmed.startsWith("/") ||
                trimmed.startsWith("./") ||
                trimmed.startsWith("../")
              )
                return true;
              if (/^(templates|projects|uploads|videos)\//i.test(trimmed))
                return true;
              return false;
            };
            const safeIncomingThumbnail =
              normalizedIncomingThumbnail &&
              isLikelyRemoteImageRef(normalizedIncomingThumbnail)
                ? normalizedIncomingThumbnail
                : "";
            setNodes((ns) =>
              ns.map((n) => {
                if (n.id !== target.id) return n;
                const resetStatus =
                  target.type === "analysis"
                    ? { status: "idle", error: undefined, prompt: "", text: "" }
                    : {};
                const thumbPatch =
                  target.type === "image" || target.type === "imagePro"
                    ? { thumbnail: safeIncomingThumbnail || undefined }
                    : {};
                const imagePatch = isLikelyRemoteImageRef(img)
                  ? { imageUrl: img, imageData: undefined }
                  : { imageData: img };
                return {
                  ...n,
                  data: {
                    ...n.data,
                    ...imagePatch,
                    crop: undefined,
                    imageName: normalizedIncomingName || undefined,
                    ...thumbPatch,
                    ...resetStatus,
                  },
                };
              })
            );
          }
        }
      } catch {}
      setIsConnecting(false);
    },
    [
      isValidConnection,
      canAcceptConnection,
      setEdges,
      rf,
      setNodes,
      isTextHandle,
      setIsConnecting,
    ]
  );

  // 监听来自节点的本地数据写入（TextPrompt）
  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        id: string;
        patch: Record<string, any>;
      };
      if (!detail?.id) return;

      // 处理位置偏移（用于中心点缩放）
      const positionOffset = detail.patch?._positionOffset;

      let shouldAutoGenerateThumbnail = false;
      let thumbnailNodeId: string | null = null;
      let thumbnailSourceImageData: string | null = null;

      setNodes((ns) =>
        ns.map((n) => {
          if (n.id !== detail.id) return n;
          const patch = { ...(detail.patch || {}) };

          // 移除内部使用的 _positionOffset
          delete patch._positionOffset;

          if (
            Object.prototype.hasOwnProperty.call(patch, "imageData") &&
            !Object.prototype.hasOwnProperty.call(patch, "imageName")
          ) {
            patch.imageName = undefined;
          }
          // imageData 更新时一并清理 thumbnail，避免旧缩略图残留（且 thumbnail 不落库）
          if (Object.prototype.hasOwnProperty.call(patch, "imageData")) {
            patch.thumbnail = undefined;
          }
          // imageData 清空时一并清理 thumbnail，避免大字符串残留
          if (
            Object.prototype.hasOwnProperty.call(patch, "imageData") &&
            !patch.imageData
          ) {
            patch.thumbnail = undefined;
          }

          // 图片节点：若写入 imageData 但未提供 thumbnail，异步生成缩略图
          if (
            Object.prototype.hasOwnProperty.call(patch, "imageData") &&
            patch.imageData &&
            !Object.prototype.hasOwnProperty.call(patch, "thumbnail") &&
            (n.type === "image" || n.type === "imagePro") &&
            !(
              typeof patch.imageData === "string" &&
              patch.imageData.trim().startsWith(FLOW_IMAGE_ASSET_PREFIX)
            )
          ) {
            patch.thumbnail = undefined;
            shouldAutoGenerateThumbnail = true;
            thumbnailNodeId = n.id;
            thumbnailSourceImageData = patch.imageData;
          }

          // 如果有位置偏移，同时更新节点位置
          let newPosition = n.position;
          if (positionOffset) {
            newPosition = {
              x: n.position.x + positionOffset.x,
              y: n.position.y + positionOffset.y,
            };
          }

          return { ...n, position: newPosition, data: { ...n.data, ...patch } };
        })
      );

      if (
        shouldAutoGenerateThumbnail &&
        thumbnailNodeId &&
        thumbnailSourceImageData
      ) {
        void (async () => {
          const thumb = await createThumbnailDataUrl(
            thumbnailSourceImageData,
            256
          );
          if (!thumb) return;
          setNodes((ns) =>
            ns.map((n) => {
              if (n.id !== thumbnailNodeId) return n;
              const current = (n.data as any)?.imageData;
              if (current !== thumbnailSourceImageData) return n;
              return { ...n, data: { ...n.data, thumbnail: thumb } };
            })
          );
        })();
      }

      // 若目标是 Image 且设置了 imageData 为空，自动断开输入连线
      if (
        Object.prototype.hasOwnProperty.call(detail.patch, "imageData") &&
        !detail.patch.imageData
      ) {
        setEdges((eds) =>
          eds.filter(
            (e) => !(e.target === detail.id && e.targetHandle === "img")
          )
        );
      }
    };
    window.addEventListener("flow:updateNodeData", handler as EventListener);
    return () =>
      window.removeEventListener(
        "flow:updateNodeData",
        handler as EventListener
      );
  }, [setNodes]);

  // 监听节点右键菜单：复制（写入 Flow 内部剪贴板，Ctrl+V 可粘贴）
  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { nodeId?: string }
        | undefined;
      const allNodes = rf.getNodes();
      const targetNode = detail?.nodeId ? rf.getNode(detail.nodeId) : null;
      const selectedNodes = allNodes.filter((n: any) => n.selected);
      const nodesToCopy =
        targetNode && !targetNode.selected
          ? [targetNode]
          : selectedNodes.length
          ? selectedNodes
          : targetNode
          ? [targetNode]
          : [];

      if (!nodesToCopy.length) return;

      let hasCanvasPayload = false;
      try {
        const canvasPayload = buildCanvasClipboardFromFlowNodes(
          nodesToCopy as any
        );
        if (canvasPayload) {
          clipboardService.setCanvasData(canvasPayload);
          hasCanvasPayload = true;
        }
      } catch {}

      const idSet = new Set(nodesToCopy.map((n: any) => n.id));
      const nodeSnapshots = rfNodesToTplNodes(nodesToCopy as any);
      const relatedEdges = rf
        .getEdges()
        .filter(
          (edge: any) => idSet.has(edge.source) && idSet.has(edge.target)
        );
      const edgeSnapshots = rfEdgesToTplEdges(relatedEdges as any);
      const minX = Math.min(...nodesToCopy.map((n: any) => n.position?.x ?? 0));
      const minY = Math.min(...nodesToCopy.map((n: any) => n.position?.y ?? 0));

      clipboardService.setActiveZone("flow");
      clipboardService.setFlowData({
        nodes: nodeSnapshots,
        edges: edgeSnapshots,
        origin: { x: minX, y: minY },
      });

      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: {
            message: hasCanvasPayload
              ? "已复制节点：Flow Ctrl+V 粘贴，画板 Ctrl+V 可粘贴图片"
              : "已复制节点，按 Ctrl+V 粘贴",
            type: "success",
          },
        })
      );
    };

    window.addEventListener("flow:copyNode", handler as EventListener);
    return () =>
      window.removeEventListener("flow:copyNode", handler as EventListener);
  }, [
    rf,
    rfNodesToTplNodes,
    rfEdgesToTplEdges,
    buildCanvasClipboardFromFlowNodes,
  ]);

  // 监听节点右键菜单：删除
  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { nodeId?: string }
        | undefined;
      const allNodes = rf.getNodes();
      const targetNode = detail?.nodeId ? rf.getNode(detail.nodeId) : null;
      const selectedIds = new Set(
        allNodes.filter((n: any) => n.selected).map((n: any) => n.id)
      );
      const ids =
        targetNode && !targetNode.selected
          ? new Set([targetNode.id])
          : selectedIds.size
          ? selectedIds
          : detail?.nodeId
          ? new Set([detail.nodeId])
          : new Set<string>();
      if (!ids.size) return;

      setNodes((prev: any[]) => prev.filter((n: any) => !ids.has(n.id)));
      setEdges((prev: any[]) =>
        prev.filter((e: any) => !ids.has(e.source) && !ids.has(e.target))
      );
      try {
        historyService.commit("flow-delete-node").catch(() => {});
      } catch {}
    };
    window.addEventListener("flow:deleteNode", handler as EventListener);
    return () =>
      window.removeEventListener("flow:deleteNode", handler as EventListener);
  }, [rf, setNodes, setEdges]);

  // 监听节点右键菜单：复制节点（直接在画板上创建副本）
  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { nodeId?: string }
        | undefined;
      const targetNode = detail?.nodeId ? rf.getNode(detail.nodeId) : null;
      if (!targetNode) return;

      const OFFSET = 40;
      const newId = generateId(targetNode.type || "n");
      const data: any = sanitizeNodeData((targetNode.data as any) || {});

      const newNode = {
        id: newId,
        type: targetNode.type || "default",
        position: {
          x: (targetNode.position?.x ?? 0) + OFFSET,
          y: (targetNode.position?.y ?? 0) + OFFSET,
        },
        data,
        selected: true,
        width: targetNode.width,
        height: targetNode.height,
        style: targetNode.style ? { ...targetNode.style } : undefined,
      } as any;

      setNodes((prev: any[]) =>
        prev.map((node) => ({ ...node, selected: false })).concat([newNode])
      );
      try {
        historyService.commit("flow-duplicate-node").catch(() => {});
      } catch {}

      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: { message: "已复制节点", type: "success" },
        })
      );
    };
    window.addEventListener("flow:duplicateNode", handler as EventListener);
    return () =>
      window.removeEventListener(
        "flow:duplicateNode",
        handler as EventListener
      );
  }, [rf, setNodes, sanitizeNodeData]);

  // 监听节点右键菜单：添加到个人库（上传到 OSS 后写入 store）
  React.useEffect(() => {
    const normalizeSource = (value?: string): string | null => {
      const trimmed = value?.trim();
      if (!trimmed) return null;
      if (
        /^data:/i.test(trimmed) ||
        /^blob:/i.test(trimmed) ||
        /^https?:\/\//i.test(trimmed)
      )
        return trimmed;
      return `data:image/png;base64,${trimmed}`;
    };
    const sanitizeFileStem = (value: string): string =>
      value
        .trim()
        .replace(/[\\/:*?"<>|]+/g, "_")
        .slice(0, 80) || "image";

    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | {
            imageData?: string;
            nodeId?: string;
            nodeType?: string;
          }
        | undefined;
      const nodeId = detail?.nodeId;
      const node = nodeId ? rf.getNode(nodeId) : null;
      const rawImageData = detail?.imageData ?? (node?.data as any)?.imageData;
      const source = normalizeSource(rawImageData);
      if (!source) return;

      const nameCandidate =
        (node?.data as any)?.imageName ||
        (node?.data as any)?.label ||
        (node?.data as any)?.title ||
        "";
      const displayName =
        typeof nameCandidate === "string" && nameCandidate.trim()
          ? nameCandidate.trim()
          : `节点资源 ${new Date().toLocaleString("zh-CN", {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}`;
      const now = Date.now();
      const fileName = `${sanitizeFileStem(displayName)}_${now}.png`;

      void (async () => {
        try {
          let uploadedUrl: string | null = null;
          let uploadedMeta: {
            width?: number;
            height?: number;
            fileName?: string;
            contentType?: string;
          } | null = null;
          let fileSize: number | undefined;

          try {
            if (source.startsWith("data:")) {
              const uploadResult = await imageUploadService.uploadImageDataUrl(
                source,
                {
                  dir: "uploads/personal-library/images/",
                  fileName,
                }
              );
              if (uploadResult.success && uploadResult.asset?.url) {
                uploadedUrl = uploadResult.asset.url;
                uploadedMeta = {
                  width: uploadResult.asset.width,
                  height: uploadResult.asset.height,
                  fileName: uploadResult.asset.fileName ?? fileName,
                  contentType: uploadResult.asset.contentType ?? "image/png",
                };
              }
            } else {
              let credentials: RequestCredentials | undefined;
              if (source.startsWith("http")) {
                try {
                  const origin = new URL(source).origin;
                  credentials =
                    origin === window.location.origin ? "include" : "omit";
                } catch {
                  credentials = "omit";
                }
              }
              const response = await fetchWithAuth(source, {
                ...(credentials ? { credentials } : {}),
                auth: "omit",
                allowRefresh: false,
              });
              if (response.ok) {
                const blob = await responseToBlob(response);
                const file = new File([blob], fileName, {
                  type: blob.type || "image/png",
                });
                fileSize = file.size;
                const uploadResult = await imageUploadService.uploadImageFile(
                  file,
                  {
                    dir: "uploads/personal-library/images/",
                  }
                );
                if (uploadResult.success && uploadResult.asset?.url) {
                  uploadedUrl = uploadResult.asset.url;
                  uploadedMeta = {
                    width: uploadResult.asset.width,
                    height: uploadResult.asset.height,
                    fileName: uploadResult.asset.fileName ?? file.name,
                    contentType: uploadResult.asset.contentType ?? file.type,
                  };
                }
              }
            }
          } catch {
            // ignore, fallback below
          }

          const finalUrl =
            uploadedUrl || (source.startsWith("http") ? source : null);
          if (!finalUrl) {
            window.dispatchEvent(
              new CustomEvent("toast", {
                detail: { message: "添加到库失败，请重试", type: "error" },
              })
            );
            return;
          }

          const assetId = createPersonalAssetId("plimg");
          const imageAsset: PersonalImageAsset = {
            id: assetId,
            type: "2d",
            name: displayName,
            url: finalUrl,
            thumbnail: finalUrl,
            fileName: uploadedMeta?.fileName ?? fileName,
            fileSize,
            contentType: uploadedMeta?.contentType,
            width: uploadedMeta?.width,
            height: uploadedMeta?.height,
            createdAt: now,
            updatedAt: now,
          };

          addPersonalAsset(imageAsset);
          void personalLibraryApi.upsert(imageAsset).catch(() => {});

          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message: "已添加到个人库", type: "success" },
            })
          );
        } catch (error) {
          console.error("添加到库失败:", error);
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message: "添加到库失败，请重试", type: "error" },
            })
          );
        }
      })();
    };

    window.addEventListener("flow:addToLibrary", handler as EventListener);
    return () =>
      window.removeEventListener("flow:addToLibrary", handler as EventListener);
  }, [rf, addPersonalAsset]);

  // 监听双击输出节点创建新节点并连线
  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        sourceId: string;
        sourceHandle: string;
        targetHandle: string;
        nodeType: string;
        offsetX: number;
      };
      if (!detail?.sourceId || !detail?.nodeType) return;

      const sourceNode = rf.getNode(detail.sourceId);
      if (!sourceNode) return;

      // 创建新节点 ID
      const newId = `${detail.nodeType}_${Date.now()}`;

      // 计算新节点位置（在源节点右侧）
      const newPosition = {
        x: sourceNode.position.x + detail.offsetX,
        y: sourceNode.position.y,
      };

      // 根据节点类型创建默认数据
      const newData =
        detail.nodeType === "generatePro"
          ? { status: "idle" as const, prompts: [""], imageWidth: 296 }
          : { status: "idle" as const };

      // 添加新节点
      setNodes((ns) =>
        ns.concat([
          {
            id: newId,
            type: detail.nodeType,
            position: newPosition,
            data: newData,
            selected: true,
          } as any,
        ])
      );

      // 取消选中源节点，选中新节点
      setNodes((ns) =>
        ns.map((n) => ({
          ...n,
          selected: n.id === newId,
        }))
      );

      // 创建连线
      setEdges((eds) =>
        addEdge(
          {
            source: detail.sourceId,
            sourceHandle: detail.sourceHandle,
            target: newId,
            targetHandle: detail.targetHandle,
          },
          eds
        )
      );
    };
    window.addEventListener(
      "flow:duplicateAndConnect",
      handler as EventListener
    );
    return () =>
      window.removeEventListener(
        "flow:duplicateAndConnect",
        handler as EventListener
      );
  }, [rf, setNodes, setEdges]);

  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        imageData?: string;
        imageUrl?: string;
        label?: string;
        imageName?: string;
      };
      const imageUrlForNode =
        typeof detail?.imageUrl === "string" ? detail.imageUrl.trim() : "";
      const imageDataForNode =
        typeof detail?.imageData === "string" ? detail.imageData.trim() : "";
      if (!imageUrlForNode && !imageDataForNode) return;
      const normalizedImageName = detail.imageName?.trim();
      const rect = containerRef.current?.getBoundingClientRect();
      const screenPosition = {
        x: (rect?.width || window.innerWidth) / 2 + (Math.random() * 120 - 60),
        y:
          (rect?.height || window.innerHeight) / 2 +
          60 +
          (Math.random() * 80 - 40),
      };
      const position = rf.screenToFlowPosition(screenPosition);
      const id = `img_${Date.now()}`;
      setNodes((ns) =>
        ns.concat([
          {
            id,
            type: "image",
            position,
            data: {
              imageUrl: imageUrlForNode || undefined,
              imageData: imageUrlForNode ? undefined : imageDataForNode,
              label: detail.label || "Image",
              imageName: normalizedImageName || undefined,
              boxW: 260,
              boxH: 240,
            },
            selected: true,
          } as any,
        ])
      );

      // 已有远程 URL：无需再上传替换
      if (imageUrlForNode) {
        try {
          const projectId = useProjectContentStore.getState().projectId;
          const historyId = `${id}-${Date.now()}`;
          void recordImageHistoryEntry({
            id: historyId,
            remoteUrl: imageUrlForNode,
            title: normalizedImageName || "Flow Image",
            nodeId: id,
            nodeType: "image",
            fileName: `${normalizedImageName || `flow_image_${historyId}`}.png`,
            projectId,
            keepThumbnail: false,
          }).catch(() => {});
        } catch {}
        try {
          historyService
            .commit("flow-create-image-from-canvas")
            .catch(() => {});
        } catch {}
        return;
      }

      // 异步上传到 OSS：成功后用远程 URL 替换节点内的内联数据，避免写入项目 JSON/DB
      try {
        const projectId = useProjectContentStore.getState().projectId;
        const historyId = `${id}-${Date.now()}`;
        void recordImageHistoryEntry({
          id: historyId,
          base64: imageDataForNode,
          title: normalizedImageName || "Flow Image",
          nodeId: id,
          nodeType: "image",
          fileName: `${normalizedImageName || `flow_image_${historyId}`}.png`,
          projectId,
          keepThumbnail: false,
        })
          .then(({ remoteUrl }) => {
            if (!remoteUrl) return;
            setNodes((ns) =>
              ns.map((n) => {
                if (n.id !== id) return n;
                if ((n.data as any)?.imageData !== imageDataForNode) return n;
                return {
                  ...n,
                  data: {
                    ...n.data,
                    imageUrl: remoteUrl,
                    imageData: undefined,
                    thumbnail: undefined,
                  },
                };
              })
            );
          })
          .catch(() => {});
      } catch {}
      try {
        historyService.commit("flow-create-image-from-canvas").catch(() => {});
      } catch {}
    };
    window.addEventListener("flow:createImageNode", handler as EventListener);
    return () =>
      window.removeEventListener(
        "flow:createImageNode",
        handler as EventListener
      );
  }, [rf, setNodes]);

  // 监听 Midjourney Action 事件（U1-U4, V1-V4 等按钮操作）
  React.useEffect(() => {
    const handler = async (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        nodeId: string;
        taskId: string;
        customId: string;
        label?: string;
      };
      if (!detail?.nodeId || !detail?.taskId || !detail?.customId) return;

      const node = rf.getNode(detail.nodeId);
      if (!node || node.type !== "midjourney") return;

      // 设置节点为运行状态
      setNodes((ns) =>
        ns.map((n) =>
          n.id === detail.nodeId
            ? {
                ...n,
                data: { ...n.data, status: "running", error: undefined },
              }
            : n
        )
      );

      try {
        const result = await midjourneyActionViaAPI({
          taskId: detail.taskId,
          customId: detail.customId,
          actionLabel: detail.label,
        });

        if (!result.success || !result.data) {
          const msg = result.error?.message || "Midjourney 操作失败";
          setNodes((ns) =>
            ns.map((n) =>
              n.id === detail.nodeId
                ? {
                    ...n,
                    data: { ...n.data, status: "failed", error: msg },
                  }
                : n
            )
          );
          return;
        }

        const imgBase64 = result.data.imageData;
        const metadata = result.data.metadata || {};
        const midjourneyMeta = metadata.midjourney || {};
        const midjourneyImageUrl = midjourneyMeta.imageUrl || metadata.imageUrl;
        const normalizedMidjourneyUrl =
          typeof midjourneyImageUrl === "string"
            ? midjourneyImageUrl.trim()
            : "";
        const hasRemoteUrl = normalizedMidjourneyUrl.length > 0;
        const previewSource = hasRemoteUrl
          ? normalizedMidjourneyUrl
          : imgBase64;
        const historyId = previewSource
          ? `${detail.nodeId}-${Date.now()}`
          : undefined;

        // 更新节点数据
        setNodes((ns) =>
          ns.map((n) =>
            n.id === detail.nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    status: "succeeded",
                    imageData: hasRemoteUrl ? undefined : imgBase64,
                    error: undefined,
                    taskId: midjourneyMeta.taskId || detail.taskId,
                    buttons: midjourneyMeta.buttons,
                    imageUrl: hasRemoteUrl
                      ? normalizedMidjourneyUrl
                      : undefined,
                    promptEn: midjourneyMeta.promptEn,
                    lastHistoryId: historyId ?? (n.data as any)?.lastHistoryId,
                  },
                }
              : n
          )
        );

        // 生成缩略图
        if (historyId) {
          // 记录到历史（避免依赖节点渲染，onlyRenderVisibleElements 时也可记录）
          const projectId = useProjectContentStore.getState().projectId;
          void recordImageHistoryEntry({
            id: historyId,
            base64: hasRemoteUrl ? undefined : imgBase64,
            remoteUrl: hasRemoteUrl ? normalizedMidjourneyUrl : undefined,
            title: `Midjourney ${
              detail.label || "Action"
            } ${new Date().toLocaleTimeString()}`,
            nodeId: detail.nodeId,
            nodeType: "midjourney",
            fileName: `flow_midjourney_${historyId}.png`,
            projectId,
            keepThumbnail: false,
          })
            .then(({ remoteUrl }) => {
              if (!remoteUrl) return;
              if (hasRemoteUrl) return;
              setNodes((ns) =>
                ns.map((n) => {
                  if (n.id !== detail.nodeId) return n;
                  if ((n.data as any)?.imageData !== imgBase64) return n;
                  return {
                    ...n,
                    data: {
                      ...n.data,
                      imageUrl: remoteUrl,
                      imageData: undefined,
                      thumbnail: undefined,
                    },
                  };
                })
              );
            })
            .catch(() => {});
        }
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Midjourney 操作失败";
        setNodes((ns) =>
          ns.map((n) =>
            n.id === detail.nodeId
              ? {
                  ...n,
                  data: { ...n.data, status: "failed", error: msg },
                }
              : n
          )
        );
      }
    };

    window.addEventListener("flow:midjourneyAction", handler as EventListener);
    return () =>
      window.removeEventListener(
        "flow:midjourneyAction",
        handler as EventListener
      );
  }, [rf, setNodes]);

  // 运行：根据输入自动选择 生图/编辑/融合（支持 generate / generate4 / generateRef）
  const runNode = React.useCallback(
    async (nodeId: string) => {
      const node = rf.getNode(nodeId);
      if (!node) return;

      const currentEdges = rf.getEdges();

      const resolveImageData = (edge: Edge): string | undefined => {
        const srcNode = rf.getNode(edge.source);
        if (!srcNode) return undefined;
        const data = srcNode.data as any;

        if (srcNode.type === "generate4" || srcNode.type === "generatePro4") {
          const handle = (edge as any).sourceHandle as string | undefined;
          const idx = handle?.startsWith("img")
            ? Math.max(0, Math.min(3, Number(handle.substring(3)) - 1))
            : 0;
          const urls = Array.isArray(data?.imageUrls)
            ? (data.imageUrls as string[])
            : undefined;
          const imgs = Array.isArray(data?.images)
            ? (data.images as string[])
            : undefined;
          let img = urls?.[idx] || imgs?.[idx];
          if (
            !img &&
            typeof data?.imageData === "string" &&
            data.imageData.length
          ) {
            img = data.imageData;
          }
          if (
            !img &&
            typeof data?.imageUrl === "string" &&
            data.imageUrl.length
          ) {
            img = data.imageUrl;
          }
          return img;
        }

        if (typeof data?.imageData === "string") return data.imageData;
        if (typeof data?.imageUrl === "string") return data.imageUrl;
        return undefined;
      };

      const collectImages = (edgesToCollect: Edge[]) =>
        edgesToCollect
          .map(resolveImageData)
          .filter(
            (img): img is string => typeof img === "string" && img.length > 0
          );

      // 运行时图片输入归一化：
      // - 允许节点数据里是 URL/OSS key/flow-asset/base64
      // - 对后端 AI 接口：统一转换成 dataURL(base64) 再发送（避免后端不支持 URL）
      // - 对 ImageSplit：按 splitRects 动态裁切生成 dataURL（不落库）
      const toFetchableUrl = (value: string): string | null => {
        const trimmed = typeof value === "string" ? value.trim() : "";
        if (!trimmed) return null;

        if (
          /^data:/i.test(trimmed) ||
          /^blob:/i.test(trimmed) ||
          (typeof FLOW_IMAGE_ASSET_PREFIX === "string" &&
            trimmed.startsWith(FLOW_IMAGE_ASSET_PREFIX))
        ) {
          return trimmed;
        }

        if (
          trimmed.startsWith("/api/assets/proxy") ||
          trimmed.startsWith("/assets/proxy")
        ) {
          return proxifyRemoteAssetUrl(trimmed);
        }

        const withoutLeading = trimmed.replace(/^\/+/, "");
        if (/^(templates|projects|uploads|videos)\//i.test(withoutLeading)) {
          return proxifyRemoteAssetUrl(
            `/api/assets/proxy?key=${encodeURIComponent(withoutLeading)}`
          );
        }

        if (/^https?:\/\//i.test(trimmed)) return trimmed;

        if (
          trimmed.startsWith("/") ||
          trimmed.startsWith("./") ||
          trimmed.startsWith("../")
        ) {
          try {
            return new URL(trimmed, window.location.origin).toString();
          } catch {
            return null;
          }
        }

        return null;
      };

      const resolveImageValueToDataUrlForBackend = async (
        value?: string
      ): Promise<string | null> => {
        const trimmed = typeof value === "string" ? value.trim() : "";
        if (!trimmed) {
          console.warn("[resolveImageValueToDataUrlForBackend] 输入为空");
          return null;
        }

        console.log(`[resolveImageValueToDataUrlForBackend] 输入: ${trimmed.slice(0, 80)}...`);

        // 已经是 data URL，直接返回
        if (trimmed.startsWith("data:")) {
          console.log("[resolveImageValueToDataUrlForBackend] 已是 data URL");
          return trimmed;
        }

        // 优先处理 flow-asset: 引用 - 必须转换为 data URL
        if (trimmed.startsWith(FLOW_IMAGE_ASSET_PREFIX)) {
          console.log("[resolveImageValueToDataUrlForBackend] 检测到 flow-asset 引用，尝试转换...");
          const resolved = await resolveImageToDataUrl(trimmed, { preferProxy: true });
          if (resolved) {
            console.log(`[resolveImageValueToDataUrlForBackend] flow-asset 转换成功: ${resolved.slice(0, 50)}...`);
            return resolved;
          }
          console.warn("[resolveImageValueToDataUrlForBackend] flow-asset 转换失败");
          return null;
        }

        // 处理 blob: URL - 必须转换为 data URL
        if (trimmed.startsWith("blob:")) {
          console.log("[resolveImageValueToDataUrlForBackend] 检测到 blob URL，尝试转换...");
          const resolved = await resolveImageToDataUrl(trimmed, { preferProxy: true });
          if (resolved) {
            console.log(`[resolveImageValueToDataUrlForBackend] blob 转换成功: ${resolved.slice(0, 50)}...`);
            return resolved;
          }
          console.warn("[resolveImageValueToDataUrlForBackend] blob 转换失败");
          return null;
        }

        // 远程 URL - 可以直接返回（后端会处理）
        const normalizedRemote = normalizeStableRemoteUrl(trimmed);
        if (isRemoteUrl(normalizedRemote)) {
          console.log(`[resolveImageValueToDataUrlForBackend] 远程 URL: ${normalizedRemote}`);
          return normalizedRemote;
        }

        // 其他格式通过 toFetchableUrl 处理
        const fetchable = toFetchableUrl(trimmed);
        if (fetchable) {
          console.log(`[resolveImageValueToDataUrlForBackend] fetchable URL: ${fetchable.slice(0, 80)}...`);
          const resolved = await resolveImageToDataUrl(fetchable, {
            preferProxy: true,
          });
          if (resolved) {
            console.log(`[resolveImageValueToDataUrlForBackend] 转换成功: ${resolved.slice(0, 50)}...`);
            return resolved;
          }
          // 尝试直接 fetch
          if (
            fetchable.includes("/api/assets/proxy") ||
            fetchable.includes("/assets/proxy") ||
            fetchable.startsWith(window.location.origin)
          ) {
            try {
              const response = await fetchWithAuth(fetchable, {
                auth: "auto",
                allowRefresh: false,
              });
              if (!response.ok) {
                console.warn(`[resolveImageValueToDataUrlForBackend] fetch 失败: ${response.status}`);
                return null;
              }
              const blob = await responseToBlob(response);
              const dataUrl = await blobToDataUrl(blob);
              console.log(`[resolveImageValueToDataUrlForBackend] fetch 转换成功: ${dataUrl.slice(0, 50)}...`);
              return dataUrl;
            } catch (err) {
              console.warn("[resolveImageValueToDataUrlForBackend] fetch 异常:", err);
              return null;
            }
          }
          console.warn("[resolveImageValueToDataUrlForBackend] fetchable 转换失败");
          return null;
        }

        // 兜底：认为是裸 base64
        console.log("[resolveImageValueToDataUrlForBackend] 兜底处理为裸 base64");
        return ensureDataUrl(trimmed);
      };

      const cropImageToDataUrl = async (params: {
        baseRef: string;
        rect: { x: number; y: number; width: number; height: number };
        sourceWidth?: number;
        sourceHeight?: number;
      }): Promise<string | null> => {
        const baseRef = params.baseRef?.trim?.() || "";
        if (!baseRef) return null;

        const w = Math.max(1, Math.round(params.rect.width));
        const h = Math.max(1, Math.round(params.rect.height));
        if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
          return null;
        }

        // 目标输出尺寸：使用“源坐标系”的裁切尺寸，而不是解码后图片的像素尺寸
        // 否则当 baseRef 实际加载到的是缩略图（naturalW < sourceWidth）时，会把输出错误压缩成缩略图大小（例如 2048->400 导致 1024 变 200）。
        const MAX_OUTPUT_PIXELS = 32_000_000; // ~32MP，避免极端情况下创建超大画布导致内存峰值过高
        const outputScale =
          w * h > MAX_OUTPUT_PIXELS ? Math.sqrt(MAX_OUTPUT_PIXELS / (w * h)) : 1;
        const outW = Math.max(1, Math.floor(w * outputScale));
        const outH = Math.max(1, Math.floor(h * outputScale));

        const fetchable = toFetchableUrl(baseRef) || ensureDataUrl(baseRef);
        const blob = await resolveImageToBlob(fetchable, { preferProxy: true });
        if (!blob) return null;

        const makeCanvas = (cw: number, ch: number): any => {
          if (typeof OffscreenCanvas !== "undefined") {
            return new OffscreenCanvas(cw, ch);
          }
          const canvas = document.createElement("canvas");
          canvas.width = cw;
          canvas.height = ch;
          return canvas;
        };

        // 优先使用 ImageBitmap（更快且不受 CORS 影响，因为我们是 blob）
        if (typeof createImageBitmap === "function") {
          const bitmap = await createImageBitmapLimited(blob);
          try {
            const naturalW = bitmap.width;
            const naturalH = bitmap.height;
            if (!naturalW || !naturalH) return null;

            const srcW =
              typeof params.sourceWidth === "number" && params.sourceWidth > 0
                ? params.sourceWidth
                : naturalW;
            const srcH =
              typeof params.sourceHeight === "number" && params.sourceHeight > 0
                ? params.sourceHeight
                : naturalH;

	            const scaleX = srcW > 0 ? naturalW / srcW : 1;
	            const scaleY = srcH > 0 ? naturalH / srcH : 1;

	            // 对 source 坐标做整数化，减少边缘采样导致的“白边/透明边”伪影
	            const sx = Math.max(
	              0,
	              Math.min(naturalW - 1, Math.round(params.rect.x * scaleX))
	            );
	            const sy = Math.max(
	              0,
	              Math.min(naturalH - 1, Math.round(params.rect.y * scaleY))
	            );
	            const swRaw = Math.max(1, Math.round(params.rect.width * scaleX));
	            const shRaw = Math.max(1, Math.round(params.rect.height * scaleY));
	            const sw = Math.max(1, Math.min(naturalW - sx, swRaw));
	            const sh = Math.max(1, Math.min(naturalH - sy, shRaw));

            const canvas = makeCanvas(outW, outH);
            const ctx = canvas.getContext("2d");
            if (!ctx) return null;
            try {
              // 避免因小数坐标采样造成边缘“白边/透明边”伪影
              // @ts-ignore - 部分环境无此字段
              ctx.imageSmoothingEnabled = true;
            } catch {}
            ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, outW, outH);
            const outBlob = await canvasToBlob(canvas, { type: "image/png" });
            return await blobToDataUrl(outBlob);
          } finally {
            try {
              bitmap.close();
            } catch {}
          }
        }

        // 兼容性兜底：HTMLImageElement
        const objectUrl = URL.createObjectURL(blob);
        try {
          const img = new Image();
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error("图片解码失败"));
            img.src = objectUrl;
          });

          const naturalW = img.naturalWidth || img.width;
          const naturalH = img.naturalHeight || img.height;
          if (!naturalW || !naturalH) return null;

          const srcW =
            typeof params.sourceWidth === "number" && params.sourceWidth > 0
              ? params.sourceWidth
              : naturalW;
          const srcH =
            typeof params.sourceHeight === "number" && params.sourceHeight > 0
              ? params.sourceHeight
              : naturalH;

	          const scaleX = srcW > 0 ? naturalW / srcW : 1;
	          const scaleY = srcH > 0 ? naturalH / srcH : 1;

	          const sx = Math.max(
	            0,
	            Math.min(naturalW - 1, Math.round(params.rect.x * scaleX))
	          );
	          const sy = Math.max(
	            0,
	            Math.min(naturalH - 1, Math.round(params.rect.y * scaleY))
	          );
	          const swRaw = Math.max(1, Math.round(params.rect.width * scaleX));
	          const shRaw = Math.max(1, Math.round(params.rect.height * scaleY));
	          const sw = Math.max(1, Math.min(naturalW - sx, swRaw));
	          const sh = Math.max(1, Math.min(naturalH - sy, shRaw));

          const canvas = makeCanvas(outW, outH);
          const ctx = canvas.getContext("2d");
          if (!ctx) return null;
          try {
            // @ts-ignore - 部分环境无此字段
            ctx.imageSmoothingEnabled = true;
          } catch {}
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
          const outBlob = await canvasToBlob(canvas, { type: "image/png" });
          return await blobToDataUrl(outBlob);
        } finally {
          try {
            URL.revokeObjectURL(objectUrl);
          } catch {}
        }
      };

      const resolveNodeImageToDataUrl = async (
        node: RFNode,
        sourceHandle?: string | null,
        visited: Set<string> = new Set()
      ): Promise<string | null> => {
        if (!node || !node.id) {
          console.warn("[resolveNodeImageToDataUrl] 节点无效");
          return null;
        }
        if (visited.has(node.id)) {
          console.warn(`[resolveNodeImageToDataUrl] 循环引用: ${node.id}`);
          return null;
        }
        visited.add(node.id);

        const d = (node.data ?? {}) as any;
        const handle =
          typeof sourceHandle === "string" ? sourceHandle.trim() : "";

        console.log(`[resolveNodeImageToDataUrl] 节点: ${node.id}, 类型: ${node.type}, handle: ${handle}`);
        console.log(`[resolveNodeImageToDataUrl] 节点数据: imageData=${d.imageData?.slice?.(0, 50) || 'undefined'}, imageUrl=${d.imageUrl?.slice?.(0, 50) || 'undefined'}`);

        if (node.type === "imageSplit") {
          const base =
            (typeof d.inputImageUrl === "string" && d.inputImageUrl.trim()) ||
            (typeof d.inputImage === "string" && d.inputImage.trim()) ||
            "";

          const splitRects = Array.isArray(d.splitRects) ? d.splitRects : [];
          const match = handle ? /^image(\d+)$/.exec(handle) : null;
          const idx = match ? Math.max(0, Number(match[1]) - 1) : 0;

          const rect = splitRects?.[idx];
          const x = typeof rect?.x === "number" ? rect.x : Number(rect?.x ?? 0);
          const y = typeof rect?.y === "number" ? rect.y : Number(rect?.y ?? 0);
          const w =
            typeof rect?.width === "number"
              ? rect.width
              : Number(rect?.width ?? 0);
          const h =
            typeof rect?.height === "number"
              ? rect.height
              : Number(rect?.height ?? 0);

          if (
            base &&
            Number.isFinite(x) &&
            Number.isFinite(y) &&
            w > 0 &&
            h > 0
          ) {
            return await cropImageToDataUrl({
              baseRef: base,
              rect: { x, y, width: w, height: h },
              sourceWidth:
                typeof d.sourceWidth === "number" ? d.sourceWidth : undefined,
              sourceHeight:
                typeof d.sourceHeight === "number" ? d.sourceHeight : undefined,
            });
          }

          // legacy 兜底：有些历史数据可能仍保存了 splitImages
          const splitImages = Array.isArray(d.splitImages) ? d.splitImages : [];
          const legacy = splitImages?.[idx]?.imageData;
          if (typeof legacy === "string" && legacy.trim()) {
            return await resolveImageValueToDataUrlForBackend(legacy);
          }
          return null;
        }

        if (node.type === "imageGrid") {
          const out =
            typeof d.outputImage === "string" ? d.outputImage.trim() : "";
          return out ? await resolveImageValueToDataUrlForBackend(out) : null;
        }

        if (node.type === "videoFrameExtract" && handle === "image") {
          const frames = Array.isArray(d.frames) ? d.frames : [];
          const selectedFrameIndex = Number(d.selectedFrameIndex ?? 1);
          const idx = Math.max(0, selectedFrameIndex - 1);
          const frame = frames[idx];
          const value =
            (typeof frame?.imageUrl === "string" && frame.imageUrl.trim()) ||
            (typeof frame?.thumbnailDataUrl === "string" &&
              frame.thumbnailDataUrl.trim()) ||
            "";
          return value
            ? await resolveImageValueToDataUrlForBackend(value)
            : null;
        }

        if (node.type === "generate4" || node.type === "generatePro4") {
          const idx = handle?.startsWith("img")
            ? Math.max(0, Math.min(3, Number(handle.substring(3)) - 1))
            : 0;
          const urls = Array.isArray(d?.imageUrls)
            ? (d.imageUrls as string[])
            : [];
          const imgs = Array.isArray(d?.images) ? (d.images as string[]) : [];
          const thumbs = Array.isArray(d?.thumbnails)
            ? (d.thumbnails as string[])
            : [];
          const candidate =
            (typeof urls[idx] === "string" && urls[idx].trim()) ||
            (typeof imgs[idx] === "string" && imgs[idx].trim()) ||
            (typeof thumbs[idx] === "string" && thumbs[idx].trim()) ||
            (typeof d?.imageData === "string" && d.imageData.trim()) ||
            (typeof d?.imageUrl === "string" && d.imageUrl.trim()) ||
            "";
          return candidate
            ? await resolveImageValueToDataUrlForBackend(candidate)
            : null;
        }

        if (node.type === "image" || node.type === "imagePro") {
          const upstream = currentEdges.find(
            (e) => e.target === node.id && e.targetHandle === "img"
          );

          const crop = (d as any)?.crop as
            | {
                x?: unknown;
                y?: unknown;
                width?: unknown;
                height?: unknown;
                sourceWidth?: unknown;
                sourceHeight?: unknown;
              }
            | undefined;
          if (crop) {
            const x = typeof crop.x === "number" ? crop.x : Number(crop.x ?? 0);
            const y = typeof crop.y === "number" ? crop.y : Number(crop.y ?? 0);
            const w =
              typeof crop.width === "number"
                ? crop.width
                : Number(crop.width ?? 0);
            const h =
              typeof crop.height === "number"
                ? crop.height
                : Number(crop.height ?? 0);

            const sourceWidth =
              typeof crop.sourceWidth === "number"
                ? crop.sourceWidth
                : Number(crop.sourceWidth ?? 0);
            const sourceHeight =
              typeof crop.sourceHeight === "number"
                ? crop.sourceHeight
                : Number(crop.sourceHeight ?? 0);

            const baseRef =
              (typeof d.imageData === "string" && d.imageData.trim()) ||
              (typeof d.imageUrl === "string" && d.imageUrl.trim()) ||
              "";

            // 优先使用节点本地 baseRef；缺失时回溯上游连线作为裁切基底
            const base =
              baseRef ||
              (upstream
                ? await resolveNodeImageToDataUrl(
                    rf.getNode(upstream.source) as any,
                    (upstream as any).sourceHandle,
                    visited
                  )
                : "");

            if (
              base &&
              Number.isFinite(x) &&
              Number.isFinite(y) &&
              w > 0 &&
              h > 0
            ) {
              const cropped = await cropImageToDataUrl({
                baseRef: base,
                rect: { x, y, width: w, height: h },
                sourceWidth: sourceWidth > 0 ? sourceWidth : undefined,
                sourceHeight: sourceHeight > 0 ? sourceHeight : undefined,
              });
              if (cropped) return cropped;
            }
          }

          const directRef =
            (typeof d.imageData === "string" && d.imageData.trim()) ||
            (typeof d.imageUrl === "string" && d.imageUrl.trim()) ||
            (typeof d.thumbnail === "string" && d.thumbnail.trim()) ||
            "";
          if (directRef) {
            const resolved = await resolveImageValueToDataUrlForBackend(
              directRef
            );
            if (resolved) return resolved;
          }

          // Image/ImagePro 作为“显示节点”时，图片可能来自上游连线；优先向上追溯以匹配当前显示内容
          if (upstream) {
            const src = rf.getNode(upstream.source);
            if (src) {
              return await resolveNodeImageToDataUrl(
                src as any,
                (upstream as any).sourceHandle,
                visited
              );
            }
          }
        }

        const direct =
          (typeof d.imageData === "string" && d.imageData.trim()) ||
          (typeof d.imageUrl === "string" && d.imageUrl.trim()) ||
          "";
        if (direct) {
          return await resolveImageValueToDataUrlForBackend(direct);
        }

        return null;
      };

      const resolveEdgeImageToDataUrl = async (
        edge: Edge
      ): Promise<string | null> => {
        const srcNode = rf.getNode(edge.source);
        if (!srcNode) {
          console.warn(`[resolveEdgeImageToDataUrl] 源节点不存在: ${edge.source}`);
          return null;
        }
        const result = await resolveNodeImageToDataUrl(
          srcNode as any,
          (edge as any).sourceHandle,
          new Set()
        );
        console.log(`[resolveEdgeImageToDataUrl] 边 ${edge.source} -> ${edge.target}, 结果: ${result ? `${result.slice(0, 50)}...` : 'null'}`);
        return result;
      };

      const resolveEdgesAsDataUrls = async (
        edges: Edge[]
      ): Promise<string[]> => {
        console.log(`[resolveEdgesAsDataUrls] 开始解析 ${edges.length} 条边`);
        const out: string[] = [];
        for (const edge of edges) {
          try {
            const dataUrl = await resolveEdgeImageToDataUrl(edge);
            if (dataUrl) {
              out.push(dataUrl);
            } else {
              console.warn(`[resolveEdgesAsDataUrls] 边 ${edge.source} -> ${edge.target} 解析返回 null`);
            }
          } catch (err) {
            console.error(`[resolveEdgesAsDataUrls] 边 ${edge.source} -> ${edge.target} 解析失败:`, err);
          }
        }
        console.log(`[resolveEdgesAsDataUrls] 解析完成，成功 ${out.length}/${edges.length}`);
        return out;
      };
      const getTextPromptForNode = (targetId: string) => {
        const textEdge = currentEdges.find(
          (e) => e.target === targetId && e.targetHandle === "text"
        );
        if (!textEdge) return { text: "", hasEdge: false };
        const promptNode = rf.getNode(textEdge.source);
        if (!promptNode) return { text: "", hasEdge: true };
        const resolved = resolveTextFromSourceNode(
          promptNode,
          textEdge.sourceHandle
        );
        return { text: resolved?.trim() || "", hasEdge: true };
      };

      const getTextPromptsForNode = (targetId: string) => {
        const textEdges = currentEdges.filter(
          (e) => e.target === targetId && e.targetHandle === "text"
        );
        if (!textEdges.length) return { texts: [] as string[], hasEdge: false };

        const texts: string[] = [];
        for (const edge of textEdges) {
          const promptNode = rf.getNode(edge.source);
          if (!promptNode) continue;
          const resolved = resolveTextFromSourceNode(
            promptNode,
            edge.sourceHandle
          );
          const trimmed = resolved?.trim() || "";
          if (trimmed) texts.push(trimmed);
        }

        return { texts, hasEdge: true };
      };

      // Wan2.6 节点处理逻辑
      if (node.type === "wan26") {
        const projectId = useProjectContentStore.getState().projectId;
        const { text: promptText, hasEdge: hasText } =
          getTextPromptForNode(nodeId);
        if (!hasText) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "failed",
                      error: "缺少 TextPrompt 输入",
                    },
                  }
                : n
            )
          );
          return;
        }
        if (!promptText) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: { ...n.data, status: "failed", error: "提示词为空" },
                  }
                : n
            )
          );
          return;
        }

        // 检查是否有图片输入（判断 T2V 还是 I2V）
        const imageEdges = currentEdges
          .filter(
            (e) =>
              e.target === nodeId &&
              isImageHandle(e.targetHandle)
          )
          .slice(0, 1);
        const hasImageInput = imageEdges.length > 0;

        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: { ...n.data, status: "running", error: undefined },
                }
              : n
          )
        );

        try {
          let imgUrl: string | undefined = undefined;

          if (hasImageInput) {
            const imageDatas = await resolveEdgesAsDataUrls(imageEdges);
            if (!imageDatas.length) throw new Error("图片输入为空");
            for (const img of imageDatas) {
              const trimmed = typeof img === "string" ? img.trim() : "";
              if (!trimmed) continue;
              if (isRemoteUrl(trimmed)) {
                imgUrl = normalizeStableRemoteUrl(trimmed);
                continue;
              }
              const dataUrl = ensureDataUrl(trimmed);
              const uploaded = await uploadImageToOSS(dataUrl, projectId);
              if (!uploaded) throw new Error("图片上传失败");
              imgUrl = uploaded;
            }
          }

          const size = (node.data as any)?.size || "16:9";
          const resolution = (node.data as any)?.resolution || "720P";
          const duration = (node.data as any)?.duration || 5;
          const shotType = (node.data as any)?.shotType || "single";
          const audioUrl = (node.data as any)?.audioUrl;

          const result = await generateWan26ViaAPI({
            prompt: promptText,
            imgUrl: imgUrl,
            audioUrl: audioUrl,
            parameters: { size, resolution, duration, shot_type: shotType },
          });

          const extractVideoUrl = (obj: any): string | undefined => {
            if (!obj) return undefined;
            return (
              obj.videoUrl ||
              obj.video_url ||
              obj.output?.video_url ||
              (Array.isArray(obj.output) && obj.output[0]?.video_url) ||
              obj.raw?.output?.video_url ||
              obj.raw?.video_url ||
              undefined
            );
          };

          if (!result?.success) {
            throw new Error(result?.error?.message || "任务提交失败");
          }

          const videoUrl = extractVideoUrl(result.data);
          if (!videoUrl) {
            throw new Error("未返回视频地址");
          }
          const thumbnail = result.data?.thumbnail;
          const historyEntry = {
            id: `history-${Date.now()}`,
            videoUrl,
            thumbnail,
            prompt: promptText,
            quality: hasImageInput ? "I2V" : "T2V",
            createdAt: new Date().toISOString(),
          };

          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "succeeded",
                      videoUrl,
                      thumbnail,
                      error: undefined,
                      videoVersion:
                        Number((n.data as any).videoVersion || 0) + 1,
                      history: Array.isArray((n.data as any).history)
                        ? [historyEntry, ...(n.data as any).history]
                        : [historyEntry],
                    },
                  }
                : n
            )
          );
        } catch (error) {
          const msg = error instanceof Error ? error.message : "任务提交失败";
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, status: "failed", error: msg } }
                : n
            )
          );
        }
        return;
      }

      // Wan2.6 R2V 节点处理逻辑（参考视频生成视频）
      if (node.type === "wan2R2V") {
        const { text: promptText, hasEdge: hasText } =
          getTextPromptForNode(nodeId);
        if (!hasText) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "failed",
                      error: "缺少 TextPrompt 输入",
                    },
                  }
                : n
            )
          );
          return;
        }
        if (!promptText) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: { ...n.data, status: "failed", error: "提示词为空" },
                  }
                : n
            )
          );
          return;
        }

        const sanitizeMediaUrl = (url?: string | null) => {
          if (!url || typeof url !== "string") return undefined;
          const trimmed = url.trim();
          if (!trimmed) return undefined;
          const markdownSplit = trimmed.split("](");
          const candidate =
            markdownSplit.length > 1 ? markdownSplit[0] : trimmed;
          const spaceIdx = candidate.indexOf(" ");
          return spaceIdx > 0 ? candidate.slice(0, spaceIdx) : candidate;
        };

        const resolveVideoUrl = (edge: Edge): string | undefined => {
          const srcNode = rf.getNode(edge.source);
          if (!srcNode) return undefined;
          const data = (srcNode.data as any) || {};
          const direct =
            data.videoUrl ||
            data.video_url ||
            data.output?.video_url ||
            (Array.isArray(data.output)
              ? data.output[0]?.video_url
              : undefined) ||
            data.raw?.output?.video_url ||
            data.raw?.video_url;
          const fromHistory = Array.isArray(data.history)
            ? data.history[0]?.videoUrl
            : undefined;
          return sanitizeMediaUrl(direct) || sanitizeMediaUrl(fromHistory);
        };

        const videoEdges = currentEdges
          .filter(
            (e) =>
              e.target === nodeId &&
              typeof e.targetHandle === "string" &&
              e.targetHandle.startsWith("video-")
          )
          .sort((a, b) =>
            String(a.targetHandle).localeCompare(String(b.targetHandle))
          );
        if (!videoEdges.length) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "failed",
                      error: "缺少参考视频输入",
                    },
                  }
                : n
            )
          );
          return;
        }

        const referenceVideoUrls = videoEdges
          .map(resolveVideoUrl)
          .filter((v): v is string => typeof v === "string" && v.length > 0);
        if (!referenceVideoUrls.length) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "failed",
                      error: "参考视频为空",
                    },
                  }
                : n
            )
          );
          return;
        }

        const sizeMapping: Record<string, string> = {
          "16:9": "1280*720",
          "9:16": "720*1280",
          "1:1": "960*960",
          "4:3": "1088*832",
          "3:4": "832*1088",
        };
        const size = (node.data as any)?.size || "16:9";
        const duration = (node.data as any)?.duration || 5;
        const shotType = (node.data as any)?.shotType || "single";
        const mappedSize = sizeMapping[size] || size;

        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: { ...n.data, status: "running", error: undefined },
                }
              : n
          )
        );

        try {
          const result = await generateWan26R2VViaAPI({
            prompt: promptText,
            referenceVideoUrls,
            parameters: { size: mappedSize, duration, shot_type: shotType },
          });

          const extractVideoUrl = (obj: any): string | undefined => {
            if (!obj) return undefined;
            return (
              obj.videoUrl ||
              obj.video_url ||
              obj.output?.video_url ||
              (Array.isArray(obj.output) && obj.output[0]?.video_url) ||
              obj.raw?.output?.video_url ||
              obj.raw?.video_url ||
              undefined
            );
          };

          if (!result?.success) {
            throw new Error(result?.error?.message || "任务提交失败");
          }
          const videoUrl = extractVideoUrl(result.data);
          if (!videoUrl) {
            throw new Error("未返回视频地址");
          }

          const thumbnail = result.data?.thumbnail;
          const historyEntry = {
            id: `history-${Date.now()}`,
            videoUrl,
            thumbnail,
            prompt: promptText,
            quality: "R2V",
            createdAt: new Date().toISOString(),
            referenceCount: referenceVideoUrls.length,
          };

          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "succeeded",
                      videoUrl,
                      thumbnail,
                      error: undefined,
                      videoVersion:
                        Number((n.data as any).videoVersion || 0) + 1,
                      history: Array.isArray((n.data as any).history)
                        ? [historyEntry, ...(n.data as any).history]
                        : [historyEntry],
                    },
                  }
                : n
            )
          );
        } catch (error) {
          const msg = error instanceof Error ? error.message : "任务提交失败";
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, status: "failed", error: msg } }
                : n
            )
          );
        }
        return;
      }

      if (node.type === "sora2Video") {
        const projectId = useProjectContentStore.getState().projectId;
        const { text: promptText, hasEdge: hasText } =
          getTextPromptForNode(nodeId);
        if (!hasText) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "failed",
                      error: "缺少 TextPrompt 输入",
                    },
                  }
                : n
            )
          );
          return;
        }
        if (!promptText) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: { ...n.data, status: "failed", error: "提示词为空" },
                  }
                : n
            )
          );
          return;
        }

        const clipDuration =
          typeof (node.data as any)?.clipDuration === "number"
            ? (node.data as any).clipDuration
            : undefined;
        const aspectSetting =
          typeof (node.data as any)?.aspectRatio === "string"
            ? (node.data as any).aspectRatio
            : "";
        const provider = (node.data as any)?.provider || "sora2";
        const suffixPieces: string[] = [];
        if (clipDuration) suffixPieces.push(`${clipDuration}s`);
        if (aspectSetting) {
          suffixPieces.push(
            aspectSetting === "9:16" ? "竖屏 9:16" : "横屏 16:9"
          );
        }
        const finalPromptText = suffixPieces.length
          ? `${promptText} ${suffixPieces.join(" ")}`
          : promptText;

        const imageEdges = currentEdges
          .filter((e) => e.target === nodeId && e.targetHandle === "image")
          .slice(
            0,
            provider === "vidu"
              ? VIDU_MAX_REFERENCE_IMAGES
              : SORA2_MAX_REFERENCE_IMAGES
          );
        const referenceImages = await resolveEdgesAsDataUrls(imageEdges);

        const generationStartMs = Date.now();
        const referenceImageUrls: string[] = [];
        if (referenceImages.length) {
          try {
            for (const img of referenceImages) {
              const trimmed = typeof img === "string" ? img.trim() : "";
              if (!trimmed) continue;
              if (isRemoteUrl(trimmed)) {
                referenceImageUrls.push(normalizeStableRemoteUrl(trimmed));
                continue;
              }
              const dataUrl = ensureDataUrl(trimmed);
              const uploaded = await uploadImageToOSS(dataUrl, projectId);
              if (!uploaded) {
                setNodes((ns) =>
                  ns.map((n) =>
                    n.id === nodeId
                      ? {
                          ...n,
                          data: {
                            ...n.data,
                            status: "failed",
                            error: "参考图上传失败",
                          },
                        }
                      : n
                  )
                );
                return;
              }
              referenceImageUrls.push(uploaded);
            }
          } catch (error) {
            const msg =
              error instanceof Error ? error.message : "参考图上传失败";
            setNodes((ns) =>
              ns.map((n) =>
                n.id === nodeId
                  ? { ...n, data: { ...n.data, status: "failed", error: msg } }
                  : n
              )
            );
            return;
          }
        }

        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: { ...n.data, status: "running", error: undefined },
                }
              : n
          )
        );
        const videoQuality =
          (node.data as any)?.videoQuality === "sd"
            ? "sd"
            : DEFAULT_SORA2_VIDEO_QUALITY;

        // 仅将受支持的取值传给后端（避免非法值导致请求失败）
        const aspectRatioForAPI =
          aspectSetting === "16:9" || aspectSetting === "9:16"
            ? (aspectSetting as "16:9" | "9:16")
            : undefined;
        const durationSecondsForAPI =
          clipDuration === 10 || clipDuration === 15 || clipDuration === 25
            ? (clipDuration as 10 | 15 | 25)
            : undefined;

        try {
          console.log("🎬 [Flow] Sending Sora2 video request", {
            nodeId,
            quality: videoQuality,
            aspectRatio: aspectRatioForAPI,
            duration: durationSecondsForAPI,
            referenceCount: referenceImageUrls.length,
            promptPreview: finalPromptText.slice(0, 120),
          });
          const videoResult = await requestSora2VideoGeneration(
            finalPromptText,
            referenceImageUrls,
            {
              quality: videoQuality,
              aspectRatio: aspectRatioForAPI,
              durationSeconds: durationSecondsForAPI,
            }
          );
          console.log("✅ [Flow] Sora2 video response received", {
            nodeId,
            videoUrl: videoResult.videoUrl,
            thumbnail: videoResult.thumbnailUrl,
            status: videoResult.status,
            taskId: videoResult.taskId,
            referencedUrls: videoResult.referencedUrls?.length,
          });

          // 将视频上传到 OSS，获取持久化 URL
          const projectId = useProjectContentStore.getState().projectId;
          let persistedVideoUrl = videoResult.videoUrl;
          let persistedThumbnail = videoResult.thumbnailUrl;

          try {
            console.log("🎬 [Flow] Uploading Sora2 video to OSS...");
            const ossVideoUrl = await uploadVideoToOSS(videoResult.videoUrl, projectId);
            if (ossVideoUrl) {
              persistedVideoUrl = ossVideoUrl;
              console.log("✅ [Flow] Sora2 video uploaded to OSS:", ossVideoUrl);
            }
          } catch (uploadErr) {
            console.warn("⚠️ [Flow] Failed to upload video to OSS, using original URL", uploadErr);
          }

          setNodes((ns) =>
            ns.map((n) => {
              if (n.id !== nodeId) return n;
              const previousData = (n.data as any) || {};
              const nextThumbnail = persistedThumbnail || previousData.thumbnail;
              const elapsedSeconds = Math.max(
                1,
                Math.round((Date.now() - generationStartMs) / 1000)
              );
              const historyEntry: Sora2VideoHistoryItem = {
                id: `sora2-history-${Date.now()}`,
                videoUrl: persistedVideoUrl,
                thumbnail: nextThumbnail,
                prompt: finalPromptText,
                quality: videoQuality,
                createdAt: new Date().toISOString(),
                elapsedSeconds,
              };
              return {
                ...n,
                data: {
                  ...previousData,
                  status: "succeeded",
                  videoUrl: persistedVideoUrl,
                  thumbnail: nextThumbnail,
                  error: undefined,
                  fallbackMessage: (videoResult as any).fallbackMessage,
                  videoVersion: Number(previousData.videoVersion || 0) + 1,
                  history: appendSora2History(
                    previousData.history as Sora2VideoHistoryItem[] | undefined,
                    historyEntry
                  ),
                },
              };
            })
          );
        } catch (error) {
          console.warn("❌ [Flow] Sora2 video request failed", {
            nodeId,
            error: error instanceof Error ? error.message : String(error),
          });
          const msg = error instanceof Error ? error.message : "视频生成失败";
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, status: "failed", error: msg } }
                : n
            )
          );
        }
        return;
      }

      // 新的视频生成节点处理逻辑（可灵 Kling、Vidu、豆包 Seedance）
      const newVideoNodeTypes = ["klingVideo", "viduVideo", "doubaoVideo"];
      if (newVideoNodeTypes.includes(node.type || "")) {
        const projectId = useProjectContentStore.getState().projectId;
        const provider = (node.data as any)?.provider || "kling";

        // 先获取图片数量，判断是否需要 prompt
        const maxImages =
          provider === "vidu"
            ? VIDU_MAX_REFERENCE_IMAGES
            : provider === "kling"
            ? KLING_MAX_REFERENCE_IMAGES
            : SORA2_MAX_REFERENCE_IMAGES;

        const imageEdges = currentEdges
          .filter((e) => e.target === nodeId && e.targetHandle === "image")
          .slice(0, maxImages);
        const imageCount = imageEdges.length;

        // 获取 prompt
        const { text: promptText, hasEdge: hasText } =
          getTextPromptForNode(nodeId);

        // Vidu 智能模式判断逻辑：
        // - 0张图必须有prompt (text2video)
        // - 1-2张图：有prompt用reference2video，无prompt用img2video/start-end2video
        // - 3-7张图：使用reference2video（必须有prompt，无prompt时使用默认）
        let finalPrompt = promptText;

        if (provider === "vidu") {
          if (imageCount === 0 && !hasText) {
            // 0张图必须有prompt
            setNodes((ns) =>
              ns.map((n) =>
                n.id === nodeId
                  ? {
                      ...n,
                      data: {
                        ...n.data,
                        status: "failed",
                        error: "文生视频模式需要提供提示词",
                      },
                    }
                  : n
              )
            );
            return;
          }

          // 3-7张图且无prompt时，使用默认prompt
          if (imageCount >= 3 && !promptText) {
            finalPrompt = "基于图片生成视频";
          }
        } else if (provider === "kling") {
          // Kling 智能模式判断逻辑：
          // - 0张图必须有prompt (text2video)
          // - 1-2张图：可选prompt (image2video/image2video-tail)
          // - 3-4张图：使用multi-image2video（必须有prompt，无prompt时使用默认）
          if (imageCount === 0 && !hasText) {
            // 0张图必须有prompt
            setNodes((ns) =>
              ns.map((n) =>
                n.id === nodeId
                  ? {
                      ...n,
                      data: {
                        ...n.data,
                        status: "failed",
                        error: "文生视频模式需要提供提示词",
                      },
                    }
                  : n
              )
            );
            return;
          }

          // 3-4张图且无prompt时，使用默认prompt
          if (imageCount >= 3 && !promptText) {
            finalPrompt = "参考图片内容生成视频";
          }
        } else {
          // 其他 provider（doubao）必须有 prompt
          if (!hasText) {
            setNodes((ns) =>
              ns.map((n) =>
                n.id === nodeId
                  ? {
                      ...n,
                      data: {
                        ...n.data,
                        status: "failed",
                        error: "缺少 TextPrompt 输入",
                      },
                    }
                  : n
              )
            );
            return;
          }
          if (!promptText) {
            setNodes((ns) =>
              ns.map((n) =>
                n.id === nodeId
                  ? {
                      ...n,
                      data: { ...n.data, status: "failed", error: "提示词为空" },
                    }
                  : n
              )
            );
            return;
          }
        }

        const clipDuration =
          typeof (node.data as any)?.clipDuration === "number"
            ? (node.data as any).clipDuration
            : undefined;
        const aspectSetting =
          typeof (node.data as any)?.aspectRatio === "string"
            ? (node.data as any).aspectRatio
            : "";

        const referenceImages = await resolveEdgesAsDataUrls(imageEdges);

        console.log(`🎬 [VideoProvider] 解析后参考图数量: ${referenceImages.length}`);
        referenceImages.forEach((img, i) => {
          console.log(`🎬 [VideoProvider] 参考图${i + 1}: ${img?.slice(0, 60)}...`);
        });

        const generationStartMs = Date.now();
        const referenceImageUrls: string[] = [];
        if (referenceImages.length) {
          try {
            const fetchRemoteImageAsDataUrl = async (url: string) => {
              const fetchUrl = proxifyRemoteAssetUrl(url);
              const init: RequestInit =
                fetchUrl.startsWith("blob:") || fetchUrl.startsWith("data:")
                  ? {}
                  : { mode: "cors", credentials: "omit" };
              const response = await fetchWithAuth(fetchUrl, {
                ...init,
                auth: "omit",
                allowRefresh: false,
              });
              if (!response.ok) {
                throw new Error(`参考图拉取失败: ${response.status}`);
              }
              const blob = await responseToBlob(response);
              return await blobToDataUrl(blob);
            };

            for (const img of referenceImages) {
              const trimmed = typeof img === "string" ? img.trim() : "";
              if (!trimmed) continue;

              // 根据供应商处理图片格式
              if (provider === "vidu" || provider === "kling") {
                // Vidu 和 Kling 需要可访问的 URL，必须上传到 OSS
                if (isRemoteUrl(trimmed)) {
                  referenceImageUrls.push(normalizeStableRemoteUrl(trimmed));
                } else {
                  const dataUrl = ensureDataUrl(trimmed);
                  const uploaded = await uploadImageToOSS(dataUrl, projectId);
                  if (!uploaded) {
                    setNodes((ns) =>
                      ns.map((n) =>
                        n.id === nodeId
                          ? {
                              ...n,
                              data: {
                                ...n.data,
                                status: "failed",
                                error: "参考图上传失败",
                              },
                            }
                          : n
                      )
                    );
                    return;
                  }
                  referenceImageUrls.push(uploaded);
                }
              } else {
                // 其他供应商直接使用 Base64 Data URI
                if (isRemoteUrl(trimmed)) {
                  const dataUrl = await fetchRemoteImageAsDataUrl(trimmed);
                  referenceImageUrls.push(dataUrl);
                } else {
                  referenceImageUrls.push(ensureDataUrl(trimmed));
                }
              }
            }
          } catch (error) {
            const msg =
              error instanceof Error ? error.message : "参考图上传失败";
            setNodes((ns) =>
              ns.map((n) =>
                n.id === nodeId
                  ? { ...n, data: { ...n.data, status: "failed", error: msg } }
                  : n
              )
            );
            return;
          }
        }

        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: { ...n.data, status: "running", error: undefined },
                }
              : n
          )
        );

        // 根据供应商调整参数
        const aspectRatioForAPI = aspectSetting || undefined;

        // 不同供应商支持的时长不同
        let durationForAPI: number | undefined = undefined;
        if (clipDuration) {
          if (
            provider === "kling" &&
            (clipDuration === 5 || clipDuration === 10)
          ) {
            durationForAPI = clipDuration;
          } else if (
            provider === "vidu" &&
            clipDuration >= 1 &&
            clipDuration <= 10
          ) {
            durationForAPI = clipDuration;
          } else if (
            provider === "doubao" &&
            [3, 4, 5, 6, 8].includes(clipDuration)
          ) {
            durationForAPI = clipDuration;
          }
        }

        try {
          console.log("🎬 [Flow] Sending video request", {
            nodeId,
            provider,
            aspectRatio: aspectRatioForAPI,
            duration: durationForAPI,
            referenceCount: referenceImageUrls.length,
            promptPreview: finalPrompt?.slice(0, 120) || "(无提示词)",
          });

          // 调用对应供应商的 API
          const createResult = await generateVideoByProvider({
            prompt: finalPrompt,
            referenceImages:
              referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
            duration: durationForAPI,
            aspectRatio: aspectRatioForAPI,
            provider: provider as VideoProvider,
            resolution: (node.data as any)?.resolution,
            style: (node.data as any)?.style,
            offPeak: (node.data as any)?.offPeak,
            camerafixed: (node.data as any)?.camerafixed,
            watermark: (node.data as any)?.watermark,
          });

          console.log("✅ [Flow] Video task created", {
            nodeId,
            provider,
            taskId: createResult.taskId,
          });

          // 开始轮询查询任务状态
          const pollInterval = 5000; // 5秒
          const maxAttempts = 180; // 最多180次（15分钟）
          let attempts = 0;
          let pollTimer: number | undefined;

          const pollTask = async () => {
            attempts++;
            if (attempts > maxAttempts) {
              clearInterval(pollTimer);
              setNodes((ns) =>
                ns.map((n) =>
                  n.id === nodeId
                    ? {
                        ...n,
                        data: {
                          ...n.data,
                          status: "failed",
                          error: "任务查询超时",
                        },
                      }
                    : n
                )
              );
              return;
            }

            try {
              const queryResult = await queryVideoTask(
                provider as VideoProvider,
                createResult.taskId
              );

              if (
                queryResult.status === "succeeded" ||
                queryResult.status === "SUCCESS" ||
                queryResult.status === "succeed"
              ) {
                clearInterval(pollTimer);
                const elapsedSeconds = Math.max(
                  1,
                  Math.round((Date.now() - generationStartMs) / 1000)
                );
                const historyEntry = {
                  id: `video-history-${Date.now()}`,
                  videoUrl: queryResult.videoUrl,
                  thumbnail: queryResult.thumbnailUrl,
                  prompt: promptText,
                  createdAt: new Date().toISOString(),
                  elapsedSeconds,
                };
                setNodes((ns) =>
                  ns.map((n) => {
                    if (n.id !== nodeId) return n;
                    const previousData = (n.data as any) || {};
                    return {
                      ...n,
                      data: {
                        ...previousData,
                        status: "succeeded",
                        videoUrl: queryResult.videoUrl,
                        thumbnail: queryResult.thumbnailUrl,
                        error: undefined,
                        videoVersion:
                          Number(previousData.videoVersion || 0) + 1,
                        history: Array.isArray(previousData.history)
                          ? [historyEntry, ...previousData.history]
                          : [historyEntry],
                      },
                    };
                  })
                );
              } else if (
                queryResult.status === "failed" ||
                queryResult.status === "FAILURE"
              ) {
                clearInterval(pollTimer);
                setNodes((ns) =>
                  ns.map((n) =>
                    n.id === nodeId
                      ? {
                          ...n,
                          data: {
                            ...n.data,
                            status: "failed",
                            error: (queryResult as any).error || "任务生成失败",
                          },
                        }
                      : n
                  )
                );
              }
              // 其他状态继续轮询
            } catch (error) {
              console.warn("❌ [Flow] Task query failed", {
                nodeId,
                provider,
                attempt: attempts,
                error: error instanceof Error ? error.message : String(error),
              });
              // 继续轮询，不中断
            }
          };

          // 开始轮询
          pollTimer = window.setInterval(pollTask, pollInterval);
          // 立即执行一次
          pollTask();
        } catch (error) {
          console.warn("❌ [Flow] Video request failed", {
            nodeId,
            provider,
            error: error instanceof Error ? error.message : String(error),
          });
          const msg = error instanceof Error ? error.message : "视频生成失败";
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, status: "failed", error: msg } }
                : n
            )
          );
        }
        return;
      }

      // Midjourney 节点处理逻辑
      if (node.type === "midjourney") {
        const { text: promptText, hasEdge: hasText } =
          getTextPromptForNode(nodeId);
        if (!hasText) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "failed",
                      error: "缺少 TextPrompt 输入",
                    },
                  }
                : n
            )
          );
          return;
        }
        if (!promptText) {
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: { ...n.data, status: "failed", error: "提示词为空" },
                  }
                : n
            )
          );
          return;
        }

        // 获取预设提示词
        const presetPrompt =
          typeof (node.data as any)?.presetPrompt === "string"
            ? (node.data as any).presetPrompt.trim()
            : "";
        const finalPrompt = presetPrompt
          ? `${presetPrompt} ${promptText}`
          : promptText;

        // 获取模式和宽高比
        const mjMode = (node.data as any)?.mode || "FAST";
        const mjAspectRatio = (node.data as any)?.aspectRatio;

        // 检查是否有图片输入
        const mjImageEdges = currentEdges
          .filter((e) => e.target === nodeId && e.targetHandle === "img")
          .slice(0, 6);

        // MJ 优先使用 URL 格式，从源节点获取 imageUrl
        const mjImageUrls: string[] = [];
        for (const edge of mjImageEdges) {
          const srcNode = rf.getNode(edge.source);
          if (!srcNode) continue;
          const d = srcNode.data as any;
          // 优先使用 imageUrl（OSS URL），其次使用 imageData
          const url = d?.imageUrl || d?.thumbnail || "";
          console.log(`[MJ] 源节点 ${srcNode.id} 数据:`, { imageUrl: d?.imageUrl, thumbnail: d?.thumbnail, hasImageData: !!d?.imageData });
          if (url && url.startsWith("http")) {
            mjImageUrls.push(url);
          }
        }
        console.log(`[MJ] 获取到的 URL 数量: ${mjImageUrls.length}`, mjImageUrls);
        // 如果没有获取到 URL，回退到 base64
        const mjImageDatas = mjImageUrls.length > 0
          ? mjImageUrls
          : await resolveEdgesAsDataUrls(mjImageEdges);

        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: { ...n.data, status: "running", error: undefined },
                }
              : n
          )
        );

        try {
          let mjResult: {
            success: boolean;
            data?: any;
            error?: { message: string };
          };

          if (mjImageDatas.length === 0) {
            // 文生图 (Imagine)
            mjResult = await generateImageViaAPI({
              prompt: finalPrompt,
              outputFormat: "png",
              aiProvider: "midjourney",
              model: "midjourney-fast",
              aspectRatio: mjAspectRatio,
              providerOptions: {
                midjourney: { mode: mjMode },
              },
            });
          } else if (mjImageDatas.length === 1) {
            // 图生图：使用 imagine 接口 + base64Array
            mjResult = await generateImageViaAPI({
              prompt: finalPrompt,
              outputFormat: "png",
              aiProvider: "midjourney",
              model: "midjourney-fast",
              aspectRatio: mjAspectRatio,
              providerOptions: {
                midjourney: {
                  mode: mjMode,
                  base64Array: mjImageDatas,
                },
              },
            });
          } else {
            // 融图 (Blend)
            mjResult = await blendImagesViaAPI({
              prompt: finalPrompt,
              sourceImages: mjImageDatas.slice(0, 6),
              outputFormat: "png",
              aiProvider: "midjourney",
              model: "midjourney-fast",
              aspectRatio: mjAspectRatio,
              providerOptions: {
                midjourney: { mode: mjMode },
              },
            });
          }

          if (!mjResult.success || !mjResult.data) {
            const msg = mjResult.error?.message || "Midjourney 生成失败";
            setNodes((ns) =>
              ns.map((n) =>
                n.id === nodeId
                  ? { ...n, data: { ...n.data, status: "failed", error: msg } }
                  : n
              )
            );
            return;
          }

          const mjImgBase64 = mjResult.data.imageData;
          const mjMetadata = mjResult.data.metadata || {};
          const midjourneyMeta = mjMetadata.midjourney || {};
          const midjourneyImageUrl =
            midjourneyMeta.imageUrl || mjMetadata.imageUrl;
          const normalizedMidjourneyUrl =
            typeof midjourneyImageUrl === "string"
              ? midjourneyImageUrl.trim()
              : "";
          const hasRemoteUrl = normalizedMidjourneyUrl.length > 0;
          const previewSource = hasRemoteUrl
            ? normalizedMidjourneyUrl
            : mjImgBase64;
          const historyId = previewSource
            ? `${nodeId}-${Date.now()}`
            : undefined;

          // 更新节点数据
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      status: "succeeded",
                      imageData: hasRemoteUrl ? undefined : mjImgBase64,
                      error: undefined,
                      taskId: midjourneyMeta.taskId,
                      buttons: midjourneyMeta.buttons,
                      imageUrl: hasRemoteUrl
                        ? normalizedMidjourneyUrl
                        : undefined,
                      promptEn: midjourneyMeta.promptEn,
                      lastHistoryId:
                        historyId ?? (n.data as any)?.lastHistoryId,
                    },
                  }
                : n
            )
          );

          // 生成缩略图
          if (historyId) {
            const projectId = useProjectContentStore.getState().projectId;
            const actionLabel =
              mjImageDatas.length === 0
                ? "Imagine"
                : mjImageDatas.length === 1
                ? "Edit"
                : "Blend";
            void recordImageHistoryEntry({
              id: historyId,
              base64: hasRemoteUrl ? undefined : mjImgBase64,
              remoteUrl: hasRemoteUrl ? normalizedMidjourneyUrl : undefined,
              title: `Midjourney ${actionLabel} ${new Date().toLocaleTimeString()}`,
              nodeId,
              nodeType: "midjourney",
              fileName: `flow_midjourney_${historyId}.png`,
              projectId,
              keepThumbnail: false,
            })
              .then(({ remoteUrl }) => {
                if (!remoteUrl) return;
                if (hasRemoteUrl) return;
                const outs = rf.getEdges().filter((e) => e.source === nodeId);
                setNodes((ns) =>
                  ns.map((n) => {
                    // 更新当前 midjourney 节点自身
                    if (n.id === nodeId) {
                      if ((n.data as any)?.imageData !== mjImgBase64) return n;
                      return {
                        ...n,
                        data: {
                          ...n.data,
                          imageUrl: remoteUrl,
                          imageData: undefined,
                          thumbnail: undefined,
                        },
                      };
                    }
                    // 同步更新下游 Image 节点，避免把 base64 写入项目 JSON
                    if (
                      outs.some((e) => e.target === n.id) &&
                      n.type === "image"
                    ) {
                      if ((n.data as any)?.imageData !== mjImgBase64) return n;
                      return {
                        ...n,
                        data: {
                          ...n.data,
                          imageUrl: remoteUrl,
                          imageData: undefined,
                          thumbnail: undefined,
                        },
                      };
                    }
                    return n;
                  })
                );
              })
              .catch(() => {});
          }

          if (previewSource) {
            // 更新下游节点
            const mjOuts = rf.getEdges().filter((e) => e.source === nodeId);
            if (mjOuts.length) {
              setNodes((ns) =>
                ns.map((n) => {
                  const hits = mjOuts.filter((e) => e.target === n.id);
                  if (!hits.length) return n;
                  if (n.type === "image")
                    return {
                      ...n,
                      data: {
                        ...n.data,
                        ...(hasRemoteUrl
                          ? {
                              imageUrl: normalizedMidjourneyUrl,
                              imageData: undefined,
                            }
                          : { imageData: mjImgBase64 }),
                        thumbnail: undefined,
                      },
                    };
                  return n;
                })
              );
            }
          }
        } catch (error) {
          const msg =
            error instanceof Error ? error.message : "Midjourney 生成失败";
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, status: "failed", error: msg } }
                : n
            )
          );
        }
        return;
      }

      if (
        node.type !== "generate" &&
        node.type !== "generate4" &&
        node.type !== "generateRef" &&
        node.type !== "generatePro" &&
        node.type !== "generatePro4"
      )
        return;

      const { text: promptFromText, hasEdge: hasPromptEdge } =
        getTextPromptForNode(nodeId);
      const { texts: promptsFromTextEdges } = getTextPromptsForNode(nodeId);

      const failWithMessage = (message: string) => {
        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, status: "failed", error: message } }
              : n
          )
        );
      };

      let prompt = "";

      if (node.type === "generateRef") {
        const rawBase =
          typeof (node.data as any)?.referencePrompt === "string"
            ? (node.data as any).referencePrompt
            : "";
        const basePrompt = rawBase.trim().length
          ? rawBase.trim()
          : DEFAULT_REFERENCE_PROMPT;
        const pieces = [basePrompt, promptFromText.trim()].filter(Boolean);
        prompt = pieces.join("，").trim();
        if (!prompt.length) {
          failWithMessage("提示词为空");
          return;
        }
      } else if (node.type === "generatePro" || node.type === "generatePro4") {
        // GeneratePro / GeneratePro4: 合并本地 prompts 数组和外部提示词
        const localPrompts = (() => {
          const raw = (node.data as any)?.prompts;
          if (Array.isArray(raw)) {
            return raw
              .filter(
                (p: unknown) => typeof p === "string" && p.trim().length > 0
              )
              .map((p: string) => p.trim());
          }
          return [];
        })();
        const externalPrompts = promptsFromTextEdges;

        // 合并：外部提示词 + 本地提示词数组（依次叠加）
        const allPrompts = [...externalPrompts, ...localPrompts].filter(
          Boolean
        );
        prompt = allPrompts.join(" ").trim();

        if (!prompt.length) {
          failWithMessage("提示词为空（请输入本地提示词或连接外部提示词）");
          return;
        }
      } else {
        if (!hasPromptEdge) {
          failWithMessage("缺少 TextPrompt 输入");
          return;
        }
        prompt = promptFromText.trim();
        if (!prompt.length) {
          failWithMessage("提示词为空");
          return;
        }
      }

      if (node.type === "generate") {
        const preset = (() => {
          const raw = (node.data as any)?.presetPrompt;
          return typeof raw === "string" ? raw.trim() : "";
        })();
        if (preset) {
          prompt = `${preset} ${prompt}`.trim();
        }
      }

      let imageDatas: string[] = [];

      if (node.type === "generateRef") {
        const primaryEdges = currentEdges
          .filter(
            (e) =>
              e.target === nodeId &&
              ["image2", "img"].includes(e.targetHandle || "")
          )
          .slice(0, 1);
        const referEdges = currentEdges
          .filter(
            (e) =>
              e.target === nodeId &&
              ["image1", "refer"].includes(e.targetHandle || "")
          )
          .slice(0, 1);
        imageDatas = [
          ...(await resolveEdgesAsDataUrls(primaryEdges)),
          ...(await resolveEdgesAsDataUrls(referEdges)),
        ];
      } else {
        const imgEdges = currentEdges
          .filter((e) => e.target === nodeId && e.targetHandle === "img")
          .slice(0, 6);
        imageDatas = await resolveEdgesAsDataUrls(imgEdges);
      }

      console.log(`[Flow Debug] Node ${nodeId} (${node.type}) 准备运行:`, {
        prompt: prompt.substring(0, 50) + "...",
        imageDatasCount: imageDatas.length,
        imageDatas: imageDatas.map((img) => img?.substring(0, 50) + "..."),
        imgEdges: currentEdges
          .filter((e) => e.target === nodeId && e.targetHandle === "img")
          .map((e) => ({ source: e.source, handle: e.targetHandle })),
      });

      const aspectRatioValue = (() => {
        const raw = (node.data as any)?.aspectRatio;
        return typeof raw === "string" && raw.trim().length
          ? (raw.trim() as AIImageGenerateRequest["aspectRatio"])
          : undefined;
      })();

      // 优先使用节点本地的 imageSize，否则使用全局设置
      const nodeSizeValue = (() => {
        const raw = (node.data as any)?.imageSize;
        if (raw === "1K" || raw === "2K" || raw === "4K") return raw;
        return undefined;
      })();
      const effectiveImageSize = nodeSizeValue || imageSize || undefined;

      if (node.type === "generate4") {
        const total = Math.max(
          1,
          Math.min(4, Number((node.data as any)?.count) || 4)
        );
        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    status: "running",
                    error: undefined,
                    images: [],
                  },
                }
              : n
          )
        );
        const produced: string[] = [];
        const updateMultiGenerateProgress = (completedSlots: number) => {
          const ratio = Math.max(0, Math.min(1, completedSlots / total));
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: { ...n.data, images: [...produced] },
                  }
                : n
            )
          );
        };

        for (let i = 0; i < total; i++) {
          let generatedImage: string | undefined;
          try {
            let result: {
              success: boolean;
              data?: AIImageResult;
              error?: { message: string };
            };
            const remoteInputs = imageDatas.filter(isRemoteUrl);
            const hasOnlyRemote =
              imageDatas.length > 0 && remoteInputs.length === imageDatas.length;
            if (imageDatas.length === 0) {
              result = await generateImageViaAPI({
                prompt,
                outputFormat: "png",
                aiProvider,
                model: imageModel,
                aspectRatio: aspectRatioValue,
                imageSize: effectiveImageSize,
              });
            } else if (imageDatas.length === 1) {
              result = await editImageViaAPI({
                prompt,
                ...(hasOnlyRemote
                  ? { sourceImageUrl: imageDatas[0] }
                  : { sourceImage: imageDatas[0] }),
                outputFormat: "png",
                aiProvider,
                model: imageModel,
                aspectRatio: aspectRatioValue,
                imageSize: effectiveImageSize,
              });
            } else {
              result = await blendImagesViaAPI({
                prompt,
                ...(hasOnlyRemote
                  ? { sourceImageUrls: imageDatas.slice(0, 6) }
                  : { sourceImages: imageDatas.slice(0, 6) }),
                outputFormat: "png",
                aiProvider,
                model: imageModel,
                aspectRatio: aspectRatioValue,
                imageSize: effectiveImageSize,
              });
            }

            const generatedSrc =
              result.data?.imageUrl ||
              result.data?.metadata?.imageUrl ||
              result.data?.imageData;

            if (!result.success || !result.data || !generatedSrc) {
              if (result.success && result.data && !generatedSrc) {
                console.warn(
                  "⚠️ Flow generate4 success but no image returned",
                  {
                    nodeId,
                    slot: i,
                    aiProvider,
                    model: imageModel,
                    prompt,
                    hasImage: !!generatedSrc,
                  }
                );
              }
            } else {
              generatedImage = generatedSrc;
            }
          } catch {
            // 忽略单张失败，继续下一张
          }

          if (generatedImage) {
            produced[i] = generatedImage;

            const outs = rf
              .getEdges()
              .filter(
                (e) =>
                  e.source === nodeId &&
                  (e as any).sourceHandle === `img${i + 1}`
              );
            if (outs.length) {
              const imgB64 = generatedImage;
              setNodes((ns) =>
                ns.map((n) => {
                  const hits = outs.filter((e) => e.target === n.id);
                  if (!hits.length) return n;
                  if (n.type === "image" && imgB64)
                    return {
                      ...n,
                      data: {
                        ...n.data,
                        imageData: imgB64,
                        thumbnail: undefined,
                      },
                    };
                  return n;
                })
              );
            }

            // 异步上传并写入远程 URL（避免 base64 落盘到项目 JSON/DB）
            try {
              const projectId = useProjectContentStore.getState().projectId;
              const slotIndex = i;
              const historyId = `${nodeId}-${slotIndex}-${Date.now()}`;
              void recordImageHistoryEntry({
                id: historyId,
                base64: generatedImage,
                title: `Generate4 #${
                  slotIndex + 1
                } ${new Date().toLocaleTimeString()}`,
                nodeId,
                nodeType: "generate",
                fileName: `flow_generate4_${historyId}.png`,
                projectId,
                keepThumbnail: false,
              })
                .then(({ remoteUrl }) => {
                  if (!remoteUrl) return;
                  const outEdges = rf
                    .getEdges()
                    .filter(
                      (e) =>
                        e.source === nodeId &&
                        (e as any).sourceHandle === `img${slotIndex + 1}`
                    );
                  setNodes((ns) =>
                    ns.map((n) => {
                      // 更新 generate4 节点本身：写入 imageUrls 并清理对应 images 槽位
                      if (n.id === nodeId) {
                        const prevUrls = Array.isArray(
                          (n.data as any)?.imageUrls
                        )
                          ? ([...(n.data as any).imageUrls] as string[])
                          : [];
                        prevUrls[slotIndex] = remoteUrl;
                        const prevImages = Array.isArray(
                          (n.data as any)?.images
                        )
                          ? ([...(n.data as any).images] as any[])
                          : [];
                        if (prevImages[slotIndex] === generatedImage) {
                          prevImages[slotIndex] = "";
                        }
                        return {
                          ...n,
                          data: {
                            ...n.data,
                            imageUrls: prevUrls,
                            images: prevImages,
                          },
                        };
                      }

                      // 更新下游 Image 节点：替换为远程 URL，清理 base64
                      if (
                        outEdges.some((e) => e.target === n.id) &&
                        n.type === "image" &&
                        (n.data as any)?.imageData === generatedImage
                      ) {
                        return {
                          ...n,
                          data: {
                            ...n.data,
                            imageUrl: remoteUrl,
                            imageData: undefined,
                            thumbnail: undefined,
                          },
                        };
                      }

                      return n;
                    })
                  );
                })
                .catch(() => {});
            } catch {}
          }

          updateMultiGenerateProgress(i + 1);
        }

        const hasAny = produced.filter(Boolean).length > 0;
        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    status: hasAny ? "succeeded" : "failed",
                    error: hasAny ? undefined : "全部生成失败",
                    images: [...produced],
                  },
                }
              : n
          )
        );

        return;
      }

      // 处理 generatePro4 节点：并发生成4张图片
      if (node.type === "generatePro4") {
        const total = 4;
        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    status: "running",
                    error: undefined,
                    images: [],
                  },
                }
              : n
          )
        );

        // 并发生成4张图片
        const generateSingleImage = async (
          index: number
        ): Promise<{ index: number; image?: string; error?: string }> => {
          try {
            let result: {
              success: boolean;
              data?: AIImageResult;
              error?: { message: string };
            };
            const remoteInputs = imageDatas.filter(isRemoteUrl);
            const hasOnlyRemote =
              imageDatas.length > 0 && remoteInputs.length === imageDatas.length;
            if (imageDatas.length === 0) {
              result = await generateImageViaAPI({
                prompt,
                outputFormat: "png",
                aiProvider,
                model: imageModel,
                aspectRatio: aspectRatioValue,
                imageSize: effectiveImageSize,
              });
            } else if (imageDatas.length === 1) {
              result = await editImageViaAPI({
                prompt,
                ...(hasOnlyRemote
                  ? { sourceImageUrl: imageDatas[0] }
                  : { sourceImage: imageDatas[0] }),
                outputFormat: "png",
                aiProvider,
                model: imageModel,
                aspectRatio: aspectRatioValue,
                imageSize: effectiveImageSize,
              });
            } else {
              result = await blendImagesViaAPI({
                prompt,
                ...(hasOnlyRemote
                  ? { sourceImageUrls: imageDatas.slice(0, 6) }
                  : { sourceImages: imageDatas.slice(0, 6) }),
                outputFormat: "png",
                aiProvider,
                model: imageModel,
                aspectRatio: aspectRatioValue,
                imageSize: effectiveImageSize,
              });
            }

            const generatedSrc =
              result.data?.imageUrl ||
              result.data?.metadata?.imageUrl ||
              result.data?.imageData;
            if (result.success && generatedSrc) {
              return { index, image: generatedSrc };
            }
            // 返回错误信息
            return { index, error: result.error?.message || "生成失败" };
          } catch (err) {
            console.error(
              `[generatePro4] Image ${index} generation error:`,
              err
            );
            return {
              index,
              error: err instanceof Error ? err.message : "生成异常",
            };
          }
        };

        // 创建4个并发任务
        const tasks = Array.from({ length: total }, (_, i) =>
          generateSingleImage(i)
        );
        const produced: string[] = new Array(total).fill("");
        const errors: string[] = [];

        // 使用 Promise.all 等待所有任务完成，同时监听每个完成的结果
        const results = await Promise.all(
          tasks.map(async (task) => {
            const result = await task;
            if (result.image) {
              produced[result.index] = result.image;

              // 更新UI显示已完成的图片
              setNodes((ns) =>
                ns.map((n) =>
                  n.id === nodeId
                    ? {
                        ...n,
                        data: { ...n.data, images: [...produced] },
                      }
                    : n
                )
              );

              // 更新连接的下游节点
              const outs = rf
                .getEdges()
                .filter(
                  (e) =>
                    e.source === nodeId &&
                    (e as any).sourceHandle === `img${result.index + 1}`
                );
              if (outs.length) {
                const imgB64 = result.image;
                setNodes((ns) =>
                  ns.map((n) => {
                    const hits = outs.filter((e) => e.target === n.id);
                    if (!hits.length) return n;
                    if (n.type === "image" && imgB64)
                      return {
                        ...n,
                        data: {
                          ...n.data,
                          imageData: imgB64,
                          thumbnail: undefined,
                        },
                      };
                    return n;
                  })
                );
              }

              // 异步上传并写入远程 URL（避免 base64 落盘到项目 JSON/DB）
              try {
                const projectId = useProjectContentStore.getState().projectId;
                const slotIndex = result.index;
                const base64 = result.image;
                const historyId = `${nodeId}-${slotIndex}-${Date.now()}`;
                void recordImageHistoryEntry({
                  id: historyId,
                  base64,
                  title: `GeneratePro4 #${
                    slotIndex + 1
                  } ${new Date().toLocaleTimeString()}`,
                  nodeId,
                  nodeType: "generatePro4",
                  fileName: `flow_generatepro4_${historyId}.png`,
                  projectId,
                  keepThumbnail: false,
                })
                  .then(({ remoteUrl }) => {
                    if (!remoteUrl) return;
                    const outEdges = rf
                      .getEdges()
                      .filter(
                        (e) =>
                          e.source === nodeId &&
                          (e as any).sourceHandle === `img${slotIndex + 1}`
                      );
                    setNodes((ns) =>
                      ns.map((n) => {
                        // 更新 generatePro4 节点本身：写入 imageUrls 并清理对应 images 槽位
                        if (n.id === nodeId) {
                          const prevUrls = Array.isArray(
                            (n.data as any)?.imageUrls
                          )
                            ? ([...(n.data as any).imageUrls] as string[])
                            : [];
                          prevUrls[slotIndex] = remoteUrl;
                          const prevImages = Array.isArray(
                            (n.data as any)?.images
                          )
                            ? ([...(n.data as any).images] as any[])
                            : [];
                          if (prevImages[slotIndex] === base64) {
                            prevImages[slotIndex] = "";
                          }
                          return {
                            ...n,
                            data: {
                              ...n.data,
                              imageUrls: prevUrls,
                              images: prevImages,
                            },
                          };
                        }

                        // 更新下游 Image 节点：替换为远程 URL，清理 base64
                        if (
                          outEdges.some((e) => e.target === n.id) &&
                          n.type === "image" &&
                          (n.data as any)?.imageData === base64
                        ) {
                          return {
                            ...n,
                            data: {
                              ...n.data,
                              imageUrl: remoteUrl,
                              imageData: undefined,
                              thumbnail: undefined,
                            },
                          };
                        }

                        return n;
                      })
                    );
                  })
                  .catch(() => {});
              } catch {}
            } else if (result.error) {
              errors.push(`图${result.index + 1}: ${result.error}`);
            }
            return result;
          })
        );

        const hasAny = produced.filter(Boolean).length > 0;
        const errorMsg = errors.length > 0 ? errors.join("; ") : "全部生成失败";
        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    status: hasAny ? "succeeded" : "failed",
                    error: hasAny ? undefined : errorMsg,
                    images: [...produced],
                  },
                }
              : n
          )
        );

        return;
      }

      setNodes((ns) =>
        ns.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, status: "running", error: undefined } }
            : n
        )
      );

      try {
        let result: {
          success: boolean;
          data?: AIImageResult;
          error?: { message: string };
        };

        const remoteInputs = imageDatas.filter(isRemoteUrl);
        const hasOnlyRemote =
          imageDatas.length > 0 && remoteInputs.length === imageDatas.length;
        if (imageDatas.length === 0) {
          result = await generateImageViaAPI({
            prompt,
            outputFormat: "png",
            aiProvider,
            model: imageModel,
            aspectRatio: aspectRatioValue,
            imageSize: effectiveImageSize,
          });
        } else if (imageDatas.length === 1) {
          result = await editImageViaAPI({
            prompt,
            ...(hasOnlyRemote
              ? { sourceImageUrl: imageDatas[0] }
              : { sourceImage: imageDatas[0] }),
            outputFormat: "png",
            aiProvider,
            model: imageModel,
            aspectRatio: aspectRatioValue,
            imageSize: effectiveImageSize,
          });
        } else {
          result = await blendImagesViaAPI({
            prompt,
            ...(hasOnlyRemote
              ? { sourceImageUrls: imageDatas.slice(0, 6) }
              : { sourceImages: imageDatas.slice(0, 6) }),
            outputFormat: "png",
            aiProvider,
            model: imageModel,
            aspectRatio: aspectRatioValue,
            imageSize: effectiveImageSize,
          });
        }

        if (!result.success || !result.data) {
          const msg = result.error?.message || "执行失败";
          setNodes((ns) =>
            ns.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, status: "failed", error: msg } }
                : n
            )
          );
          return;
        }

        const out = result.data;
        const imgBase64 =
          out.imageUrl || out.metadata?.imageUrl || out.imageData;
        if (!imgBase64) {
          console.warn("⚠️ Flow generate success but no image returned", {
            nodeId,
            aiProvider,
            model: imageModel,
            prompt,
            hasImage: !!imgBase64,
          });
        }

        // 先设置原图，然后异步生成缩略图
        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    status: "succeeded",
                    imageData: imgBase64,
                    error: undefined,
                  },
                }
              : n
          )
        );

        if (imgBase64) {
          const outs = rf.getEdges().filter((e) => e.source === nodeId);
          if (outs.length) {
            setNodes((ns) =>
              ns.map((n) => {
                const hits = outs.filter((e) => e.target === n.id);
                if (!hits.length) return n;
                if (n.type === "image")
                  return {
                    ...n,
                    data: {
                      ...n.data,
                      imageData: imgBase64,
                      thumbnail: undefined,
                    },
                  };
                return n;
              })
            );
          }
        }

        // 异步上传并写入远程 URL（避免 base64 落盘到项目 JSON/DB）
        if (imgBase64) {
          try {
            const projectId = useProjectContentStore.getState().projectId;
            const historyId = `${nodeId}-${Date.now()}`;
            const historyNodeType =
              node.type === "generatePro" ? "generatePro" : "generate";
            void recordImageHistoryEntry({
              id: historyId,
              base64: imgBase64,
              title: `${
                node.type === "generatePro"
                  ? "GeneratePro"
                  : node.type === "generateRef"
                  ? "GenerateRef"
                  : "Generate"
              } ${new Date().toLocaleTimeString()}`,
              nodeId,
              nodeType: historyNodeType,
              fileName: `flow_${node.type || "generate"}_${historyId}.png`,
              projectId,
              keepThumbnail: false,
            })
              .then(({ remoteUrl }) => {
                if (!remoteUrl) return;
                const outs = rf.getEdges().filter((e) => e.source === nodeId);
                setNodes((ns) =>
                  ns.map((n) => {
                    // 更新当前生成节点自身
                    if (n.id === nodeId) {
                      if ((n.data as any)?.imageData !== imgBase64) return n;
                      return {
                        ...n,
                        data: {
                          ...n.data,
                          imageUrl: remoteUrl,
                          imageData: undefined,
                          thumbnail: undefined,
                          lastHistoryId:
                            historyId ?? (n.data as any)?.lastHistoryId,
                        },
                      };
                    }

                    // 同步更新下游 Image 节点：替换为远程 URL，清理 base64
                    if (
                      outs.some((e) => e.target === n.id) &&
                      n.type === "image" &&
                      (n.data as any)?.imageData === imgBase64
                    ) {
                      return {
                        ...n,
                        data: {
                          ...n.data,
                          imageUrl: remoteUrl,
                          imageData: undefined,
                          thumbnail: undefined,
                        },
                      };
                    }

                    return n;
                  })
                );
              })
              .catch(() => {});
          } catch {}
        }
      } catch (err: any) {
        const msg = err?.message || String(err);
        setNodes((ns) =>
          ns.map((n) =>
            n.id === nodeId
              ? { ...n, data: { ...n.data, status: "failed", error: msg } }
              : n
          )
        );
      }
    },
    [aiProvider, imageModel, rf, setNodes, appendSora2History]
  );

  // 定义稳定的onSend回调
  const onSendHandler = React.useCallback(
    async (id: string) => {
      const node = rf.getNode(id);
      if (!node) return;
      const cacheKey = "flow_send_image_cache_v1";
      const getCachedUrl = (key: string): string | null => {
        try {
          const raw = localStorage.getItem(cacheKey);
          if (!raw) return null;
          const data = JSON.parse(raw) as Record<string, { url: string; ts: number }>;
          const entry = data[key];
          return entry?.url || null;
        } catch {
          return null;
        }
      };
      const setCachedUrl = (key: string, url: string) => {
        try {
          const raw = localStorage.getItem(cacheKey);
          const data = (raw ? JSON.parse(raw) : {}) as Record<
            string,
            { url: string; ts: number }
          >;
          data[key] = { url, ts: Date.now() };
          const keys = Object.keys(data);
          if (keys.length > 50) {
            const sorted = keys.sort((a, b) => data[a].ts - data[b].ts);
            sorted.slice(0, keys.length - 50).forEach((k) => delete data[k]);
          }
          localStorage.setItem(cacheKey, JSON.stringify(data));
        } catch {}
      };
      const hash32 = (input: string): string => {
        let hash = 0x811c9dc5;
        for (let i = 0; i < input.length; i++) {
          hash ^= input.charCodeAt(i);
          hash = Math.imul(hash, 0x01000193);
        }
        return (hash >>> 0).toString(16);
      };
      const fingerprintDataUrl = (dataUrl: string): string => {
        const sampleSize = 256;
        const head = dataUrl.slice(0, sampleSize);
        const tail = dataUrl.slice(Math.max(0, dataUrl.length - sampleSize));
        return `${dataUrl.length}:${hash32(`${head}|${tail}`)}`;
      };
      const normalizeForCanvas = (value?: string): string | null => {
        const trimmed = value?.trim();
        if (!trimmed) return null;
        if (
          trimmed.startsWith(FLOW_IMAGE_ASSET_PREFIX) // 本地 IndexedDB 引用不直接外发
        )
          return null;
        if (
          /^data:/i.test(trimmed) ||
          /^https?:\/\//i.test(trimmed) ||
          trimmed.startsWith("/api/assets/proxy") ||
          trimmed.startsWith("/assets/proxy") ||
          trimmed.startsWith("/") ||
          trimmed.startsWith("./") ||
          trimmed.startsWith("../") ||
          /^(templates|projects|uploads|videos)\//i.test(trimmed)
        )
          return trimmed;
        return `data:image/png;base64,${trimmed}`;
      };

      const cropImageToDataUrl = async (params: {
        baseRef: string;
        rect: { x: number; y: number; width: number; height: number };
        sourceWidth?: number;
        sourceHeight?: number;
      }): Promise<string | null> => {
        const baseRef = params.baseRef?.trim?.() || "";
        if (!baseRef) return null;

        const w = Math.max(1, Math.round(params.rect.width));
        const h = Math.max(1, Math.round(params.rect.height));
        if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
          return null;
        }

        const blob = await resolveImageToBlob(baseRef, { preferProxy: true });
        if (!blob) return null;

        const makeCanvas = (cw: number, ch: number): any => {
          if (typeof OffscreenCanvas !== "undefined") {
            return new OffscreenCanvas(cw, ch);
          }
          const canvas = document.createElement("canvas");
          canvas.width = cw;
          canvas.height = ch;
          return canvas;
        };

        if (typeof createImageBitmap === "function") {
          const bitmap = await createImageBitmapLimited(blob);
          try {
            const naturalW = bitmap.width;
            const naturalH = bitmap.height;
            if (!naturalW || !naturalH) return null;

            const srcW =
              typeof params.sourceWidth === "number" && params.sourceWidth > 0
                ? params.sourceWidth
                : naturalW;
            const srcH =
              typeof params.sourceHeight === "number" && params.sourceHeight > 0
                ? params.sourceHeight
                : naturalH;

            const scaleX = srcW > 0 ? naturalW / srcW : 1;
            const scaleY = srcH > 0 ? naturalH / srcH : 1;

            const sx = Math.max(
              0,
              Math.min(naturalW - 1, Math.round(params.rect.x * scaleX))
            );
            const sy = Math.max(
              0,
              Math.min(naturalH - 1, Math.round(params.rect.y * scaleY))
            );
            const swRaw = Math.max(1, Math.round(params.rect.width * scaleX));
            const shRaw = Math.max(1, Math.round(params.rect.height * scaleY));
            const sw = Math.max(1, Math.min(naturalW - sx, swRaw));
            const sh = Math.max(1, Math.min(naturalH - sy, shRaw));

            const canvas = makeCanvas(w, h);
            const ctx = canvas.getContext("2d");
            if (!ctx) return null;
            ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, w, h);
            const outBlob = await canvasToBlob(canvas, { type: "image/png" });
            return await blobToDataUrl(outBlob);
          } finally {
            try {
              bitmap.close();
            } catch {}
          }
        }

        return null;
      };

      if (node.type === "generate4" || node.type === "generatePro4") {
        const imgs = ((node.data as any)?.images as string[] | undefined) || [];
        const urls =
          ((node.data as any)?.imageUrls as string[] | undefined) || [];
        const merged = Array.from(
          { length: Math.max(imgs.length, urls.length) },
          (_, idx) => urls[idx] || imgs[idx]
        );
        const normalizedImages = merged
          .map(normalizeForCanvas)
          .filter(Boolean) as string[];
        if (!normalizedImages.length) {
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message: "没有可发送的图片", type: "warning" },
            })
          );
          return;
        }

        const parallelGroupId = `flow_send_${id}_${Date.now()}`;
        normalizedImages.forEach((dataUrl, idx) => {
          const fileName = `flow_${id}_${idx + 1}.png`;
          window.dispatchEvent(
            new CustomEvent("triggerQuickImageUpload", {
              detail: {
                imageData: dataUrl,
                fileName,
                operationType: "generate",
                smartPosition: undefined,
                sourceImageId: undefined,
                sourceImages: undefined,
                preferHorizontal: true,
                parallelGroupId,
                parallelGroupIndex: idx,
                parallelGroupTotal: normalizedImages.length,
              },
            })
          );
        });

        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: {
              message: `已发送 ${normalizedImages.length} 张图片到画板`,
              type: "success",
            },
          })
        );
        return;
      }

      if (node.type === "image" || node.type === "imagePro") {
        const resolveCropFromImageChain = (
          current: any,
          visited: Set<string>
        ): {
          baseRef: string;
          rect: { x: number; y: number; width: number; height: number };
          sourceWidth?: number;
          sourceHeight?: number;
        } | null => {
          if (!current?.id || visited.has(current.id)) return null;
          visited.add(current.id);
          if (current.type !== "image" && current.type !== "imagePro") return null;

          const d = (current.data ?? {}) as any;
          const crop = d?.crop as
            | {
                x?: unknown;
                y?: unknown;
                width?: unknown;
                height?: unknown;
                sourceWidth?: unknown;
                sourceHeight?: unknown;
              }
            | undefined;
          const baseRef =
            (typeof d.imageData === "string" && d.imageData.trim()) ||
            (typeof d.imageUrl === "string" && d.imageUrl.trim()) ||
            "";
          if (crop && baseRef) {
            const x = typeof crop.x === "number" ? crop.x : Number(crop.x ?? 0);
            const y = typeof crop.y === "number" ? crop.y : Number(crop.y ?? 0);
            const w = typeof crop.width === "number" ? crop.width : Number(crop.width ?? 0);
            const h = typeof crop.height === "number" ? crop.height : Number(crop.height ?? 0);
            if (Number.isFinite(x) && Number.isFinite(y) && w > 0 && h > 0) {
              const sourceWidth =
                typeof crop.sourceWidth === "number"
                  ? crop.sourceWidth
                  : Number(crop.sourceWidth ?? 0);
              const sourceHeight =
                typeof crop.sourceHeight === "number"
                  ? crop.sourceHeight
                  : Number(crop.sourceHeight ?? 0);
              return {
                baseRef,
                rect: { x, y, width: w, height: h },
                sourceWidth: sourceWidth > 0 ? sourceWidth : undefined,
                sourceHeight: sourceHeight > 0 ? sourceHeight : undefined,
              };
            }
          }

          const upstream = rf
            .getEdges()
            .find((e) => e.target === current.id && e.targetHandle === "img");
          if (!upstream) return null;
          const up = rf.getNode(upstream.source);
          const handle = (upstream as any).sourceHandle as string | undefined;
          if (up?.type === "imageSplit") {
            const splitData = (up.data ?? {}) as any;
            const base =
              (typeof splitData.inputImageUrl === "string" && splitData.inputImageUrl.trim()) ||
              (typeof splitData.inputImage === "string" && splitData.inputImage.trim()) ||
              "";
            const match = handle ? /^image(\d+)$/.exec(handle) : null;
            const idx = match ? Math.max(0, Number(match[1]) - 1) : 0;
            const splitRects = Array.isArray(splitData.splitRects) ? splitData.splitRects : [];
            const rect = splitRects?.[idx];
            const x = typeof rect?.x === "number" ? rect.x : Number(rect?.x ?? 0);
            const y = typeof rect?.y === "number" ? rect.y : Number(rect?.y ?? 0);
            const w = typeof rect?.width === "number" ? rect.width : Number(rect?.width ?? 0);
            const h = typeof rect?.height === "number" ? rect.height : Number(rect?.height ?? 0);
            if (base && Number.isFinite(x) && Number.isFinite(y) && w > 0 && h > 0) {
              const sourceWidth =
                typeof splitData.sourceWidth === "number" ? splitData.sourceWidth : undefined;
              const sourceHeight =
                typeof splitData.sourceHeight === "number" ? splitData.sourceHeight : undefined;
              return {
                baseRef: base,
                rect: { x, y, width: w, height: h },
                sourceWidth,
                sourceHeight,
              };
            }
            return null;
          }
          if (up?.type === "image" || up?.type === "imagePro") {
            return resolveCropFromImageChain(up, visited);
          }
          return null;
        };

        const d = (node.data ?? {}) as any;
        const baseRef =
          (typeof d.imageData === "string" && d.imageData.trim()) ||
          (typeof d.imageUrl === "string" && d.imageUrl.trim()) ||
          "";
        const cropSpec = resolveCropFromImageChain(node, new Set());
        if (cropSpec?.baseRef) {
          const cropped = await cropImageToDataUrl({
            baseRef: cropSpec.baseRef,
            rect: cropSpec.rect,
            sourceWidth: cropSpec.sourceWidth,
            sourceHeight: cropSpec.sourceHeight,
          });
          if (cropped) {
            const fingerprint = fingerprintDataUrl(cropped);
            const cachedUrl = getCachedUrl(fingerprint);
            const fileName = `flow_${id}_${Date.now()}.png`;
            if (cachedUrl) {
              window.dispatchEvent(
                new CustomEvent("triggerQuickImageUpload", {
                  detail: {
                    imageData: cachedUrl,
                    fileName,
                    operationType: "generate",
                    smartPosition: undefined,
                    sourceImageId: undefined,
                    sourceImages: undefined,
                  },
                })
              );
              window.dispatchEvent(
                new CustomEvent("toast", {
                  detail: { message: "图片已发送到画板", type: "success" },
                })
              );
              return;
            }

            try {
              const blob = await resolveImageToBlob(cropped, { preferProxy: true });
              if (blob) {
                const file = new File([blob], fileName, { type: "image/png" });
                const uploadResult = await imageUploadService.uploadImageFile(file, {
                  fileName,
                  contentType: "image/png",
                });
                if (uploadResult.success && uploadResult.asset?.url) {
                  setCachedUrl(fingerprint, uploadResult.asset.url);
                  window.dispatchEvent(
                    new CustomEvent("triggerQuickImageUpload", {
                      detail: {
                        imageData: uploadResult.asset.url,
                        fileName,
                        operationType: "generate",
                        smartPosition: undefined,
                        sourceImageId: undefined,
                        sourceImages: undefined,
                      },
                    })
                  );
                  window.dispatchEvent(
                    new CustomEvent("toast", {
                      detail: { message: "图片已发送到画板", type: "success" },
                    })
                  );
                  return;
                }
              }
            } catch {}

            window.dispatchEvent(
              new CustomEvent("triggerQuickImageUpload", {
                detail: {
                  imageData: cropped,
                  fileName,
                  operationType: "generate",
                  smartPosition: undefined,
                  sourceImageId: undefined,
                  sourceImages: undefined,
                },
              })
            );
            window.dispatchEvent(
              new CustomEvent("toast", {
                detail: { message: "图片已发送到画板", type: "success" },
              })
            );
            return;
          }
        }

        const normalized = normalizeForCanvas(baseRef);
        const resolved =
          normalized ||
          (baseRef
            ? await resolveImageToDataUrl(baseRef, { preferProxy: true })
            : null);
        if (!resolved) {
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message: "没有可发送的图片", type: "warning" },
            })
          );
          return;
        }

        const fileName = `flow_${id}_${Date.now()}.png`;
        window.dispatchEvent(
          new CustomEvent("triggerQuickImageUpload", {
            detail: {
              imageData: resolved,
              fileName,
              operationType: "generate",
              smartPosition: undefined,
              sourceImageId: undefined,
              sourceImages: undefined,
            },
          })
        );
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message: "图片已发送到画板", type: "success" },
          })
        );
        return;
      }

      // 默认单图（generate / generatePro / generateRef）
      const dataUrl = normalizeForCanvas(
        ((node.data as any)?.imageUrl as string | undefined) ||
          ((node.data as any)?.imageData as string | undefined)
      );
      if (!dataUrl) {
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message: "没有可发送的图片", type: "warning" },
          })
        );
        return;
      }

      const fileName = `flow_${Date.now()}.png`;
      window.dispatchEvent(
        new CustomEvent("triggerQuickImageUpload", {
          detail: {
            imageData: dataUrl,
            fileName,
            operationType: "generate",
            smartPosition: undefined,
            sourceImageId: undefined,
            sourceImages: undefined,
          },
        })
      );
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: { message: "图片已发送到画板", type: "success" },
        })
      );
    },
    [rf]
  );

  // 连接状态回调
  const onConnectStart = React.useCallback(
    () => setIsConnecting(true),
    [setIsConnecting]
  );
  const onConnectEnd = React.useCallback(
    () => setIsConnecting(false),
    [setIsConnecting]
  );

  // 在 node 渲染前为 Generate 节点注入 onRun 回调
  const nodesWithHandlers = React.useMemo(
    () =>
      nodes.map((n) =>
        n.type === "generate" ||
        n.type === "generate4" ||
        n.type === "generateRef" ||
        n.type === "generatePro" ||
        n.type === "generatePro4" ||
        n.type === "midjourney"
          ? { ...n, data: { ...n.data, onRun: runNode, onSend: onSendHandler } }
          : n.type === "image" || n.type === "imagePro"
          ? { ...n, data: { ...n.data, onSend: onSendHandler } }
          : n.type === "sora2Video" ||
            n.type === "wan26" ||
            n.type === "wan2R2V" ||
            n.type === "klingVideo" ||
            n.type === "viduVideo" ||
            n.type === "doubaoVideo"
          ? { ...n, data: { ...n.data, onRun: runNode } }
          : n
      ),
    [nodes, runNode, onSendHandler]
  );

  // 简单的全局调试API，便于从控制台添加节点
  React.useEffect(() => {
    (window as any).tanvaFlow = {
      addTextPrompt: (x = 0, y = 0, text = "") => {
        const id = `tp_${Date.now()}`;
        setNodes((ns) =>
          ns.concat([
            {
              id,
              type: "textPrompt",
              position: { x, y },
              data: { text, title: "Prompt" },
            },
          ] as any)
        );
        return id;
      },
      addTextNote: (x = 0, y = 0, text = "") => {
        const id = `tn_${Date.now()}`;
        setNodes((ns) =>
          ns.concat([
            { id, type: "textNote", position: { x, y }, data: { text } },
          ] as any)
        );
        return id;
      },
      addImage: (x = 0, y = 0, imageData?: string) => {
        const id = `img_${Date.now()}`;
        setNodes((ns) =>
          ns.concat([
            { id, type: "image", position: { x, y }, data: { imageData } },
          ] as any)
        );
        return id;
      },
      addThree: (x = 0, y = 0) => {
        const id = `three_${Date.now()}`;
        setNodes((ns) =>
          ns.concat([
            { id, type: "three", position: { x, y }, data: {} },
          ] as any)
        );
        return id;
      },
      addCamera: (x = 0, y = 0) => {
        const id = `camera_${Date.now()}`;
        setNodes((ns) =>
          ns.concat([
            { id, type: "camera", position: { x, y }, data: {} },
          ] as any)
        );
        return id;
      },
      addGenerate: (x = 0, y = 0) => {
        const id = `gen_${Date.now()}`;
        setNodes((ns) =>
          ns.concat([
            {
              id,
              type: "generate",
              position: { x, y },
              data: { status: "idle", presetPrompt: "" },
            },
          ] as any)
        );
        return id;
      },
      addGenerate4: (x = 0, y = 0) => {
        const id = `gen4_${Date.now()}`;
        setNodes((ns) =>
          ns.concat([
            {
              id,
              type: "generate4",
              position: { x, y },
              data: { status: "idle", images: [], count: 4 },
            },
          ] as any)
        );
        return id;
      },
      connect: (
        source: string,
        target: string,
        targetHandle:
          | "text"
          | "img"
          | "image1"
          | "image2"
          | "refer"
          | "text-top-in"
          | "text-bottom-in"
          | "text-left-in"
          | "text-right-in"
      ) => {
        const conn = { source, target, targetHandle } as any;
        if (
          isValidConnection(conn as any) &&
          canAcceptConnection(conn as any)
        ) {
          setEdges((eds) => addEdge(conn, eds));
          return true;
        }
        return false;
      },
      // 暴露 React Flow 实例，用于框选工具选择节点
      selectNodesInBox: (screenRect: {
        x: number;
        y: number;
        width: number;
        height: number;
      }) => {
        try {
          const allNodes = rf.getNodes();
          const selectedNodeIds: string[] = [];

          // 获取 Flow 容器的位置
          const container = containerRef.current;
          if (!container) return [];

          // 将屏幕坐标转换为相对于 Flow 容器的坐标
          const containerRect = container.getBoundingClientRect();
          const relativeX = screenRect.x - containerRect.left;
          const relativeY = screenRect.y - containerRect.top;

          // 将屏幕坐标的选择框转换为 Flow 坐标
          const topLeft = rf.screenToFlowPosition({
            x: relativeX,
            y: relativeY,
          });
          const bottomRight = rf.screenToFlowPosition({
            x: relativeX + screenRect.width,
            y: relativeY + screenRect.height,
          });

          // 确保坐标顺序正确
          const minX = Math.min(topLeft.x, bottomRight.x);
          const maxX = Math.max(topLeft.x, bottomRight.x);
          const minY = Math.min(topLeft.y, bottomRight.y);
          const maxY = Math.max(topLeft.y, bottomRight.y);

          // 检查每个节点是否在选择框内
          for (const node of allNodes) {
            const nodeX = node.position?.x ?? 0;
            const nodeY = node.position?.y ?? 0;

            // 获取节点的实际大小
            const nodeWidth = node.data?.boxW ?? node.width ?? 150;
            const nodeHeight = node.data?.boxH ?? node.height ?? 100;

            // 计算节点的边界
            const nodeLeft = nodeX;
            const nodeRight = nodeX + nodeWidth;
            const nodeTop = nodeY;
            const nodeBottom = nodeY + nodeHeight;

            // 检查节点是否与选择框相交
            const isIntersecting =
              nodeLeft < maxX &&
              nodeRight > minX &&
              nodeTop < maxY &&
              nodeBottom > minY;

            if (isIntersecting) {
              selectedNodeIds.push(node.id);
            }
          }

          // 更新节点选择状态
          if (selectedNodeIds.length > 0) {
            setNodes((prevNodes) =>
              prevNodes.map((node) => ({
                ...node,
                selected: selectedNodeIds.includes(node.id),
              }))
            );
          }

          return selectedNodeIds;
        } catch (error) {
          console.warn("选择节点失败:", error);
          return [];
        }
      },
      // 选择所有节点
      selectAllNodes: () => {
        setNodes((prevNodes) =>
          prevNodes.map((node) => ({ ...node, selected: true }))
        );
      },
      // 取消选择所有节点
      deselectAllNodes: () => {
        setNodes((prevNodes) =>
          prevNodes.map((node) => ({ ...node, selected: false }))
        );
      },
      // 暴露 React Flow 实例
      rf: rf,
    };
    return () => {
      delete (window as any).tanvaFlow;
    };
  }, [setNodes, setEdges, isValidConnection, canAcceptConnection, rf]);

  const addAtCenter = React.useCallback(
    (
      type:
        | "textPrompt"
        | "textPromptPro"
        | "textChat"
        | "textNote"
        | "promptOptimize"
        | "image"
        | "generate"
        | "generatePro"
        | "generate4"
        | "generateRef"
        | "analysis"
    ) => {
      const rect = containerRef.current?.getBoundingClientRect();
      const centerScreen = {
        x: (rect?.width || window.innerWidth) / 2,
        y: (rect?.height || window.innerHeight) / 2,
      };
      const center = rf.screenToFlowPosition(centerScreen);
      const id = `${type}_${Date.now()}`;
      const base: any = {
        id,
        type,
        position: center,
        data:
          type === "textPrompt"
            ? { text: "", title: "Prompt" }
            : type === "textPromptPro"
            ? { prompts: [""], text: "", textMode: "raw" }
            : type === "textNote"
            ? { text: "" }
            : type === "textChat"
            ? {
                status: "idle" as const,
                manualInput: "",
                responseText: "",
                enableWebSearch: false,
              }
            : type === "promptOptimize"
            ? { text: "", expandedText: "" }
            : type === "generate"
            ? { status: "idle", presetPrompt: "" }
            : type === "generatePro"
            ? { status: "idle", prompts: [""] }
            : type === "generate4"
            ? { status: "idle", images: [], count: 4 }
            : type === "generateRef"
            ? { status: "idle", referencePrompt: undefined }
            : type === "analysis"
            ? { status: "idle", prompt: "", analysisPrompt: undefined }
            : { imageData: undefined },
      };
      setNodes((ns) => ns.concat([base]));
      try {
        historyService.commit("flow-add-at-center").catch(() => {});
      } catch {}
      return id;
    },
    [rf, setNodes]
  );

  const showFlowPanel = useUIStore((s) => s.showFlowPanel);
  const flowUIEnabled = useUIStore((s) => s.flowUIEnabled);
  const focusMode = useUIStore((s) => s.focusMode);

  const FlowToolbar =
    flowUIEnabled && showFlowPanel ? (
      <div
        className='tanva-flow-toolbar'
        style={{
          position: "absolute",
          top: 56,
          right: 16,
          zIndex: 10,
          display: "flex",
          gap: 8,
          alignItems: "center",
          background: "rgba(255,255,255,0.9)",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 8,
        }}
      >
        <button
          onClick={() => addAtCenter("textPrompt")}
          style={{
            padding: "6px 10px",
            fontSize: 12,
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            background: "#fff",
          }}
        >
          文字
        </button>
        <button
          onClick={() => addAtCenter("textNote")}
          style={{
            padding: "6px 10px",
            fontSize: 12,
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            background: "#fff",
          }}
        >
          文本卡片
        </button>
        <button
          onClick={() => addAtCenter("textChat")}
          style={{
            padding: "6px 10px",
            fontSize: 12,
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            background: "#fff",
          }}
        >
          文字交互
        </button>
        <button
          onClick={() => addAtCenter("promptOptimize")}
          style={{
            padding: "6px 10px",
            fontSize: 12,
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            background: "#fff",
          }}
        >
          优化
        </button>
        <button
          onClick={() => addAtCenter("analysis")}
          style={{
            padding: "6px 10px",
            fontSize: 12,
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            background: "#fff",
          }}
        >
          分析
        </button>
        <button
          onClick={() => addAtCenter("image")}
          style={{
            padding: "6px 10px",
            fontSize: 12,
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            background: "#fff",
          }}
        >
          图片
        </button>
        <button
          onClick={() => addAtCenter("generate")}
          style={{
            padding: "6px 10px",
            fontSize: 12,
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            background: "#111827",
            color: "#fff",
          }}
        >
          生成
        </button>
        <button
          onClick={() => addAtCenter("generateRef")}
          style={{
            padding: "6px 10px",
            fontSize: 12,
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            background: "#111827",
            color: "#fff",
          }}
        >
          参考生成
        </button>
        <button
          onClick={() => addAtCenter("generate4")}
          style={{
            padding: "6px 10px",
            fontSize: 12,
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            background: "#111827",
            color: "#fff",
          }}
        >
          Multi Generate
        </button>
        <div
          style={{
            width: 1,
            height: 20,
            background: "#e5e7eb",
            margin: "0 4px",
          }}
        />
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
          }}
        >
          <input
            type='checkbox'
            checked={backgroundEnabled}
            onChange={(e) => setBackgroundEnabled(e.target.checked)}
          />{" "}
          Flow背景
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
          }}
          title='开启后视窗外节点会卸载以节省性能，但拖回视窗时会有重新渲染/加载感'
        >
          <input
            type='checkbox'
            checked={onlyRenderVisibleElements}
            onChange={(e) => setOnlyRenderVisibleElements(e.target.checked)}
          />{" "}
          仅渲染可见(性能)
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
          }}
          title='显示拖拽/缩放交互的估算帧率（节点拖拽、图片拖拽/缩放；每 250ms 刷新一次）'
        >
          <input
            type='checkbox'
            checked={showFpsOverlay}
            onChange={(e) => setShowFpsOverlay(e.target.checked)}
          />{" "}
          FPS
        </label>
        {backgroundEnabled && (
          <>
            <select
              value={backgroundVariant}
              onChange={(e) =>
                setBackgroundVariant(e.target.value as FlowBackgroundVariant)
              }
              style={{
                fontSize: 12,
                border: "1px solid #e5e7eb",
                borderRadius: 6,
                padding: "4px 6px",
                background: "#fff",
              }}
            >
              <option value={FlowBackgroundVariant.DOTS}>点阵</option>
              <option value={FlowBackgroundVariant.LINES}>网格线</option>
              <option value={FlowBackgroundVariant.CROSS}>十字网格</option>
            </select>
            <input
              type='color'
              value={backgroundColor}
              onChange={(e) => setBackgroundColor(e.target.value)}
              title='背景颜色'
              style={{
                width: 28,
                height: 28,
                padding: 0,
                border: "none",
                background: "transparent",
              }}
            />
            <label style={{ fontSize: 12 }}>
              间距
              <input
                type='number'
                inputMode='numeric'
                min={4}
                max={100}
                value={bgGapInput}
                onChange={(e) => setBgGapInput(e.target.value)}
                onBlur={(e) => commitGap(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter")
                    commitGap((e.target as HTMLInputElement).value);
                }}
                style={{
                  width: 56,
                  marginLeft: 4,
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                  padding: "2px 6px",
                }}
              />
            </label>
            <label style={{ fontSize: 12 }}>
              尺寸
              <input
                type='number'
                inputMode='numeric'
                min={0.5}
                max={10}
                step={0.5}
                value={bgSizeInput}
                onChange={(e) => setBgSizeInput(e.target.value)}
                onBlur={(e) => commitSize(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter")
                    commitSize((e.target as HTMLInputElement).value);
                }}
                style={{
                  width: 44,
                  marginLeft: 4,
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                  padding: "2px 6px",
                }}
              />
            </label>
            <label style={{ fontSize: 12 }}>
              透明度
              <input
                type='range'
                min={0}
                max={1}
                step={0.1}
                value={backgroundOpacity}
                onChange={(e) => setBackgroundOpacity(Number(e.target.value))}
                style={{ width: 60, marginLeft: 4 }}
              />
            </label>
          </>
        )}
      </div>
    ) : null;

  // 计算添加面板的容器内定位
  const addPanelStyle = React.useMemo(() => {
    if (!addPanel.visible) return { display: "none" } as React.CSSProperties;
    const rect = containerRef.current?.getBoundingClientRect();
    const left = rect ? rect.width / 2 : window.innerWidth / 2;
    const top = rect ? rect.height / 2 : window.innerHeight / 2;
    // 始终在视窗（容器）中心显示：用 translate(-50%, -50%) 校正为居中
    // z-index 设为 100，确保在 AI 对话框（z-50）之上
    return {
      position: "absolute",
      left,
      top,
      transform: "translate(-50%, -50%)",
      zIndex: 100,
    } as React.CSSProperties;
  }, [addPanel.visible]);

  const handleContainerDoubleClick = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isBlankArea(e.clientX, e.clientY))
        openAddPanelAt(e.clientX, e.clientY, {
          tab: "nodes",
          allowedTabs: ["nodes", "beta", "custom"],
        });
    },
    [openAddPanelAt, isBlankArea]
  );

  const commitEdgeLabelValue = React.useCallback(
    (edgeId: string, value: string) => {
      const trimmed = value.trim();
      let changed = false;
      setEdges((prev) =>
        prev.map((edge) => {
          if (edge.id !== edgeId) return edge;
          const prevValue = typeof edge.label === "string" ? edge.label : "";
          if (prevValue === trimmed) return edge;
          changed = true;
          if (trimmed) {
            return { ...edge, label: trimmed };
          }
          const next = { ...edge };
          delete (next as any).label;
          return next;
        })
      );
      if (changed) {
        try {
          historyService.commit("flow-edge-label").catch(() => {});
        } catch {}
      }
    },
    [setEdges]
  );

  const finalizeEdgeLabelEditor = React.useCallback(
    (commit: boolean) => {
      setEdgeLabelEditor((prev) => {
        if (commit && prev.edgeId) {
          commitEdgeLabelValue(prev.edgeId, prev.value);
        }
        return createEdgeLabelEditorState();
      });
    },
    [commitEdgeLabelValue]
  );

  const handleEdgeLabelChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setEdgeLabelEditor((prev) => ({ ...prev, value }));
    },
    []
  );

  const handleEdgeLabelKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finalizeEdgeLabelEditor(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finalizeEdgeLabelEditor(false);
      }
    },
    [finalizeEdgeLabelEditor]
  );

  const handleEdgeLabelBlur = React.useCallback(() => {
    finalizeEdgeLabelEditor(true);
  }, [finalizeEdgeLabelEditor]);

  const handleEdgeDoubleClick = React.useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.preventDefault();
      event.stopPropagation();

      const containerRect = containerRef.current?.getBoundingClientRect();
      const targetElement = event.target as HTMLElement | null;
      const targetRect = targetElement?.getBoundingClientRect?.();
      const globalX = targetRect
        ? targetRect.left + targetRect.width / 2
        : event.clientX;
      const globalY = targetRect
        ? targetRect.top + targetRect.height / 2
        : event.clientY;
      let localX = containerRect ? globalX - containerRect.left : globalX;
      let localY = containerRect ? globalY - containerRect.top : globalY;
      if (containerRect) {
        const margin = 16;
        localX = Math.min(
          Math.max(margin, localX),
          containerRect.width - margin
        );
        localY = Math.min(
          Math.max(margin, localY),
          containerRect.height - margin
        );
      }

      const allEdges = (rf.getEdges?.() || edges) as Edge[];
      const currentEdge = allEdges.find((e) => e.id === edge.id);
      const existingValue =
        typeof currentEdge?.label === "string" ? currentEdge.label : "";

      setEdgeLabelEditor((prev) => {
        if (prev.visible && prev.edgeId && prev.edgeId !== edge.id) {
          commitEdgeLabelValue(prev.edgeId, prev.value);
        }
        return {
          visible: true,
          edgeId: edge.id,
          value: existingValue,
          position: { x: localX, y: localY },
        };
      });

      try {
        const selection = window.getSelection?.();
        selection?.removeAllRanges?.();
      } catch {}
    },
    [rf, edges, commitEdgeLabelValue]
  );

  // -------- 模板：实例化与保存 --------
  const instantiateTemplateAt = React.useCallback(
    async (tpl: FlowTemplate, world: { x: number; y: number }) => {
      if (!tpl?.nodes?.length) return;
      const minX = Math.min(...tpl.nodes.map((n) => n.position?.x || 0));
      const minY = Math.min(...tpl.nodes.map((n) => n.position?.y || 0));
      const idMap = new Map<string, string>();
      const newNodes = tpl.nodes.map((n) => {
        const newId = generateId(n.type || "n");
        idMap.set(n.id, newId);
        const data: any = { ...(n.data || {}) };
        delete data.onRun;
        delete data.onSend;
        delete data.status;
        delete data.error;
        return {
          id: newId,
          type: n.type as any,
          position: {
            x: world.x + (n.position.x - minX),
            y: world.y + (n.position.y - minY),
          },
          data,
        } as any;
      });
      const newEdges = (tpl.edges || []).map((e) => ({
        id: generateId("e"),
        source: idMap.get(e.source) || e.source,
        target: idMap.get(e.target) || e.target,
        sourceHandle: (e as any).sourceHandle,
        targetHandle: (e as any).targetHandle,
        type: e.type || "default",
        label: e.label,
      })) as any[];
      setNodes((ns) => ns.concat(newNodes));
      setEdges((es) => es.concat(newEdges));
      setAddPanel((v) => ({ ...v, visible: false }));
    },
    [setNodes, setEdges]
  );

  // 监听模板实例化事件（从 TemplateModal 触发）
  React.useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        template: FlowTemplate;
      };
      if (!detail?.template?.nodes?.length) {
        console.warn("[FlowOverlay] instantiateTemplate: 模板数据无效", detail);
        return;
      }
      const container = document.querySelector(".react-flow");
      const rect = container?.getBoundingClientRect();
      const centerX = rect ? rect.width / 2 : 400;
      const centerY = rect ? rect.height / 2 : 300;
      const world = rf.screenToFlowPosition({ x: centerX, y: centerY });
      console.log("[FlowOverlay] 收到模板实例化事件，位置:", world);
      instantiateTemplateAt(detail.template, world);
    };
    window.addEventListener("flow:instantiateTemplate", handler as EventListener);
    return () =>
      window.removeEventListener("flow:instantiateTemplate", handler as EventListener);
  }, [rf, instantiateTemplateAt]);

  const saveCurrentAsTemplate = React.useCallback(async () => {
    const allNodes = rf.getNodes();
    const selected = allNodes.filter((n: any) => n.selected);
    const nodesToSave = selected.length ? selected : allNodes;
    if (!nodesToSave.length) return;
    const edgesAll = rf.getEdges();
    const nodeIdSet = new Set(nodesToSave.map((n) => n.id));
    const edgesToSave = edgesAll.filter(
      (e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target)
    );
    const name =
      prompt("模板名称", `模板_${new Date().toLocaleString()}`) ||
      `模板_${Date.now()}`;
    const id = generateId("tpl");
    const minX = Math.min(...nodesToSave.map((n) => n.position.x));
    const minY = Math.min(...nodesToSave.map((n) => n.position.y));
    try {
      const templateNodes = await Promise.all(
        nodesToSave.map(async (n: any) => {
          const raw = { ...(n.data || {}) };
          delete raw.onRun;
          delete raw.onSend;
          const data: any = sanitizeNodeData(raw) || {};
          delete data.status;
          delete data.error;
          delete data.taskId;
          delete data.buttons;
          delete data.lastHistoryId;

          const nodeType = String(n.type || "");

          // ImageSplit：只保留可持久化的原图引用 + 裁切矩形（不保存切片图片数据）
          if (nodeType === "imageSplit") {
            const candidateInput =
              (typeof data.inputImageUrl === "string" &&
              data.inputImageUrl.trim()
                ? data.inputImageUrl
                : undefined) ??
              (typeof data.inputImage === "string" && data.inputImage.trim()
                ? data.inputImage
                : undefined);

            if (candidateInput) {
              data.inputImageUrl = await uploadImageToStableUrl(
                String(candidateInput).trim(),
                `flow_template_${id}_${String(n.id)}_input.png`
              );
              delete data.inputImage;
            }

            const existingRects = Array.isArray(data.splitRects)
              ? data.splitRects
              : [];
            const legacyImages = Array.isArray(data.splitImages)
              ? data.splitImages
              : [];
            if (existingRects.length === 0 && legacyImages.length > 0) {
              const rects = legacyImages
                .map((img: any, idx: number) => ({
                  index:
                    typeof img?.index === "number" && Number.isFinite(img.index)
                      ? img.index
                      : idx,
                  x: Number(img?.x ?? 0),
                  y: Number(img?.y ?? 0),
                  width: Number(img?.width ?? 0),
                  height: Number(img?.height ?? 0),
                }))
                .filter(
                  (r: any) =>
                    Number.isFinite(r.x) &&
                    Number.isFinite(r.y) &&
                    Number.isFinite(r.width) &&
                    Number.isFinite(r.height) &&
                    r.width > 0 &&
                    r.height > 0
                );
              if (rects.length > 0) {
                data.splitRects = rects;
              }
            }
            if (Array.isArray(data.splitImages)) {
              delete data.splitImages;
            }
          }

          // 多图：仅存 imageUrls，避免 base64 过大
          const rawImages: unknown[] = Array.isArray(data.images)
            ? data.images
            : [];
          const rawImageUrls: unknown[] = Array.isArray(data.imageUrls)
            ? data.imageUrls
            : [];
          const rawThumbnails: unknown[] = Array.isArray(data.thumbnails)
            ? data.thumbnails
            : [];
          if (rawImages.length || rawImageUrls.length || rawThumbnails.length) {
            const len = Math.max(
              rawImages.length,
              rawImageUrls.length,
              rawThumbnails.length
            );
            const urls: string[] = [];
            for (let i = 0; i < len; i += 1) {
              const candidate =
                rawImageUrls[i] ?? rawImages[i] ?? rawThumbnails[i];
              const candidateStr =
                typeof candidate === "string" ? candidate.trim() : "";
              if (!candidateStr) {
                const historyUrl =
                  nodeType === "generatePro4"
                    ? getHistoryRemoteUrlForNode(String(n.id), i)
                    : null;
                urls.push(historyUrl || "");
                continue;
              }
              urls.push(
                await uploadImageToStableUrl(
                  candidateStr,
                  `flow_template_${id}_${String(n.id)}_${i + 1}.png`
                )
              );
            }
            data.imageUrls = urls;
            delete data.images;
            delete data.imageData;
            delete data.thumbnails;
            delete data.thumbnail;
          }

          // 单图：仅存 imageUrl，避免 base64 过大
          const candidateSingle =
            (typeof data.imageUrl === "string" && data.imageUrl.trim()
              ? data.imageUrl
              : undefined) ??
            (typeof data.imageData === "string" && data.imageData.trim()
              ? data.imageData
              : undefined) ??
            (typeof data.thumbnail === "string" && data.thumbnail.trim()
              ? data.thumbnail
              : undefined);
          if (candidateSingle) {
            const candidateStr = String(candidateSingle).trim();
            data.imageUrl = await uploadImageToStableUrl(
              candidateStr,
              `flow_template_${id}_${String(n.id)}.png`
            );
            delete data.imageData;
            delete data.thumbnail;
            delete data.thumbnails;
          } else if (
            typeof data.imageData === "string" ||
            typeof data.imageUrl === "string"
          ) {
            delete data.imageData;
            delete data.thumbnail;
            delete data.thumbnails;
          } else {
            const historyUrl = getHistoryRemoteUrlForNode(String(n.id));
            if (historyUrl) data.imageUrl = historyUrl;
          }

          stripLargeInlineBlobsInPlace(data);

          return {
            id: n.id,
            type: n.type || "default",
            position: { x: n.position.x - minX, y: n.position.y - minY },
            data,
            boxW: (n as any).data?.boxW,
            boxH: (n as any).data?.boxH,
          };
        })
      );

      const tpl: FlowTemplate = {
        schemaVersion: 1,
        id,
        name,
        nodes: templateNodes as any,
        edges: edgesToSave.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: (e as any).sourceHandle,
          targetHandle: (e as any).targetHandle,
          type: e.type || "default",
          label: typeof e.label === "string" ? e.label : undefined,
        })) as any,
      };
      await saveUserTemplate(tpl);
      const list = await listUserTemplates();
      setUserTplList(list);
      alert("已保存为模板");
    } catch (error) {
      console.error("保存模板失败", error);
      alert("保存模板失败：图片上传或模板序列化失败，请重试");
    }
  }, [
    getHistoryRemoteUrlForNode,
    isRemoteUrl,
    normalizeStableRemoteUrl,
    rf,
    sanitizeNodeData,
    setUserTplList,
    stripLargeInlineBlobsInPlace,
    uploadImageToStableUrl,
  ]);

  return (
    <div
      ref={containerRef}
      className={`tanva-flow-overlay absolute inset-0 ${
        isPointerMode ? "pointer-mode" : ""
      } ${isMarqueeMode ? "marquee-mode" : ""}`}
      onDoubleClick={handleContainerDoubleClick}
      onPointerDownCapture={() => clipboardService.setActiveZone("flow")}
    >
      {FlowToolbar}
      <ReactFlow
        nodes={nodesWithHandlers}
        edges={edges}
        onNodesChange={onNodesChangeWithHistory}
        onEdgesChange={onEdgesChangeWithHistory}
        defaultViewport={initialViewport}
        onNodeDragStart={(event, node) => {
          nodeDraggingRef.current = true;
          setIsNodeDragging(true);
          // 检测 Alt 键是否按下
          const altPressed = event.altKey;
          if (altPressed) {
            // Alt+拖拽：创建副本并让副本跟随鼠标移动，原节点保持原有连线与位置
            const allNodes = rf.getNodes();
            const selectedNodes = allNodes.filter(
              (n: any) => n.selected || n.id === node.id
            );

            if (selectedNodes.length > 0) {
              const startPositions = new Map<
                string,
                { x: number; y: number }
              >();
              const startAbsPositions = new Map<
                string,
                { x: number; y: number }
              >();
              const idMap = new Map<string, string>();
              const clonedNodes = selectedNodes.map((n: any) => {
                startPositions.set(n.id, { x: n.position.x, y: n.position.y });
                startAbsPositions.set(n.id, {
                  x: (n as any).positionAbsolute?.x ?? n.position.x,
                  y: (n as any).positionAbsolute?.y ?? n.position.y,
                });
                const newId = generateId(n.type || "n");
                idMap.set(n.id, newId);
                const rawData = { ...(n.data || {}) };
                delete rawData.onRun;
                delete rawData.onSend;
                const data = sanitizeNodeData(rawData);
                if (data) {
                  delete data.status;
                  delete data.error;
                }
                return {
                  id: newId,
                  type: n.type || "default",
                  position: { x: n.position.x, y: n.position.y }, // 原位置
                  data,
                  selected: true, // 副本选中，符合“复制后继续操作副本”的直觉
                  width: n.width,
                  height: n.height,
                  style: n.style ? { ...n.style } : undefined,
                };
              });

              // 复制相关的边
              const selectedIds = new Set(selectedNodes.map((n: any) => n.id));
              const relatedEdges = rf
                .getEdges()
                .filter(
                  (edge: any) =>
                    selectedIds.has(edge.source) && selectedIds.has(edge.target)
                );
              const clonedEdges = relatedEdges
                .map((edge: any) => {
                  const source = idMap.get(edge.source);
                  const target = idMap.get(edge.target);
                  if (!source || !target) return null;
                  return {
                    id: generateId("e"),
                    source,
                    target,
                    sourceHandle: edge.sourceHandle,
                    targetHandle: edge.targetHandle,
                    type: edge.type || "default",
                    label: edge.label,
                  };
                })
                .filter(Boolean);

              // 添加副本到节点列表（拖拽期间通过 onNodesChange 把位移重映射到副本）
              const selectedIdSet = new Set(
                selectedNodes.map((n: any) => n.id)
              );
              setNodes((prev: any[]) =>
                prev
                  .map((n: any) =>
                    selectedIdSet.has(n.id) ? { ...n, selected: false } : n
                  )
                  .concat(clonedNodes)
              );
              if (clonedEdges.length > 0) {
                setEdges((prev: any[]) => [...prev, ...clonedEdges]);
              }

              // 记录已创建副本，用于在 dragStop 时提交历史
              altDragStartRef.current = {
                nodeId: node.id,
                altPressed: true,
                startPositions,
                startAbsPositions,
                idMap,
                cloned: true,
              };
            } else {
              altDragStartRef.current = null;
            }
          } else {
            altDragStartRef.current = null;
          }
        }}
        onNodeDragStop={(event, node) => {
          nodeDraggingRef.current = false;
          setIsNodeDragging(false);

          // Alt+拖拽复制：副本已在 dragStart 时创建，这里只需提交历史
          if (
            altDragStartRef.current?.altPressed &&
            altDragStartRef.current.cloned
          ) {
            // 提交历史记录
            try {
              historyService.commit("flow-alt-drag-clone").catch(() => {});
            } catch {}

            // 提交到项目内容
            const ns = rfNodesToTplNodes((rf.getNodes?.() || nodes) as any);
            const es = rfEdgesToTplEdges(rf.getEdges?.() || edges);
            scheduleCommit(ns, es);

            // 不要立刻清理：ReactFlow 可能会在 dragStop 之后再派发一次 position(dragging:false)，
            // 需要让 onNodesChange 继续把“原节点位移”重映射到副本，避免最终落点回到原节点上。
            const snapshot = altDragStartRef.current;
            window.setTimeout(() => {
              if (altDragStartRef.current === snapshot) {
                altDragStartRef.current = null;
              }
            }, 0);
            syncViewportToCanvasStore();
            return;
          }

          // 清理 Alt 拖拽状态
          altDragStartRef.current = null;

          // 普通拖拽：提交位置变化
          const ns = rfNodesToTplNodes((rf.getNodes?.() || nodes) as any);
          const es = rfEdgesToTplEdges(rf.getEdges?.() || edges);
          scheduleCommit(ns, es);
          syncViewportToCanvasStore();
        }}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onPaneClick={onPaneClick}
        onEdgeDoubleClick={handleEdgeDoubleClick}
        isValidConnection={isValidConnection}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView={false}
        panOnDrag={!isPointerMode}
        autoPanOnNodeDrag={false}
        autoPanOnConnect={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        selectionOnDrag={isPointerMode}
        selectNodesOnDrag={!isPointerMode}
        nodesDraggable={true}
        nodesConnectable={!isPointerMode}
        multiSelectionKeyCode={isPointerMode ? null : ["Meta", "Control"]}
        selectionKeyCode={isPointerMode ? null : null}
        deleteKeyCode={["Backspace", "Delete"]}
        proOptions={{ hideAttribution: true }}
        onlyRenderVisibleElements={onlyRenderVisibleElements}
      >
        {backgroundEnabled && (
          <Background
            variant={
              backgroundVariant === FlowBackgroundVariant.DOTS
                ? BackgroundVariant.Dots
                : backgroundVariant === FlowBackgroundVariant.LINES
                ? BackgroundVariant.Lines
                : BackgroundVariant.Cross
            }
            gap={backgroundGap}
            size={backgroundSize}
            color={backgroundColor}
            style={{ opacity: backgroundOpacity }}
          />
        )}
        {/* 视口由 Canvas 驱动，禁用 MiniMap 交互避免竞态 - 专注模式下隐藏 */}
        {!focusMode && <MiniMap pannable={false} zoomable={false} />}
        {/* 将画布上的图片以绿色块显示在 MiniMap 内 - 专注模式下隐藏 */}
        {!focusMode && <MiniMapImageOverlay />}
      </ReactFlow>

      {showFpsOverlay && (
        <div
          style={{
            position: "fixed",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1000,
            pointerEvents: "none",
            fontSize: 12,
            padding: "6px 8px",
            borderRadius: 16,
            border: "1px solid rgba(229,231,235,0.9)",
            background: "rgba(255,255,255,0.85)",
            color: "#111827",
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          }}
        >
          {(fpsMode || "Image") + " FPS"}: {dragFps ? dragFps.toFixed(1) : "--"}{" "}
          | max: {dragMaxFrameMs ? dragMaxFrameMs.toFixed(1) : "--"}ms | long:{" "}
          {dragLongFrames}
        </div>
      )}

      {edgeLabelEditor.visible && (
        <div
          className='tanva-edge-label-editor'
          style={{
            left: edgeLabelEditor.position.x,
            top: edgeLabelEditor.position.y,
          }}
          data-prevent-add-panel
        >
          <input
            ref={edgeLabelInputRef}
            value={edgeLabelEditor.value}
            onChange={handleEdgeLabelChange}
            onKeyDown={handleEdgeLabelKeyDown}
            onBlur={handleEdgeLabelBlur}
            placeholder='输入文本'
          />
        </div>
      )}

      {/* 添加面板（双击空白处出现） */}
      <div ref={addPanelRef} style={addPanelStyle} className='tanva-add-panel'>
        {addPanel.visible && (
          <div
            style={{
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 16,
              boxShadow:
                "0 18px 45px rgba(0,0,0,0.12), 0 8px 16px rgba(0,0,0,0.08)",
              width: "60vw",
              minWidth: 720,
              maxWidth: 960,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                padding: "10px 12px 0",
                borderBottom: "none",
                background: "#f5f7fa",
                borderTopLeftRadius: 16,
                borderTopRightRadius: 16,
              }}
            >
              <div style={{ display: "flex", gap: 2 }}>
                {allowedAddTabs.includes("nodes") && (
                  <button
                    onClick={() => setAddTabWithMemory("nodes", allowedAddTabs)}
                    style={{
                      padding: "10px 18px 14px",
                      fontSize: 13,
                      fontWeight: addTab === "nodes" ? 600 : 500,
                      borderRadius: "24px 24px 0 0",
                      border: "none",
                      background: addTab === "nodes" ? "#fff" : "transparent",
                      color: addTab === "nodes" ? "#111827" : "#374151",
                      marginBottom: -2,
                      transition: "all 0.15s ease",
                      cursor: "pointer",
                    }}
                  >
                    节点
                  </button>
                )}
                {allowedAddTabs.includes("beta") && (
                  <button
                    onClick={() => setAddTabWithMemory("beta", allowedAddTabs)}
                    style={{
                      padding: "10px 18px 14px",
                      fontSize: 13,
                      fontWeight: addTab === "beta" ? 600 : 500,
                      borderRadius: "24px 24px 0 0",
                      border: "none",
                      background: addTab === "beta" ? "#fff" : "transparent",
                      color: addTab === "beta" ? "#111827" : "#374151",
                      marginBottom: -2,
                      transition: "all 0.15s ease",
                      cursor: "pointer",
                    }}
                  >
                    Beta节点
                  </button>
                )}
                {allowedAddTabs.includes("custom") && (
                  <button
                    onClick={() =>
                      setAddTabWithMemory("custom", allowedAddTabs)
                    }
                    style={{
                      padding: "10px 18px 14px",
                      fontSize: 13,
                      fontWeight: addTab === "custom" ? 600 : 500,
                      borderRadius: "24px 24px 0 0",
                      border: "none",
                      background: addTab === "custom" ? "#fff" : "transparent",
                      color: addTab === "custom" ? "#111827" : "#374151",
                      marginBottom: -2,
                      transition: "all 0.15s ease",
                      cursor: "pointer",
                    }}
                  >
                    定制化节点
                  </button>
                )}
                {allowedAddTabs.includes("templates") && (
                  <>
                    <button
                      onClick={() => {
                        setAddTabWithMemory("templates", allowedAddTabs);
                        setTemplateScope("public");
                      }}
                      style={{
                        padding: "10px 18px 14px",
                        fontSize: 13,
                        fontWeight:
                          addTab === "templates" && templateScope === "public"
                            ? 600
                            : 500,
                        borderRadius: "24px 24px 0 0",
                        border: "none",
                        background:
                          addTab === "templates" && templateScope === "public"
                            ? "#fff"
                            : "transparent",
                        color:
                          addTab === "templates" && templateScope === "public"
                            ? "#111827"
                            : "#374151",
                        marginBottom: -2,
                        transition: "all 0.15s ease",
                        cursor: "pointer",
                      }}
                    >
                      公共模板
                    </button>
                    <button
                      onClick={() => {
                        setAddTabWithMemory("templates", allowedAddTabs);
                        setTemplateScope("mine");
                      }}
                      style={{
                        padding: "10px 18px 14px",
                        fontSize: 13,
                        fontWeight:
                          addTab === "templates" && templateScope === "mine"
                            ? 600
                            : 500,
                        borderRadius: "24px 24px 0 0",
                        border: "none",
                        background:
                          addTab === "templates" && templateScope === "mine"
                            ? "#fff"
                            : "transparent",
                        color:
                          addTab === "templates" && templateScope === "mine"
                            ? "#111827"
                            : "#374151",
                        marginBottom: -2,
                        transition: "all 0.15s ease",
                        cursor: "pointer",
                      }}
                    >
                      我的模板
                    </button>
                  </>
                )}
                {/* 个人库标签已移至独立按钮，此处隐藏 */}
                {false && allowedAddTabs.includes("personal") && (
                  <button
                    onClick={() =>
                      setAddTabWithMemory("personal", allowedAddTabs)
                    }
                    style={{
                      padding: "10px 18px 14px",
                      fontSize: 13,
                      fontWeight: addTab === "personal" ? 600 : 500,
                      borderRadius: "24px 24px 0 0",
                      border: "none",
                      background:
                        addTab === "personal" ? "#fff" : "transparent",
                      color: addTab === "personal" ? "#111827" : "#374151",
                      marginBottom: -2,
                      transition: "all 0.15s ease",
                      cursor: "pointer",
                    }}
                  >
                    个人库
                  </button>
                )}
              </div>
            </div>
            {addTab === "nodes" ? (
              <div
                style={{
                  height: "min(70vh, 640px)",
                  overflowY: "auto",
                  overflowX: "hidden",
                  paddingTop: 8,
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: 12,
                    padding: 20,
                  }}
                >
                  {NODE_PALETTE_ITEMS.map((item) => (
                    <NodePaletteButton
                      key={item.key}
                      zh={item.zh}
                      en={item.en}
                      badge={item.badge}
                      credits={NODE_CREDITS_MAP[item.key]}
                      onClick={() =>
                        createNodeAtWorldCenter(item.key, addPanel.world)
                      }
                    />
                  ))}
                </div>
              </div>
            ) : addTab === "beta" ? (
              <div
                style={{
                  height: "min(70vh, 640px)",
                  overflowY: "auto",
                  overflowX: "hidden",
                  padding: "12px 18px 18px",
                }}
              >
                <div style={{ marginBottom: 18 }}>
                  <div
                    style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}
                  >
                    Beta 节点
                  </div>
                  <div style={{ fontSize: 13, color: "#6b7280", marginTop: 6 }}>
                    实验性功能节点
                  </div>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, 1fr)",
                    gap: 10,
                  }}
                >
                  {BETA_NODE_ITEMS.map((item) => (
                    <NodePaletteButton
                      key={item.key}
                      zh={item.zh}
                      en={item.en}
                      badge={item.badge}
                      credits={NODE_CREDITS_MAP[item.key]}
                      onClick={() =>
                        createNodeAtWorldCenter(item.key, addPanel.world)
                      }
                    />
                  ))}
                </div>
              </div>
            ) : addTab === "custom" ? (
              <div
                style={{
                  height: "min(70vh, 640px)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 40,
                }}
              >
                <div
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: "50%",
                    background: "#f3f4f6",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 16,
                  }}
                >
                  <svg
                    width='32'
                    height='32'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='#9ca3af'
                    strokeWidth='2'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                  >
                    <rect x='3' y='3' width='7' height='7' rx='1' />
                    <rect x='14' y='3' width='7' height='7' rx='1' />
                    <rect x='3' y='14' width='7' height='7' rx='1' />
                    <path d='M17.5 14v7' />
                    <path d='M14 17.5h7' />
                  </svg>
                </div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: "#374151",
                    marginBottom: 8,
                  }}
                >
                  定制化节点
                </div>
                <div
                  style={{
                    fontSize: 14,
                    color: "#6b7280",
                    textAlign: "center",
                  }}
                >
                  为您量身定制的专属节点，敬请期待
                </div>
              </div>
            ) : addTab === "templates" ? (
              <div
                style={{
                  height: "min(70vh, 640px)",
                  overflowY: "auto",
                  overflowX: "hidden",
                  padding: "12px 18px 18px",
                }}
              >
                {templateScope === "public" && tplIndex ? (
                  <div style={{ marginBottom: 18 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        marginBottom: 14,
                      }}
                    >
                      <div
                        style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
                      >
                        <button
                          onClick={() => setActiveBuiltinCategory("")}
                          style={{
                            padding: "6px 14px",
                            borderRadius: 999,
                            border:
                              "1px solid " +
                              (!activeBuiltinCategory ? "#18181b" : "#e5e7eb"),
                            background: !activeBuiltinCategory
                              ? "#18181b"
                              : "#fff",
                            color: !activeBuiltinCategory ? "#fff" : "#374151",
                            fontSize: 12,
                            fontWeight: !activeBuiltinCategory ? 600 : 500,
                            cursor: "pointer",
                            transition: "all 0.15s ease",
                            boxShadow: !activeBuiltinCategory
                              ? "0 10px 18px rgba(0, 0, 0, 0.18)"
                              : "none",
                          }}
                        >
                          全部
                        </button>
                        {builtinCategories.map((cat) => {
                          const isActive = activeBuiltinCategory === cat;
                          return (
                            <button
                              key={cat}
                              onClick={() =>
                                setActiveBuiltinCategory((prev) =>
                                  prev === cat ? "" : cat
                                )
                              }
                              style={{
                                padding: "6px 14px",
                                borderRadius: 999,
                                border:
                                  "1px solid " +
                                  (isActive ? "#18181b" : "#e5e7eb"),
                                background: isActive ? "#18181b" : "#fff",
                                color: isActive ? "#fff" : "#374151",
                                fontSize: 12,
                                fontWeight: isActive ? 600 : 500,
                                cursor: "pointer",
                                transition: "all 0.15s ease",
                                boxShadow: isActive
                                  ? "0 10px 18px rgba(0, 0, 0, 0.18)"
                                  : "none",
                              }}
                            >
                              {cat}
                            </button>
                          );
                        })}
                      </div>
                      <div style={{ width: 1 }} />
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                        gap: 20,
                      }}
                    >
                      {filteredTplIndex.map((item) => (
                        <SharedTemplateCard
                          key={item.id}
                          item={item as any}
                          onClick={() => {
                            (async () => {
                              const tpl = await loadBuiltInTemplateById(
                                item.id
                              );
                              if (tpl)
                                instantiateTemplateAt(tpl, addPanel.world);
                            })();
                          }}
                        />
                      ))}
                      {Array.from({
                        length: getPlaceholderCount(filteredTplIndex.length, {
                          minVisible: 6,
                        }),
                      }).map((_, idx) => (
                        <TemplatePlaceholder
                          key={`builtin-placeholder-${idx}`}
                          label='敬请期待更多模板'
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
                {templateScope === "mine" ? (
                  <div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "flex-end",
                        gap: 8,
                        marginBottom: 14,
                      }}
                    >
                      <button
                        onClick={exportFlow}
                        title='导出当前编排为JSON'
                        style={{
                          padding: "6px 12px",
                          borderRadius: 999,
                          border: "1px solid #e5e7eb",
                          background: "#fff",
                          color: "#374151",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: 500,
                          transition: "all 0.15s ease",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "#f9fafb";
                          e.currentTarget.style.borderColor = "#d1d5db";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "#fff";
                          e.currentTarget.style.borderColor = "#e5e7eb";
                        }}
                      >
                        <Upload size={14} strokeWidth={2} />
                        {isExporting ? "导出中..." : "导出"}
                      </button>
                      <button
                        onClick={handleImportClick}
                        title='导入JSON并复现编排'
                        style={{
                          padding: "6px 12px",
                          borderRadius: 999,
                          border: "1px solid #e5e7eb",
                          background: "#fff",
                          color: "#374151",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: 500,
                          transition: "all 0.15s ease",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "#f9fafb";
                          e.currentTarget.style.borderColor = "#d1d5db";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "#fff";
                          e.currentTarget.style.borderColor = "#e5e7eb";
                        }}
                      >
                        <Download size={14} strokeWidth={2} />
                        导入
                      </button>
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                        gap: 20,
                      }}
                    >
                      <AddTemplateCard
                        onAdd={saveCurrentAsTemplate}
                        label={
                          userTplList.length
                            ? "保存当前为新模板"
                            : "创建我的第一个模板"
                        }
                      />
                      {userTplList.map((item) => {
                        return (
                          <UserTemplateCard
                            key={item.id}
                            item={item}
                            onInstantiate={async () => {
                              const tpl = await getUserTemplate(item.id);
                              if (tpl)
                                instantiateTemplateAt(tpl, addPanel.world);
                            }}
                            onDelete={async () => {
                              if (
                                confirm(
                                  `确定要删除模板 "${item.name}" 吗？此操作无法撤销。`
                                )
                              ) {
                                try {
                                  await deleteUserTemplate(item.id);
                                  const list = await listUserTemplates();
                                  setUserTplList(list);
                                } catch (err) {
                                  console.error("删除模板失败:", err);
                                  alert("删除模板失败");
                                }
                              }
                            }}
                          />
                        );
                      })}
                      {Array.from({
                        length:
                          userTplList.length === 0
                            ? 0
                            : getPlaceholderCount(userTplList.length + 1, {
                                minVisible: 4,
                              }),
                      }).map((_, idx) => (
                        <TemplatePlaceholder key={`user-placeholder-${idx}`} />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : addTab === "personal" ? (
              <PersonalLibraryPanel />
            ) : null}
          </div>
        )}
        <input
          ref={importInputRef}
          type='file'
          accept='application/json'
          style={{ display: "none" }}
          onChange={(e) => handleImportFiles(e.target.files)}
        />
      </div>
    </div>
  );
}

export default function FlowOverlay() {
  // 若未启用 Flow UI，则让该层不拦截指针事件
  const flowUIEnabled = useUIStore((s) => s.flowUIEnabled);
  const wrapperStyle: React.CSSProperties = flowUIEnabled
    ? { pointerEvents: "auto" }
    : { pointerEvents: "none" };
  return (
    <div style={{ position: "absolute", inset: 0, ...wrapperStyle }}>
      <ReactFlowProvider>
        <FlowInner />
      </ReactFlowProvider>
    </div>
  );
}
