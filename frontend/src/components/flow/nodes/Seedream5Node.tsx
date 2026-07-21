import React from "react";
import { Handle, Position, useStore } from "@xyflow/react";
import { Send as SendIcon, HelpCircle } from "lucide-react";
import SmartImage from "../../ui/SmartImage";
import ImagePreviewModal from "../../ui/ImagePreviewModal";
import GenerationProgressBar from "./GenerationProgressBar";
import { parseFlowImageAssetRef } from "@/services/flowImageAssetStore";
import { useFlowImageAssetUrl } from "@/hooks/useFlowImageAssetUrl";
import { toRenderableImageSrc } from "@/utils/imageSource";
import { useLocaleText } from "@/utils/localeText";
import { flowImagePreviewWell, flowLetterboxBackground, useFlowNodeDarkTheme } from "./flowNodeDarkTheme";
import RunCreditBadge from "./RunCreditBadge";
import { useImageNodeCreditsPreview } from "../hooks/useImageNodeCreditsPreview";

type Props = {
  id: string;
  data: {
    status?: "idle" | "running" | "succeeded" | "failed";
    progressStartedAt?: number | string | null;
    images?: string[];
    imageUrls?: string[];
    thumbnails?: string[];
    error?: string;
    batchMode?: boolean;
    batchCount?: number;
    modelVersion?: "4.0" | "4.5" | "5.0" | "5.0-pro";
    size?: string;
    watermark?: boolean;
    creditsPerCall?: number;
    managedModelKey?: string;
    vendorKey?: string;
    platformKey?: string;
    onRun?: (id: string) => void;
    onSend?: (id: string) => void;
  };
  selected?: boolean;
};

const buildImageSrc = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return toRenderableImageSrc(trimmed) || undefined;
};

type SeedreamResolution = "1K" | "2K" | "3K" | "4K";

const resolveSeedreamResolutionOptions = (
  modelVersion: "4.0" | "4.5" | "5.0" | "5.0-pro"
): SeedreamResolution[] =>
  modelVersion === "4.0"
    ? ["1K", "2K", "4K"]
    : modelVersion === "4.5"
      ? ["2K", "4K"]
      : modelVersion === "5.0-pro"
        ? ["1K", "2K"]
        : ["2K", "3K", "4K"];

const normalizeSeedreamResolution = (
  value: string,
  allowed: SeedreamResolution[]
): SeedreamResolution => {
  const normalized = value.trim().toUpperCase();
  if (allowed.includes(normalized as SeedreamResolution)) {
    return normalized as SeedreamResolution;
  }
  if (allowed.includes("2K")) return "2K";
  return allowed[0];
};

function Seedream5Node({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const { status, error } = data;

  const images = React.useMemo(() => {
    const rawUrls = Array.isArray(data.imageUrls) ? data.imageUrls : [];
    const rawImages = Array.isArray(data.images) ? data.images : [];
    const maxLen = Math.max(rawUrls.length, rawImages.length);
    const merged: string[] = [];
    for (let i = 0; i < maxLen; i += 1) {
      const candidate = rawUrls[i] ?? rawImages[i];
      if (typeof candidate !== "string") continue;
      const trimmed = candidate.trim();
      if (!trimmed) continue;
      merged.push(trimmed);
    }
    return merged;
  }, [data.imageUrls, data.images]);

  const rawSizeValue =
    typeof data.size === "string" && data.size.trim().length > 0
      ? data.size.trim()
      : "2K";
  const modelVersionValue =
    data.modelVersion === "4.0" ||
    data.modelVersion === "4.5" ||
    data.modelVersion === "5.0" ||
    data.modelVersion === "5.0-pro"
      ? data.modelVersion
      : "5.0";
  const availableResolutionOptions = React.useMemo(
    () => resolveSeedreamResolutionOptions(modelVersionValue),
    [modelVersionValue]
  );
  const sizePresetValue = React.useMemo(
    () => normalizeSeedreamResolution(rawSizeValue, availableResolutionOptions),
    [availableResolutionOptions, rawSizeValue]
  );

  const [hover, setHover] = React.useState<string | null>(null);
  const [showHelp, setShowHelp] = React.useState(false);
  const [preview, setPreview] = React.useState(false);
  const [previewIndex, setPreviewIndex] = React.useState(0);
  const isFlowDark = useFlowNodeDarkTheme();

  // 妫€娴嬭繛鎺ョ殑鍥剧墖鏁伴噺
  const imageInputCount = useStore((state) => {
    const edges = state.edges || [];
    return edges.filter(
      (edge) => edge.target === id && edge.targetHandle === "img"
    ).length;
  });

  const { credits: backendCredits } = useImageNodeCreditsPreview({
    nodeType: "seedream5",
    aiProvider: "seedream5",
    modelVersion: modelVersionValue,
    imageSize: rawSizeValue,
    referenceImageCount: imageInputCount,
    managedModelKey: data.managedModelKey,
    vendorKey: data.vendorKey,
    platformKey: data.platformKey,
    enabled: true,
  });
  const resolvedRunCredits =
    typeof backendCredits === "number" ? backendCredits : data.creditsPerCall;

  const borderColor = selected ? "#2563eb" : "#e5e7eb";
  const boxShadow = selected
    ? "0 0 0 2px rgba(37,99,235,0.12)"
    : "0 1px 2px rgba(0,0,0,0.04)";

  const stopNodeDrag = React.useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
    const nativeEvent = (event as React.SyntheticEvent<any, Event>)
      .nativeEvent as Event & { stopImmediatePropagation?: () => void };
    nativeEvent.stopImmediatePropagation?.();
  }, []);

  const updateData = React.useCallback(
    (patch: Partial<typeof data>) => {
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: { id, patch },
        })
      );
    },
    [id]
  );

  React.useEffect(() => {
    const normalized = normalizeSeedreamResolution(
      rawSizeValue,
      availableResolutionOptions
    );
    if (normalized !== rawSizeValue.toUpperCase()) {
      updateData({ size: normalized });
    }
  }, [availableResolutionOptions, rawSizeValue, updateData]);

  const onRun = React.useCallback(() => {
    data.onRun?.(id);
  }, [data, id]);

  const onSend = React.useCallback(() => {
    data.onSend?.(id);
  }, [data, id]);

  // 鑾峰彇绗竴寮犲浘鐗囩敤浜庨瑙?
  const firstImage = images[0];
  const thumbnails = React.useMemo(() => data.thumbnails || [], [data.thumbnails]);
  const firstDisplayImage = thumbnails[0] || firstImage;
  const assetId = React.useMemo(() => parseFlowImageAssetRef(firstDisplayImage), [firstDisplayImage]);
  const assetUrl = useFlowImageAssetUrl(assetId);
  const resolvePreviewImageSrc = React.useCallback((value?: string): string => {
    const resolved = buildImageSrc(value);
    if (resolved) return resolved;
    return typeof value === "string" ? value.trim() : "";
  }, []);
  const displaySrc = assetId ? assetUrl : resolvePreviewImageSrc(firstDisplayImage);

  // 棰勮鐢ㄩ泦鍚?
  const previewCollection = React.useMemo(
    () =>
      images.map((value, i) => ({
        id: `${id}-${i}`,
        src: resolvePreviewImageSrc(value),
        title: lt(`第 ${i + 1} 张`, `Image ${i + 1}`),
      })),
    [id, images, lt, resolvePreviewImageSrc]
  );

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
        <div className='tanva-flow-node-title' style={{ fontWeight: 600 }}>Seedream</div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => setShowHelp(!showHelp)}
            style={{
              fontSize: 12,
              padding: "4px 8px",
              background: showHelp ? "#3b82f6" : "#f3f4f6",
              color: showHelp ? "#fff" : "#6b7280",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
            }}
            title={lt("玩法说明", "Help")}
          >
            <HelpCircle size={14} />
          </button>
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
            disabled={images.length === 0}
            title={images.length === 0 ? lt("无可发送的图像", "No image to send") : lt("发送到画板", "Send to canvas")}
            style={{
              fontSize: 12,
              padding: "4px 8px",
              background: images.length === 0 ? "#e5e7eb" : "#111827",
              color: "#fff",
              borderRadius: 6,
              border: "none",
              cursor: images.length === 0 ? "not-allowed" : "pointer",
            }}
          >
            <SendIcon size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* 鐜╂硶璇存槑 */}
      {showHelp && (
        <div style={{
          fontSize: 11,
          color: "#374151",
          background: "#f0f9ff",
          padding: "8px",
          borderRadius: 6,
          marginBottom: 8,
          border: "1px solid #bfdbfe",
          lineHeight: 1.5,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: "#1e40af" }}>
            {lt("可实现效果", "What You Can Do")}
          </div>
          <div style={{ marginBottom: 3 }}>
            <strong>{lt("纯文字生图", "Text to Image")}:</strong>{" "}
            {lt("根据描述生成全新图片", "Generate new images from text description")}
          </div>
          <div style={{ marginBottom: 3 }}>
            <strong>{lt("单图变体", "Single Image Variation")}:</strong> {lt("基于1张图生成相似风格", "Generate similar style from 1 image")}
          </div>
          <div style={{ marginBottom: 3 }}>
            <strong>{lt("多图融合", "Multi-Image Fusion")}:</strong> {lt("融合2-5张图的元素和风格", "Blend elements from 2-5 images")}
          </div>
          <div style={{ marginBottom: 3 }}>
            <strong>{lt("服装替换", "Outfit Change")}:</strong>{" "}
            {lt("将图1人物替换为图2风格服装", "Change person's outfit using reference")}
          </div>
          <div style={{ color: "#6b7280", fontSize: 10, marginTop: 4 }}>
            {lt("提示：多图输入可组合不同元素", "Tip: Multiple images can combine different elements")}
          </div>
        </div>
      )}

      {/* 鍥剧墖鏁伴噺璀﹀憡 */}
      {imageInputCount > 5 && (
        <div style={{
          fontSize: 11,
          color: "#b91c1c",
          background: "#fef2f2",
          padding: "6px 8px",
          borderRadius: 6,
          marginBottom: 8,
          border: "1px solid #fecaca",
        }}>
          {lt(
            `已连接 ${imageInputCount} 张图片，最多支持 5 张，只会使用前 5 张`,
            `Connected ${imageInputCount} images, max 5 supported, only first 5 will be used`
          )}
        </div>
      )}

      {/* 灏哄閫夋嫨 */}
      <div style={{ marginBottom: 8 }}>
        <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 2 }}>
          {lt("尺寸大小", "Size")}
        </label>
        <select
          value={sizePresetValue}
          onChange={(e) => updateData({ size: e.target.value })}
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
          {availableResolutionOptions.map((option) => (
            <option key={option} value={option}>
              {option === "1K"
                ? lt("1K 高清", "1K HD")
                : option === "2K"
                  ? lt("2K 超清", "2K HD")
                  : option === "3K"
                    ? lt("3K 高清", "3K Ultra HD")
                    : lt("4K 超清", "4K Ultra HD")}
            </option>
          ))}
        </select>
        </div>
      <div style={{ marginBottom: 8 }}>
          <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 2 }}>
            {lt("模型版本", "Model")}
          </label>
          <select
            value={modelVersionValue}
            onChange={(e) =>
              updateData({
                modelVersion:
                  e.target.value === "4.0"
                    ? "4.0"
                    : e.target.value === "4.5"
                      ? "4.5"
                      : e.target.value === "5.0-pro"
                        ? "5.0-pro"
                        : "5.0",
              })
            }
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
            <option value="4.0">Seedream 4.0</option>
            <option value="5.0">Seedream 5.0</option>
            <option value="5.0-pro">Seedream 5.0 Pro</option>
            <option value="4.5">Seedream 4.5</option>
          </select>
        </div>
      {/* 鍥剧墖棰勮 */}
      <div
        className="nodrag nopan nowheel"
        onPointerDownCapture={stopNodeDrag}
        onMouseDownCapture={stopNodeDrag}
        onDoubleClick={(event) => {
          event.stopPropagation();
          if (images.length > 0) {
            setPreviewIndex(0);
            setPreview(true);
          }
        }}
        style={{
          width: "100%",
          minHeight: 160,
          borderRadius: 6,
          display: "flex",
          flexWrap: "wrap",
          gap: 4,
          padding: images.length > 1 ? 4 : 0,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          cursor: images.length > 0 ? "pointer" : "default",
          ...flowImagePreviewWell(isFlowDark, {
            background: "#fff",
            border: "1px solid #eef0f2",
          }),
        }}
        title={images.length > 0 ? lt("双击预览", "Double click to preview") : undefined}
      >
        {images.length > 0 ? (
          images.map((img, idx) => (
            <div
              key={idx}
              className="nodrag nopan"
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
              onDoubleClick={(event) => {
                event.stopPropagation();
                setPreviewIndex(idx);
                setPreview(true);
              }}
              style={{
                width: images.length > 1 ? "calc(50% - 2px)" : "100%",
                height: images.length > 1 ? 78 : "100%",
                minHeight: images.length > 1 ? 78 : 160,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                cursor: "pointer",
              }}
            >
              <SmartImage
                src={resolvePreviewImageSrc(img)}
                alt=""
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  background: flowLetterboxBackground(isFlowDark),
                }}
              />
            </div>
          ))
        ) : displaySrc ? (
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

      <GenerationProgressBar
        status={status}
        simulateDurationMs={60 * 1000}
        startedAt={data.progressStartedAt}
        runKey={id}
      />

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

      {/* 杈撳叆鍙ユ焺 */}
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
        id="prompt"
        style={{ top: "65%" }}
        onMouseEnter={() => setHover("prompt-in")}
        onMouseLeave={() => setHover(null)}
      />

      {/* 杈撳嚭鍙ユ焺 */}
      <Handle
        type="source"
        position={Position.Right}
        id="img"
        style={{ top: "50%" }}
        onMouseEnter={() => setHover("img-out")}
        onMouseLeave={() => setHover(null)}
      />

      {/* Tooltip */}
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

      {/* 鍥剧墖棰勮寮圭獥 */}
      <ImagePreviewModal
        isOpen={preview}
        imageSrc={previewCollection[previewIndex]?.src || ""}
        imageTitle={lt("Seedream 图片预览", "Seedream Image Preview")}
        onClose={() => setPreview(false)}
        imageCollection={previewCollection}
        currentImageId={previewCollection[previewIndex]?.id}
        onImageChange={(imageId: string) => {
          const i = previewCollection.findIndex((it) => it.id === imageId);
          if (i >= 0) setPreviewIndex(i);
        }}
      />
    </div>
  );
}

export default React.memo(Seedream5Node);

