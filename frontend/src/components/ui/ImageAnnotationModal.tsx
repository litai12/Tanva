import React from "react";
import { createPortal } from "react-dom";
import {
  Circle,
  History,
  Loader2,
  MoveUpRight,
  Paintbrush,
  Redo2,
  RotateCcw,
  Save,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { Button } from "./button";
import SmartImage from "./SmartImage";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";
import { cn } from "@/lib/utils";
import { canvasToBlob } from "@/utils/imageConcurrency";
import {
  isLikelyManagedAssetUrl,
  isRemoteUrl,
  normalizePersistableImageRef,
  resolveImageToBlob,
} from "@/utils/imageSource";
import { proxifyRemoteAssetUrl } from "@/utils/assetProxy";
import { useLocaleText } from "@/utils/localeText";

type AnnotationTool = "brush" | "arrow" | "rect" | "circle" | "text";

type Point = {
  x: number;
  y: number;
};

type BaseShape = {
  id: string;
  tool: AnnotationTool;
  color: string;
};

type BrushShape = BaseShape & {
  tool: "brush";
  points: Point[];
  strokeWidth: number;
};

type ArrowShape = BaseShape & {
  tool: "arrow";
  start: Point;
  end: Point;
  strokeWidth: number;
};

type RectShape = BaseShape & {
  tool: "rect";
  start: Point;
  end: Point;
  strokeWidth: number;
};

type CircleShape = BaseShape & {
  tool: "circle";
  start: Point;
  end: Point;
  strokeWidth: number;
};

type TextShape = BaseShape & {
  tool: "text";
  point: Point;
  text: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: "normal" | "bold";
};

type AnnotationShape =
  | BrushShape
  | ArrowShape
  | RectShape
  | CircleShape
  | TextShape;

type EditingTextState = {
  id: string;
  point: Point;
  value: string;
  fontSize: number;
};

type LoadedCanvasImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
};

export interface ImageAnnotationHistoryItem {
  id: string;
  src: string;
  title?: string;
  timestamp?: number;
  remoteUrl?: string;
}

export interface ImageAnnotationCrop {
  baseRef: string;
  rect: { x: number; y: number; width: number; height: number };
  sourceWidth?: number;
  sourceHeight?: number;
}

export interface ImageAnnotationSavePayload {
  blob: Blob;
  baseBlob: Blob;
  width: number;
  height: number;
  annotationCount: number;
}

interface ImageAnnotationModalProps {
  isOpen: boolean;
  imageSrc: string;
  imageTitle?: string;
  crop?: ImageAnnotationCrop | null;
  historyItems?: ImageAnnotationHistoryItem[];
  currentImageId?: string;
  onClose: () => void;
  onSave: (payload: ImageAnnotationSavePayload) => Promise<void>;
  onRestore?: (item: ImageAnnotationHistoryItem) => Promise<void>;
}

const DEFAULT_TEXT = "Text";
const DEFAULT_FONT_FAMILY =
  '"Heiti SC", "SimHei", "Arial", "Helvetica", sans-serif';

const createShapeId = () =>
  `annotation_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const distance = (a: Point, b: Point) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
};

const rectFromPoints = (start: Point, end: Point) => {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  return { x, y, width, height };
};

const setLineDash = (ctx: CanvasRenderingContext2D, values: number[] = []) => {
  try {
    ctx.setLineDash(values);
  } catch {
    // ignore old canvas implementations
  }
};

const drawArrow = (
  ctx: CanvasRenderingContext2D,
  shape: ArrowShape
) => {
  const { start, end, strokeWidth, color } = shape;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = distance(start, end);
  if (!Number.isFinite(length) || length < 0.5) return;
  const headLength = Math.min(Math.max(strokeWidth * 5.4, 22), length * 0.48);
  const headHalfWidth = Math.max(strokeWidth * 1.75, headLength * 0.34);
  const shaftDistanceFromTip = Math.min(
    length,
    Math.max(strokeWidth * 0.85, headLength * 0.82)
  );
  const unitX = dx / length;
  const unitY = dy / length;
  const normalX = -unitY;
  const normalY = unitX;
  const headBase = {
    x: end.x - unitX * headLength,
    y: end.y - unitY * headLength,
  };
  const shaftEnd = {
    x: end.x - unitX * shaftDistanceFromTip,
    y: end.y - unitY * shaftDistanceFromTip,
  };
  const leftBase = {
    x: headBase.x + normalX * headHalfWidth,
    y: headBase.y + normalY * headHalfWidth,
  };
  const rightBase = {
    x: headBase.x - normalX * headHalfWidth,
    y: headBase.y - normalY * headHalfWidth,
  };

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  setLineDash(ctx);

  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(shaftEnd.x, shaftEnd.y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(leftBase.x, leftBase.y);
  ctx.lineTo(rightBase.x, rightBase.y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

const drawShape = (
  ctx: CanvasRenderingContext2D,
  shape: AnnotationShape
) => {
  if (shape.tool === "brush") {
    if (shape.points.length < 2) return;
    ctx.save();
    ctx.strokeStyle = shape.color;
    ctx.lineWidth = shape.strokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    setLineDash(ctx);
    ctx.beginPath();
    ctx.moveTo(shape.points[0].x, shape.points[0].y);
    for (let i = 1; i < shape.points.length; i += 1) {
      const prev = shape.points[i - 1];
      const current = shape.points[i];
      const mid = {
        x: (prev.x + current.x) / 2,
        y: (prev.y + current.y) / 2,
      };
      ctx.quadraticCurveTo(prev.x, prev.y, mid.x, mid.y);
    }
    const last = shape.points[shape.points.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (shape.tool === "arrow") {
    drawArrow(ctx, shape);
    return;
  }

  if (shape.tool === "rect") {
    const rect = rectFromPoints(shape.start, shape.end);
    if (rect.width < 0.5 || rect.height < 0.5) return;
    ctx.save();
    ctx.strokeStyle = shape.color;
    ctx.lineWidth = shape.strokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    setLineDash(ctx);
    ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
    ctx.restore();
    return;
  }

  if (shape.tool === "circle") {
    const rect = rectFromPoints(shape.start, shape.end);
    if (rect.width < 0.5 || rect.height < 0.5) return;
    ctx.save();
    ctx.strokeStyle = shape.color;
    ctx.lineWidth = shape.strokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    setLineDash(ctx);
    ctx.beginPath();
    ctx.ellipse(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
      rect.width / 2,
      rect.height / 2,
      0,
      0,
      Math.PI * 2
    );
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (shape.tool === "text") {
    const lines = shape.text.split(/\r?\n/);
    ctx.save();
    ctx.fillStyle = shape.color;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.font = `${shape.fontWeight} ${shape.fontSize}px ${shape.fontFamily}`;
    const lineHeight = shape.fontSize * 1.25;
    lines.forEach((line, index) => {
      ctx.fillText(line || " ", shape.point.x, shape.point.y + index * lineHeight);
    });
    ctx.restore();
  }
};

const renderCanvas = (
  canvas: HTMLCanvasElement,
  loadedImage: LoadedCanvasImage,
  shapes: AnnotationShape[],
  previewShape?: AnnotationShape | null
) => {
  canvas.width = Math.max(1, Math.round(loadedImage.width));
  canvas.height = Math.max(1, Math.round(loadedImage.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(loadedImage.source, 0, 0, canvas.width, canvas.height);
  shapes.forEach((shape) => drawShape(ctx, shape));
  if (previewShape) drawShape(ctx, previewShape);
};

const createLoadedImageFromBlob = async (
  blob: Blob
): Promise<LoadedCanvasImage> => {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        dispose: () => {
          try {
            bitmap.close();
          } catch {}
        },
      };
    } catch {
      // fall through to HTMLImageElement
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = "async";
  const loaded = await new Promise<HTMLImageElement>((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image decode failed"));
    image.src = objectUrl;
  });

  return {
    source: loaded,
    width: loaded.naturalWidth || loaded.width,
    height: loaded.naturalHeight || loaded.height,
    dispose: () => URL.revokeObjectURL(objectUrl),
  };
};

const MANAGED_ASSET_KEY_RE = /^(projects|uploads|templates|videos|ai)\//i;

// 直连 TOS 灰度开关：默认关闭。开启前提是 TOS 桶已配好 CORS（allow origin 覆盖
// 生产/staging/dev、method GET、expose ETag），否则会发生「direct 被 CORS 拦 → 回退 proxy」
// 的双请求。配好 CORS 后设 VITE_DIRECT_ASSET_LOAD=1 即可启用。
const DIRECT_ASSET_LOAD_ENABLED =
  String(import.meta.env.VITE_DIRECT_ASSET_LOAD ?? "").trim() === "1";

/**
 * 方案A：让浏览器直连 TOS（预签名 URL）加载标注底图，绕过后端字节转发。
 * 仅对「受管 key / 受管 host 的远程 URL」启用；data:/blob:/外部 URL 一律返回 null 走回退。
 */
const buildDirectAssetUrl = (sourceRef: string): string | null => {
  if (!DIRECT_ASSET_LOAD_ENABLED) return null;
  const normalized = normalizePersistableImageRef(sourceRef);
  const trimmed = typeof normalized === "string" ? normalized.trim() : "";
  if (!trimmed) return null;

  let key: string | null = null;
  const bareKey = trimmed.replace(/^\/+/, "");
  if (MANAGED_ASSET_KEY_RE.test(bareKey) && !/[?#]/.test(bareKey)) {
    key = bareKey;
  } else if (isRemoteUrl(trimmed) && isLikelyManagedAssetUrl(trimmed)) {
    try {
      const parsedUrl = new URL(trimmed);
      // 带变体参数（x-oss-process / 裁剪缩放等）的远程 URL 不能丢参数直连原图，
      // 否则标注加载的不是「所见」的资源 → 一律回退 proxy 以保留完整 URL。
      if (parsedUrl.search) return null;
      const pathKey = parsedUrl.pathname.replace(/^\/+/, "");
      if (MANAGED_ASSET_KEY_RE.test(pathKey)) key = pathKey;
    } catch {
      // ignore
    }
  }
  if (!key) return null;

  return proxifyRemoteAssetUrl(
    `/api/assets/proxy?key=${encodeURIComponent(key)}&direct=1`,
    { forceProxy: true }
  );
};

/**
 * 用 crossOrigin=anonymous 直接加载图片。onload 后再用 1x1 getImageData 探测是否
 * origin-clean（TOS 未配 CORS 时图片虽能 onload 但 canvas 会被污染），任一环节失败返回 null 以触发回退。
 */
const DIRECT_LOAD_TIMEOUT_MS = 10_000;

const loadCleanImageFromUrl = (src: string): Promise<LoadedCanvasImage | null> =>
  new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";

    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (result: LoadedCanvasImage | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      // 失败时主动中断半开的加载，避免泄漏 pending 请求。
      if (!result) {
        try {
          image.src = "";
        } catch {
          // ignore
        }
      }
      resolve(result);
    };

    // 直连卡住/半开时必须超时回退，否则弹窗会永久 loading（直连不像 fetch 有超时）。
    timer = setTimeout(() => finish(null), DIRECT_LOAD_TIMEOUT_MS);

    image.onload = () => {
      try {
        const probe = document.createElement("canvas");
        probe.width = 1;
        probe.height = 1;
        const probeCtx = probe.getContext("2d");
        if (!probeCtx) {
          finish(null);
          return;
        }
        probeCtx.drawImage(image, 0, 0, 1, 1);
        // 抛 SecurityError 说明被污染（CORS 未生效）→ 回退
        probeCtx.getImageData(0, 0, 1, 1);
      } catch {
        finish(null);
        return;
      }
      finish({
        source: image,
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
        dispose: () => {},
      });
    };
    image.onerror = () => finish(null);
    image.src = src;
  });

const loadAnnotationImage = async (
  imageSrc: string,
  crop?: ImageAnnotationCrop | null
): Promise<LoadedCanvasImage> => {
  const sourceRef = crop?.baseRef || imageSrc;

  // 优先直连 TOS；失败（未配 CORS / 非受管 / 签名不可用）自动回退到 proxy 字节流。
  let loaded: LoadedCanvasImage | null = null;
  const directUrl = buildDirectAssetUrl(sourceRef);
  if (directUrl) {
    loaded = await loadCleanImageFromUrl(directUrl);
  }
  if (!loaded) {
    const blob = await resolveImageToBlob(sourceRef, { preferProxy: true });
    if (!blob) {
      throw new Error("Unable to read image");
    }
    loaded = await createLoadedImageFromBlob(blob);
  }
  if (!crop?.rect) return loaded;

  const w = Math.max(1, Math.round(crop.rect.width));
  const h = Math.max(1, Math.round(crop.rect.height));
  const sourceWidth = crop.sourceWidth && crop.sourceWidth > 0
    ? crop.sourceWidth
    : loaded.width;
  const sourceHeight = crop.sourceHeight && crop.sourceHeight > 0
    ? crop.sourceHeight
    : loaded.height;
  const scaleX = loaded.width / sourceWidth;
  const scaleY = loaded.height / sourceHeight;
  const sx = Math.max(0, Math.min(loaded.width - 1, Math.round(crop.rect.x * scaleX)));
  const sy = Math.max(0, Math.min(loaded.height - 1, Math.round(crop.rect.y * scaleY)));
  const sw = Math.max(1, Math.min(loaded.width - sx, Math.round(crop.rect.width * scaleX)));
  const sh = Math.max(1, Math.min(loaded.height - sy, Math.round(crop.rect.height * scaleY)));

  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = w;
  cropCanvas.height = h;
  const ctx = cropCanvas.getContext("2d");
  if (!ctx) {
    loaded.dispose();
    throw new Error("Canvas unavailable");
  }
  ctx.drawImage(loaded.source, sx, sy, sw, sh, 0, 0, w, h);
  loaded.dispose();

  return {
    source: cropCanvas,
    width: w,
    height: h,
    dispose: () => {},
  };
};

const ToolButton = ({
  active,
  title,
  children,
  onClick,
  disabled,
}: {
  active?: boolean;
  title: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        type="button"
        size="sm"
        variant={active ? "default" : "outline"}
        disabled={disabled}
        className={cn(
          "h-9 w-9 rounded-full p-0",
          active
            ? "border-white bg-white text-black hover:bg-white"
            : "border-white/15 bg-white/10 text-white hover:bg-white/20"
        )}
        onClick={onClick}
      >
        {children}
      </Button>
    </TooltipTrigger>
    <TooltipContent side="top">{title}</TooltipContent>
  </Tooltip>
);

const ImageAnnotationModal: React.FC<ImageAnnotationModalProps> = ({
  isOpen,
  imageSrc,
  imageTitle,
  crop,
  historyItems = [],
  currentImageId,
  onClose,
  onSave,
  onRestore,
}) => {
  const { lt } = useLocaleText();
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const textInputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const loadedImageRef = React.useRef<LoadedCanvasImage | null>(null);

  const [loadedImage, setLoadedImage] = React.useState<LoadedCanvasImage | null>(null);
  const [loadError, setLoadError] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [restoreId, setRestoreId] = React.useState<string | null>(null);
  const [tool, setTool] = React.useState<AnnotationTool>("brush");
  const [color, setColor] = React.useState("#ff2d2d");
  const [strokeWidth, setStrokeWidth] = React.useState(8);
  const [textSize, setTextSize] = React.useState(28);
  const [shapes, setShapes] = React.useState<AnnotationShape[]>([]);
  const [redoStack, setRedoStack] = React.useState<AnnotationShape[]>([]);
  const [activeShape, setActiveShape] = React.useState<AnnotationShape | null>(null);
  const [editingText, setEditingText] = React.useState<EditingTextState | null>(null);
  const [layoutVersion, setLayoutVersion] = React.useState(0);
  const editingTextRef = React.useRef<EditingTextState | null>(null);
  const focusedTextEditorIdRef = React.useRef<string | null>(null);
  const isTextComposingRef = React.useRef(false);

  const hasHistory = historyItems.length > 0;
  const cropBaseRef = crop?.baseRef ?? "";
  const cropX = crop?.rect?.x ?? 0;
  const cropY = crop?.rect?.y ?? 0;
  const cropWidth = crop?.rect?.width ?? 0;
  const cropHeight = crop?.rect?.height ?? 0;
  const cropSourceWidth = crop?.sourceWidth;
  const cropSourceHeight = crop?.sourceHeight;
  const effectiveCrop = React.useMemo<ImageAnnotationCrop | null>(() => {
    if (!cropBaseRef || cropWidth <= 0 || cropHeight <= 0) return null;
    return {
      baseRef: cropBaseRef,
      rect: {
        x: cropX,
        y: cropY,
        width: cropWidth,
        height: cropHeight,
      },
      sourceWidth: cropSourceWidth,
      sourceHeight: cropSourceHeight,
    };
  }, [
    cropBaseRef,
    cropHeight,
    cropSourceHeight,
    cropSourceWidth,
    cropWidth,
    cropX,
    cropY,
  ]);

  const redraw = React.useCallback(
    (previewShape?: AnnotationShape | null, nextShapes?: AnnotationShape[]) => {
      const canvas = canvasRef.current;
      const image = loadedImageRef.current;
      if (!canvas || !image) return;
      renderCanvas(canvas, image, nextShapes ?? shapes, previewShape ?? null);
    },
    [shapes]
  );

  React.useEffect(() => {
    loadedImageRef.current = loadedImage;
    return () => {
      if (loadedImageRef.current === loadedImage) {
        loadedImageRef.current = null;
      }
    };
  }, [loadedImage]);

  React.useEffect(() => {
    if (!isOpen) return;
    setShapes([]);
    setRedoStack([]);
    setActiveShape(null);
    setEditingText(null);
    setLoadError("");
    setIsLoading(true);

    let cancelled = false;
    let nextLoaded: LoadedCanvasImage | null = null;
    const previousLoaded = loadedImageRef.current;
    loadedImageRef.current = null;
    setLoadedImage(null);
    previousLoaded?.dispose();

    loadAnnotationImage(imageSrc, effectiveCrop)
      .then((image) => {
        if (cancelled) {
          image.dispose();
          return;
        }
        nextLoaded = image;
        loadedImageRef.current = image;
        setLoadedImage(image);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(lt("图片加载失败", "Image failed to load"));
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
      nextLoaded?.dispose();
    };
  }, [
    effectiveCrop,
    imageSrc,
    isOpen,
    lt,
  ]);

  React.useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  React.useEffect(() => {
    if (!isOpen) return;
    const onResize = () => setLayoutVersion((value) => value + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isOpen]);

  React.useEffect(() => {
    redraw(activeShape);
  }, [activeShape, loadedImage, redraw, shapes]);

  React.useEffect(() => {
    editingTextRef.current = editingText;
  }, [editingText]);

  const editingTextId = editingText?.id ?? null;
  React.useEffect(() => {
    if (!editingTextId) return;
    if (focusedTextEditorIdRef.current === editingTextId) return;
    focusedTextEditorIdRef.current = editingTextId;
    const timer = window.setTimeout(() => {
      textInputRef.current?.focus();
      textInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [editingTextId]);

  const getCanvasPoint = React.useCallback((event: React.PointerEvent<HTMLCanvasElement>): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }, []);

  const getDisplayScale = React.useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || canvas.width <= 0) return 1;
    return canvas.width / rect.width;
  }, []);

  const imageStrokeWidth = React.useCallback(() => {
    return Math.max(1, strokeWidth * getDisplayScale());
  }, [getDisplayScale, strokeWidth]);

  const imageTextSize = React.useCallback(() => {
    return Math.max(8, textSize * getDisplayScale());
  }, [getDisplayScale, textSize]);

  const commitShape = React.useCallback((shape: AnnotationShape | null) => {
    if (!shape) return;
    setShapes((prev) => {
      const next = [...prev, shape];
      redraw(null, next);
      return next;
    });
    setRedoStack([]);
  }, [redraw]);

  const commitEditingText = React.useCallback((): TextShape | null => {
    const current = editingTextRef.current;
    if (!current) return null;
    const text = current.value.trim();
    editingTextRef.current = null;
    setEditingText(null);
    if (!text) return null;
    const shape: TextShape = {
      id: current.id,
      tool: "text",
      point: current.point,
      text,
      color,
      fontSize: current.fontSize,
      fontFamily: DEFAULT_FONT_FAMILY,
      fontWeight: "bold",
    };
    return shape;
  }, [color]);

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!loadedImageRef.current || isSaving || isLoading) return;
      if (event.button !== 0) return;
      const point = getCanvasPoint(event);
      if (!point) return;
      event.currentTarget.setPointerCapture(event.pointerId);

      const pendingText = commitEditingText();
      if (pendingText) commitShape(pendingText);

      if (tool === "text") {
        setEditingText({
          id: createShapeId(),
          point,
          value: DEFAULT_TEXT,
          fontSize: imageTextSize(),
        });
        return;
      }

      const width = imageStrokeWidth();
      const id = createShapeId();
      const shape: AnnotationShape =
        tool === "brush"
          ? { id, tool: "brush", color, strokeWidth: width, points: [point] }
          : tool === "arrow"
            ? { id, tool: "arrow", color, strokeWidth: width, start: point, end: point }
            : tool === "rect"
              ? { id, tool: "rect", color, strokeWidth: width, start: point, end: point }
              : { id, tool: "circle", color, strokeWidth: width, start: point, end: point };
      setActiveShape(shape);
    },
    [
      color,
      commitEditingText,
      commitShape,
      getCanvasPoint,
      imageStrokeWidth,
      imageTextSize,
      isLoading,
      isSaving,
      tool,
    ]
  );

  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!activeShape) return;
      const point = getCanvasPoint(event);
      if (!point) return;
      setActiveShape((current) => {
        if (!current) return current;
        if (current.tool === "brush") {
          const last = current.points[current.points.length - 1];
          if (last && distance(last, point) < Math.max(1, current.strokeWidth * 0.2)) {
            return current;
          }
          return { ...current, points: [...current.points, point] };
        }
        if (current.tool === "arrow" || current.tool === "rect" || current.tool === "circle") {
          return { ...current, end: point };
        }
        return current;
      });
    },
    [activeShape, getCanvasPoint]
  );

  const finishActiveShape = React.useCallback(() => {
    const shape = activeShape;
    setActiveShape(null);
    if (!shape) return;
    if (shape.tool === "brush") {
      if (shape.points.length < 2) return;
      commitShape(shape);
      return;
    }
    if (
      (shape.tool === "arrow" || shape.tool === "rect" || shape.tool === "circle") &&
      distance(shape.start, shape.end) >= 2
    ) {
      commitShape(shape);
    }
  }, [activeShape, commitShape]);

  const undo = React.useCallback(() => {
    const pendingText = commitEditingText();
    if (pendingText) {
      commitShape(pendingText);
    }
    setShapes((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.slice(0, -1);
      const removed = prev[prev.length - 1];
      setRedoStack((redo) => [removed, ...redo]);
      redraw(null, next);
      return next;
    });
  }, [commitEditingText, commitShape, redraw]);

  const redo = React.useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const [nextShape, ...rest] = prev;
      setShapes((current) => {
        const next = [...current, nextShape];
        redraw(null, next);
        return next;
      });
      return rest;
    });
  }, [redraw]);

  const clearAnnotations = React.useCallback(() => {
    setEditingText(null);
    setActiveShape(null);
    setRedoStack([]);
    setShapes([]);
    redraw(null, []);
  }, [redraw]);

  const getFinalShapes = React.useCallback(() => {
    const textShape = commitEditingText();
    if (!textShape) return shapes;
    const next = [...shapes, textShape];
    setShapes(next);
    setRedoStack([]);
    redraw(null, next);
    return next;
  }, [commitEditingText, redraw, shapes]);

  const handleSave = React.useCallback(async () => {
    const canvas = canvasRef.current;
    const image = loadedImageRef.current;
    if (!canvas || !image || isSaving) return;
    const finalShapes = getFinalShapes();
    setIsSaving(true);
    try {
      renderCanvas(canvas, image, finalShapes, null);
      const outputBlob = await canvasToBlob(canvas, { type: "image/png", quality: 0.95 });

      const baseCanvas = document.createElement("canvas");
      baseCanvas.width = image.width;
      baseCanvas.height = image.height;
      const baseCtx = baseCanvas.getContext("2d");
      if (!baseCtx) throw new Error("Canvas unavailable");
      baseCtx.drawImage(image.source, 0, 0, image.width, image.height);
      const baseBlob = await canvasToBlob(baseCanvas, { type: "image/png", quality: 0.95 });

      await onSave({
        blob: outputBlob,
        baseBlob,
        width: image.width,
        height: image.height,
        annotationCount: finalShapes.length,
      });
      setShapes([]);
      setRedoStack([]);
      setActiveShape(null);
    } finally {
      setIsSaving(false);
    }
  }, [getFinalShapes, isSaving, onSave]);

  const handleRestore = React.useCallback(
    async (item: ImageAnnotationHistoryItem) => {
      if (!onRestore || isSaving || restoreId) return;
      setRestoreId(item.id);
      try {
        await onRestore(item);
        setShapes([]);
        setRedoStack([]);
        setActiveShape(null);
        setEditingText(null);
      } finally {
        setRestoreId(null);
      }
    },
    [isSaving, onRestore, restoreId]
  );

  React.useEffect(() => {
    if (!isOpen) return;
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        Boolean(target?.isContentEditable);
      if (event.key === "Escape") {
        if (editingText) {
          event.preventDefault();
          setEditingText(null);
        } else {
          onClose();
        }
        return;
      }
      if (isTyping) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editingText, isOpen, onClose, redo, undo]);

  if (!isOpen) return null;

  const canvasRect = canvasRef.current?.getBoundingClientRect();
  const textInputStyle = editingText && canvasRect
    ? {
        left: canvasRect.left + (editingText.point.x / Math.max(1, canvasRef.current?.width || 1)) * canvasRect.width,
        top: canvasRect.top + (editingText.point.y / Math.max(1, canvasRef.current?.height || 1)) * canvasRect.height,
        fontSize: Math.max(12, editingText.fontSize / Math.max(0.01, getDisplayScale())),
        color,
      }
    : undefined;
  void layoutVersion;

  const sizeValue = tool === "text" ? textSize : strokeWidth;
  const sizeMin = tool === "text" ? 14 : 2;
  const sizeMax = tool === "text" ? 72 : 32;
  const setSizeValue = (value: number) => {
    const numeric = Number.isFinite(value) ? value : sizeMin;
    const clamped = Math.max(sizeMin, Math.min(sizeMax, Math.round(numeric)));
    if (tool === "text") {
      setTextSize(clamped);
    } else {
      setStrokeWidth(clamped);
    }
  };

  const title = imageTitle || lt("图片标注", "Image annotation");
  const canSave = !isLoading && !loadError && !isSaving;

  return createPortal(
    <TooltipProvider delayDuration={120}>
      <div
        className="fixed inset-0 z-[999999] flex bg-black text-white"
        onContextMenuCapture={(event) => event.stopPropagation()}
      >
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className="absolute left-4 right-4 top-3 z-[1000001] flex h-10 items-center justify-between">
            <div className="min-w-0 truncate text-sm font-medium text-white/85">
              {title}
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-9 w-9 rounded-full border-white/15 bg-white/10 p-0 text-white hover:bg-white/20"
                  onClick={onClose}
                >
                  <X className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{lt("关闭", "Close")}</TooltipContent>
            </Tooltip>
          </div>

          <div
            className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-24 pt-16"
          >
            {isLoading && (
              <div className="flex items-center gap-2 text-sm text-white/70">
                <Loader2 className="h-4 w-4 animate-spin" />
                {lt("加载中...", "Loading...")}
              </div>
            )}
            {!isLoading && loadError && (
              <div className="text-sm text-red-200">{loadError}</div>
            )}
            {!isLoading && !loadError && (
              <canvas
                ref={canvasRef}
                className={cn(
                  "max-h-full max-w-full select-none shadow-2xl outline-none",
                  tool === "text" ? "cursor-text" : "cursor-crosshair"
                )}
                style={{
                  width: loadedImage ? "auto" : undefined,
                  height: loadedImage ? "auto" : undefined,
                  objectFit: "contain",
                  touchAction: "none",
                  filter: "drop-shadow(0 24px 48px rgba(0,0,0,0.75))",
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={finishActiveShape}
                onPointerCancel={finishActiveShape}
              />
            )}

            {editingText && textInputStyle && (
              <textarea
                ref={textInputRef}
                value={editingText.value}
                rows={2}
                className="fixed z-[1000002] min-h-10 w-52 resize-none rounded-md border border-white/30 bg-black/70 px-2 py-1 font-bold text-white shadow-xl outline-none backdrop-blur"
                style={textInputStyle}
                onChange={(event) =>
                  setEditingText((prev) =>
                    prev ? { ...prev, value: event.target.value } : prev
                  )
                }
                onCompositionStart={() => {
                  isTextComposingRef.current = true;
                }}
                onCompositionEnd={(event) => {
                  isTextComposingRef.current = false;
                  const value = event.currentTarget.value;
                  setEditingText((prev) =>
                    prev ? { ...prev, value } : prev
                  );
                }}
                onBlur={() => {
                  window.setTimeout(() => {
                    if (isTextComposingRef.current) return;
                    const shape = commitEditingText();
                    if (shape) commitShape(shape);
                  }, 0);
                }}
                onKeyDown={(event) => {
                  const isComposing =
                    isTextComposingRef.current ||
                    Boolean(event.nativeEvent?.isComposing);
                  if (event.key === "Enter" && !event.shiftKey && !isComposing) {
                    event.preventDefault();
                    const shape = commitEditingText();
                    if (shape) commitShape(shape);
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setEditingText(null);
                  }
                }}
              />
            )}
          </div>

          <div className="absolute bottom-4 left-1/2 z-[1000001] -translate-x-1/2">
            <div className="flex items-center gap-2 rounded-full border border-white/15 bg-black/70 px-3 py-2 shadow-2xl backdrop-blur-md">
              <ToolButton
                active={tool === "brush"}
                title={lt("画笔", "Brush")}
                onClick={() => setTool("brush")}
              >
                <Paintbrush className="h-4 w-4" />
              </ToolButton>
              <ToolButton
                active={tool === "arrow"}
                title={lt("箭头", "Arrow")}
                onClick={() => setTool("arrow")}
              >
                <MoveUpRight className="h-4 w-4" />
              </ToolButton>
              <ToolButton
                active={tool === "rect"}
                title={lt("矩形", "Rectangle")}
                onClick={() => setTool("rect")}
              >
                <Square className="h-4 w-4" />
              </ToolButton>
              <ToolButton
                active={tool === "circle"}
                title={lt("圆形", "Circle")}
                onClick={() => setTool("circle")}
              >
                <Circle className="h-4 w-4" />
              </ToolButton>
              <ToolButton
                active={tool === "text"}
                title={lt("文字", "Text")}
                onClick={() => setTool("text")}
              >
                <Type className="h-4 w-4" />
              </ToolButton>

              <div className="mx-1 h-7 w-px bg-white/15" />

              <label className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-white/10 hover:bg-white/20">
                <input
                  aria-label={lt("颜色", "Color")}
                  type="color"
                  value={color}
                  className="h-6 w-6 cursor-pointer border-0 bg-transparent p-0"
                  onChange={(event) => setColor(event.target.value)}
                />
              </label>
              <div className="flex h-9 items-center gap-2 rounded-full border border-white/15 bg-white/10 px-2 text-white">
                <input
                  aria-label={tool === "text" ? lt("字号", "Text size") : lt("线宽", "Stroke width")}
                  type="range"
                  min={sizeMin}
                  max={sizeMax}
                  value={sizeValue}
                  className="h-2 w-24 cursor-pointer accent-white"
                  onChange={(event) => setSizeValue(Number(event.target.value))}
                />
                <input
                  aria-label={tool === "text" ? lt("字号数值", "Text size value") : lt("线宽数值", "Stroke width value")}
                  type="number"
                  min={sizeMin}
                  max={sizeMax}
                  value={sizeValue}
                  className="h-6 w-12 rounded-md border border-white/20 bg-black/50 px-1 text-center text-xs font-semibold tabular-nums text-white outline-none"
                  onChange={(event) => setSizeValue(Number(event.target.value))}
                />
              </div>

              <div className="mx-1 h-7 w-px bg-white/15" />

              <ToolButton
                title={lt("撤销", "Undo")}
                onClick={undo}
                disabled={shapes.length === 0 && !editingText}
              >
                <Undo2 className="h-4 w-4" />
              </ToolButton>
              <ToolButton
                title={lt("重做", "Redo")}
                onClick={redo}
                disabled={redoStack.length === 0}
              >
                <Redo2 className="h-4 w-4" />
              </ToolButton>
              <ToolButton
                title={lt("清空标注", "Clear annotations")}
                onClick={clearAnnotations}
                disabled={shapes.length === 0 && !editingText}
              >
                <Trash2 className="h-4 w-4" />
              </ToolButton>

              <Button
                type="button"
                size="sm"
                disabled={!canSave}
                className="h-9 rounded-full bg-white px-4 text-black hover:bg-white/90"
                onClick={handleSave}
              >
                {isSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                {lt("保存", "Save")}
              </Button>
            </div>
          </div>
        </div>

        {hasHistory && (
          <aside className="hidden w-60 shrink-0 border-l border-white/10 bg-black/80 md:flex md:flex-col">
            <div className="flex h-12 items-center gap-2 border-b border-white/10 px-3 text-sm font-medium text-white/80">
              <History className="h-4 w-4" />
              {lt("历史", "History")}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <div className="space-y-2">
                {historyItems.map((item) => {
                  const active = item.id === currentImageId;
                  return (
                    <div
                      key={item.id}
                      className={cn(
                        "overflow-hidden rounded-md border bg-white/5",
                        active ? "border-blue-400" : "border-white/10"
                      )}
                    >
                      <div className="aspect-video bg-white/5">
                        <SmartImage
                          src={item.src}
                          alt={item.title || lt("历史图片", "History image")}
                          className="h-full w-full object-cover"
                          loading="lazy"
                          placeholder={<div className="h-full w-full bg-white/5" />}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2 px-2 py-2">
                        <div className="min-w-0 truncate text-xs text-white/70">
                          {item.timestamp
                            ? new Date(item.timestamp).toLocaleString()
                            : item.title || lt("版本", "Version")}
                        </div>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={!onRestore || Boolean(restoreId)}
                              className="h-7 w-7 shrink-0 rounded-full border-white/15 bg-white/10 p-0 text-white hover:bg-white/20"
                              onClick={() => handleRestore(item)}
                            >
                              {restoreId === item.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <RotateCcw className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            {lt("恢复此版本", "Restore this version")}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>
        )}
      </div>
    </TooltipProvider>,
    document.body
  );
};

export default ImageAnnotationModal;
