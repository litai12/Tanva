import React from "react";
import { Handle, Position } from "reactflow";
import { Send as SendIcon } from "lucide-react";
import ImagePreviewModal from "../../ui/ImagePreviewModal";

type Props = {
  id: string;
  data: {
    status?: "idle" | "running" | "succeeded" | "failed";
    error?: string;
    images?: string[]; // base64 strings, max 4
    count?: number; // 1-4
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
      | "21:9";
    onRun?: (id: string) => void;
    onSend?: (id: string) => void; // send all
    boxW?: number;
    boxH?: number;
  };
  selected?: boolean;
};

const buildImageSrc = (value?: string): string => {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("data:image")) return trimmed;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://"))
    return trimmed;
  return `data:image/png;base64,${trimmed}`;
};

function Generate4NodeInner({ id, data, selected }: Props) {
  const { status, error } = data;
  const images = data.images || [];
  const [hover, setHover] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);
  const [previewIndex, setPreviewIndex] = React.useState<number>(0);
  const borderColor = selected ? "#2563eb" : "#e5e7eb";
  const boxShadow = selected
    ? "0 0 0 2px rgba(37,99,235,0.12)"
    : "0 1px 2px rgba(0,0,0,0.04)";

  const onRun = React.useCallback(() => {
    data.onRun?.(id);
  }, [data, id]);

  const onSend = React.useCallback(() => {
    data.onSend?.(id);
  }, [data, id]);

  const updateCount = React.useCallback(
    (v: number) => {
      const count = Math.max(1, Math.min(4, Math.round(v)));
      const ev = new CustomEvent("flow:updateNodeData", {
        detail: { id, patch: { count } },
      });
      window.dispatchEvent(ev);
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

  const stopNodeDrag = React.useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
    const nativeEvent = (event as React.SyntheticEvent<any, Event>)
      .nativeEvent as Event & { stopImmediatePropagation?: () => void };
    nativeEvent.stopImmediatePropagation?.();
  }, []);

  // 2x2 网格渲染单元
  const renderCell = (idx: number) => {
    const img = images[idx];
    const isLoading = status === "running" && idx >= images.length; // 简单的加载标识
    return (
      <div
        key={idx}
        onDoubleClick={() => {
          if (img) {
            setPreviewIndex(idx);
            setPreview(true);
          }
        }}
        style={{
          width: "100%",
          aspectRatio: "1 / 1",
          background: "#fff",
          borderRadius: 6,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          border: "1px solid #eef0f2",
          position: "relative",
        }}
        title={img ? "双击全屏预览" : undefined}
      >
        {img ? (
          <img
            src={buildImageSrc(img)}
            alt=''
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              background: "#fff",
            }}
          />
        ) : (
          <span style={{ fontSize: 12, color: "#9ca3af" }}>
            {isLoading ? "生成中…" : "空槽"}
          </span>
        )}
        <div
          style={{
            position: "absolute",
            left: 6,
            top: 6,
            fontSize: 11,
            color: "#6b7280",
            background: "rgba(255,255,255,0.7)",
            padding: "1px 4px",
            borderRadius: 4,
          }}
        >
          {idx + 1}
        </div>
      </div>
    );
  };

  // 预览用集合
  const previewCollection = React.useMemo(
    () =>
      images.map((b64, i) => ({
        id: `${id}-${i}`,
        src: buildImageSrc(b64),
        title: `第 ${i + 1} 张`,
      })),
    [images, id]
  );

  const boxW = data.boxW || 300;
  const boxH = data.boxH || 240;
  const aspectRatioValue = data.aspectRatio ?? "";
  const aspectOptions = React.useMemo(
    () => [
      { label: "自动", value: "" },
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
    []
  );

  return (
    <div
      style={{
        width: boxW,
        padding: 8,
        background: "#fff",
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        boxShadow,
        transition: "border-color 0.15s ease, box-shadow 0.15s ease",
        position: "relative",
      }}
    >
      {/* 标题行：仅标题 + 控制按钮 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <div style={{ fontWeight: 600 }}>Multi Generate</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
            disabled={!images.length}
            title={!images.length ? "无可发送的图像" : "发送全部到画布"}
            style={{
              fontSize: 12,
              padding: "4px 8px",
              background: !images.length ? "#e5e7eb" : "#111827",
              color: "#fff",
              borderRadius: 6,
              border: "none",
              cursor: !images.length ? "not-allowed" : "pointer",
            }}
          >
            <SendIcon size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* 数量 & 尺寸 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <label
          className='nodrag nopan'
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            color: "#6b7280",
          }}
        >
          数量
          <input
            type='number'
            min={1}
            max={4}
            value={Math.max(1, Math.min(4, Number(data.count) || 4))}
            onChange={(e) => updateCount(Number(e.target.value))}
            onPointerDown={stopNodeDrag}
            onPointerDownCapture={stopNodeDrag}
            onMouseDown={stopNodeDrag}
            onMouseDownCapture={stopNodeDrag}
            onClick={stopNodeDrag}
            onClickCapture={stopNodeDrag}
            className='nodrag nopan'
            style={{
              width: 56,
              fontSize: 12,
              padding: "2px 6px",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
            }}
          />
        </label>
        <label
          className='nodrag nopan'
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            color: "#6b7280",
          }}
        >
          尺寸
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
      </div>

      {/* 2x2 预览网格 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        {Array.from({ length: 4 }).map((_, i) => renderCell(i))}
      </div>

      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
        Status: {status || "idle"}
      </div>
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

      {/* 输入：img 在上，text 在下；输出：img1..img4 */}
      <Handle
        type='target'
        position={Position.Left}
        id='img'
        style={{ top: "35%" }}
        onMouseEnter={() => setHover("img-in")}
        onMouseLeave={() => setHover(null)}
      />
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
        id='img1'
        style={{ top: "25%" }}
        onMouseEnter={() => setHover("img1-out")}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type='source'
        position={Position.Right}
        id='img2'
        style={{ top: "40%" }}
        onMouseEnter={() => setHover("img2-out")}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type='source'
        position={Position.Right}
        id='img3'
        style={{ top: "60%" }}
        onMouseEnter={() => setHover("img3-out")}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type='source'
        position={Position.Right}
        id='img4'
        style={{ top: "75%" }}
        onMouseEnter={() => setHover("img4-out")}
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
      {hover === "img1-out" && (
        <div
          className='flow-tooltip'
          style={{ right: -8, top: "25%", transform: "translate(100%, -50%)" }}
        >
          image#1
        </div>
      )}
      {hover === "img2-out" && (
        <div
          className='flow-tooltip'
          style={{ right: -8, top: "40%", transform: "translate(100%, -50%)" }}
        >
          image#2
        </div>
      )}
      {hover === "img3-out" && (
        <div
          className='flow-tooltip'
          style={{ right: -8, top: "60%", transform: "translate(100%, -50%)" }}
        >
          image#3
        </div>
      )}
      {hover === "img4-out" && (
        <div
          className='flow-tooltip'
          style={{ right: -8, top: "75%", transform: "translate(100%, -50%)" }}
        >
          image#4
        </div>
      )}

      <ImagePreviewModal
        isOpen={preview}
        imageSrc={previewCollection[previewIndex]?.src || ""}
        imageTitle='四图预览'
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

export default React.memo(Generate4NodeInner);
