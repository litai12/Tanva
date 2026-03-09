import React from "react";
import { Handle, Position } from "reactflow";
import { Send as SendIcon } from "lucide-react";
import ImagePreviewModal, { type ImageItem } from "../../ui/ImagePreviewModal";
import SmartImage from "../../ui/SmartImage";
import { useImageHistoryStore } from "../../../stores/imageHistoryStore";
import GenerationProgressBar from "./GenerationProgressBar";
import { useProjectContentStore } from "@/stores/projectContentStore";
import { proxifyRemoteAssetUrl } from "@/utils/assetProxy";
import { parseFlowImageAssetRef } from "@/services/flowImageAssetStore";
import { useFlowImageAssetUrl } from "@/hooks/useFlowImageAssetUrl";
import { toRenderableImageSrc } from "@/utils/imageSource";
import { useAIChatStore } from "@/stores/aiChatStore";
import { useLocaleText } from "@/utils/localeText";

type Props = {
  id: string;
  data: {
    status?: "idle" | "running" | "succeeded" | "failed";
    imageData?: string;
    imageUrl?: string;
    thumbnail?: string;
    error?: string;
    aspectRatio?:
      | "1:1"
      | "2:3"
      | "3:2"
      | "3:4"
      | "4:3"
      | "4:5"
      | "5:4"
      | "9:16"
      | "16:9"
      | "21:9"
      | "4:1"
      | "1:4"
      | "8:1"
      | "1:8";
    imageSize?: "0.5K" | "1K" | "2K" | "4K";
    presetPrompt?: string;
    onRun?: (id: string) => void;
    onSend?: (id: string) => void;
  };
  selected?: boolean;
};

// 构建图片 src - 优先使用 OSS URL，避免 proxy 降级
const buildImageSrc = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return toRenderableImageSrc(trimmed) || undefined;
};

function GenerateNodeInner({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const { status, error } = data;
  const aiProvider = useAIChatStore((state) => state.aiProvider);
  const rawFullValue = data.imageData || data.imageUrl;
  const fullAssetId = React.useMemo(() => parseFlowImageAssetRef(rawFullValue), [rawFullValue]);
  const fullAssetUrl = useFlowImageAssetUrl(fullAssetId);
  const fullSrc = fullAssetId ? (fullAssetUrl || undefined) : buildImageSrc(rawFullValue);

  const rawThumbValue = data.thumbnail;
  const thumbAssetId = React.useMemo(() => parseFlowImageAssetRef(rawThumbValue), [rawThumbValue]);
  const thumbAssetUrl = useFlowImageAssetUrl(thumbAssetId);
  const displaySrc = thumbAssetId ? (thumbAssetUrl || fullSrc) : (buildImageSrc(rawThumbValue) || fullSrc);
  const [hover, setHover] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);
  const [currentImageId, setCurrentImageId] = React.useState<string>("");
  const borderColor = selected ? "#2563eb" : "#e5e7eb";
  const boxShadow = selected
    ? "0 0 0 2px rgba(37,99,235,0.12)"
    : "0 1px 2px rgba(0,0,0,0.04)";

  // 使用全局图片历史记录
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
          } as ImageItem)
      ),
    [projectHistory]
  );

  const updateAspectRatio = React.useCallback(
    (ratio: string) => {
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: {
            id,
            patch: {
              aspectRatio: ratio || undefined,
            },
          },
        })
      );
    },
    [id]
  );

  const aspectRatioValue = data.aspectRatio ?? "";
  const imageSizeValue = data.imageSize ?? "";
  const aspectOptions: Array<{ label: string; value: string }> = React.useMemo(
    () => [
      { label: lt("自动", "Auto"), value: "" },
      { label: "1:1", value: "1:1" },
      { label: "3:4", value: "3:4" },
      { label: "4:3", value: "4:3" },
      { label: "2:3", value: "2:3" },
      { label: "3:2", value: "3:2" },
      { label: "4:5", value: "4:5" },
      { label: "5:4", value: "5:4" },
      { label: "9:16", value: "9:16" },
      { label: "16:9", value: "16:9" },
      { label: "21:9", value: "21:9" },
    ],
    [lt]
  );

  const providerMode = React.useMemo<"fast" | "pro" | "ultra" | "other">(() => {
    if (aiProvider === "banana-2.5") return "fast";
    if (aiProvider === "banana-3.1") return "ultra";
    if (aiProvider === "banana" || aiProvider === "gemini-pro") return "pro";
    return "other";
  }, [aiProvider]);

  const providerModeLabel = React.useMemo(() => {
    if (providerMode === "fast") return "Fast";
    if (providerMode === "pro") return "Pro";
    if (providerMode === "ultra") return "Ultra";
    return aiProvider;
  }, [aiProvider, providerMode]);

  const showAspectRatioSelector = providerMode !== "fast";
  const showImageSizeSelector = providerMode === "pro" || providerMode === "ultra";
  const showSizeControls = showAspectRatioSelector || showImageSizeSelector;

  const imageSizeOptions: Array<{ label: string; value: string }> = React.useMemo(() => {
    const base = [
      { label: lt("自动", "Auto"), value: "" },
      { label: "1K", value: "1K" },
      { label: "2K", value: "2K" },
      { label: "4K", value: "4K" },
    ];
    if (providerMode === "ultra") {
      return [base[0], { label: "0.5K", value: "0.5K" }, ...base.slice(1)];
    }
    return base;
  }, [lt, providerMode]);

  const stopNodeDrag = React.useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
    const nativeEvent = (event as React.SyntheticEvent<any, Event>)
      .nativeEvent as Event & { stopImmediatePropagation?: () => void };
    nativeEvent.stopImmediatePropagation?.();
  }, []);

  const updateImageSize = React.useCallback(
    (size: string) => {
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: {
            id,
            patch: {
              imageSize: size || undefined,
            },
          },
        })
      );
    },
    [id]
  );

  const presetPromptValue = data.presetPrompt ?? "";
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

  const onRun = React.useCallback(() => {
    data.onRun?.(id);
  }, [data, id]);

  const onSend = React.useCallback(() => {
    data.onSend?.(id);
  }, [data, id]);

  // 处理图片切换
  const handleImageChange = React.useCallback(
    (imageId: string) => {
      const selectedImage = allImages.find((item) => item.id === imageId);
      if (selectedImage) {
        setCurrentImageId(imageId);
        // 这里可以选择是否更新节点的图片数据
        // 暂时只更新预览，不更新节点数据
      }
    },
    [allImages]
  );

  React.useEffect(() => {
    if (!preview) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreview(false);
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
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontWeight: 600 }}>Generate</div>
          <div
            style={{
              padding: "1px 8px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 600,
              color: providerMode === "ultra" ? "#0f172a" : "#475569",
              background: providerMode === "ultra" ? "#e2e8f0" : "#f1f5f9",
              border: "1px solid #e2e8f0",
            }}
            title={`${lt("当前全局模型模式", "Current global model mode")}: ${providerModeLabel}`}
          >
            {providerModeLabel}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={onRun}
            disabled={status === "running"}
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
            {status === "running" ? "Running..." : "Run"}
          </button>
          <button
            onClick={onSend}
            disabled={!(data.imageData || data.imageUrl)}
            title={!(data.imageData || data.imageUrl) ? lt("无可发送的图像", "No image to send") : lt("发送到画布", "Send to canvas")}
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
          placeholder={lt('生成时自动拼接在提示词前', 'Auto-prepended before the prompt during generation')}
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
          {lt("会在 TextPrompt 输入前自动添加", "Will be automatically added before TextPrompt input")}
        </div>
      </div>
      {showSizeControls && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent:
              showAspectRatioSelector && showImageSizeSelector
                ? "space-between"
                : "flex-start",
            marginBottom: 6,
          }}
        >
          {showAspectRatioSelector && (
            <label
              className='nodrag nopan'
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "#6b7280",
              }}
            >
              {lt("尺寸", "Aspect")}
              <select
                value={aspectRatioValue}
                onChange={(e) => updateAspectRatio(e.target.value)}
                onPointerDown={stopNodeDrag}
                onPointerDownCapture={stopNodeDrag}
                onMouseDown={stopNodeDrag}
                onMouseDownCapture={stopNodeDrag}
                onClick={stopNodeDrag}
                onClickCapture={stopNodeDrag}
                className='nodrag nopan'
                style={{
                  fontSize: 12,
                  padding: "2px 6px",
                  borderRadius: 6,
                  border: "1px solid #e5e7eb",
                  background: "#fff",
                  color: "#111827",
                }}
              >
                {aspectOptions.map((opt) => (
                  <option key={opt.value || "auto"} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {showImageSizeSelector && (
            <label
              className='nodrag nopan'
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "#6b7280",
              }}
            >
              {lt("分辨率", "Resolution")}
              <select
                value={imageSizeValue}
                onChange={(e) => updateImageSize(e.target.value)}
                onPointerDown={stopNodeDrag}
                onPointerDownCapture={stopNodeDrag}
                onMouseDown={stopNodeDrag}
                onMouseDownCapture={stopNodeDrag}
                onClick={stopNodeDrag}
                onClickCapture={stopNodeDrag}
                className='nodrag nopan'
                style={{
                  fontSize: 12,
                  padding: "2px 6px",
                  borderRadius: 6,
                  border: "1px solid #e5e7eb",
                  background: "#fff",
                  color: "#111827",
                }}
              >
                {imageSizeOptions.map((opt) => (
                  <option key={opt.value || "auto"} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      <div
        onDoubleClick={() => fullSrc && setPreview(true)}
        style={{
          width: "100%",
          height: 160,
          background: "#fff",
          borderRadius: 6,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          border: "1px solid #eef0f2",
        }}
        title={displaySrc ? lt("双击预览", "Double click to preview") : undefined}
      >
        {displaySrc ? (
          <SmartImage
            src={displaySrc}
            alt=''
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              background: "#fff",
            }}
          />
        ) : (
          <span style={{ fontSize: 12, color: "#9ca3af" }}>{lt("等待生成", "Waiting for generation")}</span>
        )}
      </div>
      <GenerationProgressBar status={status} />
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

      {/* 输入：img 在上，text 在下；输出：img */}
      <Handle
        type='target'
        position={Position.Left}
        id='img'
        style={{ top: "35%" }}
        onMouseEnter={() => setHover("img-in")}
        onMouseLeave={() => setHover(null)}
      />
      {/* 兼容历史多图输入句柄，避免旧连线 targetHandle=img2/img3... 报错 */}
      {["img2", "img3", "img4", "img5", "img6"].map((legacyHandleId) => (
        <Handle
          key={legacyHandleId}
          type='target'
          position={Position.Left}
          id={legacyHandleId}
          style={{
            top: "35%",
            width: 1,
            height: 1,
            opacity: 0,
            border: "none",
            background: "transparent",
            pointerEvents: "none",
          }}
        />
      ))}
      <Handle
        type='target'
        position={Position.Left}
        id='text'
        style={{ top: "65%" }}
        onMouseEnter={() => setHover("prompt-in")}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type='source'
        position={Position.Right}
        id='img'
        style={{ top: "50%" }}
        onMouseEnter={() => setHover("img-out")}
        onMouseLeave={() => setHover(null)}
      />

      {hover === "img-in" && (
        <div
          className='flow-tooltip'
          style={{ left: -8, top: "35%", transform: "translate(-100%, -50%)" }}
        >
          image
        </div>
      )}
      {hover === "prompt-in" && (
        <div
          className='flow-tooltip'
          style={{ left: -8, top: "65%", transform: "translate(-100%, -50%)" }}
        >
          prompt
        </div>
      )}
      {hover === "img-out" && (
        <div
          className='flow-tooltip'
          style={{ right: -8, top: "50%", transform: "translate(100%, -50%)" }}
        >
          image
        </div>
      )}

      <ImagePreviewModal
        isOpen={preview}
        imageSrc={
          allImages.length > 0 && currentImageId
            ? allImages.find((item) => item.id === currentImageId)?.src ||
              fullSrc ||
              ""
            : fullSrc || ""
        }
        imageTitle={lt('全局图片预览', 'Global image preview')}
        onClose={() => setPreview(false)}
        imageCollection={allImages}
        currentImageId={currentImageId}
        onImageChange={handleImageChange}
      />
    </div>
  );
}

export default React.memo(GenerateNodeInner);
