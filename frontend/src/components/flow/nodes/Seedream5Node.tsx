import React from "react";
import { Handle, Position, useStore } from "reactflow";
import { Send as SendIcon, HelpCircle } from "lucide-react";
import SmartImage from "../../ui/SmartImage";
import GenerationProgressBar from "./GenerationProgressBar";
import { parseFlowImageAssetRef } from "@/services/flowImageAssetStore";
import { useFlowImageAssetUrl } from "@/hooks/useFlowImageAssetUrl";
import { toRenderableImageSrc } from "@/utils/imageSource";
import { useLocaleText } from "@/utils/localeText";

type Props = {
  id: string;
  data: {
    status?: "idle" | "running" | "succeeded" | "failed";
    images?: string[];
    imageUrls?: string[];
    error?: string;
    batchMode?: boolean;
    batchCount?: number;
    size?: string;
    watermark?: boolean;
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

const SEEDREAM_PIXEL_SIZE_OPTIONS = [
  { value: "2048x2048", label: "2K 路 1:1 路 2048x2048" },
  { value: "1728x2304", label: "2K 路 3:4 路 1728x2304" },
  { value: "2304x1728", label: "2K 路 4:3 路 2304x1728" },
  { value: "2848x1600", label: "2K 路 16:9 路 2848x1600" },
  { value: "1600x2848", label: "2K 路 9:16 路 1600x2848" },
  { value: "2496x1664", label: "2K 路 3:2 路 2496x1664" },
  { value: "1664x2496", label: "2K 路 2:3 路 1664x2496" },
  { value: "3136x1344", label: "2K 路 21:9 路 3136x1344" },
  { value: "3072x3072", label: "3K 路 1:1 路 3072x3072" },
  { value: "2592x3456", label: "3K 路 3:4 路 2592x3456" },
  { value: "3456x2592", label: "3K 路 4:3 路 3456x2592" },
  { value: "4096x2304", label: "3K 路 16:9 路 4096x2304" },
  { value: "2304x4096", label: "3K 路 9:16 路 2304x4096" },
  { value: "3744x2496", label: "3K 路 3:2 路 3744x2496" },
  { value: "2496x3744", label: "3K 路 2:3 路 2496x3744" },
  { value: "4704x2016", label: "3K 路 21:9 路 4704x2016" },
];

const normalizeSeedreamDimensionSize = (value?: string): string | undefined => {
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^(\d{3,5})\s*[xX]\s*(\d{3,5})$/);
  if (!match) return undefined;
  return `${match[1]}x${match[2]}`;
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
  const normalizedPixelSize = normalizeSeedreamDimensionSize(rawSizeValue);
  const sizePresetValue =
    rawSizeValue.toUpperCase() === "3K" ? "3K" : "2K";
  const sizePixelValue =
    normalizedPixelSize || SEEDREAM_PIXEL_SIZE_OPTIONS[0].value;

  const [hover, setHover] = React.useState<string | null>(null);
  const [showHelp, setShowHelp] = React.useState(false);

  // 妫€娴嬭繛鎺ョ殑鍥剧墖鏁伴噺
  const imageInputCount = useStore((state) => {
    const edges = state.edges || [];
    return edges.filter(
      (edge) => edge.target === id && edge.targetHandle === "img"
    ).length;
  });

  const hasPromptInput = useStore((state) => {
    const edges = state.edges || [];
    return edges.some(
      (edge) => edge.target === id && edge.targetHandle === "prompt"
    );
  });
  const hasImageInput = imageInputCount > 0;
  // 鑷姩灏哄妯″紡锛氭湁 image 杈撳叆鏃惰蛋鏂规1锛涗粎 prompt 杈撳叆鏃惰蛋鏂规2
  const usePixelSizeMode = hasPromptInput && !hasImageInput;

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

  const onRun = React.useCallback(() => {
    data.onRun?.(id);
  }, [data, id]);

  const onSend = React.useCallback(() => {
    data.onSend?.(id);
  }, [data, id]);

  // 鑾峰彇绗竴寮犲浘鐗囩敤浜庨瑙?
  const firstImage = images[0];
  const assetId = React.useMemo(() => parseFlowImageAssetRef(firstImage), [firstImage]);
  const assetUrl = useFlowImageAssetUrl(assetId);
  const displaySrc = assetId ? assetUrl : buildImageSrc(firstImage);

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
        <div style={{ fontWeight: 600 }}>Seedream</div>
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
            title={lt("鐜╂硶璇存槑", "Help")}
          >
            <HelpCircle size={14} />
          </button>
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
            disabled={images.length === 0}
            title={images.length === 0 ? lt("鏃犲彲鍙戦€佺殑鍥惧儚", "No image to send") : lt("鍙戦€佸埌鐢诲竷", "Send to canvas")}
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
            <strong>{lt("鍗曞浘鍙樹綋", "Single Image Variation")}:</strong> {lt("鍩轰簬1寮犲浘鐢熸垚鐩镐技椋庢牸", "Generate similar style from 1 image")}
          </div>
          <div style={{ marginBottom: 3 }}>
            <strong>{lt("澶氬浘铻嶅悎", "Multi-Image Fusion")}:</strong> {lt("铻嶅悎2-5寮犲浘鐨勫厓绱犲拰椋庢牸", "Blend elements from 2-5 images")}
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
        {usePixelSizeMode ? (
          <select
            value={sizePixelValue}
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
            {SEEDREAM_PIXEL_SIZE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
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
            <option value="2K">{lt("2K 超清", "2K HD")}</option>
            <option value="3K">{lt("3K 高清", "3K Ultra HD")}</option>
          </select>
        )}
        </div>
      {/* 鍥剧墖棰勮 */}
      <div
        style={{
          width: "100%",
          minHeight: 160,
          background: "#fff",
          borderRadius: 6,
          display: "flex",
          flexWrap: "wrap",
          gap: 4,
          padding: images.length > 1 ? 4 : 0,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          border: "1px solid #eef0f2",
        }}
      >
        {images.length > 0 ? (
          images.map((img, idx) => (
            <SmartImage
              key={idx}
              src={buildImageSrc(img)}
              alt=""
              style={{
                width: images.length > 1 ? "calc(50% - 2px)" : "100%",
                height: images.length > 1 ? 78 : "100%",
                minHeight: images.length > 1 ? 78 : 160,
                objectFit: "contain",
                background: "#fff",
              }}
            />
          ))
        ) : displaySrc ? (
          <SmartImage
            src={displaySrc}
            alt=""
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              background: "#fff",
            }}
          />
        ) : (
          <span style={{ fontSize: 12, color: "#9ca3af" }}>{lt("绛夊緟鐢熸垚", "Waiting for generation")}</span>
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
    </div>
  );
}

export default React.memo(Seedream5Node);
