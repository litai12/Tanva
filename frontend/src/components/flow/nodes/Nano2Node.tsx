import React from "react";
import { Handle, Position, useStore } from "reactflow";
import { Send as SendIcon } from "lucide-react";
import ImagePreviewModal, { type ImageItem } from "../../ui/ImagePreviewModal";
import SmartImage from "../../ui/SmartImage";
import { useImageHistoryStore } from "../../../stores/imageHistoryStore";
import GenerationProgressBar from "./GenerationProgressBar";
import { useProjectContentStore } from "@/stores/projectContentStore";
import { parseFlowImageAssetRef } from "@/services/flowImageAssetStore";
import { useFlowImageAssetUrl } from "@/hooks/useFlowImageAssetUrl";
import { toRenderableImageSrc } from "@/utils/imageSource";
import { useLocaleText } from "@/utils/localeText";
import {
  flowImagePreviewWell,
  flowLetterboxBackground,
  useFlowNodeDarkTheme,
} from "./flowNodeDarkTheme";
import RunCreditBadge from "./RunCreditBadge";
import NodeSelect from "./NodeSelect";
import { useAIChatStore } from "@/stores/aiChatStore";
import { useImageNodeCreditsPreview } from "../hooks/useImageNodeCreditsPreview";

type NodeConfigMetadata = {
  type?: string;
  flowNodeType?: string;
  provider?: string;
  model?: string;
  aspectRatios?: string[];
  resolutions?: string[];
  showResolutionSelector?: boolean;
  showGoogleSearch?: boolean;
  showGoogleImageSearch?: boolean;
  maxReferenceImages?: number;
  defaultData?: Record<string, any>;
};

type NodeData = {
  status?: "idle" | "running" | "succeeded" | "failed";
  imageData?: string;
  imageUrl?: string;
  thumbnail?: string;
  error?: string;
  aspectRatio?: string;
  resolution?: string;
  presetPrompt?: string;
  googleSearch?: boolean;
  googleImageSearch?: boolean;
  model?: string;
  modelProvider?: string;
  maxReferenceImages?: number;
  nodeConfigKey?: string;
  nodeConfigNameZh?: string;
  nodeConfigNameEn?: string;
  nodeConfigMetadata?: Record<string, any>;
  creditsPerCall?: number;
  managedModelKey?: string;
  vendorKey?: string;
  platformKey?: string;
  onRun?: (id: string) => void;
  onSend?: (id: string) => void;
};

type CreditNodeType =
  | "generate"
  | "generatePro"
  | "generateRef"
  | "analysis"
  | "seedream5"
  | "nano2"
  | "gptImage2"
  | "midjourney"
  | "midjourneyV7"
  | "niji7";

type Props = {
  id: string;
  data: NodeData;
  selected?: boolean;
};

const DEFAULT_ASPECT_RATIOS = [
  "1:1",
  "3:2",
  "2:3",
  "4:3",
  "3:4",
  "16:9",
  "9:16",
  "5:4",
  "4:5",
  "21:9",
  "4:1",
  "1:4",
  "8:1",
  "1:8",
];
const DEFAULT_RESOLUTIONS = ["0.5K", "1K", "2K", "4K"];

const buildImageSrc = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return toRenderableImageSrc(trimmed) || undefined;
};

const toStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
};

const resolveBool = (primary: unknown, fallback: boolean): boolean => {
  if (typeof primary === "boolean") return primary;
  return fallback;
};

const normalizeCreditNodeType = (value: string): CreditNodeType => {
  switch (value) {
    case "generate":
    case "generatePro":
    case "generateRef":
    case "analysis":
    case "seedream5":
    case "nano2":
    case "gptImage2":
    case "midjourney":
    case "midjourneyV7":
    case "niji7":
      return value;
    default:
      return "nano2";
  }
};

function Nano2NodeInner({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const { status, error } = data;
  const bananaImageRoute = useAIChatStore((state) => state.bananaImageRoute);

  const metadata = React.useMemo<NodeConfigMetadata | undefined>(() => {
    if (!data.nodeConfigMetadata || typeof data.nodeConfigMetadata !== "object") return undefined;
    return data.nodeConfigMetadata as NodeConfigMetadata;
  }, [data.nodeConfigMetadata]);
  const defaultData = React.useMemo<Record<string, any> | undefined>(() => {
    if (!metadata?.defaultData || typeof metadata.defaultData !== "object") return undefined;
    return metadata.defaultData as Record<string, any>;
  }, [metadata]);

  const titleZh = data.nodeConfigNameZh || "Nano2";
  const titleEn = data.nodeConfigNameEn || "Nano2";
  const resolvedNodeType = normalizeCreditNodeType(
    metadata?.flowNodeType || metadata?.type || data.nodeConfigKey || "nano2"
  );
  const resolvedProvider =
    data.modelProvider ||
    metadata?.provider ||
    (typeof defaultData?.modelProvider === "string" ? defaultData.modelProvider : undefined) ||
    "nano2";

  const aspectRatioOptions = React.useMemo(() => {
    const fromMeta = toStringList(metadata?.aspectRatios);
    return fromMeta.length > 0 ? fromMeta : DEFAULT_ASPECT_RATIOS;
  }, [metadata?.aspectRatios]);
  const resolutionOptions = React.useMemo(() => {
    const fromMeta = toStringList(metadata?.resolutions);
    return fromMeta.length > 0 ? fromMeta : DEFAULT_RESOLUTIONS;
  }, [metadata?.resolutions]);

  const showResolutionSelector = resolveBool(metadata?.showResolutionSelector, true);
  const showGoogleSearch = resolveBool(metadata?.showGoogleSearch, true);
  const showGoogleImageSearch = resolveBool(metadata?.showGoogleImageSearch, true);
  const maxReferenceImages = React.useMemo(() => {
    const raw = Number(
      data.maxReferenceImages ??
        metadata?.maxReferenceImages ??
        defaultData?.maxReferenceImages
    );
    return Number.isFinite(raw) && raw > 0 ? Math.max(1, Math.floor(raw)) : undefined;
  }, [data.maxReferenceImages, metadata?.maxReferenceImages, defaultData?.maxReferenceImages]);

  const aspectRatioValue =
    data.aspectRatio ??
    (typeof defaultData?.aspectRatio === "string" ? defaultData.aspectRatio : "") ??
    "";
  const resolutionValue =
    data.resolution ||
    (typeof defaultData?.resolution === "string" ? defaultData.resolution : "") ||
    resolutionOptions[0] ||
    "1K";
  const googleSearchValue =
    typeof data.googleSearch === "boolean"
      ? data.googleSearch
      : Boolean(defaultData?.googleSearch);
  const googleImageSearchValue =
    typeof data.googleImageSearch === "boolean"
      ? data.googleImageSearch
      : Boolean(defaultData?.googleImageSearch);

  const rawFullValue = data.imageUrl || data.imageData;
  const fullAssetId = React.useMemo(() => parseFlowImageAssetRef(rawFullValue), [rawFullValue]);
  const fullAssetUrl = useFlowImageAssetUrl(fullAssetId);
  const fullSrc = fullAssetId ? fullAssetUrl || undefined : buildImageSrc(rawFullValue);

  const rawThumbValue = data.thumbnail;
  const thumbAssetId = React.useMemo(() => parseFlowImageAssetRef(rawThumbValue), [rawThumbValue]);
  const thumbAssetUrl = useFlowImageAssetUrl(thumbAssetId);
  const displaySrc = thumbAssetId
    ? thumbAssetUrl || fullSrc
    : buildImageSrc(rawThumbValue) || fullSrc;

  const [hover, setHover] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);
  const [currentImageId, setCurrentImageId] = React.useState<string>("");

  const borderColor = selected ? "#2563eb" : "#e5e7eb";
  const boxShadow = selected
    ? "0 0 0 2px rgba(37,99,235,0.12)"
    : "0 1px 2px rgba(0,0,0,0.04)";
  const isFlowDark = useFlowNodeDarkTheme();
  const imageInputCount = useStore((state) => {
    const edges = state.edges || [];
    return edges.filter((edge) => edge.target === id && edge.targetHandle === "img").length;
  });

  const projectId = useProjectContentStore((state) => state.projectId);
  const history = useImageHistoryStore((state) => state.history);
  const projectHistory = React.useMemo(() => {
    if (!projectId) return history;
    return history.filter((item) => {
      const pid = item.projectId ?? null;
      return pid === projectId || pid === null;
    });
  }, [history, projectId]);

  const allImages = React.useMemo(
    () =>
      projectHistory.map(
        (item) =>
          ({
            id: item.id,
            src: item.src,
            title: item.title,
            timestamp: item.timestamp,
          }) as ImageItem
      ),
    [projectHistory]
  );

  const stopNodeDrag = React.useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
    const nativeEvent = (event as React.SyntheticEvent<any, Event>).nativeEvent as Event & {
      stopImmediatePropagation?: () => void;
    };
    nativeEvent.stopImmediatePropagation?.();
  }, []);

  const presetPromptValue =
    data.presetPrompt ??
    (typeof defaultData?.presetPrompt === "string" ? defaultData.presetPrompt : "") ??
    "";
  const updatePresetPrompt = React.useCallback(
    (value: string) => {
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: { id, patch: { presetPrompt: value } },
        })
      );
    },
    [id]
  );

  const updateAspectRatio = React.useCallback(
    (value: string) => {
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: { id, patch: { aspectRatio: value || undefined } },
        })
      );
    },
    [id]
  );

  const updateResolution = React.useCallback(
    (value: string) => {
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: { id, patch: { resolution: value } },
        })
      );
    },
    [id]
  );

  const updateGoogleSearch = React.useCallback(
    (value: boolean) => {
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: { id, patch: { googleSearch: value } },
        })
      );
    },
    [id]
  );

  const updateGoogleImageSearch = React.useCallback(
    (value: boolean) => {
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: { id, patch: { googleImageSearch: value } },
        })
      );
    },
    [id]
  );

  const onRun = React.useCallback(() => {
    data.onRun?.(id);
  }, [data, id]);

  const onSend = React.useCallback(() => {
    data.onSend?.(id);
  }, [data, id]);

  const { credits: backendCredits } = useImageNodeCreditsPreview({
    nodeType: resolvedNodeType,
    aiProvider: resolvedProvider,
    bananaImageRoute,
    imageSize: resolutionValue || undefined,
    aspectRatio: aspectRatioValue || undefined,
    referenceImageCount: imageInputCount,
    managedModelKey: data.managedModelKey,
    vendorKey: data.vendorKey,
    platformKey: data.platformKey,
    enabled: true,
  });
  const resolvedRunCredits =
    typeof backendCredits === "number" ? backendCredits : data.creditsPerCall;

  const handleImageChange = React.useCallback(
    (imageId: string) => {
      const selectedImage = allImages.find((item) => item.id === imageId);
      if (selectedImage) {
        setCurrentImageId(imageId);
      }
    },
    [allImages]
  );

  React.useEffect(() => {
    if (!preview) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreview(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [preview]);

  return (
    <div
      style={{
        width: 260,
        padding: 8,
        background: "#fff",
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        boxShadow,
        transition: "border-color 0.15s ease, box-shadow 0.15s ease",
        position: "relative",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <div style={{ fontWeight: 600 }}>{lt(titleZh, titleEn)}</div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={onRun}
            disabled={status === "running"}
            className='run-btn-with-credit'
            style={{
              fontSize: 12,
              padding: "4px 8px",
              background: status === "running" ? "#e5e7eb" : "#111827",
              color: "#fff",
              borderRadius: 6,
              border: "none",
              cursor: status === "running" ? "not-allowed" : "pointer",
            }}
          >
            {status === "running" ? (
              <span className='run-text-trigger'>Running...</span>
            ) : (
              <>
                <span className='run-text-trigger'>Run</span>
                <RunCreditBadge credits={resolvedRunCredits} runButton />
              </>
            )}
          </button>
          <button
            onClick={onSend}
            disabled={!(data.imageData || data.imageUrl)}
            title={
              !(data.imageData || data.imageUrl)
                ? lt("无可发送的图像", "No image to send")
                : lt("发送到画布", "Send to canvas")
            }
            style={{
              fontSize: 12,
              padding: "4px 8px",
              background: !(data.imageData || data.imageUrl) ? "#e5e7eb" : "#111827",
              color: "#fff",
              borderRadius: 6,
              border: "none",
              cursor: !(data.imageData || data.imageUrl) ? "not-allowed" : "pointer",
            }}
          >
            <SendIcon size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <label
          style={{
            display: "block",
            fontSize: 12,
            color: "#6b7280",
            marginBottom: 2,
          }}
        >
          {lt("预设提示词", "Preset prompt")}
        </label>
        <input
          value={presetPromptValue}
          onChange={(event) => updatePresetPrompt(event.target.value)}
          placeholder={lt(
            "生成时自动拼接在提示词前",
            "Auto-prepended before the prompt during generation"
          )}
          style={{
            width: "100%",
            fontSize: 12,
            padding: "4px 6px",
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            outline: "none",
            background: "#fff",
          }}
          onPointerDownCapture={stopNodeDrag}
          onPointerDown={stopNodeDrag}
          onMouseDownCapture={stopNodeDrag}
          onMouseDown={stopNodeDrag}
        />
        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
          {lt(
            "会在 TextPrompt 输入前自动添加",
            "Will be automatically added before TextPrompt input"
          )}
        </div>
      </div>

      <div style={{ marginBottom: 6 }}>
        <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 2 }}>
          {lt("宽高比", "Aspect ratio")}
        </label>
        <select
          value={aspectRatioValue}
          onChange={(event) => updateAspectRatio(event.target.value)}
          style={{
            width: "100%",
            fontSize: 12,
            padding: "4px 6px",
            borderRadius: 6,
            border: "1px solid #e5e7eb",
            outline: "none",
            background: "#fff",
          }}
          onPointerDownCapture={stopNodeDrag}
          onMouseDownCapture={stopNodeDrag}
        >
          <option value="">{lt("自动", "Auto")}</option>
          {aspectRatioOptions.map((ratio) => (
            <option key={ratio} value={ratio}>
              {ratio}
            </option>
          ))}
        </select>
      </div>

      {showResolutionSelector && resolutionOptions.length > 0 ? (
        <div style={{ marginBottom: 6 }}>
          <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 2 }}>
            {lt("分辨率", "Resolution")}
          </label>
          <NodeSelect
            value={resolutionValue}
            options={resolutionOptions.map((value) => ({ value, label: value }))}
            onChange={updateResolution}
            menuLabel={lt("分辨率", "Resolution")}
            title={lt("选择分辨率", "Select resolution")}
          />
        </div>
      ) : null}

      {(showGoogleSearch || showGoogleImageSearch) && (
        <div style={{ marginBottom: 8, display: "flex", gap: 12 }}>
          {showGoogleSearch ? (
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 12,
                color: "#6b7280",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={googleSearchValue}
                onChange={(event) => updateGoogleSearch(event.target.checked)}
                onPointerDownCapture={stopNodeDrag}
                onMouseDownCapture={stopNodeDrag}
              />
              {lt("文本搜索", "Text search")}
            </label>
          ) : null}
          {showGoogleImageSearch ? (
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 12,
                color: "#6b7280",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={googleImageSearchValue}
                onChange={(event) => updateGoogleImageSearch(event.target.checked)}
                onPointerDownCapture={stopNodeDrag}
                onMouseDownCapture={stopNodeDrag}
              />
              {lt("图片搜索", "Image search")}
            </label>
          ) : null}
        </div>
      )}

      <div
        onDoubleClick={() => fullSrc && setPreview(true)}
        style={{
          width: "100%",
          height: 160,
          borderRadius: 6,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          ...flowImagePreviewWell(isFlowDark, {
            background: "#fff",
            border: "1px solid #eef0f2",
          }),
        }}
        title={displaySrc ? lt("双击预览", "Double click to preview") : undefined}
      >
        {displaySrc ? (
          <SmartImage
            src={displaySrc}
            alt=""
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              background: flowLetterboxBackground(isFlowDark),
            }}
          />
        ) : (
          <span style={{ fontSize: 12, color: "#9ca3af" }}>{lt("等待生成", "Waiting for generation")}</span>
        )}
      </div>
      <GenerationProgressBar status={status} simulateDurationMs={15 * 60 * 1000} />
      {status === "failed" && error && (
        <div
          style={{
            fontSize: 12,
            color: "#ef4444",
            marginTop: 4,
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </div>
      )}

      <Handle
        type="target"
        position={Position.Left}
        id="img"
        style={{ top: "35%" }}
        onMouseEnter={() => setHover("img-in")}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="text"
        style={{ top: "65%" }}
        onMouseEnter={() => setHover("prompt-in")}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="img"
        style={{ top: "50%" }}
        onMouseEnter={() => setHover("img-out")}
        onMouseLeave={() => setHover(null)}
      />

      {hover === "img-in" && (
        <div
          className="flow-tooltip"
          style={{ left: -8, top: "35%", transform: "translate(-100%, -50%)" }}
        >
          image
        </div>
      )}
      {hover === "prompt-in" && (
        <div
          className="flow-tooltip"
          style={{ left: -8, top: "65%", transform: "translate(-100%, -50%)" }}
        >
          prompt
        </div>
      )}
      {hover === "img-out" && (
        <div
          className="flow-tooltip"
          style={{ right: -8, top: "50%", transform: "translate(100%, -50%)" }}
        >
          image
        </div>
      )}

      <ImagePreviewModal
        isOpen={preview}
        imageSrc={
          allImages.length > 0 && currentImageId
            ? allImages.find((item) => item.id === currentImageId)?.src || fullSrc || ""
            : fullSrc || ""
        }
        imageTitle={lt("全局图片预览", "Global image preview")}
        onClose={() => setPreview(false)}
        imageCollection={allImages}
        currentImageId={currentImageId}
        onImageChange={handleImageChange}
      />
      {typeof maxReferenceImages === "number" ? (
        <div style={{ marginTop: 4, fontSize: 11, color: "#9ca3af" }}>
          {lt("参考图上限", "Reference max")}: {maxReferenceImages}
        </div>
      ) : null}
    </div>
  );
}

export default React.memo(Nano2NodeInner);
