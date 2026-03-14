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
    error?: string;
    batchMode?: boolean;
    batchCount?: number;
    size?: "1K" | "2K" | "4K";
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

function Seedream5Node({ id, data, selected }: Props) {
  const { lt } = useLocaleText();
  const { status, error, images = [] } = data;

  const sizeValue = data.size ?? "2K";

  const [hover, setHover] = React.useState<string | null>(null);
  const [showHelp, setShowHelp] = React.useState(false);

  // 检测连接的图片数量
  const imageInputCount = useStore((state) => {
    const edges = state.edges || [];
    return edges.filter(
      (edge) => edge.target === id && edge.targetHandle === "img"
    ).length;
  });

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

  // 获取第一张图片用于预览
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
            title={lt("玩法说明", "Help")}
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
            title={images.length === 0 ? lt("无可发送的图像", "No image to send") : lt("发送到画布", "Send to canvas")}
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

      {/* 玩法说明 */}
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
            🎨 {lt("可实现效果", "What You Can Do")}
          </div>
          <div style={{ marginBottom: 3 }}>
            <strong>{lt("纯文字生图", "Text to Image")}:</strong> {lt("根据描述生成全新图片", "Generate new images from text description")}
          </div>
          <div style={{ marginBottom: 3 }}>
            <strong>{lt("单图变体", "Single Image Variation")}:</strong> {lt("基于1张图生成相似风格", "Generate similar style from 1 image")}
          </div>
          <div style={{ marginBottom: 3 }}>
            <strong>{lt("多图融合", "Multi-Image Fusion")}:</strong> {lt("融合2-5张图的元素和风格", "Blend elements from 2-5 images")}
          </div>
          <div style={{ marginBottom: 3 }}>
            <strong>{lt("服装替换", "Outfit Change")}:</strong> {lt("将图1人物换成图2的服装", "Change person's outfit using reference")}
          </div>
          <div style={{ color: "#6b7280", fontSize: 10, marginTop: 4 }}>
            💡 {lt("提示：多图输入时可组合不同元素", "Tip: Multiple images can combine different elements")}
          </div>
        </div>
      )}

      {/* 图片数量警告 */}
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
          ⚠️ {lt(`已连接${imageInputCount}张图片，最多支持5张，只会使用前5张`, `Connected ${imageInputCount} images, max 5 supported, only first 5 will be used`)}
        </div>
      )}

      {/* 尺寸选择 */}
      <div style={{ marginBottom: 8 }}>
        <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 2 }}>
          {lt("图像尺寸", "Size")}
        </label>
        <select
          value={sizeValue}
          onChange={(e) => updateData({ size: e.target.value as "1K" | "2K" | "4K" })}
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
          <option value="1K">{lt("1K (~1024px) 快速", "1K (~1024px) Fast")}</option>
          <option value="2K">{lt("2K (~2048px) 推荐", "2K (~2048px) Recommended")}</option>
          <option value="4K">{lt("4K (~4096px) 高清", "4K (~4096px) HD")}</option>
        </select>
      </div>

      {/* 批量模式 */}
      <div style={{ marginBottom: 8 }}>
        <label style={{ display: "flex", alignItems: "center", fontSize: 12, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={data.batchMode || false}
            onChange={(e) => updateData({ batchMode: e.target.checked, batchCount: e.target.checked ? 4 : undefined })}
            style={{ marginRight: 6 }}
            onPointerDownCapture={stopNodeDrag}
            onMouseDownCapture={stopNodeDrag}
          />
          <span>{lt("批量生成", "Batch Mode")}</span>
        </label>
      </div>

      {/* 批量数量 */}
      {data.batchMode && (
        <div style={{ marginBottom: 8 }}>
          <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 2 }}>
            {lt("生成数量 (2-10张)", "Count (2-10)")}
          </label>
          <input
            type="number"
            min={2}
            max={10}
            value={data.batchCount || 4}
            onChange={(e) => updateData({ batchCount: Math.min(Math.max(parseInt(e.target.value) || 4, 2), 10) })}
            style={{
              width: "100%",
              fontSize: 12,
              padding: "4px 6px",
              borderRadius: 6,
              border: "1px solid #e5e7eb",
              outline: "none",
            }}
            onPointerDownCapture={stopNodeDrag}
            onMouseDownCapture={stopNodeDrag}
          />
        </div>
      )}

      {/* 图片预览 */}
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

      {/* 输入句柄 */}
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

      {/* 输出句柄 */}
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
