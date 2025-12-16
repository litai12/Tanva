import React from "react";
import { Handle, Position } from "reactflow";
import { Send as SendIcon } from "lucide-react";
import ImagePreviewModal, { type ImageItem } from "../../ui/ImagePreviewModal";
import { useImageHistoryStore } from "../../../stores/imageHistoryStore";
import { recordImageHistoryEntry } from "@/services/imageHistoryService";
import GenerationProgressBar from "./GenerationProgressBar";
import { useProjectContentStore } from "@/stores/projectContentStore";

type Props = {
  id: string;
  data: {
    status?: "idle" | "running" | "succeeded" | "failed";
    imageData?: string;
    error?: string;
    referencePrompt?: string;
    onRun?: (id: string) => void;
    onSend?: (id: string) => void;
  };
  selected?: boolean;
};

const buildImageSrc = (value?: string): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("data:image")) return trimmed;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://"))
    return trimmed;
  return `data:image/png;base64,${trimmed}`;
};

const DEFAULT_REFERENCE_PROMPT = "请参考第二张图的内容";

function GenerateReferenceNodeInner({ id, data, selected }: Props) {
  const { status, error } = data;
  const src = buildImageSrc(data.imageData);
  const [hover, setHover] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);
  const [currentImageId, setCurrentImageId] = React.useState<string>("");
  const borderColor = selected ? "#2563eb" : "#e5e7eb";
  const boxShadow = selected
    ? "0 0 0 2px rgba(37,99,235,0.12)"
    : "0 1px 2px rgba(0,0,0,0.04)";

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

  const referencePromptValue = data.referencePrompt ?? DEFAULT_REFERENCE_PROMPT;

  const onRun = React.useCallback(() => {
    data.onRun?.(id);
  }, [data, id]);

  const onSend = React.useCallback(() => {
    data.onSend?.(id);
  }, [data, id]);

  React.useEffect(() => {
    if (typeof data.referencePrompt === "undefined") {
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: { id, patch: { referencePrompt: DEFAULT_REFERENCE_PROMPT } },
        })
      );
    }
  }, [data.referencePrompt, id]);

  React.useEffect(() => {
    if (data.imageData && status === "succeeded") {
      const newImageId = `${id}-${Date.now()}`;
      setCurrentImageId(newImageId);
      void recordImageHistoryEntry({
        id: newImageId,
        base64: data.imageData,
        title: `Generate参考节点 ${new Date().toLocaleTimeString()}`,
        nodeId: id,
        nodeType: "generate",
        fileName: `flow_generate_ref_${newImageId}.png`,
        projectId,
      });
    }
  }, [data.imageData, status, id, projectId]);

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

  const onReferencePromptChange = React.useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: { id, patch: { referencePrompt: event.target.value } },
        })
      );
    },
    [id]
  );

  const tooltipStyleBase = React.useMemo(
    () => ({ position: "absolute" as const, whiteSpace: "nowrap" as const }),
    []
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
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ fontWeight: 600 }}>Generate Refer</div>
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
            disabled={!data.imageData}
            title={!data.imageData ? "无可发送的图像" : "发送到画布"}
            style={{
              fontSize: 12,
              padding: "4px 8px",
              background: !data.imageData ? "#e5e7eb" : "#111827",
              color: "#fff",
              borderRadius: 6,
              border: "none",
              cursor: !data.imageData ? "not-allowed" : "pointer",
            }}
          >
            <SendIcon size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      <div
        onDoubleClick={() => src && setPreview(true)}
        style={{
          width: "100%",
          height: 140,
          background: "#fff",
          borderRadius: 6,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          border: "1px solid #eef0f2",
        }}
        title={src ? "双击预览" : undefined}
      >
        {src ? (
          <img
            src={src}
            alt=''
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              background: "#fff",
            }}
          />
        ) : (
          <span style={{ fontSize: 12, color: "#9ca3af" }}>等待生成</span>
        )}
      </div>

      <div>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
          参考提示词
        </div>
        <textarea
          value={referencePromptValue}
          onChange={onReferencePromptChange}
          placeholder='请输入参考提示词'
          style={{
            width: "100%",
            minHeight: 70,
            resize: "vertical",
            fontSize: 12,
            lineHeight: 1.4,
            padding: "6px 8px",
            borderRadius: 6,
            border: "1px solid #d1d5db",
            background: "#fff",
            color: "#111827",
            fontFamily: "inherit",
          }}
          disabled={status === "running"}
        />
      </div>

      <div style={{ fontSize: 12, color: "#6b7280" }}>
        Status: {status || "idle"}
      </div>
      <GenerationProgressBar status={status} />
      {status === "failed" && error ? (
        <div style={{ fontSize: 12, color: "#ef4444", whiteSpace: "pre-wrap" }}>
          {error}
        </div>
      ) : null}

      <Handle
        type='target'
        position={Position.Left}
        id='image1'
        style={{ top: "30%" }}
        onMouseEnter={() => setHover("image1-in")}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type='target'
        position={Position.Left}
        id='image2'
        style={{ top: "55%" }}
        onMouseEnter={() => setHover("image2-in")}
        onMouseLeave={() => setHover(null)}
      />
      <Handle
        type='target'
        position={Position.Left}
        id='text'
        style={{ top: "80%" }}
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

      {hover === "image2-in" && (
        <div
          className='flow-tooltip'
          style={{
            ...tooltipStyleBase,
            left: -8,
            top: "55%",
            transform: "translate(-100%, -50%)",
          }}
        >
          image2
        </div>
      )}
      {hover === "image1-in" && (
        <div
          className='flow-tooltip'
          style={{
            ...tooltipStyleBase,
            left: -8,
            top: "30%",
            transform: "translate(-100%, -50%)",
          }}
        >
          image1
        </div>
      )}
      {hover === "prompt-in" && (
        <div
          className='flow-tooltip'
          style={{
            ...tooltipStyleBase,
            left: -8,
            top: "80%",
            transform: "translate(-100%, -50%)",
          }}
        >
          prompt
        </div>
      )}
      {hover === "img-out" && (
        <div
          className='flow-tooltip'
          style={{
            ...tooltipStyleBase,
            right: -8,
            top: "50%",
            transform: "translate(100%, -50%)",
          }}
        >
          image
        </div>
      )}

      <ImagePreviewModal
        isOpen={preview}
        imageSrc={
          allImages.length > 0 && currentImageId
            ? allImages.find((item) => item.id === currentImageId)?.src ||
              src ||
              ""
            : src || ""
        }
        imageTitle='全局图片预览'
        onClose={() => setPreview(false)}
        imageCollection={allImages}
        currentImageId={currentImageId}
        onImageChange={handleImageChange}
      />
    </div>
  );
}

export default React.memo(GenerateReferenceNodeInner);
