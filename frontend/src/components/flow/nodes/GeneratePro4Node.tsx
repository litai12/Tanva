import React from "react";
import { Handle, Position, useReactFlow } from "reactflow";
import { Play, Plus, X, Link, Copy, Trash2, Download, FolderPlus, Send as SendIcon } from "lucide-react";
import ImagePreviewModal from "../../ui/ImagePreviewModal";
import { recordImageHistoryEntry } from "@/services/imageHistoryService";
import { useProjectContentStore } from "@/stores/projectContentStore";
import { useAIChatStore } from "@/stores/aiChatStore";
import { cn } from "@/lib/utils";
import { resolveTextFromSourceNode } from "../utils/textSource";
import ContextMenu from "../../ui/context-menu";

// 长宽比图标
const AspectRatioIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg
    viewBox='0 0 16 16'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
    {...props}
  >
    <rect
      x='2'
      y='4'
      width='12'
      height='8'
      stroke='currentColor'
      strokeWidth='1.5'
      fill='none'
      rx='1'
    />
  </svg>
);

type Props = {
  id: string;
  data: {
    status?: "idle" | "running" | "succeeded" | "failed";
    images?: string[];
    thumbnails?: string[]; // 缩略图
    error?: string;
    aspectRatio?: "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "4:5" | "5:4" | "9:16" | "16:9" | "21:9";
    imageSize?: "1K" | "2K" | "4K" | null;
    prompts?: string[];
    imageWidth?: number;
    onRun?: (id: string) => void;
    onSend?: (id: string) => void;
  };
  selected?: boolean;
};

const DEFAULT_IMAGE_WIDTH = 340;
const MIN_IMAGE_WIDTH = 200;
const MAX_IMAGE_WIDTH = 800;

const buildImageSrc = (value?: string): string => {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("data:image")) return trimmed;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://"))
    return trimmed;
  return `data:image/png;base64,${trimmed}`;
};

function GeneratePro4NodeInner({ id, data, selected }: Props) {
  const { status, error } = data;
  const images = React.useMemo(() => data.images || [], [data.images]);
  const thumbnails = React.useMemo(() => data.thumbnails || [], [data.thumbnails]);
  const [hover, setHover] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(false);
  const [previewIndex, setPreviewIndex] = React.useState(0);
  const [isTextFocused, setIsTextFocused] = React.useState(false);
  const [isAspectMenuOpen, setIsAspectMenuOpen] = React.useState(false);
  const [isImageSizeMenuOpen, setIsImageSizeMenuOpen] = React.useState(false);
  const [contextMenu, setContextMenu] = React.useState<{ x: number; y: number } | null>(null);
  const aspectMenuRef = React.useRef<HTMLDivElement>(null);
  const imageSizeMenuRef = React.useRef<HTMLDivElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const promptBoxRef = React.useRef<HTMLDivElement>(null);
  const imageBoxRef = React.useRef<HTMLDivElement>(null);

  // 全局状态
  const projectId = useProjectContentStore((state) => state.projectId);
  const aiProvider = useAIChatStore((state) => state.aiProvider);
  const isProMode = aiProvider === 'gemini-pro' || aiProvider === 'banana';

  // 检测外部文本连接
  const rf = useReactFlow();
  const [externalPrompts, setExternalPrompts] = React.useState<string[]>([]);
  const [externalSourceIds, setExternalSourceIds] = React.useState<string[]>([]);

  const refreshExternalPrompts = React.useCallback(() => {
    const currentEdges = rf.getEdges();
    const textEdges = currentEdges.filter((e) => e.target === id && e.targetHandle === "text");

    if (textEdges.length === 0) {
      setExternalPrompts([]);
      setExternalSourceIds([]);
      return;
    }

    const sourceIds: string[] = [];
    const prompts: string[] = [];
    for (const edge of textEdges) {
      sourceIds.push(edge.source);
      const sourceNode = rf.getNode(edge.source);
      if (!sourceNode) continue;
      const resolved = resolveTextFromSourceNode(sourceNode, edge.sourceHandle);
      if (resolved && resolved.trim().length) prompts.push(resolved.trim());
    }

    setExternalSourceIds(sourceIds);
    setExternalPrompts(prompts);
  }, [id, rf]);

  React.useEffect(() => {
    refreshExternalPrompts();
  }, [refreshExternalPrompts]);

  React.useEffect(() => {
    const handleEdgesChange = () => {
      refreshExternalPrompts();
    };
    window.addEventListener("flow:edgesChange", handleEdgesChange);
    return () => window.removeEventListener("flow:edgesChange", handleEdgesChange);
  }, [refreshExternalPrompts]);

  React.useEffect(() => {
    if (externalSourceIds.length === 0) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string }>).detail;
      if (!detail?.id || !externalSourceIds.includes(detail.id)) return;
      refreshExternalPrompts();
    };
    window.addEventListener("flow:updateNodeData", handler as EventListener);
    return () =>
      window.removeEventListener(
        "flow:updateNodeData",
        handler as EventListener
      );
  }, [externalSourceIds, refreshExternalPrompts]);

  // 图片区域宽度
  const imageWidth = data.imageWidth || DEFAULT_IMAGE_WIDTH;

  // 提示词数组
  const prompts = React.useMemo(() => {
    const p = data.prompts || [""];
    return p.length > 0 ? p : [""];
  }, [data.prompts]);

  const stopNodeDrag = React.useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
    const nativeEvent = (event as React.SyntheticEvent<Element, Event>)
      .nativeEvent as Event & { stopImmediatePropagation?: () => void };
    nativeEvent.stopImmediatePropagation?.();
  }, []);

  // 更新单个提示词
  const updatePrompt = React.useCallback(
    (index: number, value: string) => {
      const newPrompts = [...prompts];
      newPrompts[index] = value;
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: { id, patch: { prompts: newPrompts } },
        })
      );
    },
    [id, prompts]
  );

  // 添加新提示词
  const addPrompt = React.useCallback(() => {
    const newPrompts = [...prompts, ""];
    window.dispatchEvent(
      new CustomEvent("flow:updateNodeData", {
        detail: { id, patch: { prompts: newPrompts } },
      })
    );
  }, [id, prompts]);

  // 删除提示词
  const removePrompt = React.useCallback(
    (index: number) => {
      if (prompts.length <= 1) return;
      const newPrompts = prompts.filter((_, i) => i !== index);
      window.dispatchEvent(
        new CustomEvent("flow:updateNodeData", {
          detail: { id, patch: { prompts: newPrompts } },
        })
      );
    },
    [id, prompts]
  );

  const onRun = React.useCallback(() => {
    data.onRun?.(id);
  }, [data, id]);

  const onSend = React.useCallback(() => {
    data.onSend?.(id);
  }, [data, id]);

  // 右键菜单处理
  const handleContextMenu = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = React.useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleCopy = React.useCallback(() => {
    window.dispatchEvent(new CustomEvent('flow:duplicateNode', { detail: { nodeId: id } }));
  }, [id]);

  const handleDelete = React.useCallback(() => {
    window.dispatchEvent(new CustomEvent('flow:deleteNode', { detail: { nodeId: id } }));
  }, [id]);

  const handleDownload = React.useCallback((index: number) => {
    const img = images[index];
    if (!img) return;
    const src = buildImageSrc(img);
    const link = document.createElement('a');
    link.href = src;
    link.download = `generate_pro4_${id}_${index + 1}_${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [images, id]);

  const handleAddToLibrary = React.useCallback(() => {
    const firstImage = images[0];
    if (!firstImage) return;
    window.dispatchEvent(new CustomEvent('flow:addToLibrary', {
      detail: { imageData: firstImage, nodeId: id, nodeType: 'generatePro4' }
    }));
  }, [images, id]);

  // 长宽比选项
  const aspectOptions: Array<{ label: string; value: string }> = React.useMemo(
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

  // 更新长宽比
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
  const imageSizeValue = data.imageSize ?? null;

  // 图像尺寸选项
  const imageSizeOptions: Array<{ label: string; value: '1K' | '2K' | '4K' | null }> = React.useMemo(() => ([
    { label: '自动', value: null },
    { label: '1K', value: '1K' },
    { label: '2K', value: '2K' },
    { label: '4K', value: '4K' },
  ]), []);

  const updateImageSize = React.useCallback((size: '1K' | '2K' | '4K' | null) => {
    window.dispatchEvent(
      new CustomEvent('flow:updateNodeData', {
        detail: { id, patch: { imageSize: size } }
      })
    );
  }, [id]);

  // 点击外部关闭菜单
  React.useEffect(() => {
    if (!isImageSizeMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (imageSizeMenuRef.current && !imageSizeMenuRef.current.contains(e.target as Node)) {
        setIsImageSizeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isImageSizeMenuOpen]);

  // 当图片数据更新时，添加到全局历史记录
  React.useEffect(() => {
    if (images.length > 0 && status === "succeeded") {
      images.forEach((img, idx) => {
        if (img) {
          const newImageId = `${id}-${idx}-${Date.now()}`;
          void recordImageHistoryEntry({
            id: newImageId,
            base64: img,
            title: `GeneratePro4节点 #${
              idx + 1
            } ${new Date().toLocaleTimeString()}`,
            nodeId: id,
            nodeType: "generatePro4",
            fileName: `flow_generatepro4_${newImageId}.png`,
            projectId,
          });
        }
      });
    }
  }, [images, status, id, projectId]);

  React.useEffect(() => {
    if (!preview) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreview(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [preview]);

  // 点击外部关闭长宽比菜单
  React.useEffect(() => {
    if (!isAspectMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        aspectMenuRef.current &&
        !aspectMenuRef.current.contains(e.target as Node)
      ) {
        setIsAspectMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isAspectMenuOpen]);

  // 角点拖拽调整大小
  const handleResizeStart = React.useCallback(
    (corner: string) => (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();

      const startX = e.clientX;
      const startY = e.clientY;
      const startWidth = imageWidth;
      let lastWidth = startWidth;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const deltaY = moveEvent.clientY - startY;

        let widthChange = 0;
        if (corner === "top-left") {
          widthChange = -Math.max(deltaX, deltaY);
        } else if (corner === "top-right") {
          widthChange = Math.max(deltaX, -deltaY);
        } else if (corner === "bottom-left") {
          widthChange = Math.max(-deltaX, deltaY);
        } else if (corner === "bottom-right") {
          widthChange = Math.max(deltaX, deltaY);
        }

        const newWidth = Math.max(
          MIN_IMAGE_WIDTH,
          Math.min(MAX_IMAGE_WIDTH, startWidth + widthChange)
        );
        const incrementalChange = newWidth - lastWidth;
        lastWidth = newWidth;

        if (incrementalChange === 0) return;

        const positionOffsetX = -incrementalChange / 2;
        const positionOffsetY = -incrementalChange / 2;

        window.dispatchEvent(
          new CustomEvent("flow:updateNodeData", {
            detail: {
              id,
              patch: {
                imageWidth: newWidth,
                _positionOffset: { x: positionOffsetX, y: positionOffsetY },
              },
            },
          })
        );
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [imageWidth, id]
  );

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

  // 2x2 网格渲染单元
  const renderCell = (idx: number) => {
    const img = images[idx];
    const thumb = thumbnails[idx];
    const displaySrc = thumb ? buildImageSrc(thumb) : (img ? buildImageSrc(img) : "");
    // 并发模式：status 是 running 且这张图片还没有生成出来，都显示生成中
    const isGenerating = status === "running" && !img;
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
          background: displaySrc ? "transparent" : "#f8f9fa",
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          position: "relative",
          cursor: img ? "pointer" : "default",
        }}
        title={img ? "双击预览" : undefined}
      >
        {displaySrc ? (
          <img
            src={displaySrc}
            alt=''
            loading="lazy"
            decoding="async"
            draggable={false}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        ) : (
          <span style={{ fontSize: 12, color: "#9ca3af" }}>
            {isGenerating ? "生成中..." : "空"}
          </span>
        )}
        {/* 图片序号标签 */}
        <div
          style={{
            position: "absolute",
            left: 6,
            top: 6,
            fontSize: 10,
            color: "#6b7280",
            background: "rgba(255,255,255,0.85)",
            padding: "2px 6px",
            borderRadius: 4,
            fontWeight: 500,
          }}
        >
          {idx + 1}
        </div>
        {/* 单张图片底部进度条 - 并发模式下所有正在生成的图片都显示 */}
        {isGenerating && (
          <div
            style={{
              position: "absolute",
              bottom: 4,
              left: 4,
              right: 4,
              height: 4,
              background: "rgba(59, 130, 246, 0.2)",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              className='generatepro4-progress-bar'
              style={{
                height: "100%",
                background: "linear-gradient(90deg, #3b82f6, #60a5fa)",
                borderRadius: 2,
                width: "30%",
              }}
            />
          </div>
        )}
      </div>
    );
  };

  // 角点样式
  const cornerStyle: React.CSSProperties = {
    position: "absolute",
    width: 10,
    height: 10,
    borderRadius: "50%",
    background: "#3b82f6",
    cursor: "nwse-resize",
    zIndex: 20,
  };

  // 计算 Handle 的垂直位置（对应4张图片）
  const handlePositions = ["20%", "40%", "60%", "80%"];

  return (
    <div
      ref={containerRef}
      onContextMenu={handleContextMenu}
      style={{
        width: imageWidth + 24,
        background: "transparent",
        position: "relative",
        padding: "0 12px",
      }}
    >
      {/* 进度条动画样式 */}
      <style>{`
        @keyframes generatepro4-slide {
          0% { transform: translateX(0); }
          50% { transform: translateX(233%); }
          100% { transform: translateX(0); }
        }
        .generatepro4-progress-bar {
          animation: generatepro4-slide 1.2s ease-in-out infinite;
        }
      `}</style>
      {/* 图片区域容器 */}
      <div ref={imageBoxRef} style={{ position: "relative" }}>
        {/* 选中时的蓝色边框 */}
        {selected && (
          <div
            style={{
              position: "absolute",
              top: -2,
              left: -2,
              right: -2,
              bottom: -2,
              border: "2px solid #3b82f6",
              borderRadius: 0,
              pointerEvents: "none",
              zIndex: 10,
            }}
          />
        )}

        {/* 2x2 图片网格区域 */}
        <div
          style={{
            position: "relative",
            width: imageWidth,
            background: "#f8f9fa",
            borderRadius: 12,
            overflow: "hidden",
            padding: 8,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 6,
            }}
          >
            {Array.from({ length: 4 }).map((_, i) => renderCell(i))}
          </div>
        </div>

        {/* 选中时的四个角点 */}
        {selected && (
          <>
            <div
              className='nodrag'
              style={{
                ...cornerStyle,
                top: -5,
                left: -5,
                cursor: "nwse-resize",
              }}
              onMouseDown={handleResizeStart("top-left")}
            />
            <div
              className='nodrag'
              style={{
                ...cornerStyle,
                top: -5,
                right: -5,
                cursor: "nesw-resize",
              }}
              onMouseDown={handleResizeStart("top-right")}
            />
            <div
              className='nodrag'
              style={{
                ...cornerStyle,
                bottom: -5,
                left: -5,
                cursor: "nesw-resize",
              }}
              onMouseDown={handleResizeStart("bottom-left")}
            />
            <div
              className='nodrag'
              style={{
                ...cornerStyle,
                bottom: -5,
                right: -5,
                cursor: "nwse-resize",
              }}
              onMouseDown={handleResizeStart("bottom-right")}
            />
          </>
        )}

        {/* 左侧图片输入 Handle - 放在图像框中间 */}
        <Handle
          type='target'
          position={Position.Left}
          id='img'
          style={{
            top: "50%",
            left: -12,
            width: 8,
            height: 8,
            background: "#6b7280",
            border: "2px solid #fff",
            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          }}
          onMouseEnter={() => setHover("img-in")}
          onMouseLeave={() => setHover(null)}
        />

        {/* 右侧4个输出 Handle，分别对应4张图片 */}
        {[1, 2, 3, 4].map((num, idx) => (
          <Handle
            key={`img${num}`}
            type='source'
            position={Position.Right}
            id={`img${num}`}
            style={{
              top: handlePositions[idx],
              right: -12,
              width: 8,
              height: 8,
              background: "#6b7280",
              border: "2px solid #fff",
              boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
            }}
            onMouseEnter={() => setHover(`img${num}-out`)}
            onMouseLeave={() => setHover(null)}
          />
        ))}

        {/* Handle 提示 - 图片输入 */}
        {hover === "img-in" && (
          <div
            className='flow-tooltip'
            style={{
              position: "absolute",
              left: -16,
              top: "50%",
              transform: "translate(-100%, -50%)",
              zIndex: 10,
            }}
          >
            image
          </div>
        )}
        {/* Handle 提示 - 图片输出 */}
        {[1, 2, 3, 4].map(
          (num, idx) =>
            hover === `img${num}-out` && (
              <div
                key={`tooltip-${num}`}
                className='flow-tooltip'
                style={{
                  position: "absolute",
                  right: -16,
                  top: handlePositions[idx],
                  transform: "translate(100%, -50%)",
                  zIndex: 10,
                }}
              >
                image#{num}
              </div>
            )
        )}
      </div>

      {/* 多个提示词输入框 */}
      {prompts.map((prompt, index) => (
        <div
          key={index}
          ref={index === 0 ? promptBoxRef : undefined}
          style={{ marginTop: 8, position: "relative" }}
        >
          <div
            className='group nodrag nopan'
            style={{
              background: "#fff",
              borderRadius: 16,
              border: "1px solid #e5e7eb",
              padding: "12px 16px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
              position: "relative",
            }}
          >
            {/* 外部连接的提示词显示（仅第一个输入框展示） */}
            {index === 0 && externalPrompts.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  marginBottom: 8,
                }}
              >
                {externalPrompts.map((externalPrompt, externalIndex) => (
                  <div
                    key={externalIndex}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 6,
                      padding: "8px 10px",
                      background: "#f0f9ff",
                      borderRadius: 8,
                      border: "1px solid #bae6fd",
                    }}
                  >
                    <Link
                      style={{
                        width: 14,
                        height: 14,
                        color: "#0ea5e9",
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    />
                    <span
                      style={{
                        fontSize: 13,
                        color: "#0369a1",
                        lineHeight: 1.4,
                        wordBreak: "break-word",
                        maxHeight: 60,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {externalPrompt.length > 100
                        ? `${externalPrompt.slice(0, 100)}...`
                        : externalPrompt}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <textarea
              className='nodrag nopan nowheel'
              value={prompt}
              onChange={(event) => updatePrompt(index, event.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onRun();
                }
              }}
              placeholder={
                index === 0
                  ? externalPrompts.length > 0
                    ? "输入额外提示词（可选）..."
                    : "输入提示词..."
                  : "输入额外提示词（可选）..."
              }
              rows={2}
              style={{
                width: "100%",
                fontSize: 14,
                lineHeight: 1.5,
                border: "none",
                outline: "none",
                background: "transparent",
                resize: "none",
                color: "#374151",
                paddingRight: prompts.length > 1 ? 24 : 0,
              }}
              onWheelCapture={(event) => {
                event.stopPropagation();
                (
                  event.nativeEvent as Event & {
                    stopImmediatePropagation?: () => void;
                  }
                )?.stopImmediatePropagation?.();
              }}
              onPointerDownCapture={(event) => {
                event.stopPropagation();
                (
                  event.nativeEvent as Event & {
                    stopImmediatePropagation?: () => void;
                  }
                )?.stopImmediatePropagation?.();
              }}
              onMouseDownCapture={(event) => {
                event.stopPropagation();
                (
                  event.nativeEvent as Event & {
                    stopImmediatePropagation?: () => void;
                  }
                )?.stopImmediatePropagation?.();
              }}
              onFocus={() => setIsTextFocused(true)}
              onBlur={() => setIsTextFocused(false)}
              disabled={status === "running"}
            />

            {/* 删除按钮 - 只有多个时显示 */}
            {prompts.length > 1 && (
              <button
                onClick={() => removePrompt(index)}
                onPointerDownCapture={stopNodeDrag}
                className='absolute top-2 right-2 w-5 h-5 rounded-full bg-gray-100 hover:bg-red-100 text-gray-400 hover:text-red-500 flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100'
                title='删除此提示词'
              >
                <X style={{ width: 12, height: 12 }} />
              </button>
            )}
          </div>

          {/* 第一个提示词框的 Handle */}
          {index === 0 && (
            <>
              <Handle
                type='target'
                position={Position.Left}
                id='text'
                style={{
                  top: "50%",
                  left: -12,
                  width: 8,
                  height: 8,
                  background: "#6b7280",
                  border: "2px solid #fff",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                }}
                onMouseEnter={() => setHover("text-in")}
                onMouseLeave={() => setHover(null)}
              />
              <Handle
                type='source'
                position={Position.Right}
                id='text'
                style={{
                  top: "50%",
                  right: -12,
                  width: 8,
                  height: 8,
                  background: "#6b7280",
                  border: "2px solid #fff",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                }}
                onMouseEnter={() => setHover("text-out")}
                onMouseLeave={() => setHover(null)}
              />

              {hover === "text-in" && (
                <div
                  className='flow-tooltip'
                  style={{
                    position: "absolute",
                    left: -16,
                    top: "50%",
                    transform: "translate(-100%, -50%)",
                    zIndex: 10,
                  }}
                >
                  prompt
                </div>
              )}
              {hover === "text-out" && (
                <div
                  className='flow-tooltip'
                  style={{
                    position: "absolute",
                    right: -16,
                    top: "50%",
                    transform: "translate(100%, -50%)",
                    zIndex: 10,
                  }}
                >
                  prompt
                </div>
              )}
            </>
          )}
        </div>
      ))}

      {/* 选中或文字聚焦时显示：添加提示词按钮和按钮组 */}
      {(selected || isTextFocused) && (
        <>
          {/* 添加提示词按钮 */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              marginTop: 4,
              marginBottom: 4,
            }}
          >
            <button
              onClick={addPrompt}
              onPointerDownCapture={stopNodeDrag}
              className='text-gray-400 hover:text-gray-600 flex items-center justify-center transition-colors cursor-pointer'
              title='添加提示词'
              style={{
                padding: 0,
                background: "transparent",
                border: "none",
              }}
            >
              <Plus style={{ width: 12, height: 12 }} />
            </button>
          </div>

          {/* 按钮组 */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              marginTop: 8,
            }}
          >
          <div className='inline-flex items-center gap-2 px-2 py-2 rounded-[999px] bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border border-liquid-glass'>
            {/* 长宽比选择按钮 - 仅 Pro 模式显示 */}
            {isProMode && (
              <div className='relative' ref={aspectMenuRef}>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsAspectMenuOpen(!isAspectMenuOpen);
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onPointerDownCapture={stopNodeDrag}
                  className={cn(
                    "p-0 h-8 w-8 rounded-full bg-white/50 border border-gray-300 text-gray-700 transition-all duration-200 hover:bg-gray-800/10 hover:border-gray-800/20 flex items-center justify-center",
                    aspectRatioValue ? "bg-gray-800 text-white border-gray-800" : ""
                  )}
                  title={aspectRatioValue ? `长宽比: ${aspectRatioValue}` : "选择长宽比"}
                >
                  <AspectRatioIcon style={{ width: 14, height: 14 }} />
                </button>
              </div>
            )}

            {/* HD 图像尺寸选择按钮 - 仅 Pro 模式显示 */}
            {isProMode && (
              <div className="relative" ref={imageSizeMenuRef}>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsImageSizeMenuOpen(!isImageSizeMenuOpen);
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onPointerDownCapture={stopNodeDrag}
                  className={cn(
                    "p-0 h-8 w-8 rounded-full bg-white/50 border border-gray-300 text-gray-700 transition-all duration-200 hover:bg-gray-800/10 hover:border-gray-800/20 flex items-center justify-center",
                    imageSizeValue ? "bg-gray-800 text-white border-gray-800" : ""
                  )}
                  title={imageSizeValue ? `分辨率: ${imageSizeValue}` : '选择分辨率'}
                >
                  <span className="font-medium text-[10px] leading-none">
                    {imageSizeValue || 'HD'}
                  </span>
                </button>
              </div>
            )}

            {/* Run 按钮 */}
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRun();
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              disabled={status === "running"}
              onPointerDownCapture={stopNodeDrag}
              className='p-0 h-8 w-8 rounded-full bg-white/50 border border-gray-300 text-gray-700 transition-all duration-200 hover:bg-gray-800/10 hover:border-gray-800/20 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed'
              title={status === "running" ? "生成中..." : "运行生成"}
            >
              <Play style={{ width: 14, height: 14 }} />
            </button>
          </div>

          {/* 长宽比水平选择栏 - 仅 Pro 模式显示 */}
          {isProMode && isAspectMenuOpen && (
            <div className='bg-white rounded-full shadow-lg border border-gray-200 px-2 py-1.5 flex items-center gap-1'>
              {aspectOptions.map((opt) => (
                <button
                  key={opt.value || "auto"}
                  onClick={(e) => {
                    e.stopPropagation();
                    updateAspectRatio(opt.value);
                    setIsAspectMenuOpen(false);
                  }}
                  onPointerDownCapture={stopNodeDrag}
                  className={cn(
                    "px-2 py-1 text-xs rounded-md transition-colors whitespace-nowrap",
                    aspectRatioValue === opt.value ||
                      (!aspectRatioValue && opt.value === "")
                      ? "bg-gray-800 text-white font-medium"
                      : "text-gray-700 hover:bg-gray-100"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {/* HD 图像尺寸水平选择栏 - 仅 Pro 模式显示 */}
          {isProMode && isImageSizeMenuOpen && (
            <div className="bg-white rounded-full shadow-lg border border-gray-200 px-2 py-1.5 flex items-center gap-1">
              {imageSizeOptions.map(opt => (
                <button
                  key={opt.value || 'auto'}
                  onClick={(e) => {
                    e.stopPropagation();
                    updateImageSize(opt.value);
                    setIsImageSizeMenuOpen(false);
                  }}
                  onPointerDownCapture={stopNodeDrag}
                  className={cn(
                    "px-2 py-1 text-xs rounded-md transition-colors whitespace-nowrap",
                    imageSizeValue === opt.value
                      ? "bg-gray-800 text-white font-medium"
                      : "text-gray-700 hover:bg-gray-100"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
          </div>
        </>
      )}

      {/* 状态和错误信息 */}
      {status === "failed" && error && (
        <div
          style={{
            fontSize: 12,
            color: "#ef4444",
            marginTop: 8,
            whiteSpace: "pre-wrap",
            padding: "8px 12px",
            background: "#fef2f2",
            borderRadius: 8,
          }}
        >
          {error}
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

      {/* 右键菜单 */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={closeContextMenu}
          items={[
            {
              label: '复制节点',
              icon: <Copy className="w-4 h-4" />,
              onClick: handleCopy,
            },
            {
              label: '删除节点',
              icon: <Trash2 className="w-4 h-4" />,
              onClick: handleDelete,
            },
            {
              label: '添加到库',
              icon: <FolderPlus className="w-4 h-4" />,
              onClick: handleAddToLibrary,
              disabled: !images.length,
            },
            {
              label: '下载图片',
              icon: <Download className="w-4 h-4" />,
              onClick: () => handleDownload(0),
              disabled: !images.length,
            },
            {
              label: '发送到画板',
              icon: <SendIcon className="w-4 h-4" />,
              onClick: onSend,
              disabled: !images.length,
            },
          ]}
        />
      )}
    </div>
  );
}

export default React.memo(GeneratePro4NodeInner);
