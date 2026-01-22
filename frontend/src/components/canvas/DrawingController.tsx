/**
 * Canvas drawing controller with selection, context menu, and persistence hooks.
 */
import React, { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import paper from 'paper';
import {
  ArrowDown,
  ArrowUp,
  ClipboardPaste,
  Copy,
  Download,
  Trash2,
  FolderPlus,
  FileJson,
  FileInput,
} from 'lucide-react';
import { useToolStore, useCanvasStore, useLayerStore } from '@/stores';
import { useAIChatStore } from '@/stores/aiChatStore';
import { useProjectContentStore } from '@/stores/projectContentStore';
import ImageUploadComponent from './ImageUploadComponent';
import Model3DUploadComponent from './Model3DUploadComponent';
import Model3DContainer from './Model3DContainer';
import ImageContainer from './ImageContainer';
import SelectionGroupToolbar from './SelectionGroupToolbar';
import { DrawingLayerManager } from './drawing/DrawingLayerManager';
import { AutoScreenshotService } from '@/services/AutoScreenshotService';
import { fetchWithAuth } from '@/services/authFetch';
import { logger } from '@/utils/logger';
import { recordImageHistoryEntry } from '@/services/imageHistoryService';
import { ensureImageGroupStructure } from '@/utils/paperImageGroup';
import { BoundsCalculator } from '@/utils/BoundsCalculator';
import { createImageGroupBlock, formatImageGroupTitle, removeGroupBlockTitle } from '@/utils/paperImageGroupBlock';
import { contextManager } from '@/services/contextManager';
import { clipboardService, type CanvasClipboardData, type PathClipboardSnapshot } from '@/services/clipboardService';
import { clipboardJsonService } from '@/services/clipboardJsonService';
import { isGroup, isRaster } from '@/utils/paperCoords';
import type { ImageAssetSnapshot, ModelAssetSnapshot, TextAssetSnapshot, VideoAssetSnapshot } from '@/types/project';
import ContextMenu from '@/components/ui/context-menu';

// 导入新的hooks
import { useImageTool } from "./hooks/useImageTool";
import { useModel3DTool } from "./hooks/useModel3DTool";
import { useVideoTool } from "./hooks/useVideoTool";
import { useDrawingTools } from "./hooks/useDrawingTools";
import { useSelectionTool } from "./hooks/useSelectionTool";
import { usePathEditor } from "./hooks/usePathEditor";
import { useEraserTool } from "./hooks/useEraserTool";
import { useInteractionController } from "./hooks/useInteractionController";
import { useQuickImageUpload } from "./hooks/useQuickImageUpload";
import { useSimpleTextTool } from "./hooks/useSimpleTextTool";
import { useSnapAlignment } from "./hooks/useSnapAlignment";
import SimpleTextEditor from "./SimpleTextEditor";
import TextSelectionOverlay from "./TextSelectionOverlay";
import { SnapGuideRenderer } from "./SnapGuideRenderer";
import type { DrawingContext, ImageInstance } from "@/types/canvas";
import { paperSaveService } from "@/services/paperSaveService";
import { historyService } from "@/services/historyService";
import type { Model3DData } from "@/services/model3DUploadService";
import { clientToProject } from "@/utils/paperCoords";
import { downloadImage, getSuggestedFileName } from "@/utils/downloadHelper";
import { applyCursorForDrawMode } from "@/utils/cursorStyles";
import { proxifyRemoteAssetUrl } from "@/utils/assetProxy";
import {
  isAssetKeyRef,
  isPersistableImageRef,
  isRemoteUrl,
  normalizePersistableImageRef,
  resolveImageToBlob,
  toRenderableImageSrc,
} from "@/utils/imageSource";
import { responseToBlob } from "@/utils/imageConcurrency";
import {
  usePersonalLibraryStore,
  createPersonalAssetId,
  type PersonalImageAsset,
  type PersonalSvgAsset,
} from "@/stores/personalLibraryStore";
import { personalLibraryApi } from "@/services/personalLibraryApi";
import { imageUploadService } from "@/services/imageUploadService";
import { generateOssKey } from "@/services/ossUploadService";
import { putFlowImageBlobs, toFlowImageAssetRef } from "@/services/flowImageAssetStore";

const isInlineImageSource = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  return value.startsWith("data:image") || value.startsWith("blob:");
};

const extractLocalImageData = (imageData: unknown): string | null => {
  if (!imageData || typeof imageData !== "object") return null;
  const candidates = ["localDataUrl", "dataUrl", "previewDataUrl"];
  for (const key of candidates) {
    const candidate = (imageData as Record<string, unknown>)[key];
    if (
      typeof candidate === "string" &&
      candidate.length > 0 &&
      isInlineImageSource(candidate)
    ) {
      return candidate;
    }
  }
  return null;
};

// 提取可持久化图片引用（优先 OSS key，其次 remoteUrl/url/src 等；返回 normalize 后的 ref）
const extractPersistableImageRef = (imageData: unknown): string | null => {
  if (!imageData || typeof imageData !== "object") return null;
  const data = imageData as Record<string, unknown>;

  // key 更“稳定/可迁移”，优先于 remoteUrl
  const urlCandidates = ["key", "remoteUrl", "url", "src"];
  for (const key of urlCandidates) {
    const candidate = data[key];
    if (typeof candidate !== "string" || candidate.trim().length === 0) continue;
    const normalized = normalizePersistableImageRef(candidate);
    if (!normalized || !isPersistableImageRef(normalized)) continue;
    return normalized;
  }
  return null;
};

const dispatchImageInstancesUpdated = (instances: ImageInstance[]) => {
  try {
    window.dispatchEvent(
      new CustomEvent("tanva-image-instances-updated", {
        detail: { count: instances?.length ?? 0 },
      })
    );
  } catch {}
};

const syncImageInstancesToWindow = (instances: ImageInstance[]) => {
  try {
    (window as any).tanvaImageInstances = instances;
  } catch {}
  dispatchImageInstancesUpdated(instances);
};

const getPersistedImageAssetSnapshot = (imageId: string): unknown | null => {
  if (!imageId) return null;
  try {
    const content = useProjectContentStore.getState().content;
    const images = content?.assets?.images;
    if (!Array.isArray(images)) return null;
    return images.find((it: any) => it && it.id === imageId) ?? null;
  } catch {
    return null;
  }
};

// 画布图片同步到 Chat：
// - 若图片仍处于上传中（pendingUpload=true），优先使用 blob:/data: 预览，避免 key/URL 尚不可用导致“裂图”
// - 上传完成后优先取可持久化引用（SSOT: ProjectContent.assets），以满足设计 JSON 约束
const resolveCanvasImageRefForChat = (
  imageId: string,
  imageData: unknown
): string | null => {
  const rasterRemoteUrl = (() => {
    if (!imageId) return null;
    try {
      const project = paper?.project as any;
      const rasterClass = (paper as any).Raster;
      if (!project?.getItems || !rasterClass) return null;
      const rasters = project.getItems({ class: rasterClass }) as any[];
      for (const raster of rasters) {
        if (!raster) continue;
        const rid =
          raster?.data?.imageId ||
          raster?.parent?.data?.imageId ||
          raster?.data?.id ||
          raster?.id;
        if (String(rid) !== String(imageId)) continue;
        const raw =
          typeof raster?.data?.remoteUrl === "string"
            ? raster.data.remoteUrl
            : "";
        const normalized = normalizePersistableImageRef(raw) || raw;
        if (normalized && isRemoteUrl(normalized)) return normalized;
      }
    } catch {}
    return null;
  })();

  const persisted = getPersistedImageAssetSnapshot(imageId);
  const pendingUpload =
    Boolean((persisted as any)?.pendingUpload) ||
    Boolean((imageData as any)?.pendingUpload);

  const primarySource =
    (imageData as any)?.src ??
    (imageData as any)?.url ??
    (imageData as any)?.remoteUrl;
  const inlineSource = isInlineImageSource(primarySource) ? primarySource : null;
  const localPreview = inlineSource || extractLocalImageData(imageData);

  // 上传中：先给一个“立即可渲染”的引用（blob 优先），避免对话框里显示 404/裂图
  if (pendingUpload && localPreview) {
    return localPreview;
  }

  if (rasterRemoteUrl) return rasterRemoteUrl;

  const remoteCandidate = (() => {
    const candidates = [
      (persisted as any)?.remoteUrl,
      (imageData as any)?.remoteUrl,
      (persisted as any)?.url,
      (imageData as any)?.url,
    ];
    for (const candidate of candidates) {
      if (typeof candidate !== "string") continue;
      const trimmed = candidate.trim();
      if (!trimmed) continue;
      const normalized = normalizePersistableImageRef(trimmed) || trimmed;
      if (isRemoteUrl(normalized)) return normalized;
    }
    return null;
  })();
  if (remoteCandidate) return remoteCandidate;

  const persistedRef = extractPersistableImageRef(persisted);
  const runtimeRef = extractPersistableImageRef(imageData);
  const persistable = persistedRef || runtimeRef;
  if (persistable) return toRenderableImageSrc(persistable) || persistable;

  return localPreview;
};

// 提取图片的任何可用源（优先 remoteUrl，其次其他可持久化引用，最后 inline 数据）
const extractAnyImageSource = (imageData: unknown): string | null => {
  if (!imageData || typeof imageData !== "object") return null;
  const data = imageData as Record<string, unknown>;

  // 优先使用可持久化引用（remoteUrl 优先）
  const urlCandidates = ["remoteUrl", "src", "url", "key"];
  for (const key of urlCandidates) {
    const candidate = data[key];
    if (typeof candidate !== "string" || candidate.length === 0) continue;
    const normalized = normalizePersistableImageRef(candidate);
    if (!normalized || !isPersistableImageRef(normalized)) continue;
    return toRenderableImageSrc(candidate) || candidate;
  }

  // 再使用 inline 数据（blob/base64）
  const localData = extractLocalImageData(imageData);
  if (localData) return localData;

  return null;
};

const isEditableElement = (el: Element | null): boolean => {
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea") return true;
  const anyEl = el as any;
  return !!anyEl?.isContentEditable;
};

const normalizeImageFileName = (
  fileNameCandidate: unknown,
  contentTypeCandidate: unknown
): string => {
  const candidate =
    typeof fileNameCandidate === "string" && fileNameCandidate.trim().length > 0
      ? fileNameCandidate.trim()
      : "";
  const contentType =
    typeof contentTypeCandidate === "string" &&
    contentTypeCandidate.trim().length > 0
      ? contentTypeCandidate.trim()
      : "";

  const extFromType = (() => {
    const lower = contentType.toLowerCase();
    if (lower.includes("image/png")) return ".png";
    if (lower.includes("image/jpeg") || lower.includes("image/jpg"))
      return ".jpg";
    if (lower.includes("image/webp")) return ".webp";
    if (lower.includes("image/gif")) return ".gif";
    if (lower.includes("image/svg+xml")) return ".svg";
    return "";
  })();

  const hasExt = /\.[a-z0-9]+$/i.test(candidate);
  if (candidate) {
    if (hasExt) {
      if (extFromType && !candidate.toLowerCase().endsWith(extFromType)) {
        return candidate.replace(/\.[a-z0-9]+$/i, extFromType);
      }
      return candidate;
    }
    return extFromType ? `${candidate}${extFromType}` : `${candidate}.png`;
  }

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, "");
  return `image_${timestamp}${extFromType || ".png"}`;
};

const seemsImageUrl = (text: string): boolean => {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) return false;

  const normalized = normalizePersistableImageRef(trimmed);
  if (!normalized || !isPersistableImageRef(normalized)) return false;

  if (/\.(png|jpe?g|gif|webp|bmp|svg)([?#].*)?$/i.test(trimmed)) return true;
  if (isAssetKeyRef(normalized)) return true;
  if (trimmed.includes("/api/assets/proxy") || trimmed.includes("/assets/proxy")) return true;

  return false;
};

const fetchImagePayload = async (url: string): Promise<string> => url;

const looksLikeSvgMarkup = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("<svg")) return true;
  if (trimmed.startsWith("<?xml") && trimmed.includes("<svg")) return true;
  return trimmed.includes("<svg");
};

const CANVAS_CLIPBOARD_MIME = "application/x-tanva-canvas";
const CANVAS_CLIPBOARD_FALLBACK_TEXT = "Tanva canvas selection";
const CANVAS_CLIPBOARD_TYPE = "tanva-canvas";

interface DrawingControllerProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

type ContextMenuTargetType =
  | "canvas"
  | "selection"
  | "image"
  | "model3d"
  | "text"
  | "path";

interface CanvasContextMenuState {
  x: number;
  y: number;
  type: ContextMenuTargetType;
  targetId?: string;
}

type HitTestTarget =
  | { type: "image"; id: string }
  | { type: "model3d"; id: string }
  | { type: "text"; id?: string }
  | { type: "path"; path: paper.Path }
  | null;

const DrawingController: React.FC<DrawingControllerProps> = ({ canvasRef }) => {
  const {
    drawMode,
    currentColor,
    fillColor,
    strokeWidth,
    isEraser,
    hasFill,
    setDrawMode,
  } = useToolStore();
  const zoom = useCanvasStore((state) => state.zoom);
  const panX = useCanvasStore((state) => state.panX);
  const panY = useCanvasStore((state) => state.panY);
  const { toggleVisibility } = useLayerStore();
  const { setSourceImageForEditing, showDialog: showAIDialog } =
    useAIChatStore();
  const projectId = useProjectContentStore((s) => s.projectId);
  const projectAssets = useProjectContentStore((s) => s.content?.assets);
  const drawingLayerManagerRef = useRef<DrawingLayerManager | null>(null);
  const lastDrawModeRef = useRef<string>(drawMode);
  const [isGroupCapturePending, setIsGroupCapturePending] = useState(false);
  const [modelCapturePending, setModelCapturePending] = useState<
    Record<string, boolean>
  >({});
  const [contextMenuState, setContextMenuState] =
    useState<CanvasContextMenuState | null>(null);
  const handleCanvasPasteRef = useRef<() => boolean>(() => false);
  const canvasToChatSyncTokenRef = useRef(0);
  const canvasBlobToFlowAssetRefCacheRef = useRef<Map<string, string>>(
    new Map()
  );
  const scheduleRebuildRef = useRef<(() => void) | null>(null);
  const lastRecoveryAtRef = useRef(0);

  // 内存优化：使用 ref 存储频繁变化的值，避免闭包重建
  const zoomRef = useRef(zoom);
  const panRef = useRef({ x: panX, y: panY });

  useEffect(() => {
    zoomRef.current = zoom;
    panRef.current = { x: panX, y: panY };
  }, [zoom, panX, panY]);

  // 根据当前工具切换画布光标（图片/3D 工具展示对应图标）
  useEffect(() => {
    applyCursorForDrawMode(canvasRef.current, drawMode);

    return () => {
      applyCursorForDrawMode(canvasRef.current, null);
    };
  }, [canvasRef, drawMode]);

  // 初始化图层管理器
  useEffect(() => {
    if (!drawingLayerManagerRef.current) {
      drawingLayerManagerRef.current = new DrawingLayerManager();
    }

    // 初始化Paper.js保存服务
    paperSaveService.init();

    // Expose paperSaveService globally for testing (development only)
    if (import.meta.env.DEV) {
      (window as any).testPaperSave = () => {
        logger.debug("🧪 Testing Paper.js save manually...");
        paperSaveService.triggerAutoSave();
      };

      (window as any).testPaperState = () => {
        logger.debug("🔍 Paper.js状态检查:", {
          hasPaper: !!paper,
          hasProject: !!paper?.project,
          hasView: !!paper?.view,
          projectLayers: paper?.project?.layers?.length || 0,
          layerNames: paper?.project?.layers?.map((l) => l.name) || [],
        });
      };
    }

    // 监听 Paper.js 项目恢复事件
    const handleProjectRecovery = (_event: CustomEvent) => {
      logger.debug("🔄 收到Paper.js项目恢复请求，重新初始化图层管理器...");

      try {
        // 重新创建图层管理器
        if (drawingLayerManagerRef.current) {
          drawingLayerManagerRef.current.cleanup();
        }
        drawingLayerManagerRef.current = new DrawingLayerManager();

        // 触发 paper-ready 事件
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent("paper-ready", {
              detail: { recovered: true, timestamp: Date.now() },
            })
          );
        }, 100);

        logger.debug("✅ Paper.js项目恢复完成");
      } catch (error) {
        console.error("❌ Paper.js项目恢复失败:", error);
      }
    };

    // 添加恢复事件监听器
    window.addEventListener(
      "paper-project-recovery-needed",
      handleProjectRecovery as EventListener
    );

    return () => {
      if (drawingLayerManagerRef.current) {
        drawingLayerManagerRef.current.cleanup();
        drawingLayerManagerRef.current = null;
      }
      // 清理保存服务
      paperSaveService.cleanup();

      // 移除恢复事件监听器
      window.removeEventListener(
        "paper-project-recovery-needed",
        handleProjectRecovery as EventListener
      );
    };
  }, []);

  // 确保绘图图层存在并激活
  const ensureDrawingLayer = useCallback(() => {
    // 首先检查 Paper.js 项目状态
    if (!paper || !paper.project || !paper.view) {
      console.warn("⚠️ Paper.js项目未初始化，尝试恢复...");

      // 触发项目恢复
      window.dispatchEvent(
        new CustomEvent("paper-project-recovery-needed", {
          detail: { source: "ensureDrawingLayer", timestamp: Date.now() },
        })
      );

      return null;
    }

    if (!drawingLayerManagerRef.current) {
      drawingLayerManagerRef.current = new DrawingLayerManager();
    }

    try {
      return drawingLayerManagerRef.current.ensureDrawingLayer();
    } catch (error) {
      console.error("❌ 确保绘图图层失败:", error);

      // 尝试重新创建图层管理器
      try {
        drawingLayerManagerRef.current = new DrawingLayerManager();
        return drawingLayerManagerRef.current.ensureDrawingLayer();
      } catch (retryError) {
        console.error("❌ 重试创建绘图图层失败:", retryError);
        return null;
      }
    }
  }, []);

  // ========== 初始化绘图上下文 ==========
  const drawingContext: DrawingContext = {
    ensureDrawingLayer: () =>
      ensureDrawingLayer() ?? useLayerStore.getState().ensureActiveLayer(),
    zoom,
  };

  const ensureChatStableImageRef = useCallback(
    async (value: string, nodeId?: string): Promise<string> => {
      const trimmed = typeof value === "string" ? value.trim() : "";
      if (!trimmed) return value;

      // 远程 URL / key / proxy/path 等可持久化引用：直接使用（避免不必要的 clone）
      const normalized = normalizePersistableImageRef(trimmed);
      if (normalized && isPersistableImageRef(normalized)) {
        return trimmed;
      }

      // 画布侧的 blob: ObjectURL 可能会被回收（例如升级为远程 URL 后），
      // 直接把 blob: 透传到 Chat 会导致预览“突然裂图”。
      // 这里把 blob: 克隆为 flow-asset:（IndexedDB + refcount）以跨组件稳定复用。
      if (!trimmed.startsWith("blob:")) return trimmed;

      const cached = canvasBlobToFlowAssetRefCacheRef.current.get(trimmed);
      if (cached) return cached;

      const blob = await resolveImageToBlob(trimmed, { preferProxy: false });
      if (!blob) return trimmed;

      const ids = await putFlowImageBlobs([
        { blob, projectId: projectId ?? null, nodeId },
      ]);
      const id = ids?.[0];
      if (!id) return trimmed;

      const ref = toFlowImageAssetRef(id);
      canvasBlobToFlowAssetRefCacheRef.current.set(trimmed, ref);
      return ref;
    },
    [projectId]
  );

  const mapCanvasImageSourceToChatStable = useCallback(
    (value: string | null): string | null => {
      const trimmed = typeof value === "string" ? value.trim() : "";
      if (!trimmed) return null;
      if (!trimmed.startsWith("blob:")) return trimmed;
      return canvasBlobToFlowAssetRefCacheRef.current.get(trimmed) ?? trimmed;
    },
    []
  );

  // 内存优化：使用 ref 存储实例数组，避免大型闭包
  const imageInstancesRef = useRef<ImageInstance[]>([]);

  // ========== 初始化图片工具Hook ==========
  const imageTool = useImageTool({
    context: drawingContext,
    canvasRef,
    eventHandlers: {
      onImageSelect: (imageId) => logger.debug("图片选中:", imageId),
      onImageDeselect: () => logger.debug("取消图片选择"),
      onImageDelete: (imageId) => {
        try {
          // 尝试找到被删除的实例，提取其源数据用于同步到AI对话框
          const instance = imageInstancesRef.current.find(
            (img) => img.id === imageId
          );
          const rawSource = instance
            ? resolveCanvasImageRefForChat(instance.id, instance.imageData)
            : null;
          const imageSourceForAI = mapCanvasImageSourceToChatStable(rawSource);
          if (!imageSourceForAI) return;

          const aiStore = useAIChatStore.getState();

          // 若当前编辑/分析源图就是这张，被删除后清空
          if (aiStore.sourceImageForEditing === imageSourceForAI) {
            aiStore.setSourceImageForEditing(null);
          }
          if (aiStore.sourceImageForAnalysis === imageSourceForAI) {
            aiStore.setSourceImageForAnalysis(null);
          }

          // 从多图融合列表中移除被删除的画布图片
          const blendIndex = aiStore.sourceImagesForBlending.findIndex(
            (img) => img === imageSourceForAI
          );
          if (blendIndex >= 0) {
            aiStore.removeImageFromBlending(blendIndex);
          }
        } catch (error) {
          console.warn("同步删除图片到AI对话框失败:", error);
        }
      },
    },
  });

  imageInstancesRef.current = imageTool.imageInstances;

  const shouldRecoverPaperImages = useCallback(() => {
    if (!paper || !paper.project) return false;

    const rasterClass = (paper as any).Raster;
    const rasters = rasterClass
      ? ((paper.project as any).getItems?.({ class: rasterClass }) as any[])
      : [];
    const imageItems = (paper.project as any).getItems?.({
      match: (item: any) =>
        item?.data?.type === "image" && typeof item?.data?.imageId === "string",
    }) as any[] | undefined;
    const selectionAreas = (paper.project as any).getItems?.({
      match: (item: any) =>
        item?.data?.type === "image-selection-area" &&
        typeof item?.data?.imageId === "string",
    }) as any[] | undefined;

    const rasterCount = rasters?.length ?? 0;
    const imageItemCount = imageItems?.length ?? 0;
    const selectionCount = selectionAreas?.length ?? 0;
    const instances = imageInstancesRef.current || [];

    const hasPaperImages = rasterCount > 0 || imageItemCount > 0;
    if (!hasPaperImages) return false;

    const hasValidInstanceBounds = instances.some(
      (img) => (img?.bounds?.width ?? 0) > 0 && (img?.bounds?.height ?? 0) > 0
    );

    if (instances.length === 0) return true;
    if (!hasValidInstanceBounds) return true;
    if (selectionCount === 0) return true;
    return false;
  }, []);

  const requestPaperRecovery = useCallback(
    (reason: string) => {
      const now = Date.now();
      if (now - lastRecoveryAtRef.current < 800) return;
      if (!shouldRecoverPaperImages()) return;
      lastRecoveryAtRef.current = now;
      logger.debug("🧩 Paper 恢复触发:", reason);
      scheduleRebuildRef.current?.();
    },
    [shouldRecoverPaperImages]
  );

  // ========== 初始化快速图片上传Hook ==========
  const quickImageUpload = useQuickImageUpload({
    context: drawingContext,
    canvasRef,
    projectId,
  });
  const uploadImageToCanvas = quickImageUpload.handleQuickImageUploaded;
  // ========== 监听drawMode变化，处理快速上传 ==========
  useEffect(() => {
    // 只在drawMode变化时触发，避免重复触发
    if (
      drawMode === "quick-image" &&
      lastDrawModeRef.current !== "quick-image"
    ) {
      logger.tool("触发快速图片上传");
      quickImageUpload.triggerQuickImageUpload();
      // 触发后立即切换回选择模式
      setTimeout(() => {
        setDrawMode("select");
      }, 100);
    }
    lastDrawModeRef.current = drawMode;
  }, [drawMode, quickImageUpload, setDrawMode]);

  // ========== 监听快速上传的图片并添加到实例管理 ==========
  useEffect(() => {
    const handleQuickImageAdded = (event: CustomEvent) => {
      const imageInstance = event.detail;
      logger.debug("🎪 [DEBUG] DrawingController收到quickImageAdded事件:", {
        id: imageInstance.id,
        bounds: imageInstance.bounds,
        layerId: imageInstance.layerId,
        hasRemoteUrl: !!(
          imageInstance.imageData?.url &&
          !imageInstance.imageData.url.startsWith("data:")
        ),
        hasInlineData: !!(
          imageInstance.imageData?.src &&
          imageInstance.imageData.src.startsWith("data:")
        ),
      });

      if (imageInstance) {
        imageTool.setImageInstances((prev) => {
          const alreadyExists = prev.some(
            (inst) => inst.id === imageInstance.id
          );
          if (alreadyExists) {
            logger.debug(
              "ℹ️ [DEBUG] quickImageAdded: 实例已存在，跳过重复添加",
              imageInstance.id
            );
            return prev;
          }
          const next = [...prev, imageInstance];
          // 立即同步到 window，避免“刚发送到画布→立刻保存”时 assets 采集不到新图片
          try {
            (window as any).tanvaImageInstances = next;
          } catch {}
          logger.upload("快速上传的图片已添加到实例管理");
          logger.debug("✅ [DEBUG] 图片实例已添加到imageTool管理");
          return next;
        });

        // 同步缓存位置信息（如果该图片刚被缓存为最新）
        try {
          const cached = contextManager.getCachedImage();
          const rawSource = imageInstance.imageData?.src;
          const inlineSource = isInlineImageSource(rawSource)
            ? rawSource
            : null;
          const localDataUrl = extractLocalImageData(imageInstance.imageData);
          const imageDataForCache =
            inlineSource || localDataUrl || cached?.imageData || null;
          const remoteUrl = (() => {
            if (inlineSource) {
              return imageInstance.imageData?.url ?? cached?.remoteUrl ?? null;
            }
            if (typeof rawSource === "string" && rawSource.length > 0) {
              return rawSource;
            }
            if (
              typeof imageInstance.imageData?.url === "string" &&
              imageInstance.imageData.url.length > 0
            ) {
              return imageInstance.imageData.url;
            }
            return cached?.remoteUrl ?? null;
          })();

          if (remoteUrl) {
            // 画布侧不缓存 base64/dataURL：只缓存远程 URL，避免内存与序列化开销
            contextManager.cacheLatestImage(
              null,
              imageInstance.id,
              cached?.prompt || "快速上传图片",
              {
                bounds: imageInstance.bounds,
                layerId: imageInstance.layerId,
                remoteUrl,
              }
            );
            logger.debug("🧷 已将图片位置信息写入缓存（覆盖为当前实例）:", {
              id: imageInstance.id,
              bounds: imageInstance.bounds,
            });
          } else if (imageDataForCache) {
            contextManager.cacheLatestImage(
              imageDataForCache,
              imageInstance.id,
              cached?.prompt || "快速上传图片",
              {
                bounds: imageInstance.bounds,
                layerId: imageInstance.layerId,
                remoteUrl: null,
              }
            );
          } else {
            console.warn("⚠️ 未找到可缓存的图像数据，保持现有缓存", {
              imageId: imageInstance.id,
              hasInlineSource: !!inlineSource,
              hasLocalDataUrl: !!localDataUrl,
              hadCachedImage: !!cached?.imageData,
              hasRemoteUrl: !!remoteUrl,
            });
          }
        } catch (e) {
          console.warn("写入缓存位置信息失败:", e);
        }
      }
    };

    window.addEventListener(
      "quickImageAdded",
      handleQuickImageAdded as EventListener
    );

    return () => {
      window.removeEventListener(
        "quickImageAdded",
        handleQuickImageAdded as EventListener
      );
    };
  }, [imageTool.setImageInstances]);

  // ========== 粘贴到画布：从剪贴板粘贴图片 ==========
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      void (async () => {
        try {
          // 若焦点在可编辑元素中，放行默认粘贴行为
          const active = document.activeElement as Element | null;
          if (isEditableElement(active)) return;

          const clipboardData = e.clipboardData;
          if (!clipboardData) return;

          // 先尝试处理画布内的结构化剪贴板数据
          const rawCanvasData =
            clipboardData.getData(CANVAS_CLIPBOARD_MIME) ||
            clipboardData.getData("application/json");
          if (rawCanvasData) {
            try {
              const parsed = JSON.parse(rawCanvasData);
              const payload: CanvasClipboardData | null =
                parsed?.type === CANVAS_CLIPBOARD_TYPE
                  ? parsed.data
                  : parsed?.images && parsed?.paths
                  ? parsed
                  : null;
              if (payload) {
                clipboardService.setCanvasData(payload);
                const handled = handleCanvasPasteRef.current();
                if (handled) {
                  e.preventDefault();
                  return;
                }
              }
            } catch (err) {
              logger.warn("解析画布剪贴板数据失败", err);
            }
          }

          // 优先处理图片项
          const items = clipboardData.items;
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (
              item &&
              item.kind === "file" &&
              item.type.startsWith("image/")
            ) {
              const file = item.getAsFile();
              if (!file) continue;

              // 阻止默认粘贴（避免在页面其它位置插入）
              e.preventDefault();
              try {
                const uploadDir = projectId
                  ? `projects/${projectId}/images/`
                  : "uploads/images/";
                const uploadResult = await imageUploadService.uploadImageFile(
                  file,
                  {
                    projectId,
                    dir: uploadDir,
                    fileName: file.name,
                  }
                );

                if (uploadResult.success && uploadResult.asset?.url) {
                  await uploadImageToCanvas?.(
                    {
                      ...uploadResult.asset,
                      src: uploadResult.asset.url,
                    },
                    uploadResult.asset.fileName || file.name
                  );
                  void recordImageHistoryEntry({
                    remoteUrl: uploadResult.asset.url,
                    title: uploadResult.asset.fileName || file.name,
                    fileName: uploadResult.asset.fileName || file.name,
                    nodeId: "canvas",
                    nodeType: "image",
                    projectId,
                    skipInitialStoreUpdate: true,
                  });
                } else {
                  // fallback: blob URL（避免 base64）
                  const blobUrl = URL.createObjectURL(file);
                  await uploadImageToCanvas?.(
                    {
                      id: `local_img_${Date.now()}_${Math.random()
                        .toString(36)
                        .slice(2, 8)}`,
                      url: blobUrl,
                      src: blobUrl,
                      fileName: file.name,
                      pendingUpload: true,
                      localDataUrl: blobUrl,
                    },
                    file.name
                  );
                }
              } catch (err) {
                console.error("粘贴图片处理失败:", err);
              }
              return; // 已处理首个图片项
            }
          }

          // 无图片项时，尝试处理文本中的图片URL
          const text = clipboardData.getData("text/plain")?.trim();
          if (text && seemsImageUrl(text)) {
            e.preventDefault();
            try {
              const payload = await fetchImagePayload(text);
              await uploadImageToCanvas?.(payload, undefined);
            } catch (err) {
              console.error("粘贴URL处理失败:", err);
            }
            return;
          }

          // 兜底：若系统剪贴板没有图片/URL/结构化数据，但内存中存在画布剪贴板数据，则执行画布内粘贴
          const canUseInMemoryCanvasPaste =
            !rawCanvasData &&
            (!text || text === CANVAS_CLIPBOARD_FALLBACK_TEXT) &&
            !!clipboardService.getCanvasData();
          if (canUseInMemoryCanvasPaste) {
            const handled = handleCanvasPasteRef.current();
            if (handled) {
              e.preventDefault();
              return;
            }
          }
        } catch (err) {
          console.error("处理粘贴事件出错:", err);
        }
      })();
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [projectId, uploadImageToCanvas]);

  const fetchSvgText = useCallback(
    async (url: string): Promise<string | null> => {
      const tryFetch = async (init?: RequestInit) => {
        try {
          const res = await fetchWithAuth(url, {
            ...(init || {}),
            auth: 'omit',
            allowRefresh: false,
          });
          if (!res.ok) return null;
          const text = await res.text();
          return looksLikeSvgMarkup(text) ? text : null;
        } catch {
          return null;
        }
      };

      return (
        (await tryFetch({ mode: "cors", credentials: "include" })) ||
        (await tryFetch({ mode: "cors" })) ||
        (await tryFetch())
      );
    },
    []
  );

  const resolveSvgContent = useCallback(
    async (asset: any): Promise<string | null> => {
      const inline =
        typeof asset?.svgContent === "string" ? asset.svgContent.trim() : "";
      if (inline) return inline;

      const id = typeof asset?.id === "string" ? asset.id : "";
      if (id) {
        const stored = usePersonalLibraryStore
          .getState()
          .assets.find((item) => item.type === "svg" && item.id === id) as
          | PersonalSvgAsset
          | undefined;
        const storedSvg =
          typeof stored?.svgContent === "string"
            ? stored.svgContent.trim()
            : "";
        if (storedSvg) return storedSvg;
      }

      const url = typeof asset?.url === "string" ? asset.url.trim() : "";
      if (url) {
        return await fetchSvgText(url);
      }

      return null;
    },
    [fetchSvgText]
  );

  const insertSvgAssetToCanvas = useCallback(
    async (asset: any, position?: { x: number; y: number }) => {
      if (!paper?.project || !paper?.view) return;
      const svgContent = await resolveSvgContent(asset);
      if (!svgContent) {
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message: "SVG 内容为空或无法读取", type: "error" },
          })
        );
        return;
      }

      ensureDrawingLayer();
      try {
        useLayerStore.getState().ensureActiveLayer();
      } catch {}

      const targetPoint = position
        ? new paper.Point(position.x, position.y)
        : paper.view?.center
        ? new paper.Point(paper.view.center.x, paper.view.center.y)
        : new paper.Point(0, 0);

      try {
        const imported = paper.project.importSVG(svgContent, {
          insert: false,
          expandShapes: true,
          applyMatrix: true,
        }) as paper.Item;

        paper.project.activeLayer.addChild(imported);
        imported.position = targetPoint;
        try {
          imported.bringToFront();
        } catch {}

        try {
          const paths = imported.getItems({
            class: paper.Path,
          } as any) as paper.Path[];
          paths.forEach((path) => {
            const strokeWidth = path.strokeWidth ?? 1;
            path.data = {
              ...(path.data || {}),
              originalStrokeWidth: strokeWidth,
            };
          });
        } catch {}

        paper.view.update();
        paperSaveService.triggerAutoSave();
        try {
          historyService.commit("import-svg").catch(() => {});
        } catch {}
      } catch (error) {
        console.warn("导入 SVG 失败:", error);
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message: "SVG 导入失败", type: "error" },
          })
        );
      }
    },
    [ensureDrawingLayer, resolveSvgContent]
  );

  // ========== 拖拽图片到画布 ==========
  useEffect(() => {
    const isEventInsideCanvas = (event: DragEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return false;
      const rect = canvas.getBoundingClientRect();
      const { clientX, clientY } = event;
      return (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      );
    };

    const handleDragOver = (event: DragEvent) => {
      if (!isEventInsideCanvas(event)) return;
      const items = Array.from(event.dataTransfer?.items || []);
      const _hasImageFile = items.some(
        (item) =>
          item.kind === "file" &&
          typeof item.type === "string" &&
          item.type.startsWith("image/")
      );
      const _hasPotentialUrl = items.some((item) => item.kind === "string");
      // 只要落在画布上且存在可处理的条目就阻止默认行为，避免浏览器打开文件
      event.preventDefault();
      try {
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "copy";
        }
      } catch {
        // ignore
      }
    };

    const handleDrop = (event: DragEvent) => {
      void (async () => {
        if (!isEventInsideCanvas(event)) return;
        const canvas = canvasRef.current;
        if (!canvas || !paper?.project) return;
        const dt = event.dataTransfer;
        if (!dt) return;

        const projectPoint = clientToProject(
          canvas,
          event.clientX,
          event.clientY
        );
        const tanvaAssetData = dt.getData("application/x-tanva-asset");
        if (tanvaAssetData) {
          try {
            const parsed = JSON.parse(tanvaAssetData);
            if (parsed?.type === "svg" && parsed?.url) {
              event.preventDefault();
              event.stopPropagation();
              await insertSvgAssetToCanvas(parsed, {
                x: projectPoint.x,
                y: projectPoint.y,
              });
              return;
            }
            // 🔥 修复：处理从资源库拖拽的 2D 图片
            if (parsed?.type === "2d" && parsed?.url) {
              event.preventDefault();
              event.stopPropagation();
              logger.upload("🖼️ 从资源库拖拽 2D 图片:", parsed);
              await uploadImageToCanvas?.(
                parsed.url,
                parsed.fileName || parsed.name,
                undefined,
                { x: projectPoint.x, y: projectPoint.y },
                "manual"
              );
              return;
            }
          } catch (error) {
            console.warn("解析拖拽资源数据失败:", error);
          }
        }
        const imageFiles = Array.from(dt.files || []).filter(
          (file) => file.type && file.type.startsWith("image/")
        );

        if (imageFiles.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          const file = imageFiles[0];
          try {
            const uploadDir = projectId
              ? `projects/${projectId}/images/`
              : "uploads/images/";

            // 1) 先用 blob: 立即上画布，同时生成并关联 key（避免等上传完才显示）
            const blobUrl = URL.createObjectURL(file);
            const imageId = `local_img_${Date.now()}_${Math.random()
              .toString(36)
              .slice(2, 8)}`;
            const { key } = generateOssKey({
              projectId,
              dir: uploadDir,
              fileName: file.name,
              contentType: file.type,
            });
            const localAsset = {
              id: imageId,
              url: key,
              key,
              src: key,
              fileName: file.name,
              contentType: file.type,
              pendingUpload: true,
              localDataUrl: blobUrl,
            };

            await uploadImageToCanvas?.(
              localAsset as any,
              file.name,
              undefined,
              { x: projectPoint.x, y: projectPoint.y },
              "manual"
            );

            // 2) 后台上传：成功后回写并清理本地临时 blob
            void imageUploadService
              .uploadImageFile(file, {
                projectId,
                dir: uploadDir,
                fileName: file.name,
                key,
              })
              .then((uploadResult) => {
                if (!uploadResult.success || !uploadResult.asset?.url) {
                  logger.upload?.("⚠️ [CanvasDrop] 图片上传失败，已保留本地副本", {
                    error: uploadResult.error,
                  });
                  return;
                }
                try {
                  window.dispatchEvent(
                    new CustomEvent("tanva:upgradeImageSource", {
                      detail: {
                        placeholderId: imageId,
                        key: uploadResult.asset.key || key,
                        remoteUrl: uploadResult.asset.url,
                      },
                    })
                  );
                } catch {}
                void recordImageHistoryEntry({
                  remoteUrl: uploadResult.asset.url,
                  title: file.name,
                  fileName: file.name,
                  nodeId: "canvas",
                  nodeType: "image",
                  projectId,
                  skipInitialStoreUpdate: true,
                });
              })
              .catch((err) => {
                logger.upload?.("⚠️ [CanvasDrop] 图片上传异常，已保留本地副本", { err });
              });
          } catch (err) {
            console.error("处理拖拽图片失败:", err);
          }
          return;
        }

        const uriList = dt.getData("text/uri-list");
        const plainText = dt.getData("text/plain");
        const text = (uriList || plainText || "").trim();
        if (!text || !seemsImageUrl(text)) return;

        event.preventDefault();
        event.stopPropagation();
        try {
          const payload = await fetchImagePayload(text);
          await uploadImageToCanvas?.(
            payload,
            undefined,
            undefined,
            { x: projectPoint.x, y: projectPoint.y },
            "manual"
          );
        } catch (err) {
          console.error("拖拽图片链接处理失败:", err);
        }
      })();
    };

    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("drop", handleDrop);
    return () => {
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("drop", handleDrop);
    };
  }, [canvasRef, insertSvgAssetToCanvas, projectId, uploadImageToCanvas]);

  useEffect(() => {
    const handleInsertSvg = (event: CustomEvent) => {
      const detail = event.detail as any;
      const asset = detail?.asset;
      if (!asset) return;
      void insertSvgAssetToCanvas(asset, detail?.position);
    };

    window.addEventListener(
      "canvas:insert-svg",
      handleInsertSvg as EventListener
    );
    return () =>
      window.removeEventListener(
        "canvas:insert-svg",
        handleInsertSvg as EventListener
      );
  }, [insertSvgAssetToCanvas]);

	  // ========== 监听AI生成图片的快速上传触发事件 ==========
	  useEffect(() => {
	    const handleTriggerQuickUpload = (event: CustomEvent) => {
	      const {
	        imageData,
        fileName,
        selectedImageBounds,
        smartPosition,
        operationType,
        sourceImageId,
        sourceImages,
        videoInfo,
        placeholderId,
        preferHorizontal, // 🔥 新增：是否优先横向排列
        // 🔥 并行生成分组信息，用于 X4/X8 自动打组
        parallelGroupId,
        parallelGroupIndex,
        parallelGroupTotal,
      } = event.detail;

      logger.debug("🎨 [DEBUG] 收到AI图片快速上传触发事件:", {
        fileName,
        hasSelectedBounds: !!selectedImageBounds,
        hasSmartPosition: !!smartPosition,
        operationType,
        sourceImageId,
        sourceImages: sourceImages?.length,
        preferHorizontal,
        parallelGroupId,
        parallelGroupIndex,
        parallelGroupTotal,
	      });

	      if (imageData && quickImageUpload.handleQuickImageUploaded) {
	        const handle = () => {
	          // 直接调用快速上传的处理函数，传递智能排版相关参数
	          quickImageUpload.handleQuickImageUploaded(
	            imageData,
	            fileName,
	            selectedImageBounds,
	            smartPosition,
	            operationType,
	            sourceImageId,
	            sourceImages,
	            {
	              videoInfo,
	              placeholderId,
	              preferHorizontal,
	              parallelGroupId,
	              parallelGroupIndex,
	              parallelGroupTotal,
	            } // 🔥 传递并行分组信息
	          );
	          logger.debug("✅ [DEBUG] 已调用智能排版快速上传处理函数");
	        };

	        try {
	          handle();
	        } catch (error) {
	          logger.error("❌ [DEBUG] 智能排版快速上传处理失败:", error);

	          // Paper.js 初始化期间可能会抛错：等待 paper-ready 后重试一次（不阻塞事件派发）
	          let retried = false;
	          const retryOnce = () => {
	            if (retried) return;
	            retried = true;
	            try {
	              handle();
	            } catch (retryError) {
	              logger.error("❌ [DEBUG] 重试快速上传仍失败:", retryError);
	              if (placeholderId) {
	                try {
	                  quickImageUpload.removePredictedPlaceholder(placeholderId);
	                } catch {}
	              }
	            }
	          };

	          try {
	            window.addEventListener("paper-ready", retryOnce as EventListener, {
	              once: true,
	            });
	          } catch {}
	          setTimeout(retryOnce, 300);
	        }
	      }
	    };

    window.addEventListener(
      "triggerQuickImageUpload",
      handleTriggerQuickUpload as EventListener
    );

    return () => {
      window.removeEventListener(
        "triggerQuickImageUpload",
        handleTriggerQuickUpload as EventListener
      );
    };
  }, [quickImageUpload]);

  // 使用 ref 存储 quickImageUpload 的最新引用，避免 useEffect 重复执行
  const quickImageUploadRef = useRef(quickImageUpload);
  useEffect(() => {
    quickImageUploadRef.current = quickImageUpload;
  }, [quickImageUpload]);

  // 使用 ref 存储 imageTool.setImageInstances 的最新引用，避免事件监听闭包过期
  const imageToolSetInstancesRef = useRef(imageTool.setImageInstances);
  useEffect(() => {
    imageToolSetInstancesRef.current = imageTool.setImageInstances;
  }, [imageTool.setImageInstances]);

  // 🔥 AI 生成图片：上传到 OSS 后，仅回写远程元数据（画布渲染不强制切换）
  useEffect(() => {
    const getRasterSourceString = (raster: any): string => {
        try {
          const tracked = (raster as any)?.__tanvaSourceRef;
          if (typeof tracked === "string" && tracked.trim()) return tracked;
        } catch {}
        try {
          const source = raster?.source;
          if (typeof source === "string") return source;
          const src = (source as any)?.src;
          if (typeof src === "string") return src;
        } catch {}
        try {
          const image = (raster as any)?.image || (raster as any)?._image;
          const src = image?.src;
          if (typeof src === "string") return src;
        } catch {}
        return "";
      };

    // 上传完成后的“软切换”：
    // 1) 先回写远程元数据（url/key/remoteUrl/pendingUpload=false）
    // 2) 预加载远程图片，等加载完成后再覆盖渲染源（避免裂图/闪白）
    // 3) 覆盖成功后再回收旧 blob: ObjectURL（避免对话参考图/画布同时引用时被提前 revoke）
    const swapTasks = new Map<string, { token: number; targetSrc: string }>();

    const loadImageOnce = (
      src: string,
      timeoutMs: number
    ): Promise<HTMLImageElement | null> => {
      return new Promise((resolve) => {
        if (typeof Image === "undefined") return resolve(null);
        if (!src) return resolve(null);

        const img = new Image();
        img.decoding = "async";
        let done = false;

        const finish = (ok: boolean) => {
          if (done) return;
          done = true;
          try {
            img.onload = null;
            img.onerror = null;
          } catch {}
          resolve(ok ? img : null);
        };

        const timer = window.setTimeout(() => finish(false), timeoutMs);

        img.onload = () => {
          window.clearTimeout(timer);
          // decode() 能确保图片已进入可渲染状态（支持的浏览器上更稳定）
          const decoder = (img as any).decode;
          if (typeof decoder === "function") {
            (decoder.call(img) as Promise<void>)
              .then(() => finish(true))
              .catch(() => finish(true));
          } else {
            finish(true);
          }
        };
        img.onerror = () => {
          window.clearTimeout(timer);
          finish(false);
        };

        try {
          img.src = src;
        } catch {
          window.clearTimeout(timer);
          finish(false);
        }
      });
    };

    const preloadRemoteImage = async (src: string): Promise<HTMLImageElement | null> => {
      const trimmed = typeof src === "string" ? src.trim() : "";
      if (!trimmed) return null;
      const maxAttempts = 6;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const loaded = await loadImageOnce(trimmed, 20000);
        if (loaded) return loaded;
        // 指数退避，给 OSS/CDN/代理一点时间
        await new Promise((r) => setTimeout(r, 250 * attempt));
      }
      return null;
    };

    const collectBlobCandidatesFromImageData = (imageData: any): string[] => {
      if (!imageData || typeof imageData !== "object") return [];
      const candidates = [imageData.localDataUrl, imageData.src, imageData.url];
      return candidates.filter(
        (v: any) => typeof v === "string" && v.trim().startsWith("blob:")
      );
    };

    const isObjectUrlStillUsed = (url: string): boolean => {
        if (!url || typeof url !== "string" || !url.startsWith("blob:"))
          return false;

        try {
          const instances = (window as any).tanvaImageInstances as
            | any[]
            | undefined;
          if (Array.isArray(instances)) {
            const usedByInstances = instances.some((inst) => {
              const d = inst?.imageData;
              return d?.localDataUrl === url || d?.url === url || d?.src === url;
            });
            if (usedByInstances) return true;
          }
        } catch {}

        try {
          const project = paper?.project as any;
          const rasterClass = (paper as any).Raster;
          if (project?.getItems && rasterClass) {
            const rasters = project.getItems({ class: rasterClass }) as any[];
            const usedByRasters = rasters.some(
              (raster) => getRasterSourceString(raster) === url
            );
            if (usedByRasters) return true;
          }
        } catch {}

        // AI 对话框可能会临时引用画布的 blob:（作为参考图预览），不能提前 revoke
        try {
          const chat = useAIChatStore.getState();
          if (chat.sourceImageForEditing === url) return true;
          if (chat.sourceImageForAnalysis === url) return true;
          if (
            Array.isArray(chat.sourceImagesForBlending) &&
            chat.sourceImagesForBlending.some((v) => v === url)
          ) {
            return true;
          }
        } catch {}

        // DOM 中仍在展示该 blob:（例如参考图平滑切换的双缓冲），不能提前 revoke
        try {
          const images = Array.from(document.images || []);
          const usedByDom = images.some((img) => {
            try {
              return (
                (img as any)?.currentSrc === url ||
                (typeof (img as any)?.src === "string" && (img as any).src === url)
              );
            } catch {
              return false;
            }
          });
          if (usedByDom) return true;
        } catch {}

        return false;
      };

      const revokeObjectUrlsIfUnused = (urls: Set<string>, attempt: number = 0) => {
        if (!urls || urls.size === 0) return;
        const stillUsed = new Set<string>();
        urls.forEach((url) => {
          if (!url || typeof url !== "string" || !url.startsWith("blob:")) return;
          if (isObjectUrlStillUsed(url)) {
            stillUsed.add(url);
            return;
          }
          try {
            URL.revokeObjectURL(url);
          } catch {}
        });

        if (stillUsed.size > 0 && attempt < 30) {
          try {
            window.setTimeout(() => {
              revokeObjectUrlsIfUnused(stillUsed, attempt + 1);
            }, 500);
          } catch {}
        }
      };

      const swapChatSelectionIfMatches = (params: {
        matchUrls: Set<string>;
        nextSrc: string;
      }) => {
        const { matchUrls, nextSrc } = params;
        if (!matchUrls || matchUrls.size === 0) return;
        if (!nextSrc) return;

        try {
          const chat = useAIChatStore.getState();
          const selected =
            Array.isArray(chat.sourceImagesForBlending) &&
            chat.sourceImagesForBlending.length > 0
              ? chat.sourceImagesForBlending
              : chat.sourceImageForEditing
              ? [chat.sourceImageForEditing]
              : [];

          if (!selected.length) return;

          let changed = false;
          const next = selected.map((src) => {
            if (matchUrls.has(src)) {
              changed = true;
              return nextSrc;
            }
            return src;
          });

          if (!changed) return;
          useAIChatStore.getState().setSourceImagesFromCanvas(next);
        } catch {}
      };

      const finalizeSwapAfterLoaded = (params: {
        placeholderId: string;
        persistedUrl: string;
        incomingKey?: string;
        incomingSrc?: string;
        nextRenderableSrc: string;
        loadedImage: HTMLImageElement;
      }): boolean => {
        const {
          placeholderId,
          persistedUrl,
          incomingKey,
          incomingSrc,
          nextRenderableSrc,
          loadedImage,
        } = params;
        if (!placeholderId || !nextRenderableSrc) return false;

        const objectUrlsToMaybeRevoke = new Set<string>();
        const matchUrls = new Set<string>();

        // 先从运行时实例收集“旧 blob”，用于替换 Chat 参考图
        try {
          const instances = (window as any).tanvaImageInstances as any[] | undefined;
          if (Array.isArray(instances) && instances.length > 0) {
            const inst = instances.find((it) => it?.id === placeholderId);
            const imageData = inst?.imageData || null;
            const blobs = collectBlobCandidatesFromImageData(imageData);
            blobs.forEach((u) => {
              objectUrlsToMaybeRevoke.add(u);
              matchUrls.add(u);
              const flowRef = canvasBlobToFlowAssetRefCacheRef.current.get(u);
              if (flowRef) matchUrls.add(flowRef);
            });
          }
        } catch {}

        // 若 Raster 仍使用 blob:/data:，也纳入替换与回收集合
        try {
          const project = paper?.project as any;
          if (project?.getItems) {
            const rasterClass = (paper as any).Raster;
            const rasters = project.getItems({ class: rasterClass }) as any[];
            rasters.forEach((raster) => {
              if (!raster) return;
              const imageId = raster.data?.imageId;
              if (imageId !== placeholderId) return;
              const currentSource = getRasterSourceString(raster);
              if (currentSource.startsWith("blob:")) {
                objectUrlsToMaybeRevoke.add(currentSource);
                matchUrls.add(currentSource);
                const flowRef = canvasBlobToFlowAssetRefCacheRef.current.get(
                  currentSource
                );
                if (flowRef) matchUrls.add(flowRef);
              }
            });
          }
        } catch {}

        // 先切换 Chat 参考图（避免画布/保存逻辑提前 revoke 导致裂图）
        swapChatSelectionIfMatches({ matchUrls, nextSrc: nextRenderableSrc });

        let updated = false;

        // 1) 更新运行时图片实例（window.tanvaImageInstances）
        try {
          const instances = (window as any).tanvaImageInstances as any[] | undefined;
          if (Array.isArray(instances) && instances.length > 0) {
            let changed = false;
            const next = instances.map((inst) => {
              if (!inst || inst.id !== placeholderId) return inst;
              const imageData = inst.imageData || {};

              const nextImageData: any = {
                ...imageData,
                url: persistedUrl,
                key: incomingKey || imageData.key,
                pendingUpload: false,
                localDataUrl: undefined,
                src: nextRenderableSrc,
              };
              if (incomingSrc) {
                nextImageData.remoteUrl = incomingSrc;
              } else if (typeof imageData.remoteUrl === "string" && imageData.remoteUrl) {
                nextImageData.remoteUrl = imageData.remoteUrl;
              }

              changed = true;
              updated = true;
              return { ...inst, imageData: nextImageData };
            });

            if (changed) {
              (window as any).tanvaImageInstances = next;
            }
          }
        } catch {}

        // 1.5) 更新 React 状态（imageTool.imageInstances）
        try {
          imageToolSetInstancesRef.current((prev: any[]) => {
            if (!Array.isArray(prev) || prev.length === 0) return prev;
            const idx = prev.findIndex((inst) => inst?.id === placeholderId);
            if (idx < 0) return prev;
            const inst = prev[idx];
            const imageData = inst?.imageData || {};

            const nextImageData: any = {
              ...imageData,
              url: persistedUrl,
              key: incomingKey || imageData.key,
              pendingUpload: false,
              localDataUrl: undefined,
              src: nextRenderableSrc,
            };
            if (incomingSrc) {
              nextImageData.remoteUrl = incomingSrc;
            } else if (typeof imageData.remoteUrl === "string" && imageData.remoteUrl) {
              nextImageData.remoteUrl = imageData.remoteUrl;
            }

            const next = prev.slice();
            next[idx] = { ...inst, imageData: nextImageData };
            updated = true;
            return next;
          });
        } catch {}

        // 2) 更新 Paper.js Raster（用 data.imageId 关联）
        try {
          const project = paper?.project as any;
          if (project?.getItems) {
            const rasterClass = (paper as any).Raster;
            const rasters = project.getItems({ class: rasterClass }) as any[];
            rasters.forEach((raster) => {
              if (!raster) return;
              const imageId = raster.data?.imageId;
              if (imageId !== placeholderId) return;

              const currentSource = getRasterSourceString(raster);
              const restoreBounds = (() => {
                try {
                  const stored = (raster as any)?.data?.__tanvaBounds as
                    | { x: number; y: number; width: number; height: number }
                    | undefined;
                  if (
                    stored &&
                    Number.isFinite(stored.x) &&
                    Number.isFinite(stored.y) &&
                    Number.isFinite(stored.width) &&
                    Number.isFinite(stored.height) &&
                    stored.width > 0 &&
                    stored.height > 0
                  ) {
                    return new paper.Rectangle(
                      stored.x,
                      stored.y,
                      stored.width,
                      stored.height
                    );
                  }
                } catch {}
                try {
                  const b = raster.bounds as paper.Rectangle | undefined;
                  if (b && b.width > 0 && b.height > 0) return b.clone();
                } catch {}
                return null;
              })();
              const applyBoundsToGroup = (rect: paper.Rectangle) => {
                if (!rect) return;
                try {
                  raster.bounds = rect.clone();
                } catch {}
                try {
                  const parent: any = raster.parent;
                  if (
                    parent &&
                    parent.className === "Group" &&
                    Array.isArray(parent.children)
                  ) {
                    parent.children.forEach((child: any) => {
                      if (!child || child === raster) return;
                      const data = child.data || {};
                      if (
                        data.type === "image-selection-area" ||
                        data.isSelectionBorder ||
                        data.isImageHitRect
                      ) {
                        try {
                          child.bounds = rect.clone();
                        } catch {}
                        return;
                      }
                      if (data.isResizeHandle) {
                        const direction = data.direction;
                        let x = rect.x;
                        let y = rect.y;
                        if (direction === "ne" || direction === "se") {
                          x = rect.x + rect.width;
                        }
                        if (direction === "sw" || direction === "se") {
                          y = rect.y + rect.height;
                        }
                        try {
                          child.position = new paper.Point(x, y);
                        } catch {}
                      }
                    });
                  }
                } catch {}
              };

              raster.data = {
                ...(raster.data || {}),
                ...(incomingSrc ? { remoteUrl: incomingSrc } : null),
                ...(incomingKey ? { key: incomingKey } : null),
                pendingUpload: false,
              };

              // 远程已加载：用已 decode 的 Image 覆盖，避免“切到远程瞬间空白”
              if (
                nextRenderableSrc &&
                (currentSource.startsWith("blob:") || currentSource.startsWith("data:")) &&
                currentSource !== nextRenderableSrc
              ) {
                const rectBeforeSwap = restoreBounds;
                try {
                  (raster as any).setImage(loadedImage);
                  try { (raster as any).__tanvaSourceRef = nextRenderableSrc; } catch {}
                } catch {
                  try {
                    raster.source = nextRenderableSrc;
                    try { (raster as any).__tanvaSourceRef = nextRenderableSrc; } catch {}
                  } catch {}
                }
                // 🔧 Paper.js 在切换 source 时可能会短暂重置 bounds（甚至变成 0），导致“闪一下再恢复”；
                // 这里立即恢复 bounds/选择元素，避免等待 onLoad 回调才补齐造成可见闪烁。
                if (rectBeforeSwap) {
                  applyBoundsToGroup(rectBeforeSwap);
                }
                updated = true;
              }
            });
          }
        } catch {}

        // 3) 覆盖完成后再尝试回收 blob: ObjectURL
        revokeObjectUrlsIfUnused(objectUrlsToMaybeRevoke);

        if (updated) {
          try {
            paper.view?.update();
          } catch {}
        }

        return updated;
      };

	    const tryUpgrade = (params: {
	      placeholderId: string;
	      remoteUrl?: string;
	      key?: string;
	    }): boolean => {
	      const { placeholderId, remoteUrl, key } = params;
	      const rawRemoteUrl = typeof remoteUrl === "string" ? remoteUrl : "";
	      const rawKey = typeof key === "string" ? key : "";
	      if (!placeholderId || (!rawRemoteUrl && !rawKey)) return false;

	      const normalizedIncoming = rawRemoteUrl
	        ? normalizePersistableImageRef(rawRemoteUrl) || rawRemoteUrl
	        : "";
	      const normalizedKey = rawKey ? normalizePersistableImageRef(rawKey) || rawKey : "";

	      const incomingKey =
	        (normalizedKey && isAssetKeyRef(normalizedKey) ? normalizedKey : undefined) ||
	        (normalizedIncoming && isAssetKeyRef(normalizedIncoming)
	          ? normalizedIncoming
	          : undefined);
	      const incomingSrc =
	        normalizedIncoming && isRemoteUrl(normalizedIncoming)
	          ? normalizedIncoming
	          : undefined;
	      const resolvedRemoteUrl = incomingSrc || undefined;
	      const persistedUrl = (incomingKey || normalizedIncoming).trim();
	      if (!persistedUrl) return false;
        const nextRenderableSrc =
          toRenderableImageSrc(resolvedRemoteUrl || incomingSrc || persistedUrl) ||
          resolvedRemoteUrl ||
          incomingSrc ||
          persistedUrl;
	      const nextStoredUrl = (resolvedRemoteUrl || incomingSrc || persistedUrl).trim();

		      let updated = false;

	      // 1) 更新运行时图片实例（window.tanvaImageInstances）
      try {
        const instances = (window as any).tanvaImageInstances as any[] | undefined;
        if (Array.isArray(instances) && instances.length > 0) {
          let changed = false;
          const next = instances.map((inst) => {
            if (!inst || inst.id !== placeholderId) return inst;
            const imageData = inst.imageData || {};

	            const normalizedPrevUrl =
	              typeof imageData.url === "string"
	                ? normalizePersistableImageRef(imageData.url)
	                : "";
	            const normalizedPrevKey =
	              typeof imageData.key === "string"
	                ? normalizePersistableImageRef(imageData.key)
	                : "";
	            const normalizedPrevRemoteUrl =
	              typeof imageData.remoteUrl === "string"
	                ? normalizePersistableImageRef(imageData.remoteUrl)
	                : "";
	            const normalizedPrevSrc =
	              typeof imageData.src === "string"
	                ? normalizePersistableImageRef(imageData.src)
	                : "";

	            const nextRemoteUrl =
	              resolvedRemoteUrl ||
	              incomingSrc ||
	              (normalizedPrevRemoteUrl && isRemoteUrl(normalizedPrevRemoteUrl)
	                ? normalizedPrevRemoteUrl
	                : normalizedPrevSrc && isRemoteUrl(normalizedPrevSrc)
	                ? normalizedPrevSrc
	                : undefined);

	            const shouldUpdate =
	              normalizedPrevUrl !== persistedUrl ||
	              (incomingKey ? normalizedPrevKey !== incomingKey : false) ||
	              (nextRemoteUrl ? normalizedPrevRemoteUrl !== nextRemoteUrl : false) ||
	              Boolean(imageData.pendingUpload) ||
	              Boolean(imageData.localDataUrl);

	            const currentSrc =
	              typeof imageData.src === "string" ? imageData.src.trim() : "";
	            if (!shouldUpdate && currentSrc) {
	              return inst;
	            }

	            changed = true;
	            updated = true;
	            const nextImageData: any = {
	              ...imageData,
	              url: nextStoredUrl,
	              key: incomingKey || imageData.key,
	              pendingUpload: false,
	            };
	            if (nextRemoteUrl) {
	              nextImageData.remoteUrl = nextRemoteUrl;
	            }
	            // 仅回写元数据，不立即切换渲染源；等远程资源加载完成后再覆盖，避免闪白/裂图
	            if (!currentSrc) {
	              // 缺失时补齐一个可渲染引用
	              const candidate = nextRemoteUrl || incomingSrc || persistedUrl;
	              nextImageData.src = toRenderableImageSrc(candidate) || candidate;
	            }

	            return {
	              ...inst,
	              imageData: nextImageData,
	            };
	          });

          if (changed) {
            (window as any).tanvaImageInstances = next;
          }
        }
	      } catch {}

	        // 1.5) 更新 React 状态（imageTool.imageInstances），避免后续 effect 回写覆盖 window 更新
	        try {
	          imageToolSetInstancesRef.current((prev: any[]) => {
            if (!Array.isArray(prev) || prev.length === 0) return prev;
            const idx = prev.findIndex((inst) => inst?.id === placeholderId);
            if (idx < 0) return prev;
            const inst = prev[idx];
            const imageData = inst?.imageData || {};

            const currentSrc =
              typeof imageData.src === "string" ? imageData.src.trim() : "";
            const normalizedPrevRemoteUrl =
              typeof imageData.remoteUrl === "string"
                ? normalizePersistableImageRef(imageData.remoteUrl)
                : "";
            const normalizedPrevSrc =
              typeof imageData.src === "string"
                ? normalizePersistableImageRef(imageData.src)
                : "";

            const nextRemoteUrl =
              resolvedRemoteUrl ||
              incomingSrc ||
              (normalizedPrevRemoteUrl && isRemoteUrl(normalizedPrevRemoteUrl)
                ? normalizedPrevRemoteUrl
                : normalizedPrevSrc && isRemoteUrl(normalizedPrevSrc)
                ? normalizedPrevSrc
                : undefined);

            const nextImageData: any = {
              ...imageData,
              url: nextStoredUrl,
              key: incomingKey || imageData.key,
              pendingUpload: false,
            };
	            if (nextRemoteUrl) {
	              nextImageData.remoteUrl = nextRemoteUrl;
	            }

	            // 仅回写元数据，不立即切换渲染源；等远程资源加载完成后再覆盖，避免闪白/裂图
	            if (!currentSrc) {
	              const candidate = nextRemoteUrl || incomingSrc || persistedUrl;
	              nextImageData.src = toRenderableImageSrc(candidate) || candidate;
	            }

            const next = prev.slice();
            next[idx] = { ...inst, imageData: nextImageData };
            return next;
          });
        } catch {}

	      // 2) 更新 Paper.js Raster（用 data.imageId 关联）
	      try {
	        const project = paper?.project as any;
	        if (project?.getItems) {
	          const rasterClass = (paper as any).Raster;
	          const rasters = project.getItems({ class: rasterClass }) as any[];
	          rasters.forEach((raster) => {
	            if (!raster) return;
	            const imageId = raster.data?.imageId;
	            if (imageId !== placeholderId) return;

            const currentSource = getRasterSourceString(raster);
	            raster.data = {
	              ...(raster.data || {}),
	              ...(resolvedRemoteUrl ? { remoteUrl: resolvedRemoteUrl } : null),
	              ...(incomingKey ? { key: incomingKey } : null),
	              pendingUpload: false,
	            };
	            updated = true;
	          });
	        }
	      } catch {}

      // 3) 若当前仍在用 blob/data 渲染，则预加载远程资源，加载完成后再覆盖并回收 blob
      const shouldSwap = (() => {
        try {
          const instances = (window as any).tanvaImageInstances as any[] | undefined;
          if (Array.isArray(instances) && instances.length > 0) {
            const inst = instances.find((it) => it?.id === placeholderId);
            const blobs = collectBlobCandidatesFromImageData(inst?.imageData);
            if (blobs.length > 0) return true;
          }
        } catch {}

        try {
          const project = paper?.project as any;
          const rasterClass = (paper as any).Raster;
          if (project?.getItems && rasterClass) {
            const rasters = project.getItems({ class: rasterClass }) as any[];
            return rasters.some((raster) => {
              if (!raster) return false;
              const imageId = raster.data?.imageId;
              if (imageId !== placeholderId) return false;
              const src = getRasterSourceString(raster);
              return src.startsWith("blob:") || src.startsWith("data:");
            });
          }
        } catch {}

        return false;
      })();

      if (shouldSwap && nextRenderableSrc) {
        const existing = swapTasks.get(placeholderId);
        if (!existing || existing.targetSrc !== nextRenderableSrc) {
          const token = (existing?.token ?? 0) + 1;
          swapTasks.set(placeholderId, { token, targetSrc: nextRenderableSrc });
          void (async () => {
            const loaded = await preloadRemoteImage(nextRenderableSrc);
            if (!loaded) return;
            const current = swapTasks.get(placeholderId);
            if (!current || current.token !== token) return;
            const swapped = finalizeSwapAfterLoaded({
              placeholderId,
              persistedUrl,
              incomingKey,
              incomingSrc,
              nextRenderableSrc,
              loadedImage: loaded,
            });
            if (swapped) {
              swapTasks.delete(placeholderId);
            }
          })();
        }
      }

      return updated;
    };

	    const handler = (event: Event) => {
	      const detail = (event as CustomEvent<any>).detail || {};
	      const placeholderId = String(detail.placeholderId || "");
	      const remoteUrl = typeof detail.remoteUrl === "string" ? detail.remoteUrl : "";
	      const key = typeof detail.key === "string" ? detail.key : "";
	      const ref = remoteUrl || key;
	      if (!placeholderId || !ref) return;

	      let attempts = 0;
	      const maxAttempts = 10;
        const attempt = () => {
          const ok = tryUpgrade({ placeholderId, remoteUrl, key });
          if (ok) {
            logger.upload?.("🔄 [Canvas] 已回写图片远程元数据", {
              placeholderId,
              ref: String(ref).substring(0, 80),
            });
            try { paperSaveService.triggerAutoSave('image-uploaded'); } catch {}
            return;
          }
        if (attempts >= maxAttempts) return;
        attempts += 1;
        setTimeout(attempt, 250 * attempts);
      };

      attempt();
    };

    window.addEventListener("tanva:upgradeImageSource", handler as EventListener);
    return () => {
      window.removeEventListener(
        "tanva:upgradeImageSource",
        handler as EventListener
      );
    };
  }, []);

  // 监听预测占位符事件，提前在画布上标记预计位置与尺寸
  useEffect(() => {
    const handlePredictPlaceholder = (event: CustomEvent) => {
      logger.tool("🎯 [DrawingController] 收到占位符事件:", event.detail);
      const detail = event.detail || {};
      const action = detail.action || "add";
      const placeholderId = detail.placeholderId as string | undefined;
      const preferSmartLayout = Boolean(detail.preferSmartLayout);
      const smartPosition = detail.smartPosition as
        | { x: number; y: number }
        | undefined;
      const sourceImageId = detail.sourceImageId as string | undefined;
      const sourceImages = detail.sourceImages as string[] | undefined;

      if (!placeholderId) {
        logger.warn("🎯 [DrawingController] 缺少 placeholderId");
        return;
      }

      if (action === "remove") {
        logger.tool("🎯 [DrawingController] 移除占位符:", placeholderId);
        quickImageUploadRef.current.removePredictedPlaceholder(placeholderId);
        return;
      }

      const groupId = detail.groupId as string | undefined;
      const groupIndex =
        typeof detail.groupIndex === "number" ? detail.groupIndex : undefined;
      const groupTotal =
        typeof detail.groupTotal === "number" ? detail.groupTotal : undefined;
      const preferHorizontal = Boolean(detail.preferHorizontal);
      const groupAnchor = detail.groupAnchor as
        | { x: number; y: number }
        | undefined;
      const center = detail.center as { x: number; y: number } | undefined;
      const width = detail.width as number | undefined;
      const height = detail.height as number | undefined;
      const operationType = detail.operationType as string | undefined;
      const layoutAnchor = groupAnchor || center || smartPosition || null;

      logger.tool("🎯 [DrawingController] 占位符参数:", {
        center,
        width,
        height,
        operationType,
        groupId,
        groupIndex,
        groupTotal,
      });

      let resolvedCenter = center;
      if (
        (preferSmartLayout || !resolvedCenter) &&
        typeof quickImageUploadRef.current.calculateSmartPosition === "function"
      ) {
        const smart =
          smartPosition ??
          quickImageUploadRef.current.calculateSmartPosition(
            operationType || "generate",
            sourceImageId,
            sourceImages,
            placeholderId,
            {
              groupId,
              groupIndex,
              groupTotal,
              anchorCenter: layoutAnchor,
              preferHorizontal,
            }
          );
        if (smart && Number.isFinite(smart.x) && Number.isFinite(smart.y)) {
          resolvedCenter = { x: smart.x, y: smart.y };
          logger.tool(
            "🎯 [DrawingController] 使用智能排版位置:",
            resolvedCenter
          );
        }
      }

      if (!resolvedCenter && paper?.view?.center) {
        resolvedCenter = { x: paper.view.center.x, y: paper.view.center.y };
      }

      if (
        !resolvedCenter ||
        typeof width !== "number" ||
        typeof height !== "number"
      ) {
        console.warn("🎯 [DrawingController] 参数不完整，跳过显示");
        return;
      }

      logger.tool("🎯 [DrawingController] 调用 showPredictedPlaceholder");
      quickImageUploadRef.current.showPredictedPlaceholder({
        placeholderId,
        center: resolvedCenter,
        width,
        height,
        operationType,
        preferSmartLayout,
        smartPosition,
        sourceImageId,
        sourceImages,
        groupId,
        groupIndex,
        groupTotal,
        preferHorizontal,
        groupAnchor: layoutAnchor || undefined,
      });
    };

    window.addEventListener(
      "predictImagePlaceholder",
      handlePredictPlaceholder as EventListener
    );
    logger.tool("🎯 [DrawingController] 已注册占位符事件监听器");
    return () => {
      window.removeEventListener(
        "predictImagePlaceholder",
        handlePredictPlaceholder as EventListener
      );
    };
  }, []); // 空依赖数组，只注册一次

  // 监听占位符进度更新事件
  useEffect(() => {
    const handleUpdateProgress = (event: CustomEvent) => {
      const detail = event.detail || {};
      const placeholderId = detail.placeholderId as string | undefined;
      const progress = detail.progress as number | undefined;

      if (!placeholderId || typeof progress !== "number") return;

      quickImageUploadRef.current.updatePlaceholderProgress(
        placeholderId,
        progress
      );
    };

    window.addEventListener(
      "updatePlaceholderProgress",
      handleUpdateProgress as EventListener
    );
    return () => {
      window.removeEventListener(
        "updatePlaceholderProgress",
        handleUpdateProgress as EventListener
      );
    };
  }, []); // 空依赖数组，只注册一次

  // ========== 初始化3D模型工具Hook ==========
  const model3DTool = useModel3DTool({
    context: drawingContext,
    canvasRef,
    eventHandlers: {
      onModel3DSelect: (modelId) => logger.debug("3D模型选中:", modelId),
      onModel3DDeselect: () => logger.debug("取消3D模型选择"),
    },
    setDrawMode,
  });

  // 内存优化：3D模型实例也使用 ref
  const model3DInstancesRef = useRef(model3DTool.model3DInstances);
  useEffect(() => {
    model3DInstancesRef.current = model3DTool.model3DInstances;
  }, [model3DTool.model3DInstances]);

  // ========== 初始化自动对齐Hook ==========
  const snapAlignment = useSnapAlignment({
    imageInstances: imageTool.imageInstances,
    model3DInstances: model3DTool.model3DInstances,
    zoom,
  });

  const create3DModelPlaceholder = model3DTool.create3DModelPlaceholder;
  const handleModel3DUploaded = model3DTool.handleModel3DUploaded;
  const currentModel3DPlaceholderRef = model3DTool.currentModel3DPlaceholderRef;

  useEffect(() => {
    const handleInsertModelFromLibrary = (event: CustomEvent) => {
      const detail = event.detail as
        | {
            modelData?: Partial<Model3DData>;
            size?: { width: number; height: number };
            position?: {
              start: { x: number; y: number };
              end: { x: number; y: number };
            };
          }
        | undefined;
      if (!detail?.modelData) return;

      // 如果提供了位置信息，使用提供的位置；否则使用画布中心
      let start: paper.Point;
      let end: paper.Point;

      if (detail.position) {
        // 使用提供的位置（例如从图片旁边）
        start = new paper.Point(
          detail.position.start.x,
          detail.position.start.y
        );
        end = new paper.Point(detail.position.end.x, detail.position.end.y);
      } else {
        // 默认使用画布中心
        const center = paper?.view?.center ?? new paper.Point(0, 0);
        const width = detail.size?.width ?? 320;
        const height = detail.size?.height ?? 240;
        start = new paper.Point(center.x - width / 2, center.y - height / 2);
        end = new paper.Point(center.x + width / 2, center.y + height / 2);
      }

      const placeholder = create3DModelPlaceholder(start, end);
      if (!placeholder) return;
      currentModel3DPlaceholderRef.current = placeholder;
      const normalized: Model3DData = {
        url: detail.modelData.url || detail.modelData.path || "",
        path: detail.modelData.path || detail.modelData.url || "",
        key: detail.modelData.key,
        format: detail.modelData.format || "glb",
        fileName: detail.modelData.fileName || "模型.glb",
        fileSize: detail.modelData.fileSize ?? 0,
        defaultScale: detail.modelData.defaultScale || { x: 1, y: 1, z: 1 },
        defaultRotation: detail.modelData.defaultRotation || {
          x: 0,
          y: 0,
          z: 0,
        },
        timestamp: detail.modelData.timestamp || Date.now(),
        camera: detail.modelData.camera,
      };
      handleModel3DUploaded(normalized);
    };

    window.addEventListener(
      "canvas:insert-model3d",
      handleInsertModelFromLibrary as EventListener
    );
    return () =>
      window.removeEventListener(
        "canvas:insert-model3d",
        handleInsertModelFromLibrary as EventListener
      );
  }, [
    create3DModelPlaceholder,
    currentModel3DPlaceholderRef,
    handleModel3DUploaded,
  ]);

  // ========== 初始化绘图工具Hook ==========
  const drawingTools = useDrawingTools({
    context: drawingContext,
    currentColor,
    fillColor,
    strokeWidth,
    isEraser,
    hasFill,
    eventHandlers: {
      onPathCreate: (path) => {
        logger.debug("路径创建:", path);
      },
      onPathComplete: (path) => {
        logger.debug("路径完成:", path);

        // 检查 Paper.js 项目状态后再触发保存
        if (paper && paper.project && paper.view) {
          paperSaveService.triggerAutoSave();
        } else {
          console.warn("⚠️ Paper.js项目状态异常，跳过自动保存");
        }
      },
      onDrawStart: (mode) => {
        logger.debug("开始绘制:", mode);
      },
      onDrawEnd: (mode) => {
        logger.debug("结束绘制:", mode);

        // 检查 Paper.js 项目状态后再触发保存
        if (paper && paper.project && paper.view) {
          paperSaveService.triggerAutoSave();
        } else {
          console.warn("⚠️ Paper.js项目状态异常，跳过自动保存");
        }
      },
    },
  });

  // ========== 初始化路径编辑器Hook ==========
  const pathEditor = usePathEditor({
    zoom,
  });

  // ========== 初始化橡皮擦工具Hook ==========
  const eraserTool = useEraserTool({
    context: drawingContext,
    strokeWidth,
  });

  // ========== 初始化简单文本工具Hook ==========
  const simpleTextTool = useSimpleTextTool({
    currentColor,
    ensureDrawingLayer: drawingContext.ensureDrawingLayer,
  });

  // ========== 初始化视频工具Hook ==========
  const videoTool = useVideoTool({
    context: drawingContext,
    canvasRef,
    eventHandlers: {
      onVideoSelect: (videoId) => logger.debug("视频选中:", videoId),
      onVideoDeselect: () => logger.debug("取消视频选择"),
      onVideoDelete: (videoId) => {
        logger.debug("视频删除:", videoId);
        // 可以在这里添加删除后的清理逻辑
      },
    },
  });

  // 内存优化：视频实例也使用 ref
  const videoInstancesRef = useRef(videoTool.videoInstances);
  useEffect(() => {
    videoInstancesRef.current = videoTool.videoInstances;
  }, [videoTool.videoInstances]);

  // ========== 初始化选择工具Hook ==========
  const selectionTool = useSelectionTool({
    zoom,
    imageInstances: imageTool.imageInstances,
    model3DInstances: model3DTool.model3DInstances,
    videoInstances: videoTool.videoInstances,
    textItems: simpleTextTool.textItems,
    onImageSelect: (imageId, addToSelection) => {
      // 先执行原有选择逻辑
      imageTool.handleImageSelect(imageId, addToSelection);
      try {
        // 在当前实例列表中查找该图片，获取其最新bounds
        const img = imageTool.imageInstances.find((i) => i.id === imageId);
        if (img && img.bounds) {
          const primarySource = img.imageData?.src ?? img.imageData?.url ?? (img.imageData as any)?.remoteUrl;
          const inlineSource = isInlineImageSource(primarySource) ? primarySource : null;
          const localDataUrl = extractLocalImageData(img.imageData);
          // 🔥 不再使用 cachedBeforeSelect?.imageData 作为 fallback，避免显示错误的图片
          const imageDataForCache = inlineSource || localDataUrl || null;

          // 🔥 优先从项目 SSOT (assets.images) 获取可持久化引用，满足设计 JSON 约束；
          // 但若图片仍在上传中（pendingUpload=true），Chat 侧会优先用 blob 预览避免裂图（见 resolveCanvasImageRefForChat）
          const persistableRef =
            extractPersistableImageRef(getPersistedImageAssetSnapshot(img.id)) ||
            extractPersistableImageRef(img.imageData);

          // 将该图片作为最新缓存，并写入位置信息（中心通过bounds在需要时计算）
          if (persistableRef) {
            // 画布侧不缓存 base64/dataURL：优先缓存可持久化引用（OSS key/远程 URL）
            contextManager.cacheLatestImage(null, img.id, "用户选择的图片", {
              bounds: img.bounds,
              layerId: img.layerId,
              remoteUrl: persistableRef,
            });
            logger.debug("📌 已基于选中图片更新缓存位置:", {
              id: img.id,
              bounds: img.bounds,
            });
          } else if (imageDataForCache) {
            contextManager.cacheLatestImage(
              imageDataForCache,
              img.id,
              "用户选择的图片",
              {
                bounds: img.bounds,
                layerId: img.layerId,
                remoteUrl: null,
              }
            );
          } else {
            console.warn("⚠️ 选中图片缺少可缓存的数据，跳过缓存更新", {
              imageId,
              hasInlineSource: !!inlineSource,
              hasLocalDataUrl: !!localDataUrl,
              hasRemoteUrl: !!persistableRef,
            });
          }

          // 🔥 同步选中图片到AI对话框
          const imageSourceForAI =
            resolveCanvasImageRefForChat(img.id, img.imageData) ||
            persistableRef ||
            imageDataForCache;
          const selectionToken = (canvasToChatSyncTokenRef.current += 1);

          if (addToSelection) {
            // 多选模式：收集所有选中图片的数据
            const allSelectedImages: string[] = [];
            // 先添加已选中的图片
            for (const instance of imageTool.imageInstances) {
              if (instance.isSelected && instance.id !== imageId) {
                const data = resolveCanvasImageRefForChat(
                  instance.id,
                  instance.imageData
                );
                if (data) allSelectedImages.push(data);
              }
            }
            // 添加当前选中的图片
            if (imageSourceForAI) allSelectedImages.push(imageSourceForAI);
            // 先同步一份“即时可用”的引用（可能包含 blob:），避免 UI 等待
            useAIChatStore.getState().setSourceImagesFromCanvas(allSelectedImages);
            void (async () => {
              try {
                const stable = await Promise.all(
                  allSelectedImages.map((src) =>
                    ensureChatStableImageRef(src, imageId)
                  )
                );
                if (canvasToChatSyncTokenRef.current !== selectionToken) return;
                if (
                  stable.length === allSelectedImages.length &&
                  stable.every((v, i) => v === allSelectedImages[i])
                ) {
                  return;
                }
                useAIChatStore.getState().setSourceImagesFromCanvas(stable);
              } catch {
                // ignore
              }
            })();
          } else {
            // 单选模式：只设置当前图片
            if (imageSourceForAI) {
              // 先同步一份“即时可用”的引用（可能包含 blob:），避免 UI 等待
              useAIChatStore.getState().setSourceImagesFromCanvas([imageSourceForAI]);
              void (async () => {
                try {
                  const stable = await ensureChatStableImageRef(
                    imageSourceForAI,
                    imageId
                  );
                  if (canvasToChatSyncTokenRef.current !== selectionToken) return;
                  if (stable === imageSourceForAI) return;
                  useAIChatStore.getState().setSourceImagesFromCanvas([stable]);
                } catch {
                  // ignore
                }
              })();
            }
          }
        }
      } catch (e) {
        console.warn("更新缓存位置失败:", e);
      }
    },
    onImageMultiSelect: (imageIds) => {
      // 先执行原有多选逻辑
      imageTool.handleImageMultiSelect(imageIds);

      // 🔥 同步多选图片到AI对话框
      try {
        const selectedImages: string[] = [];
        for (const id of imageIds) {
          const img = imageTool.imageInstances.find((i) => i.id === id);
          if (img) {
            const imageData = resolveCanvasImageRefForChat(id, img.imageData);
            if (imageData) selectedImages.push(imageData);
          }
        }
        const selectionToken = (canvasToChatSyncTokenRef.current += 1);
        useAIChatStore.getState().setSourceImagesFromCanvas(selectedImages);
        void (async () => {
          try {
            const stable = await Promise.all(
              selectedImages.map((src) => ensureChatStableImageRef(src))
            );
            if (canvasToChatSyncTokenRef.current !== selectionToken) return;
            if (
              stable.length === selectedImages.length &&
              stable.every((v, i) => v === selectedImages[i])
            ) {
              return;
            }
            useAIChatStore.getState().setSourceImagesFromCanvas(stable);
          } catch {
            // ignore
          }
        })();
      } catch (e) {
        console.warn("同步多选图片到AI对话框失败:", e);
      }
    },
    onModel3DSelect: model3DTool.handleModel3DSelect,
    onModel3DMultiSelect: model3DTool.handleModel3DMultiSelect,
    onImageDeselect: () => {
      // 先执行原有取消选择逻辑
      imageTool.handleImageDeselect();
      // 🔥 清空AI对话框中的图片
      useAIChatStore.getState().setSourceImagesFromCanvas([]);
    },
    onModel3DDeselect: model3DTool.handleModel3DDeselect,
    onVideoSelect: (videoId, addToSelection) => {
      videoTool.handleVideoSelect(videoId, addToSelection);
    },
    onVideoMultiSelect: (videoIds) => {
      videoTool.handleVideoMultiSelect(videoIds);
    },
    onVideoDeselect: videoTool.handleVideoDeselect,
    onTextSelect: (textId, addToSelection) => {
      if (addToSelection) {
        // 多选模式：保持现有选择
        simpleTextTool.selectText(textId, true);
      } else {
        // 单选模式：取消其他选择
        simpleTextTool.deselectText();
        simpleTextTool.selectText(textId, false);
      }
    },
    onTextMultiSelect: (textIds) => {
      simpleTextTool.selectMultipleTexts(textIds);
    },
    onTextDeselect: () => {
      simpleTextTool.deselectText();
    },
  });

  const selectedTextItems = useMemo(
    () =>
      simpleTextTool.textItems.filter(
        (item) => item.isSelected && item.paperText
      ),
    [simpleTextTool.textItems]
  );

  const hasSelection = useMemo(() => {
    const imageCount = imageTool.selectedImageIds?.length ?? 0;
    const modelCount = model3DTool.selectedModel3DIds?.length ?? 0;
    const videoCount = videoTool.selectedVideoIds?.length ?? 0;
    const pathCount =
      (selectionTool.selectedPath ? 1 : 0) +
      (selectionTool.selectedPaths?.length ?? 0);
    const textCount = selectedTextItems.length;
    return (
      imageCount > 0 ||
      modelCount > 0 ||
      videoCount > 0 ||
      pathCount > 0 ||
      textCount > 0
    );
  }, [
    imageTool.selectedImageIds,
    model3DTool.selectedModel3DIds,
    videoTool.selectedVideoIds,
    selectionTool.selectedPath,
    selectionTool.selectedPaths,
    selectedTextItems,
  ]);

  const hasSelectionRef = useRef(hasSelection);
  useEffect(() => {
    hasSelectionRef.current = hasSelection;
  }, [hasSelection]);

  const selectionSnapshotRef = useRef<{
    imageIds: string[];
    modelIds: string[];
    textId: string | null;
    paths: paper.Path[];
  }>({
    imageIds: [],
    modelIds: [],
    textId: null,
    paths: [],
  });

  useEffect(() => {
    selectionSnapshotRef.current = {
      imageIds: [...(imageTool.selectedImageIds ?? [])],
      modelIds: [...(model3DTool.selectedModel3DIds ?? [])],
      textId: simpleTextTool.selectedTextId ?? null,
      paths: [
        ...(selectionTool.selectedPath ? [selectionTool.selectedPath] : []),
        ...((selectionTool.selectedPaths ?? []) as paper.Path[]),
      ].filter((path): path is paper.Path => !!path),
    };
  }, [
    imageTool.selectedImageIds,
    model3DTool.selectedModel3DIds,
    selectionTool.selectedPath,
    selectionTool.selectedPaths,
    simpleTextTool.selectedTextId,
  ]);

  const {
    createImageFromSnapshot,
    handleImageMultiSelect,
    setSelectedImageIds,
  } = imageTool;
  const {
    createModel3DFromSnapshot,
    handleModel3DMultiSelect,
    setSelectedModel3DIds,
  } = model3DTool;
  const {
    clearAllSelections,
    setSelectedPaths,
    setSelectedPath,
    handlePathSelect: selectToolHandlePathSelect,
  } = selectionTool;
  const {
    createText: createSimpleText,
    stopEditText,
    selectText: selectSimpleText,
    deselectText: deselectSimpleText,
    deleteText: deleteSimpleText,
  } = simpleTextTool;
  const modelPlaceholderRef = model3DTool.currentModel3DPlaceholderRef;
  const resetImageInstances = imageTool.setImageInstances;
  const resetSelectedImageIds = imageTool.setSelectedImageIds;
  const resetModelInstances = model3DTool.setModel3DInstances;
  const resetModelSelections = model3DTool.setSelectedModel3DIds;
  const clearTextItems = simpleTextTool.clearAllTextItems;
  const clearSelections = selectionTool.clearAllSelections;
  const imagePlaceholderRef = imageTool.currentPlaceholderRef;

  useEffect(() => {
    const handlePaperCleared = () => {
      logger.debug("🧹 收到 paper-project-cleared 事件，重置前端实例状态");

      // 回收画布相关 blob: ObjectURL（避免清空后仍占用内存）
      const blobUrlsToRevoke = new Set<string>();
      const addBlobUrl = (value: unknown) => {
        if (typeof value !== "string") return;
        if (!value.startsWith("blob:")) return;
        blobUrlsToRevoke.add(value);
      };
      try {
        const instances = (window as any).tanvaImageInstances as any[] | undefined;
        if (Array.isArray(instances)) {
          instances.forEach((inst) => {
            const data = inst?.imageData;
            addBlobUrl(data?.localDataUrl);
            addBlobUrl(data?.url);
            addBlobUrl(data?.src);
          });
        }
      } catch {}
      try {
        const project = paper?.project as any;
        const rasterClass = (paper as any).Raster;
        if (project?.getItems && rasterClass) {
          const rasters = project.getItems({ class: rasterClass }) as any[];
          rasters.forEach((raster) => {
            try {
              const source = (raster as any)?.source;
              if (typeof source === "string") addBlobUrl(source);
              else addBlobUrl((source as any)?.src);
            } catch {}
          });
        }
      } catch {}

      resetImageInstances([]);
      resetSelectedImageIds([]);
      if (imagePlaceholderRef?.current) {
        try {
          imagePlaceholderRef.current.remove();
        } catch {}
        imagePlaceholderRef.current = null;
      }

      resetModelInstances([]);
      resetModelSelections([]);
      if (modelPlaceholderRef?.current) {
        try {
          modelPlaceholderRef.current.remove();
        } catch {}
        modelPlaceholderRef.current = null;
      }

      clearTextItems();
      clearSelections();

      try {
        (window as any).tanvaImageInstances = [];
      } catch {}
      try {
        (window as any).tanvaModel3DInstances = [];
      } catch {}
      try {
        (window as any).tanvaTextItems = [];
      } catch {}

      blobUrlsToRevoke.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {}
      });
    };

    window.addEventListener("paper-project-cleared", handlePaperCleared);
    return () => {
      window.removeEventListener("paper-project-cleared", handlePaperCleared);
    };
  }, [
    resetImageInstances,
    resetSelectedImageIds,
    resetModelInstances,
    resetModelSelections,
    clearTextItems,
    clearSelections,
    imagePlaceholderRef,
    modelPlaceholderRef,
  ]);

  // 记录上一次处理的 projectId，避免重复清空
  const lastProcessedProjectIdRef = useRef<string | null>(null);
  const clearingInProgressRef = useRef(false);
  const clearProjectImageInstances = imageTool.setImageInstances;
  const clearProjectSelectedImageIds = imageTool.setSelectedImageIds;
  const clearProjectModel3DInstances = model3DTool.setModel3DInstances;
  const clearProjectSelectedModel3DIds = model3DTool.setSelectedModel3DIds;
  const clearProjectTextItems = simpleTextTool.clearAllTextItems;
  const clearProjectSelections = selectionTool.clearAllSelections;

  // 🔄 当 projectId 变化时，清空所有实例状态，防止旧项目数据残留
  useEffect(() => {
    if (!projectId) return; // 避免初始化时清空

    // 避免对同一个 projectId 重复执行清空操作
    if (lastProcessedProjectIdRef.current === projectId) {
      return;
    }

    // 避免并发执行
    if (clearingInProgressRef.current) {
      return;
    }

    lastProcessedProjectIdRef.current = projectId;
    clearingInProgressRef.current = true;

    logger.debug("🔄 项目ID变化，清空所有实例:", projectId);

    // 直接同步执行，但使用稳定的函数引用
    try {
      // 回收旧项目遗留的 blob: ObjectURL（在清空实例前采集）
      const blobUrlsToRevoke = new Set<string>();
      const addBlobUrl = (value: unknown) => {
        if (typeof value !== "string") return;
        if (!value.startsWith("blob:")) return;
        blobUrlsToRevoke.add(value);
      };
      try {
        const instances = (window as any).tanvaImageInstances as any[] | undefined;
        if (Array.isArray(instances)) {
          instances.forEach((inst) => {
            const data = inst?.imageData;
            addBlobUrl(data?.localDataUrl);
            addBlobUrl(data?.url);
            addBlobUrl(data?.src);
          });
        }
      } catch {}

      // 清空图片实例
      clearProjectImageInstances([]);
      clearProjectSelectedImageIds([]);

      // 清空3D模型实例
      clearProjectModel3DInstances([]);
      clearProjectSelectedModel3DIds([]);

      // 清空文本实例
      clearProjectTextItems();

      // 清空选择工具状态
      clearProjectSelections();

      blobUrlsToRevoke.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {}
      });
    } finally {
      clearingInProgressRef.current = false;
    }
  }, [
    projectId,
    clearProjectImageInstances,
    clearProjectSelectedImageIds,
    clearProjectModel3DInstances,
    clearProjectSelectedModel3DIds,
    clearProjectTextItems,
    clearProjectSelections,
  ]);

  useEffect(() => {
    if (!projectAssets) return;
    if (!paper || !paper.project) return;
    if (!projectId) return;

    // 只允许进行一次基于快照的初始回填，避免用户删除后又被回填复原
    // 注意：该标记必须是“按项目隔离”的，否则切换项目后会误判为已回填，导致图片丢失/不可选（刷新后正常）。
    const hydratedFlagKey = `__tanva_initial_assets_hydrated__:${projectId}`;
    const alreadyHydrated =
      typeof window !== "undefined" && (window as any)[hydratedFlagKey];
    if (alreadyHydrated) return;

    // 如果已经从 paperJson 恢复过内容，则这次也不需要 snapshot 回填
    const restoredFromPaper =
      typeof window !== "undefined" && (window as any).tanvaPaperRestored;
    if (restoredFromPaper) {
      logger.debug(
        "🛑 检测到已从 paperJson 恢复，跳过 snapshot 回填以避免重复"
      );
      try {
        (window as any).tanvaPaperRestored = false;
      } catch {}
      // 视为已回填一次，避免后续空场景再次触发
      try {
        (window as any)[hydratedFlagKey] = true;
      } catch {}

      // paperJson 恢复只会还原 Paper 场景，不会重建图片/3D/文本的运行时实例。
      // 若不补齐 imageTool.imageInstances，选择/拖拽会退化为“框选矩形”，表现为图片拖不动。
      try {
        if (imageTool.imageInstances.length === 0) {
          const imageSnapshots: ImageAssetSnapshot[] = Array.isArray(
            projectAssets.images
          )
            ? projectAssets.images
            : [];
          const snapshotMap = new Map<string, ImageAssetSnapshot>();
          imageSnapshots.forEach((snap) => {
            if (snap?.id) snapshotMap.set(snap.id, snap);
          });

          const restoredImageGroups = (() => {
            try {
              const items = (paper.project as any).getItems?.({
                match: (item: any) => item?.data?.imageId,
              }) as paper.Item[] | undefined;
              const list = Array.isArray(items) ? items : [];

              // 去重：同一个 imageId 可能同时标在 Group 与其内部 Raster 上，优先保留 Group
              const byId = new Map<string, paper.Item>();
              for (const item of list) {
                const imageId = item?.data?.imageId;
                if (!imageId) continue;
                const existing = byId.get(imageId);
                const isGroupLike = (it: any) =>
                  it?.className === "Group" || it instanceof paper.Group;
                if (!existing) {
                  byId.set(imageId, item);
                  continue;
                }
                if (isGroupLike(item) && !isGroupLike(existing)) {
                  byId.set(imageId, item);
                }
              }
              return Array.from(byId.values());
            } catch {
              return [];
            }
          })();

          const reconstructed: ImageInstance[] = [];
          restoredImageGroups.forEach((item) => {
            const imageId = (item as any)?.data?.imageId as string | undefined;
            if (!imageId) return;

            const snapshot = snapshotMap.get(imageId);
            const group = item instanceof paper.Group ? item : null;
            const raster = group
              ? ((group.children || []).find(
                  (child: any) => child && isRaster(child)
                ) as paper.Raster | undefined)
              : isRaster(item)
              ? (item as paper.Raster)
              : undefined;

            const resolvedBounds = (() => {
              const paperBounds =
                (raster as any)?.bounds || (item as any)?.bounds;
              if (
                paperBounds &&
                paperBounds.width > 0 &&
                paperBounds.height > 0
              ) {
                return paperBounds as paper.Rectangle;
              }

              const cachedBounds =
                (raster as any)?.data?.__tanvaBounds ||
                (group as any)?.data?.__tanvaBounds ||
                (item as any)?.data?.__tanvaBounds;
              if (
                cachedBounds &&
                typeof cachedBounds === "object" &&
                Number.isFinite((cachedBounds as any)?.width) &&
                Number.isFinite((cachedBounds as any)?.height) &&
                (cachedBounds as any).width > 0 &&
                (cachedBounds as any).height > 0
              ) {
                return new paper.Rectangle(
                  (cachedBounds as any).x,
                  (cachedBounds as any).y,
                  (cachedBounds as any).width,
                  (cachedBounds as any).height
                );
              }

              if (snapshot?.bounds) {
                return new paper.Rectangle(
                  snapshot.bounds.x,
                  snapshot.bounds.y,
                  snapshot.bounds.width,
                  snapshot.bounds.height
                );
              }
              return paperBounds as paper.Rectangle | undefined;
            })();

            if (!resolvedBounds) return;

            // 反序列化时会清理 isHelper 元素，这里补齐图片组的命中/选择结构（边框、拖拽热区、缩放手柄等）
            if (group && raster) {
              try {
                ensureImageGroupStructure({
                  raster,
                  imageId,
                  group,
                  bounds: resolvedBounds,
                  ensureImageRect: true,
                  ensureSelectionArea: true,
                  metadata: {
                    fileName: snapshot?.fileName,
                    uploadMethod: (snapshot as any)?.uploadMethod,
                    originalWidth: snapshot?.width,
                    originalHeight: snapshot?.height,
                    aspectRatio:
                      snapshot?.width && snapshot?.height
                        ? snapshot.width / snapshot.height
                        : undefined,
                    remoteUrl: snapshot?.url,
                  },
                });
              } catch (error) {
                console.warn("重建图片组结构失败:", error);
              }
            } else if (raster) {
              // 至少保证 raster.data 上有 imageId，便于后续命中检测/预览逻辑工作
              try {
                raster.data = {
                  ...(raster.data || {}),
                  type: "image",
                  imageId,
                };
              } catch {}
            }

            const source =
              snapshot?.url ||
              snapshot?.src ||
              snapshot?.localDataUrl ||
              (typeof (raster as any)?.source === "string"
                ? (raster as any).source
                : null);

            if (!source) return;

            const layerName = (item as any)?.layer?.name;
            const derivedLayerId =
              typeof layerName === "string" && layerName.startsWith("layer_")
                ? layerName.replace("layer_", "")
                : undefined;

            reconstructed.push({
              id: imageId,
              imageData: {
                id: imageId,
                url: source,
                src: source,
                key: snapshot?.key,
                fileName: snapshot?.fileName,
                width: snapshot?.width,
                height: snapshot?.height,
                contentType: snapshot?.contentType,
                pendingUpload: snapshot?.pendingUpload,
                localDataUrl: snapshot?.localDataUrl,
              },
              bounds: {
                x: resolvedBounds.x,
                y: resolvedBounds.y,
                width: resolvedBounds.width,
                height: resolvedBounds.height,
              },
              isSelected: false,
              visible: item.visible !== false,
              layerId: snapshot?.layerId ?? derivedLayerId,
            });
          });

          if (reconstructed.length > 0) {
            imageTool.setImageInstances(reconstructed);
            imageTool.setSelectedImageIds([]);
            try {
              paper.view.update();
            } catch {}
          } else if (projectAssets.images?.length) {
            const seeded: ImageInstance[] = projectAssets.images
              .filter((snap) => snap?.id && snap?.bounds)
              .map((snap) => {
                const source =
                  snap?.url || snap?.src || snap?.key || snap?.localDataUrl;
                return {
                  id: snap.id,
                  imageData: {
                    id: snap.id,
                    url: snap.url ?? snap.key ?? source,
                    src: snap.src ?? snap.url ?? source,
                    key: snap.key,
                    fileName: snap.fileName,
                    width: snap.width,
                    height: snap.height,
                    contentType: snap.contentType,
                    pendingUpload: snap.pendingUpload,
                    localDataUrl: snap.localDataUrl,
                  },
                  bounds: {
                    x: snap.bounds.x,
                    y: snap.bounds.y,
                    width: snap.bounds.width,
                    height: snap.bounds.height,
                  },
                  isSelected: false,
                  visible: true,
                  layerId: snap.layerId,
                };
              });
            if (seeded.length > 0) {
              imageTool.setImageInstances(seeded);
              imageTool.setSelectedImageIds([]);
            }
          }
        }
      } catch (error) {
        console.warn("paperJson 恢复后重建图片实例失败:", error);
      }
      return;
    }

    const hasExisting =
      imageTool.imageInstances.length > 0 ||
      model3DTool.model3DInstances.length > 0 ||
      simpleTextTool.textItems.length > 0;
    if (hasExisting) return;

    try {
      if (projectAssets.images?.length) {
        imageTool.hydrateFromSnapshot(projectAssets.images);
      }
      if (projectAssets.models?.length) {
        model3DTool.hydrateFromSnapshot(projectAssets.models);
      }
      if (projectAssets.texts?.length) {
        simpleTextTool.hydrateFromSnapshot(projectAssets.texts);
      }
      if (projectAssets.videos?.length) {
        videoTool.hydrateFromSnapshot(projectAssets.videos);
      }
      // 标记为已回填
      try {
        (window as any)[hydratedFlagKey] = true;
      } catch {}
    } catch (error) {
      console.warn("资产回填失败:", error);
    }
  }, [
    projectId,
    projectAssets,
    imageTool.imageInstances,
    model3DTool.model3DInstances,
    simpleTextTool.textItems,
    imageTool.hydrateFromSnapshot,
    model3DTool.hydrateFromSnapshot,
    simpleTextTool.hydrateFromSnapshot,
  ]);

  useEffect(() => {
    if (!projectId) return;
    const hydratedFlagKey = `__tanva_initial_assets_hydrated__:${projectId}`;

    const handlePageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      try {
        (window as any)[hydratedFlagKey] = false;
        (window as any).tanvaPaperRestored = false;
      } catch {}

      const hasExisting =
        imageTool.imageInstances.length > 0 ||
        model3DTool.model3DInstances.length > 0 ||
        simpleTextTool.textItems.length > 0;
      if (hasExisting) return;

      try {
        if (projectAssets?.images?.length) {
          imageTool.hydrateFromSnapshot(projectAssets.images);
        }
        if (projectAssets?.models?.length) {
          model3DTool.hydrateFromSnapshot(projectAssets.models);
        }
        if (projectAssets?.texts?.length) {
          simpleTextTool.hydrateFromSnapshot(projectAssets.texts);
        }
        if (projectAssets?.videos?.length) {
          videoTool.hydrateFromSnapshot(projectAssets.videos);
        }
      } catch (error) {
        console.warn("pageshow 回填资产失败:", error);
      }
    };

    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, [
    projectId,
    projectAssets,
    imageTool.imageInstances.length,
    model3DTool.model3DInstances.length,
    simpleTextTool.textItems.length,
    imageTool.hydrateFromSnapshot,
    model3DTool.hydrateFromSnapshot,
    simpleTextTool.hydrateFromSnapshot,
    videoTool.hydrateFromSnapshot,
  ]);

  // 暴露文本工具状态到全局，供工具栏使用
  useEffect(() => {
    (window as any).tanvaTextTool = simpleTextTool;
  }, [simpleTextTool]);

  // ========== 截图功能处理 ==========
  const currentSelectedPath = selectionTool.selectedPath;
  const currentSelectedPaths = selectionTool.selectedPaths;
  const currentSelectedImageIds = imageTool.selectedImageIds;
  const currentSelectedModelIds = model3DTool.selectedModel3DIds;

  const handleScreenshot = useCallback(async () => {
    try {
      logger.debug("🖼️ 用户触发截图...");

      // 延迟一点，确保UI状态稳定
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 使用 ref 获取最新实例，避免闭包捕获大量数据
      const currentImageInstances = imageInstancesRef.current;
      const currentModel3DInstances = model3DInstancesRef.current;

      // 调试信息
      logger.debug("截图前的状态:", {
        imageCount: currentImageInstances.length,
        model3DCount: currentModel3DInstances.length,
        images: currentImageInstances,
        models: currentModel3DInstances,
      });

      // 使用带回调的截图模式，同时下载和传入AI对话框
      const selectedPaperItemsSet = new Set<paper.Item>();
      if (currentSelectedPath) {
        selectedPaperItemsSet.add(currentSelectedPath);
      }
      if (Array.isArray(currentSelectedPaths)) {
        currentSelectedPaths.forEach((path) => {
          if (path) selectedPaperItemsSet.add(path);
        });
      }
      simpleTextTool.textItems
        .filter((item) => item.isSelected && item.paperText)
        .forEach((item) => selectedPaperItemsSet.add(item.paperText));

      const manualSelection = {
        paperItems: Array.from(selectedPaperItemsSet),
        imageIds: Array.isArray(currentSelectedImageIds)
          ? [...currentSelectedImageIds]
          : [],
        modelIds: Array.isArray(currentSelectedModelIds)
          ? [...currentSelectedModelIds]
          : [],
      };

      const result = await AutoScreenshotService.captureAutoScreenshot(
        currentImageInstances,
        currentModel3DInstances,
        {
          format: "png",
          quality: 0.92,
          scale: 2,
          padding: 0, // 无边距，与内容尺寸完全一致
          autoDownload: true, // 同时下载文件，方便检查质量
          filename: "artboard-screenshot",
          selection: manualSelection,
          // 截图完成后的回调，直接传入AI聊天
          onComplete: (dataUrl: string, filename: string) => {
            logger.debug("🎨 截图完成，同时下载文件和传入AI对话框...", {
              filename,
            });

            // 将截图设置为AI编辑源图片
            setSourceImageForEditing(dataUrl);

            // 显示AI对话框
            showAIDialog();

            logger.debug("✅ 截图已下载到本地并传入AI对话框");
          },
        }
      );

      if (result.success) {
        logger.debug("✅ 截图成功生成:", result.filename);
        logger.debug("截图成功！已下载到本地并传入AI对话框:", result.filename);
      } else {
        logger.error("❌ 截图失败:", result.error);
        console.error("截图失败:", result.error);
        alert(`截图失败: ${result.error}`);
      }
    } catch (error) {
      logger.error("截图过程出错:", error);
      console.error("截图过程出错:", error);
      alert("截图失败，请重试");
    } finally {
      // 无论成功失败，都切换回选择模式
      setDrawMode("select");
    }
  }, [
    currentSelectedPath,
    currentSelectedPaths,
    currentSelectedImageIds,
    currentSelectedModelIds,
    // 移除 imageTool.imageInstances 和 model3DTool.model3DInstances 依赖
    // 改用 refs，避免每次实例变化都重建回调
    setDrawMode,
    setSourceImageForEditing,
    showAIDialog,
  ]);

  // 监听截图工具的激活
  useEffect(() => {
    if (drawMode === "screenshot") {
      // 当选择截图工具时，立即执行截图
      handleScreenshot();
    }
  }, [drawMode, handleScreenshot]);

  // ========== 组合选择工具栏 ==========
  const selectedImageInstances = useMemo(() => {
    if (!imageTool.selectedImageIds?.length) return [];
    const set = new Set(imageTool.selectedImageIds);
    return imageTool.imageInstances.filter((instance) => set.has(instance.id));
  }, [imageTool.imageInstances, imageTool.selectedImageIds]);

  const selectedModelInstances = useMemo(() => {
    if (!model3DTool.selectedModel3DIds?.length) return [];
    const set = new Set(model3DTool.selectedModel3DIds);
    return model3DTool.model3DInstances.filter((instance) =>
      set.has(instance.id)
    );
  }, [model3DTool.model3DInstances, model3DTool.selectedModel3DIds]);

  const selectedPaperItems = useMemo(() => {
    const set = new Set<paper.Item>();
    if (selectionTool.selectedPath) set.add(selectionTool.selectedPath);
    if (Array.isArray(selectionTool.selectedPaths)) {
      selectionTool.selectedPaths.forEach((item) => {
        if (item) set.add(item);
      });
    }
    selectedTextItems.forEach(({ paperText }) => {
      if (paperText) set.add(paperText);
    });
    return Array.from(set);
  }, [
    selectionTool.selectedPath,
    selectionTool.selectedPaths,
    selectedTextItems,
  ]);

  const selectedGroupBlocks = useMemo(() => {
    const items: paper.Path[] = [];
    const push = (path: paper.Path | null | undefined) => {
      if (!path) return;
      if (path.data?.type !== "image-group") return;
      items.push(path);
    };
    push(selectionTool.selectedPath);
    (selectionTool.selectedPaths ?? []).forEach(push);
    const uniq = new Map<number, paper.Path>();
    items.forEach((item) => uniq.set(item.id, item));
    return Array.from(uniq.values());
  }, [selectionTool.selectedPath, selectionTool.selectedPaths]);

  const selectedNonGroupPaths = useMemo(() => {
    const items: paper.Path[] = [];
    const push = (path: paper.Path | null | undefined) => {
      if (!path) return;
      if (path.data?.type === "image-group") return;
      items.push(path);
    };
    push(selectionTool.selectedPath);
    (selectionTool.selectedPaths ?? []).forEach(push);
    const uniq = new Map<number, paper.Path>();
    items.forEach((item) => uniq.set(item.id, item));
    return Array.from(uniq.values());
  }, [selectionTool.selectedPath, selectionTool.selectedPaths]);

  const selectedGroupImageIds = useMemo(() => {
    const ids = new Set<string>();
    selectedGroupBlocks.forEach((block) => {
      const raw = (block.data as any)?.imageIds;
      if (!Array.isArray(raw)) return;
      raw.forEach((id) => {
        if (typeof id === "string" && id.trim()) ids.add(id.trim());
      });
    });
    return Array.from(ids);
  }, [selectedGroupBlocks]);

  const groupableImageIds = useMemo(() => {
    const ids = new Set<string>();
    (imageTool.selectedImageIds ?? []).forEach((id) => {
      if (typeof id === "string" && id.trim()) ids.add(id.trim());
    });
    selectedGroupImageIds.forEach((id) => ids.add(id));
    return Array.from(ids);
  }, [imageTool.selectedImageIds, selectedGroupImageIds]);

  const pendingImageIds = useMemo(() => {
    return new Set<string>(
      (imageTool.imageInstances ?? [])
        .filter((img) => img?.imageData?.pendingUpload)
        .map((img) => String(img.id))
    );
  }, [imageTool.imageInstances]);

  const hasPendingSelection = useMemo(() => {
    if (pendingImageIds.size === 0) return false;
    if (selectedImageInstances.some((img) => pendingImageIds.has(String(img.id)))) {
      return true;
    }
    return selectedGroupImageIds.some((id) => pendingImageIds.has(String(id)));
  }, [pendingImageIds, selectedImageInstances, selectedGroupImageIds]);

  const groupSelectionCount =
    selectedImageInstances.length +
    selectedModelInstances.length +
    selectedPaperItems.length;
  const isGroupSelection = groupSelectionCount >= 2;
  const showSelectionGroupToolbar =
    isGroupSelection ||
    (selectedGroupBlocks.length === 1 && groupSelectionCount === 1);
  const canGroupImages =
    groupSelectionCount >= 2 &&
    groupableImageIds.length >= 2 &&
    selectedModelInstances.length === 0 &&
    selectedTextItems.length === 0 &&
    selectedNonGroupPaths.length === 0 &&
    !hasPendingSelection;
  const canUngroupImages = selectedGroupBlocks.length > 0 && !hasPendingSelection;

  const groupPaperBounds = useMemo(() => {
    if (!showSelectionGroupToolbar) return null;
    const bounds = BoundsCalculator.calculateSelectionBounds(
      selectedImageInstances,
      selectedModelInstances,
      selectedPaperItems,
      0
    );
    if (bounds.isEmpty) return null;
    return bounds;
  }, [
    showSelectionGroupToolbar,
    selectedImageInstances,
    selectedModelInstances,
    selectedPaperItems,
  ]);

  const paperRectToScreen = useCallback(
    (rect: { x: number; y: number; width: number; height: number } | null) => {
      if (!rect || !paper.view) return null;
      try {
        const dpr = window.devicePixelRatio || 1;
        const topLeft = paper.view.projectToView(
          new paper.Point(rect.x, rect.y)
        );
        const bottomRight = paper.view.projectToView(
          new paper.Point(rect.x + rect.width, rect.y + rect.height)
        );
        if (
          !Number.isFinite(topLeft.x) ||
          !Number.isFinite(topLeft.y) ||
          !Number.isFinite(bottomRight.x) ||
          !Number.isFinite(bottomRight.y)
        ) {
          return null;
        }
        return {
          x: topLeft.x / dpr,
          y: topLeft.y / dpr,
          width: (bottomRight.x - topLeft.x) / dpr,
          height: (bottomRight.y - topLeft.y) / dpr,
        };
      } catch (error) {
        console.warn("Group toolbar 坐标转换失败:", error);
        return null;
      }
    },
    [zoom, panX, panY]
  );

  const groupScreenBounds = useMemo(
    () => paperRectToScreen(groupPaperBounds),
    [groupPaperBounds, paperRectToScreen]
  );

  const getCameraSmartPosition = useCallback(
    (bounds?: { x: number; y: number; width: number; height: number }) => {
      if (!bounds) return undefined;
      const gap = Math.max(48, Math.min(160, bounds.height * 0.25));
      return {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2 + bounds.height + gap,
      };
    },
    []
  );

  const executeGroupCapture = useCallback(
    async (options?: { sendToDialog?: boolean }) => {
      const hasCaptureTarget =
        isGroupSelection || selectedGroupBlocks.length > 0;
      if (hasPendingSelection) return;
      if (!hasCaptureTarget || !groupPaperBounds) return;
      if (isGroupCapturePending) return;
      setIsGroupCapturePending(true);
      const sendToDialog = options?.sendToDialog ?? false;
      try {
        const captureImageIds = Array.from(
          new Set([
            ...(imageTool.selectedImageIds ?? []),
            ...selectedGroupImageIds,
          ])
        );
        const capturePaperItems = selectedPaperItems.filter(
          (item) => (item as any)?.data?.type !== "image-group"
        );
        const selection = {
          paperItems: capturePaperItems,
          imageIds: captureImageIds,
          modelIds: [...(model3DTool.selectedModel3DIds ?? [])],
        };
        const result = await AutoScreenshotService.captureAutoScreenshot(
          imageTool.imageInstances,
          model3DTool.model3DInstances,
          {
            format: "png",
            includeBackground: false,
            autoDownload: false,
            selection,
          }
        );

        if (result.success && result.dataUrl) {
          const captureBounds = result.bounds ?? groupPaperBounds;
          const boundsPayload = {
            x: captureBounds.x,
            y: captureBounds.y,
            width: captureBounds.width,
            height: captureBounds.height,
          };
          const smartPosition = getCameraSmartPosition(boundsPayload);
          const shouldAddToCanvas = !sendToDialog;

          if (shouldAddToCanvas) {
            if (quickImageUpload.handleQuickImageUploaded) {
              await quickImageUpload.handleQuickImageUploaded(
                result.dataUrl,
                `group-${Date.now()}.png`,
                boundsPayload,
                smartPosition,
                "camera"
              );
            } else {
              window.dispatchEvent(
                new CustomEvent("triggerQuickImageUpload", {
                  detail: {
                    imageData: result.dataUrl,
                    fileName: `group-${Date.now()}.png`,
                    selectedImageBounds: boundsPayload,
                    smartPosition,
                    operationType: "camera",
                  },
                })
              );
            }
          }

          if (sendToDialog) {
            setSourceImageForEditing(result.dataUrl);
            showAIDialog();
          }

          const successMessage = sendToDialog
            ? "组合图层已发送到对话框"
            : "已生成组合图层";
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message: successMessage, type: "success" },
            })
          );
        } else {
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: {
                message: result.error || "组合失败，请重试",
                type: "error",
              },
            })
          );
        }
      } catch (error) {
        console.error("Group capture failed:", error);
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message: "组合失败，请重试", type: "error" },
          })
        );
      } finally {
        setIsGroupCapturePending(false);
      }
    },
    [
      hasPendingSelection,
      isGroupSelection,
      selectedGroupBlocks.length,
      selectedGroupImageIds,
      groupPaperBounds,
      isGroupCapturePending,
      imageTool.imageInstances,
      model3DTool.model3DInstances,
      imageTool.selectedImageIds,
      model3DTool.selectedModel3DIds,
      selectedPaperItems,
      quickImageUpload.handleQuickImageUploaded,
      getCameraSmartPosition,
      setSourceImageForEditing,
      showAIDialog,
    ]
  );

  const handleGroupCapture = useCallback(() => {
    if (selectedGroupBlocks.length > 0 && selectedGroupImageIds.length > 0) {
      try {
        handleImageMultiSelect([
          ...new Set([
            ...(imageTool.selectedImageIds ?? []),
            ...selectedGroupImageIds,
          ]),
        ]);
      } catch {}
    }
    void executeGroupCapture({ sendToDialog: false });
  }, [
    executeGroupCapture,
    handleImageMultiSelect,
    imageTool.selectedImageIds,
    selectedGroupBlocks.length,
    selectedGroupImageIds,
  ]);

  const handleGroupImages = useCallback(() => {
    if (!canGroupImages) return;
    const imageIds = [...groupableImageIds];
    const { block, reason } = createImageGroupBlock(imageIds);

    if (!block) {
      const message =
        reason === "different-layers"
          ? "当前选中的图片不在同一图层，无法组合"
          : reason === "missing-images"
          ? "部分图片未找到，无法组合"
          : "组合失败，请重试";
      window.dispatchEvent(
        new CustomEvent("toast", { detail: { message, type: "error" } })
      );
      return;
    }

    try {
      selectionTool.clearAllSelections();
    } catch {}

    // 合并模式：如果这次组合包含旧的组块，移除它们（避免嵌套/重复组块）
    try {
      selectedGroupBlocks.forEach((old) => {
        // 先删除标题
        const groupId = (old.data as any)?.groupId;
        if (groupId) {
          try {
            removeGroupBlockTitle(groupId);
          } catch {}
        }
        try {
          old.remove();
        } catch {}
      });
    } catch {}

    try {
      block.selected = false;
      block.fullySelected = false;
    } catch {}

    try {
      selectionTool.setSelectedPath(block);
      selectionTool.setSelectedPaths([]);
    } catch {}

    try {
      paper.view.update();
    } catch {}
    historyService.commit("group-images").catch(() => {});
    try {
      paperSaveService.triggerAutoSave("group-images");
    } catch {}
  }, [canGroupImages, groupableImageIds, selectedGroupBlocks, selectionTool]);

  const handleUngroupImages = useCallback(() => {
    if (!selectedGroupBlocks.length) return;
    try {
      const blocks = [...selectedGroupBlocks];
      selectionTool.clearAllSelections();
      blocks.forEach((block) => {
        // 先删除标题
        const groupId = (block.data as any)?.groupId;
        if (groupId) {
          try {
            removeGroupBlockTitle(groupId);
          } catch {}
        }
        try {
          block.remove();
        } catch {}
      });
      try {
        paper.view.update();
      } catch {}
      historyService.commit("ungroup-images").catch(() => {});
      try {
        paperSaveService.triggerAutoSave("ungroup-images");
      } catch {}
    } catch {}
  }, [selectedGroupBlocks, selectionTool]);

  const handleModelCapture = useCallback(
    async (modelId: string) => {
      let abort = false;
      setModelCapturePending((prev) => {
        if (prev[modelId]) {
          abort = true;
          return prev;
        }
        return { ...prev, [modelId]: true };
      });
      if (abort) return;

      const targetModel = model3DTool.model3DInstances.find(
        (model) => model.id === modelId
      );
      if (!targetModel) {
        setModelCapturePending((prev) => {
          const next = { ...prev };
          delete next[modelId];
          return next;
        });
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message: "未找到对应的3D模型", type: "error" },
          })
        );
        return;
      }

      try {
        const selection = {
          paperItems: [] as paper.Item[],
          imageIds: [] as string[],
          modelIds: [modelId],
        };
        const result = await AutoScreenshotService.captureAutoScreenshot(
          imageTool.imageInstances,
          model3DTool.model3DInstances,
          {
            format: "png",
            includeBackground: false,
            autoDownload: false,
            selection,
          }
        );

        if (result.success && result.dataUrl) {
          const captureBounds = result.bounds ?? targetModel.bounds;
          const boundsPayload = {
            x: captureBounds.x,
            y: captureBounds.y,
            width: captureBounds.width,
            height: captureBounds.height,
          };
          const fileName = `model-${Date.now()}.png`;
          const smartPosition = getCameraSmartPosition(boundsPayload);

          if (quickImageUpload.handleQuickImageUploaded) {
            await quickImageUpload.handleQuickImageUploaded(
              result.dataUrl,
              fileName,
              boundsPayload,
              smartPosition,
              "camera"
            );
          } else {
            window.dispatchEvent(
              new CustomEvent("triggerQuickImageUpload", {
                detail: {
                  imageData: result.dataUrl,
                  fileName,
                  selectedImageBounds: boundsPayload,
                  smartPosition,
                  operationType: "camera",
                },
              })
            );
          }

          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message: "已生成3D截图", type: "success" },
            })
          );
        } else {
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: {
                message: result.error || "截图失败，请重试",
                type: "error",
              },
            })
          );
        }
      } catch (error) {
        console.error("3D capture failed:", error);
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message: "截图失败，请重试", type: "error" },
          })
        );
      } finally {
        setModelCapturePending((prev) => {
          const next = { ...prev };
          delete next[modelId];
          return next;
        });
      }
    },
    [
      imageTool.imageInstances,
      model3DTool.model3DInstances,
      quickImageUpload.handleQuickImageUploaded,
      getCameraSmartPosition,
    ]
  );

  const handleModelSelectFromOverlay = useCallback(
    (modelId: string, addToSelection: boolean = false) => {
      if (!addToSelection) {
        clearSelections();
      }
      model3DTool.handleModel3DSelect(modelId, addToSelection);
    },
    [clearSelections, model3DTool]
  );

  // ========== 初始化交互控制器Hook ==========
  useInteractionController({
    canvasRef,
    drawMode,
    zoom,
    selectionTool,
    pathEditor,
    drawingTools,
    imageTool,
    model3DTool,
    simpleTextTool,
    performErase: eraserTool.performErase,
    setDrawMode,
    isEraser,
    snapAlignment,
  });

  const collectCanvasClipboardData =
    useCallback((): CanvasClipboardData | null => {
      const selectedImageIdsSet = new Set<string>(
        (imageTool.selectedImageIds && imageTool.selectedImageIds.length > 0
          ? imageTool.selectedImageIds
          : imageTool.imageInstances
              .filter((img) => img.isSelected)
              .map((img) => img.id)) ?? []
      );
      const imageSnapshots: ImageAssetSnapshot[] = imageTool.imageInstances
        .filter((img) => selectedImageIdsSet.has(img.id))
        .map((img) => {
          const source =
            img.imageData.localDataUrl ||
            img.imageData.src ||
            img.imageData.url;
          if (!source) {
            console.warn("图片缺少可复制的资源，已跳过", img.id);
            return null;
          }
          return {
            id: img.id,
            url: img.imageData.url || source,
            src: img.imageData.src || source,
            key: img.imageData.key,
            fileName: img.imageData.fileName,
            width: img.imageData.width ?? img.bounds.width,
            height: img.imageData.height ?? img.bounds.height,
            contentType: img.imageData.contentType,
            pendingUpload: img.imageData.pendingUpload,
            localDataUrl: img.imageData.localDataUrl,
            bounds: { ...img.bounds },
            layerId: img.layerId ?? null,
          } as ImageAssetSnapshot;
        })
        .filter(
          (snapshot): snapshot is ImageAssetSnapshot => snapshot !== null
        );

      const selectedModelIdsSet = new Set<string>(
        (model3DTool.selectedModel3DIds &&
        model3DTool.selectedModel3DIds.length > 0
          ? model3DTool.selectedModel3DIds
          : model3DTool.model3DInstances
              .filter((model) => model.isSelected)
              .map((model) => model.id)) ?? []
      );
      const modelSnapshots: ModelAssetSnapshot[] = model3DTool.model3DInstances
        .filter((model) => selectedModelIdsSet.has(model.id))
        .map((model) => ({
          id: model.id,
          url: model.modelData.url,
          key: model.modelData.key,
          format: model.modelData.format,
          fileName: model.modelData.fileName,
          fileSize: model.modelData.fileSize,
          defaultScale: model.modelData.defaultScale,
          defaultRotation: model.modelData.defaultRotation,
          timestamp: model.modelData.timestamp,
          path: model.modelData.path ?? model.modelData.url,
          bounds: { ...model.bounds },
          layerId: model.layerId ?? null,
        }));

      const pathSet = new Set<paper.Path>();
      if (selectionTool.selectedPath) pathSet.add(selectionTool.selectedPath);
      if (Array.isArray(selectionTool.selectedPaths)) {
        selectionTool.selectedPaths.forEach((p) => {
          if (p) pathSet.add(p);
        });
      }
      try {
        const selected = Array.isArray(paper.project?.selectedItems)
          ? paper.project!.selectedItems
          : [];
        selected
          .filter((item): item is paper.Path => item instanceof paper.Path)
          .forEach((path) => pathSet.add(path));
      } catch {
        // ignore
      }
      const pathSnapshots: PathClipboardSnapshot[] = Array.from(pathSet)
        .filter(
          (path) =>
            !!path && path.isInserted() && !(path.data && path.data.isHelper)
        )
        .map((path) => ({
          json: path.exportJSON({ asString: true }),
          layerName: path.layer?.name,
          position: { x: path.position.x, y: path.position.y },
          strokeWidth: path.data?.originalStrokeWidth ?? path.strokeWidth,
          strokeColor: path.strokeColor
            ? path.strokeColor.toCSS(true)
            : undefined,
          fillColor: path.fillColor ? path.fillColor.toCSS(true) : undefined,
        }));
      logger.debug("准备复制的路径数量:", pathSnapshots.length, {
        setSize: pathSet.size,
      });

      const textSnapshots: TextAssetSnapshot[] = (
        simpleTextTool.textItems || []
      )
        .filter((item) => item.isSelected)
        .map((item) => ({
          id: item.id,
          content: item.paperText.content ?? "",
          position: {
            x: item.paperText.position.x,
            y: item.paperText.position.y,
          },
          style: { ...item.style },
          layerId: item.paperText.layer?.name ?? null,
        }));

      const selectedVideoIdsSet = new Set<string>(
        (videoTool.selectedVideoIds && videoTool.selectedVideoIds.length > 0
          ? videoTool.selectedVideoIds
          : videoTool.videoInstances
              .filter((video) => video.isSelected)
              .map((video) => video.id)) ?? []
      );
      const videoSnapshots: VideoAssetSnapshot[] = videoTool.videoInstances
        .filter((video) => selectedVideoIdsSet.has(video.id))
        .map((video) => {
          if (!video.videoData.url) {
            console.warn("视频缺少可复制的资源，已跳过", video.id);
            return null;
          }
          return {
            id: video.id,
            url: video.videoData.url,
            thumbnail: video.videoData.thumbnail,
            duration: video.videoData.duration,
            width: video.videoData.width ?? video.bounds.width,
            height: video.videoData.height ?? video.bounds.height,
            fileName: video.videoData.fileName,
            contentType: video.videoData.contentType,
            taskId: video.videoData.taskId,
            status: video.videoData.status,
            bounds: { ...video.bounds },
            layerId: video.layerId ?? null,
          } as VideoAssetSnapshot;
        })
        .filter(
          (snapshot): snapshot is VideoAssetSnapshot => snapshot !== null
        );

      const hasAny =
        imageSnapshots.length > 0 ||
        modelSnapshots.length > 0 ||
        pathSnapshots.length > 0 ||
        textSnapshots.length > 0 ||
        videoSnapshots.length > 0;

      if (!hasAny) return null;

      return {
        images: imageSnapshots,
        models: modelSnapshots,
        texts: textSnapshots,
        videos: videoSnapshots,
        paths: pathSnapshots,
      };
    }, [
      imageTool.imageInstances,
      imageTool.selectedImageIds,
      model3DTool.model3DInstances,
      model3DTool.selectedModel3DIds,
      videoTool.videoInstances,
      videoTool.selectedVideoIds,
      selectionTool.selectedPath,
      selectionTool.selectedPaths,
      simpleTextTool.textItems,
    ]);

  const handleCanvasCopy = useCallback(() => {
    const payload = collectCanvasClipboardData();
    if (!payload) {
      logger.debug("复制失败：未找到可复制的画布对象");
      return false;
    }
    clipboardService.setCanvasData(payload);
    logger.debug("画布内容已复制到剪贴板:", {
      images: payload.images.length,
      models: payload.models.length,
      texts: payload.texts.length,
      paths: payload.paths.length,
    });
    return true;
  }, [collectCanvasClipboardData]);

  const handleCanvasPaste = useCallback(() => {
    const payload = clipboardService.getCanvasData();
    if (!payload) return false;
    logger.debug("尝试从剪贴板粘贴画布内容:", {
      images: payload.images.length,
      models: payload.models.length,
      texts: payload.texts.length,
      paths: payload.paths.length,
    });

    const offset = { x: 32, y: 32 };

    clearAllSelections();
    deselectSimpleText();

    const newImageIds: string[] = [];
    payload.images.forEach((snapshot) => {
      const id = createImageFromSnapshot?.(snapshot, { offset });
      if (id) newImageIds.push(id);
    });

    const newModelIds: string[] = [];
    payload.models.forEach((snapshot) => {
      const id = createModel3DFromSnapshot?.(snapshot, { offset });
      if (id) newModelIds.push(id);
    });

    const newTextIds: string[] = [];
    payload.texts.forEach((snapshot) => {
      if (snapshot.layerId) {
        try {
          useLayerStore.getState().activateLayer(snapshot.layerId);
        } catch {}
      }
      const point = new paper.Point(
        snapshot.position.x + offset.x,
        snapshot.position.y + offset.y
      );
      const created = createSimpleText(point, snapshot.content, snapshot.style);
      if (created) {
        newTextIds.push(created.id);
        stopEditText();
      }
    });

    const newPaths: paper.Path[] = [];
    const offsetVector = new paper.Point(offset.x, offset.y);
    payload.paths.forEach((snapshot) => {
      try {
        const prevLayer = paper.project.activeLayer;
        if (snapshot.layerName) {
          const targetLayer = paper.project.layers.find(
            (layer) => layer.name === snapshot.layerName
          );
          if (targetLayer) targetLayer.activate();
          else drawingContext.ensureDrawingLayer();
        }
        if (!snapshot.layerName) {
          drawingContext.ensureDrawingLayer();
        }

        const imported = paper.project.importJSON(snapshot.json);
        const items = Array.isArray(imported) ? imported : [imported];
        items.forEach((item) => {
          if (!(item instanceof paper.Path)) {
            try {
              item.remove();
            } catch {}
            return;
          }

          paper.project.activeLayer.addChild(item);
          item.translate(offsetVector);
          item.visible = true;
          try {
            item.bringToFront();
          } catch {}

          const selectedBefore = item.selected;
          if (selectedBefore) {
            item.selected = false;
            item.fullySelected = false;
          }

          const strokeWidth =
            snapshot.strokeWidth ??
            item.data?.originalStrokeWidth ??
            item.strokeWidth ??
            1;
          item.strokeWidth = strokeWidth;
          item.data = {
            ...(item.data || {}),
            originalStrokeWidth: strokeWidth,
          };

          if (snapshot.strokeColor) {
            try {
              item.strokeColor = new paper.Color(snapshot.strokeColor);
            } catch {}
          }
          if (typeof snapshot.fillColor === "string") {
            try {
              item.fillColor = new paper.Color(snapshot.fillColor);
            } catch {}
          }

          if (selectedBefore) {
            item.selected = true;
            item.fullySelected = true;
          }

          newPaths.push(item);
          logger.debug("粘贴重建路径:", {
            layer: item.layer?.name,
            strokeWidth: item.strokeWidth,
            originalStrokeWidth: strokeWidth,
            bounds: item.bounds && {
              x: Math.round(item.bounds.x),
              y: Math.round(item.bounds.y),
              width: Math.round(item.bounds.width),
              height: Math.round(item.bounds.height),
            },
          });
        });

        if (prevLayer && prevLayer.isInserted()) {
          prevLayer.activate();
        }
      } catch (error) {
        console.warn("粘贴路径失败:", error);
      }
    });

    const hasNew =
      newImageIds.length > 0 ||
      newModelIds.length > 0 ||
      newPaths.length > 0 ||
      newTextIds.length > 0;

    if (!hasNew) {
      logger.debug("粘贴失败：剪贴板数据为空或无法重建对象");
      return false;
    }

    logger.debug("粘贴创建的对象数量:", {
      images: newImageIds.length,
      models: newModelIds.length,
      paths: newPaths.length,
      texts: newTextIds.length,
    });

    if (
      newImageIds.length > 0 &&
      typeof handleImageMultiSelect === "function"
    ) {
      handleImageMultiSelect(newImageIds);
    } else {
      setSelectedImageIds([]);
    }

    if (
      newModelIds.length > 0 &&
      typeof handleModel3DMultiSelect === "function"
    ) {
      handleModel3DMultiSelect(newModelIds);
    } else {
      setSelectedModel3DIds([]);
    }

    if (newPaths.length > 0) {
      newPaths.forEach((path) => {
        try {
          path.selected = true;
          path.fullySelected = true;
        } catch {}
        try {
          selectToolHandlePathSelect?.(path);
        } catch {}
      });
      setSelectedPaths?.(newPaths);
      setSelectedPath?.(newPaths[newPaths.length - 1]);
    } else {
      setSelectedPaths?.([]);
      setSelectedPath?.(null);
    }

    if (newTextIds.length > 0) {
      selectSimpleText(newTextIds[newTextIds.length - 1]);
    }

    try {
      paper.view.update();
    } catch {}
    try {
      historyService.commit("paste-canvas").catch(() => {});
    } catch {}
    try {
      paperSaveService.triggerAutoSave();
    } catch {}

    return true;
  }, [
    clearAllSelections,
    createImageFromSnapshot,
    createModel3DFromSnapshot,
    createSimpleText,
    deselectSimpleText,
    handleImageMultiSelect,
    handleModel3DMultiSelect,
    selectSimpleText,
    setSelectedImageIds,
    setSelectedModel3DIds,
    setSelectedPath,
    setSelectedPaths,
    stopEditText,
  ]);

  // 供粘贴事件处理器调用最新的粘贴逻辑
  handleCanvasPasteRef.current = handleCanvasPaste;

  const editingTextId = simpleTextTool.editingTextId;

  // 监听画布指针事件，标记当前剪贴板域为 canvas，避免 Flow 的快捷键拦截
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const target = event.target as Node | null;
      if (target && canvas.contains(target)) {
        clipboardService.setActiveZone("canvas");
      }
    };
    window.addEventListener("pointerdown", handlePointerDown, {
      capture: true,
    });
    return () =>
      window.removeEventListener("pointerdown", handlePointerDown, {
        capture: true,
      });
  }, [canvasRef]);

  // 在按下复制/粘贴快捷键前标记画布为激活区域，防止 Flow 层截获
  useEffect(() => {
    const handleKeyPreCapture = (event: KeyboardEvent) => {
      const key = event.key?.toLowerCase?.() || "";
      if ((key !== "c" && key !== "v") || !(event.metaKey || event.ctrlKey))
        return;
      if (!hasSelectionRef.current && !clipboardService.getCanvasData()) return;

      const path =
        typeof event.composedPath === "function" ? event.composedPath() : [];
      const canvas = canvasRef.current;
      const fromCanvas = !!canvas && path.includes(canvas);
      const fromFlowOverlay = path.some((el) => {
        return (
          el instanceof Element && el.classList?.contains("tanva-flow-overlay")
        );
      });
      if (!fromCanvas || fromFlowOverlay) {
        return; // 不在画布区域的快捷键，不强制切换到画布
      }

      clipboardService.setActiveZone("canvas");
    };
    window.addEventListener("keydown", handleKeyPreCapture, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyPreCapture, {
        capture: true,
      });
  }, []);

  // 复制事件：同步画布选择到系统剪贴板，避免默认粘贴落入外部内容
  useEffect(() => {
    const handleCopyEvent = (event: ClipboardEvent) => {
      try {
        const active = document.activeElement as Element | null;
        if (isEditableElement(active) || editingTextId) return;

        // 若当前剪贴板激活区为 Flow，且事件不是从画布冒泡上来，则让 Flow 处理
        const path =
          typeof event.composedPath === "function" ? event.composedPath() : [];
        const canvas = canvasRef.current;
        const fromCanvas = !!canvas && path.includes(canvas);
        const zone = clipboardService.getZone();
        if (zone !== "canvas" && !fromCanvas) return;

        const handled = handleCanvasCopy();
        if (!handled) return;

        const payload = clipboardService.getCanvasData();
        if (!payload) return;

        const serialized = JSON.stringify({
          type: CANVAS_CLIPBOARD_TYPE,
          version: 1,
          data: payload,
        });

        if (event.clipboardData) {
          event.clipboardData.setData(CANVAS_CLIPBOARD_MIME, serialized);
          event.clipboardData.setData("application/json", serialized);
          event.clipboardData.setData(
            "text/plain",
            CANVAS_CLIPBOARD_FALLBACK_TEXT
          );
          event.preventDefault();
        } else if (
          typeof navigator !== "undefined" &&
          navigator.clipboard?.writeText
        ) {
          void navigator.clipboard.writeText(serialized).catch(() => {});
        }
      } catch (error) {
        logger.warn("复制画布到系统剪贴板失败", error);
      }
    };

    window.addEventListener("copy", handleCopyEvent);
    return () => window.removeEventListener("copy", handleCopyEvent);
  }, [handleCanvasCopy, editingTextId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // ⚪ DEBUG日志已关闭 - 键盘事件频繁，不需要每次都打印
      // logger.debug('画布键盘事件', {
      //   key: event.key,
      //   ctrl: event.ctrlKey,
      //   meta: event.metaKey,
      //   defaultPrevented: event.defaultPrevented,
      // });
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

      if (isEditable || editingTextId) return;

      const path =
        typeof event.composedPath === "function" ? event.composedPath() : [];
      const canvas = canvasRef.current;
      const fromCanvas = !!canvas && path.includes(canvas);
      const zone = clipboardService.getZone();

      if (isCopy) {
        if (zone !== "canvas" && !fromCanvas) return;
        const handled = handleCanvasCopy();
        if (handled) {
          // 继续让浏览器触发原生 copy 事件以写入系统剪贴板
        }
        return;
      }

      if (isPaste) {
        if (zone !== "canvas" && !fromCanvas) return;
        // 交由原生 paste 事件处理（可读取系统剪贴板内容），避免内存剪贴板抢占外部粘贴
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleCanvasCopy, handleCanvasPaste, editingTextId]);

  // ========== 图元顺序调整处理 ==========
  const adjustItemOrderWithinLayer = useCallback(
    (
      itemType: "image" | "3d-model",
      targetId: string,
      direction: "up" | "down"
    ) => {
      try {
        if (!paper?.project) return;
        const idKey = itemType === "image" ? "imageId" : "modelId";
        const group = paper.project.layers.flatMap((layer) =>
          layer.children.filter(
            (child) =>
              child.data?.type === itemType && child.data?.[idKey] === targetId
          )
        )[0];

        if (!(group instanceof paper.Group) || !group.layer) {
          console.warn(`未找到可调整顺序的 ${itemType} 元素`, targetId);
          return;
        }

        const siblings = group.layer.children.filter(
          (child) => child.data?.type === itemType && child.data?.[idKey]
        );
        const currentIndex = siblings.indexOf(group);
        if (currentIndex === -1) return;

        if (direction === "up") {
          if (currentIndex >= siblings.length - 1) return;
          const nextItem = siblings[currentIndex + 1];
          group.insertAbove(nextItem);
        } else {
          if (currentIndex <= 0) return;
          const prevItem = siblings[currentIndex - 1];
          group.insertBelow(prevItem);
        }

        try {
          paper.view.update();
        } catch {}
        try {
          paperSaveService.triggerAutoSave("item-reorder");
        } catch {}
        try {
          historyService
            .commit(`${itemType}-${direction}-layer`)
            .catch(() => {});
        } catch {}
      } catch (error) {
        console.error("调整元素顺序失败:", error);
      }
    },
    []
  );

  const handleImageLayerMoveUp = useCallback(
    (imageId: string) => {
      adjustItemOrderWithinLayer("image", imageId, "up");
    },
    [adjustItemOrderWithinLayer]
  );

  const handleImageLayerMoveDown = useCallback(
    (imageId: string) => {
      adjustItemOrderWithinLayer("image", imageId, "down");
    },
    [adjustItemOrderWithinLayer]
  );

  const handleModelLayerMoveUp = useCallback(
    (modelId: string) => {
      adjustItemOrderWithinLayer("3d-model", modelId, "up");
    },
    [adjustItemOrderWithinLayer]
  );

  const handleModelLayerMoveDown = useCallback(
    (modelId: string) => {
      adjustItemOrderWithinLayer("3d-model", modelId, "down");
    },
    [adjustItemOrderWithinLayer]
  );

  // 处理图片图层可见性切换
  const handleImageToggleVisibility = useCallback(
    (imageId: string) => {
      try {
        // 找到对应的Paper.js图层组
        const imageGroup = paper.project.layers.flatMap((layer) =>
          layer.children.filter(
            (child) =>
              child.data?.type === "image" && child.data?.imageId === imageId
          )
        )[0];

        if (imageGroup instanceof paper.Group) {
          // 获取图片所在的图层
          const currentLayer = imageGroup.layer;
          if (currentLayer) {
            // 从图层名称获取图层store ID (layer_${id} -> id)
            const layerStoreId = currentLayer.name.replace("layer_", "");

            // 调用图层store的切换可见性函数
            toggleVisibility(layerStoreId);

            logger.debug(
              `👁️ 切换图层可见性: ${currentLayer.name} (storeId: ${layerStoreId})`
            );
          } else {
            console.warn("图片没有关联的图层");
          }
        } else {
          console.warn("未找到对应的图片图层组");
        }
      } catch (error) {
        console.error("切换图层可见性失败:", error);
      }
    },
    [toggleVisibility]
  );

  const handleDownloadImage = useCallback(
    async (imageId: string) => {
      try {
        const instance = imageTool.imageInstances.find(
          (img) => img.id === imageId
        );
        if (!instance) {
          console.warn("下载失败：未找到图片实例", imageId);
          return;
        }

        let dataUrl: string | null = null;
        if (typeof imageTool.getImageDataForEditing === "function") {
          try {
            dataUrl = imageTool.getImageDataForEditing(imageId);
          } catch (error) {
            console.warn("获取高质量图片数据失败，尝试备用地址", error);
          }
        }

        if (!dataUrl) {
          dataUrl =
            instance.imageData?.localDataUrl ||
            instance.imageData?.src ||
            instance.imageData?.url ||
            null;
        }

        if (!dataUrl) {
          console.warn("下载失败：缺少可用的图片数据", imageId);
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message: "无法获取图像数据，下载失败", type: "error" },
            })
          );
          return;
        }

        const fileName = getSuggestedFileName(
          instance.imageData?.fileName,
          "image"
        );
        downloadImage(dataUrl, fileName);
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message: "已开始下载图片", type: "success" },
          })
        );
      } catch (error) {
        console.error("下载图片失败:", error);
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message: "下载失败，请稍后再试", type: "error" },
          })
        );
      }
    },
    [imageTool.imageInstances, imageTool.getImageDataForEditing]
  );

  // 添加选中的路径到个人库（转换为SVG）
  const addAsset = usePersonalLibraryStore((state) => state.addAsset);

  const handleAddImageToLibrary = useCallback(
    async (imageId: string) => {
      const instance = imageTool.imageInstances.find(
        (img) => img.id === imageId
      );
      if (!instance) {
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message: "未找到图像，无法添加到库", type: "error" },
          })
        );
        return;
      }

      const source = extractAnyImageSource(instance.imageData);
      if (!source) {
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: {
              message: "无法获取图像数据，无法添加到库",
              type: "error",
            },
          })
        );
        return;
      }

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
          let credentials: RequestCredentials | undefined;
	          if (isRemoteUrl(source)) {
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
            auth: 'omit',
            allowRefresh: false,
          });
          if (response.ok) {
            const blob = await responseToBlob(response);
            const fileName = normalizeImageFileName(
              instance.imageData?.fileName,
              blob.type || instance.imageData?.contentType
            );
            const file = new File([blob], fileName, {
              type: blob.type || instance.imageData?.contentType || "image/png",
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
        } catch (error) {
          logger.debug("图片发送到库：上传失败，尝试降级为直接引用URL", error);
        }

	        // 兜底：上传失败时，若已有远程 URL，直接用原 URL
	        const finalUrl =
	          uploadedUrl ||
	          (isPersistableImageRef(normalizePersistableImageRef(source)) ? source : null);
        if (!finalUrl) {
          throw new Error("无法获得可持久化的图像地址");
        }

        const assetId = createPersonalAssetId("pl2d");
        const now = Date.now();
        const fileName = normalizeImageFileName(
          uploadedMeta?.fileName || instance.imageData?.fileName,
          uploadedMeta?.contentType || instance.imageData?.contentType
        );
        const imageAsset: PersonalImageAsset = {
          id: assetId,
          type: "2d",
          name: fileName.replace(/\.[^/.]+$/, "") || "未命名图片",
          url: finalUrl,
          thumbnail: finalUrl,
          width: uploadedMeta?.width ?? instance.imageData?.width,
          height: uploadedMeta?.height ?? instance.imageData?.height,
          fileName,
          fileSize,
          contentType:
            uploadedMeta?.contentType ?? instance.imageData?.contentType,
          createdAt: now,
          updatedAt: now,
        };

        addAsset(imageAsset);
        void personalLibraryApi.upsert(imageAsset).catch((error) => {
          console.warn("[PersonalLibrary] 同步图片资源到后端失败:", error);
        });

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
    },
    [addAsset, imageTool.imageInstances]
  );

  const handleAddPathsToLibrary = useCallback(async () => {
    // 收集所有选中的路径
    const pathsToExport: paper.Path[] = [];
    if (selectionTool.selectedPath) {
      pathsToExport.push(selectionTool.selectedPath);
    }
    if (Array.isArray(selectionTool.selectedPaths)) {
      selectionTool.selectedPaths.forEach((path) => {
        if (path && !pathsToExport.includes(path)) {
          pathsToExport.push(path);
        }
      });
    }

    if (pathsToExport.length === 0) {
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: { message: "没有选中的线条路径", type: "warning" },
        })
      );
      return;
    }

    try {
      // 计算所有路径的边界
      let combinedBounds: paper.Rectangle | null = null;
      for (const path of pathsToExport) {
        if (path.bounds) {
          if (!combinedBounds) {
            combinedBounds = path.bounds.clone();
          } else {
            combinedBounds = combinedBounds.unite(path.bounds);
          }
        }
      }

      if (!combinedBounds) {
        throw new Error("无法计算路径边界");
      }

      // 添加一些padding
      const padding = 10;
      const width = Math.ceil(combinedBounds.width + padding * 2);
      const height = Math.ceil(combinedBounds.height + padding * 2);
      const offsetX = combinedBounds.x - padding;
      const offsetY = combinedBounds.y - padding;

      // 生成SVG内容
      const svgPaths = pathsToExport
        .map((path) => {
          // 克隆路径并调整位置
          const clonedPath = path.clone({ insert: false });
          clonedPath.translate(new paper.Point(-offsetX, -offsetY));

          // 获取路径的SVG表示
          const pathData = clonedPath.pathData;
          const strokeColor = path.strokeColor
            ? path.strokeColor.toCSS(true)
            : "#000000";
          const strokeWidth =
            path.data?.originalStrokeWidth ?? path.strokeWidth ?? 2;
          const fillColor = path.fillColor
            ? path.fillColor.toCSS(true)
            : "none";

          clonedPath.remove();

          return `<path d="${pathData}" stroke="${strokeColor}" stroke-width="${strokeWidth}" fill="${fillColor}" stroke-linecap="round" stroke-linejoin="round"/>`;
        })
        .join("\n  ");

      const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${svgPaths}
</svg>`;

      // 将SVG转换为Blob并上传
      const svgBlob = new Blob([svgContent], { type: "image/svg+xml" });
      const svgFile = new File([svgBlob], `path_${Date.now()}.svg`, {
        type: "image/svg+xml",
      });

      // 上传SVG文件
      const uploadResult = await imageUploadService.uploadImageFile(svgFile, {
        dir: "uploads/personal-library/svg/",
      });

      if (!uploadResult.success || !uploadResult.asset) {
        throw new Error(uploadResult.error || "SVG上传失败");
      }

      // 创建个人库资产
      const assetId = createPersonalAssetId("plsvg");
      const now = Date.now();
      const svgAsset: PersonalSvgAsset = {
        id: assetId,
        type: "svg",
        name: `线条 ${new Date().toLocaleString("zh-CN", {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })}`,
        url: uploadResult.asset.url,
        thumbnail: uploadResult.asset.url,
        fileName: svgFile.name,
        fileSize: svgFile.size,
        contentType: "image/svg+xml",
        width,
        height,
        svgContent,
        createdAt: now,
        updatedAt: now,
      };

      // 添加到本地store
      addAsset(svgAsset);

      // 同步到后端
      void personalLibraryApi.upsert(svgAsset).catch((error) => {
        console.warn("[PersonalLibrary] 同步SVG资源到后端失败:", error);
      });

      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: { message: "已添加到个人库", type: "success" },
        })
      );

      logger.debug("SVG已添加到个人库:", {
        assetId,
        width,
        height,
        pathCount: pathsToExport.length,
      });
    } catch (error) {
      console.error("添加到库失败:", error);
      window.dispatchEvent(
        new CustomEvent("toast", {
          detail: { message: "添加到库失败，请重试", type: "error" },
        })
      );
    }
  }, [selectionTool.selectedPath, selectionTool.selectedPaths, addAsset]);

  // 监听从画布 Alt/Option 拖拽路径到库面板的事件
  useEffect(() => {
    const handleAddSelectedPathsToLibrary = () => {
      void handleAddPathsToLibrary();
    };
    window.addEventListener(
      "canvas:add-selected-paths-to-library",
      handleAddSelectedPathsToLibrary as EventListener
    );
    return () => {
      window.removeEventListener(
        "canvas:add-selected-paths-to-library",
        handleAddSelectedPathsToLibrary as EventListener
      );
    };
  }, [handleAddPathsToLibrary]);

  const resolveContextTarget = useCallback(
    (event: MouseEvent): HitTestTarget => {
      const canvas = canvasRef.current;
      if (!canvas || !paper?.project) return null;

      const projectPoint = clientToProject(
        canvas,
        event.clientX,
        event.clientY
      );
      const zoomValue = Math.max(zoomRef.current || 1, 0.01);
      const tolerance = 6 / zoomValue;

      let hitResult: paper.HitResult | null = null;
      try {
        hitResult = paper.project.hitTest(projectPoint, {
          segments: true,
          stroke: true,
          fill: true,
          bounds: true,
          tolerance,
          handles: false,
        });
      } catch {
        hitResult = null;
      }

      if (!hitResult?.item) return null;

      let current: paper.Item | null = hitResult.item;
      while (current) {
        const data = current.data || {};

        // 检查是否在占位框内部（占位框的子元素不应该被单独选中）
        // 🔥 使用 placeholderGroupId 而不是 placeholderGroup 引用
        if (data.placeholderGroupId || data.placeholderType) {
          // 这是占位框的子元素，不应该被选中
          return null;
        }

        if (data.isHelper || data.isSelectionHelper || data.isResizeHandle) {
          current = current.parent;
          continue;
        }
        if (
          data.type === "image-placeholder" ||
          data.type === "3d-model-placeholder" ||
          data.type === "selection-box"
        ) {
          current = current.parent;
          continue;
        }
        if (
          (data.type === "image-selection-area" ||
            data.type === "3d-model-selection-area") &&
          current.parent
        ) {
          current = current.parent;
          continue;
        }

        if (data.type === "image" && data.imageId) {
          return { type: "image", id: data.imageId };
        }
        if (data.type === "3d-model" && data.modelId) {
          return { type: "model3d", id: data.modelId };
        }
        if (data.type === "text" && data.textId) {
          return { type: "text", id: data.textId };
        }
        if (current instanceof paper.PointText) {
          const textId = data.textId || current.data?.textId;
          return { type: "text", id: textId };
        }
        if (current instanceof paper.Path && !data.isHelper) {
          const layerName = current.layer?.name;
          if (layerName === "grid" || layerName === "background") {
            current = current.parent;
            continue;
          }
          return { type: "path", path: current };
        }

        current = current.parent;
      }

      return null;
    },
    [canvasRef]
  );

  const ensureSelectionForTarget = useCallback(
    (target: HitTestTarget) => {
      if (!target) return;

      if (target.type === "image" && target.id) {
        const alreadySelected = selectionSnapshotRef.current.imageIds.includes(
          target.id
        );
        if (!alreadySelected) {
          clearSelections();
          deselectSimpleText();
          imageTool.handleImageSelect(target.id);
        }
        return;
      }

      if (target.type === "model3d" && target.id) {
        const alreadySelected = selectionSnapshotRef.current.modelIds.includes(
          target.id
        );
        if (!alreadySelected) {
          clearSelections();
          deselectSimpleText();
          model3DTool.handleModel3DSelect(target.id);
        }
        return;
      }

      if (target.type === "text" && target.id) {
        if (selectionSnapshotRef.current.textId !== target.id) {
          clearSelections();
          selectSimpleText(target.id);
        }
        return;
      }

      if (target.type === "path") {
        const alreadySelected = selectionSnapshotRef.current.paths.some(
          (path) => path === target.path
        );
        if (!alreadySelected) {
          clearSelections();
          deselectSimpleText();
          selectToolHandlePathSelect(target.path);
          setSelectedPath(target.path);
          setSelectedPaths([target.path]);
        }
      }
    },
    [
      clearSelections,
      deselectSimpleText,
      imageTool.handleImageSelect,
      model3DTool.handleModel3DSelect,
      selectSimpleText,
      selectToolHandlePathSelect,
      setSelectedPath,
      setSelectedPaths,
    ]
  );

  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;

    const handleContextMenu = (event: MouseEvent) => {
      const target = resolveContextTarget(event);
      if (target) {
        ensureSelectionForTarget(target);
        setContextMenuState({
          x: event.clientX,
          y: event.clientY,
          type: target.type as ContextMenuTargetType,
          targetId: "id" in target ? target.id : undefined,
        });
      } else {
        const fallbackType: ContextMenuTargetType = hasSelectionRef.current
          ? "selection"
          : "canvas";
        setContextMenuState({
          x: event.clientX,
          y: event.clientY,
          type: fallbackType,
        });
      }
      event.preventDefault();
      event.stopPropagation();
    };

    canvasElement.addEventListener("contextmenu", handleContextMenu);
    return () => {
      canvasElement.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [canvasRef, ensureSelectionForTarget, resolveContextTarget]);

  const handleDeleteSelection = useCallback(() => {
    let didDelete = false;

    const pathTargets: paper.Path[] = [];
    if (selectionTool.selectedPath)
      pathTargets.push(selectionTool.selectedPath);
    if (Array.isArray(selectionTool.selectedPaths)) {
      selectionTool.selectedPaths.forEach((path) => {
        if (path && !pathTargets.includes(path)) {
          pathTargets.push(path);
        }
      });
    }

    if (pathTargets.length > 0) {
      const removedPlaceholders = new Set<paper.Group>();
      pathTargets.forEach((path) => {
        // 🔥 不再使用 placeholderGroup 引用，改为向上查找占位符组
        let foundPlaceholderGroup: paper.Group | undefined;
        let node: any = path;
        while (node) {
          // 检查是否有 placeholderGroupId（新方式）或直接是占位符类型
          if (
            node.data?.type === "image-placeholder" ||
            node.data?.type === "3d-model-placeholder"
          ) {
            foundPlaceholderGroup = node as paper.Group;
            break;
          }
          node = node.parent;
        }

        const target: paper.Item = foundPlaceholderGroup || path;
        if (foundPlaceholderGroup) {
          if (!removedPlaceholders.has(foundPlaceholderGroup)) {
            try {
              // 确保删除整个占位框组及其所有子元素
              foundPlaceholderGroup.remove();
              didDelete = true;
            } catch {}
            removedPlaceholders.add(foundPlaceholderGroup);
          }
        } else {
          try {
            target.remove();
            didDelete = true;
          } catch {}
        }
      });
      setSelectedPaths([]);
      setSelectedPath(null);
    }

    if (
      (imageTool.selectedImageIds?.length ?? 0) > 0 &&
      typeof imageTool.handleImageDelete === "function"
    ) {
      imageTool.selectedImageIds!.forEach((id) => {
        try {
          imageTool.handleImageDelete?.(id);
          didDelete = true;
        } catch {}
      });
    }

    if (
      (model3DTool.selectedModel3DIds?.length ?? 0) > 0 &&
      typeof model3DTool.handleModel3DDelete === "function"
    ) {
      model3DTool.selectedModel3DIds!.forEach((id) => {
        try {
          model3DTool.handleModel3DDelete?.(id);
          didDelete = true;
        } catch {}
      });
    }

    if (simpleTextTool.selectedTextId) {
      deleteSimpleText(simpleTextTool.selectedTextId);
      didDelete = true;
    }

    // 删除选中的图片占位框
    if (imageTool.selectedPlaceholderId) {
      try {
        imageTool.deletePlaceholder?.(imageTool.selectedPlaceholderId);
        didDelete = true;
      } catch {}
    }

    // 删除选中的3D模型占位框
    if (model3DTool.selectedPlaceholderId) {
      try {
        model3DTool.deletePlaceholder?.(model3DTool.selectedPlaceholderId);
        didDelete = true;
      } catch {}
    }

    if (didDelete) {
      try {
        paper.view.update();
      } catch {}
      try {
        historyService.commit("delete-selection-contextmenu").catch(() => {});
      } catch {}
      clearSelections();
      deselectSimpleText();
    }
  }, [
    clearSelections,
    deleteSimpleText,
    deselectSimpleText,
    imageTool.handleImageDelete,
    imageTool.selectedImageIds,
    imageTool.selectedPlaceholderId,
    imageTool.deletePlaceholder,
    model3DTool.handleModel3DDelete,
    model3DTool.selectedModel3DIds,
    model3DTool.selectedPlaceholderId,
    model3DTool.deletePlaceholder,
    selectionTool.selectedPath,
    selectionTool.selectedPaths,
    setSelectedPath,
    setSelectedPaths,
    simpleTextTool.selectedTextId,
  ]);

  const closeContextMenu = useCallback(() => setContextMenuState(null), []);

  const showToast = useCallback(
    (message: string, type: "success" | "error" = "success") => {
      try {
        window.dispatchEvent(
          new CustomEvent("toast", { detail: { message, type } })
        );
      } catch {
        if (type === "error") {
          console.error(message);
        } else {
          console.log(message);
        }
      }
    },
    []
  );

  const handleCopyCanvasJson = useCallback(async () => {
    try {
      await clipboardJsonService.copyProjectContentToClipboard();
      showToast("已复制画布 JSON");
    } catch (error) {
      console.error("复制画布 JSON 失败:", error);
      showToast("复制失败，请重试", "error");
    }
  }, [showToast]);

  const handleImportCanvasJson = useCallback(async () => {
    try {
      await clipboardJsonService.importProjectContentFromClipboard();
      showToast("已导入画布 JSON");
    } catch (error) {
      console.error("导入画布 JSON 失败:", error);
      showToast("导入失败，请检查剪贴板内容", "error");
    }
  }, [showToast]);

  const contextMenuItems = useMemo(() => {
    if (!contextMenuState) return [];

    const canCopy = hasSelection && contextMenuState.type !== "canvas";
    const canPaste = !!clipboardService.getCanvasData();

    const items: Array<{
      label: string;
      icon: React.ReactNode;
      onClick: () => void;
      disabled?: boolean;
    }> = [
      {
        label: "复制",
        icon: <Copy className='w-4 h-4' />,
        onClick: () => {
          handleCanvasCopy();
        },
        disabled: !canCopy,
      },
      {
        label: "粘贴",
        icon: <ClipboardPaste className='w-4 h-4' />,
        onClick: () => {
          handleCanvasPaste();
        },
        disabled: !canPaste,
      },
      {
        label: "复制画布 JSON",
        icon: <FileJson className='w-4 h-4' />,
        onClick: () => {
          void handleCopyCanvasJson().finally(() => closeContextMenu());
        },
      },
      {
        label: "导入画布 JSON",
        icon: <FileInput className='w-4 h-4' />,
        onClick: () => {
          void handleImportCanvasJson().finally(() => closeContextMenu());
        },
      },
    ];

    if (contextMenuState.type === "image" && contextMenuState.targetId) {
      const targetId = contextMenuState.targetId;
      items.push(
        {
          label: "下载图片",
          icon: <Download className='w-4 h-4' />,
          onClick: () => handleDownloadImage(targetId),
        },
        {
          label: "添加到库",
          icon: <FolderPlus className='w-4 h-4' />,
          onClick: () => {
            void handleAddImageToLibrary(targetId);
          },
        },
        {
          label: "上移一层",
          icon: <ArrowUp className='w-4 h-4' />,
          onClick: () => handleImageLayerMoveUp(targetId),
        },
        {
          label: "下移一层",
          icon: <ArrowDown className='w-4 h-4' />,
          onClick: () => handleImageLayerMoveDown(targetId),
        }
      );
    } else if (
      contextMenuState.type === "model3d" &&
      contextMenuState.targetId
    ) {
      const targetId = contextMenuState.targetId;
      items.push(
        {
          label: "上移一层",
          icon: <ArrowUp className='w-4 h-4' />,
          onClick: () => handleModelLayerMoveUp(targetId),
        },
        {
          label: "下移一层",
          icon: <ArrowDown className='w-4 h-4' />,
          onClick: () => handleModelLayerMoveDown(targetId),
        }
      );
    }

    // 当选中路径时，显示"添加到库"选项
    const hasSelectedPaths = !!(
      selectionTool.selectedPath ||
      (selectionTool.selectedPaths && selectionTool.selectedPaths.length > 0)
    );
    if (contextMenuState.type === "path" || hasSelectedPaths) {
      items.push({
        label: "添加到库",
        icon: <FolderPlus className='w-4 h-4' />,
        onClick: () => {
          void handleAddPathsToLibrary();
        },
        disabled: !hasSelectedPaths,
      });
    }

    items.push({
      label: "删除",
      icon: <Trash2 className='w-4 h-4' />,
      onClick: handleDeleteSelection,
      disabled: !hasSelection,
    });

    return items;
  }, [
    contextMenuState,
    handleCanvasCopy,
    handleCanvasPaste,
    handleCopyCanvasJson,
    handleImportCanvasJson,
    handleAddImageToLibrary,
    handleDeleteSelection,
    handleDownloadImage,
    handleImageLayerMoveDown,
    handleImageLayerMoveUp,
    handleModelLayerMoveDown,
    handleModelLayerMoveUp,
    handleAddPathsToLibrary,
    selectionTool.selectedPath,
    selectionTool.selectedPaths,
    hasSelection,
    closeContextMenu,
  ]);

  // 事件监听器/长生命周期回调使用稳定引用，避免依赖 tool 对象导致频繁解绑/重绑
  const dcSetImageInstances = imageTool.setImageInstances;
  const dcSetSelectedImageIds = imageTool.setSelectedImageIds;
  const dcHydrateImagesFromSnapshot = imageTool.hydrateFromSnapshot;
  const dcApplyImageBoundsFromSnapshot = imageTool.applyBoundsFromSnapshot;
  const dcSetModel3DInstances = model3DTool.setModel3DInstances;
  const dcSetSelectedModel3DIds = model3DTool.setSelectedModel3DIds;
  const dcHydrateModelsFromSnapshot = model3DTool.hydrateFromSnapshot;
  const dcClearAllTextItems = simpleTextTool.clearAllTextItems;
  const dcHydrateTextsFromSnapshot = simpleTextTool.hydrateFromSnapshot;
  const dcSetVideoInstances = videoTool.setVideoInstances;
  const dcSetSelectedVideoIds = videoTool.setSelectedVideoIds;
  const dcHydrateVideosFromSnapshot = videoTool.hydrateFromSnapshot;
  const dcHydrateTextsFromPaperItems = simpleTextTool.hydrateFromPaperItems;
  const dcClearAllSelections = selectionTool.clearAllSelections;

  // 同步图片和3D模型的可见性状态
  useEffect(() => {
    const syncVisibilityStates = () => {
      // 同步图片可见性
      dcSetImageInstances((prev) =>
        prev.map((image) => {
          const paperGroup = paper.project.layers.flatMap((layer) =>
            layer.children.filter(
              (child) =>
                child.data?.type === "image" && child.data?.imageId === image.id
            )
          )[0];

          if (paperGroup) {
            return { ...image, visible: paperGroup.visible };
          }
          return image;
        })
      );

      // 同步3D模型可见性
      dcSetModel3DInstances((prev) =>
        prev.map((model) => {
          const paperGroup = paper.project.layers.flatMap((layer) =>
            layer.children.filter(
              (child) =>
                child.data?.type === "3d-model" &&
                child.data?.modelId === model.id
            )
          )[0];

          if (paperGroup) {
            return { ...model, visible: paperGroup.visible };
          }
          return model;
        })
      );
    };

    // 监听图层可见性变化事件
    const handleVisibilitySync = () => {
      syncVisibilityStates();
    };

    window.addEventListener("layerVisibilityChanged", handleVisibilitySync);

    return () => {
      window.removeEventListener(
        "layerVisibilityChanged",
        handleVisibilitySync
      );
    };
  }, [dcSetImageInstances, dcSetModel3DInstances]);

  // 将图片和3D模型实例暴露给图层面板使用
  useEffect(() => {
    try {
      syncImageInstancesToWindow(imageTool.imageInstances);
    } catch {}
    try {
      (window as any).tanvaModel3DInstances = model3DTool.model3DInstances;
    } catch {}
    try {
      (window as any).tanvaTextItems = simpleTextTool.textItems;
    } catch {}
  }, [
    imageTool.imageInstances,
    model3DTool.model3DInstances,
    simpleTextTool.textItems,
  ]);

  // 组件卸载时清理全局引用，避免残留导致无法释放
  useEffect(() => {
    return () => {
      try {
        syncImageInstancesToWindow([]);
      } catch {}
      try {
        (window as any).tanvaModel3DInstances = [];
      } catch {}
      try {
        (window as any).tanvaTextItems = [];
      } catch {}
    };
  }, []);

  // 监听图层顺序变化并更新图像的layerId
  useEffect(() => {
    const updateImageLayerIds = () => {
      dcSetImageInstances((prev) =>
        prev.map((image) => {
          const imageGroup = paper.project?.layers?.flatMap((layer) =>
            layer.children.filter(
              (child) =>
                child.data?.type === "image" && child.data?.imageId === image.id
            )
          )[0];

          if (imageGroup && imageGroup.layer) {
            const layerName = imageGroup.layer.name;
            if (layerName && layerName.startsWith("layer_")) {
              const newLayerId = layerName.replace("layer_", "");
              if (newLayerId !== image.layerId) {
                return { ...image, layerId: newLayerId };
              }
            }
          }
          return image;
        })
      );
    };

    // 监听图层变化事件
    const handleLayerOrderChanged = () => {
      updateImageLayerIds();
    };

    window.addEventListener("layerOrderChanged", handleLayerOrderChanged);

    // 移除定期检查 - 使用事件驱动替代轮询，避免内存泄漏和性能问题
    // 原因：setInterval 会持续消耗资源，且 layerOrderChanged 事件已经能覆盖大部分场景

    return () => {
      window.removeEventListener("layerOrderChanged", handleLayerOrderChanged);
    };
  }, [dcSetImageInstances]);

  // 监听图层面板触发的实例更新事件
  useEffect(() => {
    // 处理图片实例更新
    const handleImageInstanceUpdate = (event: CustomEvent) => {
      const { imageId, layerId } = event.detail;
      logger.debug(
        `🔄 DrawingController收到图片实例更新事件: ${imageId} → 图层${layerId}`
      );

      dcSetImageInstances((prev) =>
        prev.map((image) => {
          if (image.id === imageId) {
            return {
              ...image,
              layerId: layerId,
              layerIndex: parseInt(layerId) || 0,
            };
          }
          return image;
        })
      );
    };

    // 处理3D模型实例更新
    const handleModel3DInstanceUpdate = (event: CustomEvent) => {
      const { modelId, layerId } = event.detail;
      logger.debug(
        `🔄 DrawingController收到3D模型实例更新事件: ${modelId} → 图层${layerId}`
      );

      dcSetModel3DInstances((prev) =>
        prev.map((model) => {
          if (model.id === modelId) {
            return {
              ...model,
              layerId: layerId,
              layerIndex: parseInt(layerId) || 0,
            };
          }
          return model;
        })
      );
    };

    // 添加事件监听器
    window.addEventListener(
      "imageInstanceUpdated",
      handleImageInstanceUpdate as EventListener
    );
    window.addEventListener(
      "model3DInstanceUpdated",
      handleModel3DInstanceUpdate as EventListener
    );

    return () => {
      window.removeEventListener(
        "imageInstanceUpdated",
        handleImageInstanceUpdate as EventListener
      );
      window.removeEventListener(
        "model3DInstanceUpdated",
        handleModel3DInstanceUpdate as EventListener
      );
    };
  }, [dcSetImageInstances, dcSetModel3DInstances]);

  // 历史恢复：清空实例并基于快照资产回填 UI 覆盖层
  useEffect(() => {
    const handler = (event: CustomEvent) => {
      try {
        const assets = event.detail?.assets;
        // 清空现有实例
        dcSetImageInstances([]);
        dcSetSelectedImageIds([]);
        dcSetModel3DInstances([]);
        dcSetSelectedModel3DIds([]);
        dcClearAllTextItems();
        dcSetVideoInstances([]);
        dcSetSelectedVideoIds([]);

        if (assets) {
          if (assets.images?.length) {
            dcHydrateImagesFromSnapshot(assets.images);
          }
          if (assets.models?.length) {
            dcHydrateModelsFromSnapshot(assets.models);
          }
          if (assets.texts?.length) {
            dcHydrateTextsFromSnapshot(assets.texts);
          }
          if (assets.videos?.length) {
            dcHydrateVideosFromSnapshot(assets.videos);
          }
        }
      } catch (e) {
        console.warn("历史恢复回填失败:", e);
      }
    };
    window.addEventListener("history-restore", handler as EventListener);
    return () =>
      window.removeEventListener("history-restore", handler as EventListener);
  }, [
    dcClearAllTextItems,
    dcHydrateImagesFromSnapshot,
    dcHydrateModelsFromSnapshot,
    dcHydrateTextsFromSnapshot,
    dcHydrateVideosFromSnapshot,
    dcSetImageInstances,
    dcSetModel3DInstances,
    dcSetVideoInstances,
    dcSetSelectedImageIds,
    dcSetSelectedModel3DIds,
    dcSetSelectedVideoIds,
  ]);

  // 从已反序列化的 Paper 项目重建图片、文字和3D模型实例
  useEffect(() => {
    const rebuildFromPaper = () => {
      try {
        if (!paper || !paper.project) return;

        logger.drawing("🔄 rebuildFromPaper 开始执行...");

        // 🔍 调试：检查 Raster 加载状态
        const rasterClass = (paper as any).Raster;
        const allRasters = rasterClass ? (paper.project as any).getItems?.({ class: rasterClass }) as any[] : [];
        const rasterCount = allRasters?.length || 0;
        const loadedCount = allRasters?.filter((r: any) => r?.bounds?.width > 0)?.length || 0;
        console.log(`🔍 [rebuildFromPaper] Raster 状态: 总数=${rasterCount}, 已加载=${loadedCount}, 未加载=${rasterCount - loadedCount}`);

        // 避免重复包裹 Raster.onLoad（多次 rebuild 可能导致链式闭包与内存增长）
        const ensureRasterRebuildOnLoad = (
          raster: any,
          callback: () => void
        ) => {
          if (!raster) return;
          const anyRaster = raster as any;
          anyRaster.__tanvaRebuildOnLoadCallback = callback;

          const existingWrapper = anyRaster.__tanvaRebuildOnLoadWrapper as any;
          const currentOnLoad = raster.onLoad;

          // 已安装 wrapper：只更新 callback，避免链式包裹
          if (existingWrapper && currentOnLoad === existingWrapper) {
            return;
          }

          // 记录/更新原始 onLoad（避免把 wrapper 自己当作 original）
          if (currentOnLoad && currentOnLoad !== existingWrapper) {
            anyRaster.__tanvaOriginalOnLoad = currentOnLoad;
          }

          const wrapper =
            existingWrapper ||
            function (this: any, ...args: any[]) {
              try {
                const cb = (this as any).__tanvaRebuildOnLoadCallback;
                if (typeof cb === "function") {
                  // 释放闭包引用，避免长期占用内存
                  (this as any).__tanvaRebuildOnLoadCallback = null;
                  cb();
                }
              } catch (err) {
                console.warn("Raster rebuild onLoad callback failed:", err);
              }

              try {
                const original = (this as any).__tanvaOriginalOnLoad;
                const selfWrapper = (this as any).__tanvaRebuildOnLoadWrapper;
                if (
                  typeof original === "function" &&
                  original !== selfWrapper
                ) {
                  original.apply(this, args);
                }
              } catch (err) {
                console.warn("Raster original onLoad failed:", err);
              }
            };

          anyRaster.__tanvaRebuildOnLoadWrapper = wrapper;
          raster.onLoad = wrapper;
        };

        // 🔥 修复：在重建前清理所有孤儿选择框和无效图片组
	        // 1. 清理所有没有 raster 的图片组（包括它们的选择框）
	        const validImageIdsForCleanup = new Set<string>();
	        const orphanGroups: paper.Group[] = [];
	        try {
	          const imageCandidates = (paper.project as any).getItems?.({
	            match: (item: any) => item?.data?.type === 'image' && item?.data?.imageId,
	          }) as paper.Item[] | undefined;

	          (imageCandidates || []).forEach((item) => {
	            // ⚠️ 只清理真正的 Group：Raster 自身也可能带有 data.type=image，但不能当作"图片组"删掉
	            if (!isGroup(item)) return;

	            const group = item as paper.Group;
	            const imageId = (group.data as any)?.imageId;

	            const hasRaster = (() => {
	              try {
	                const direct = (group.children || []).some((child) => isRaster(child));
	                if (direct) return true;
	              } catch {}
	              try {
	                const nested = (group as any).getItems?.({
	                  match: (child: any) => isRaster(child),
	                }) as paper.Item[] | undefined;
	                return Array.isArray(nested) && nested.length > 0;
	              } catch {
	                return false;
	              }
	            })();

	            if (hasRaster) {
	              if (typeof imageId === 'string' && imageId) {
	                validImageIdsForCleanup.add(imageId);
	              }
	              return;
	            }

	            orphanGroups.push(group);
	          });
	        } catch {}

	        // 删除所有孤儿图片组（保守：只删确认为 Group 且无 Raster 的情况）
	        orphanGroups.forEach((group) => {
	          try {
	            logger.drawing(`🗑️ 清理孤儿图片组: ${String((group.data as any)?.imageId || '')}`);
	            group.remove();
	          } catch (e) {
	            console.warn('清理孤儿图片组失败:', e);
	          }
	        });

	        // 2. 清理所有没有对应图片组的孤儿选择框元素
	        // 收集所有 Raster 的 imageId，避免误删（兼容 Raster 独立存在/嵌套在 Group 中的情况）
	        try {
	          const rasters = (paper.project as any).getItems?.({
	            match: (item: any) => isRaster(item) && (item?.data?.imageId || item?.parent?.data?.imageId),
	          }) as paper.Item[] | undefined;
	          (rasters || []).forEach((item: any) => {
	            const imageId = item?.data?.imageId || item?.parent?.data?.imageId;
	            if (typeof imageId === 'string' && imageId) {
	              validImageIdsForCleanup.add(imageId);
	            }
	          });
	        } catch {}

	        // 清理所有没有对应有效图片的选择框元素（全局扫描，避免漏掉嵌套结构）
	        try {
	          const selectionItems = (paper.project as any).getItems?.({
	            match: (item: any) => {
	              const data = item?.data || {};
	              const isSelectionElement =
	                data?.type === 'image-selection-area' ||
	                data?.isSelectionBorder ||
	                data?.isResizeHandle ||
	                data?.isImageHitRect;
	              if (!isSelectionElement) return false;
	              const imageId = data?.imageId;
	              return typeof imageId === 'string' && imageId && !validImageIdsForCleanup.has(imageId);
	            },
	          }) as paper.Item[] | undefined;

	          (selectionItems || []).forEach((item) => {
	            try {
	              const imageId = (item as any)?.data?.imageId;
	              logger.drawing(`🗑️ 清理孤儿选择框元素: ${String(imageId || '')}`);
	            } catch {}
	            try { item.remove(); } catch {}
	          });
	        } catch {}

	        // 3. 清理所有选择状态
	        dcClearAllSelections();

        const imageInstances: any[] = [];
        const textInstances: any[] = [];
        const model3DInstances: any[] = [];
        const seenImageGroupTitles = new Set<string>();
        const seenImageIds = new Set<string>(); // 🔥 防止重复添加同一个图片

        // 扫描所有图层
        (paper.project.layers || []).forEach((layer: any) => {
          logger.drawing(
            `🔍 扫描图层: ${layer?.name || "未命名"}, 子元素数量: ${
              layer?.children?.length || 0
            }`
          );
          const children = layer?.children || [];
          children.forEach((item: any) => {
            // 🔍 调试：输出每个元素的信息
            logger.drawing(
              `  📦 元素: className=${item?.className}, type=${item?.data?.type}, imageId=${item?.data?.imageId}`
            );

            // ========== 处理图片 ==========
            let imageGroup: any | null = null;
            if (item?.data?.type === "image" && item?.data?.imageId) {
              imageGroup = item;
              logger.drawing(
                `    ✅ 识别为图片组 (type=image): ${item?.data?.imageId}`
              );
            } else if (
              item?.className === "Raster" ||
              item instanceof (paper as any).Raster
            ) {
              // 兼容只有 Raster 的情况
              logger.drawing("    🖼️ 发现 Raster 元素");

              // 🔥 如果 Raster 已经有 imageId，说明它正在等待 onLoad 处理，跳过
              if (item?.data?.imageId) {
                logger.drawing(
                  `    ⏭️ Raster 已有 imageId，跳过: ${item.data.imageId}`
                );
                return;
              }

              imageGroup =
                item.parent && item.parent.className === "Group"
                  ? item.parent
                  : null;
              if (
                imageGroup &&
                !(imageGroup.data && imageGroup.data.type === "image")
              ) {
                // 为旧内容补上标记
                if (!imageGroup.data) imageGroup.data = {};
                imageGroup.data.type = "image";
                imageGroup.data.imageId = `img_${Date.now()}_${Math.random()
                  .toString(36)
                  .slice(2, 8)}`;
                logger.drawing(
                  `    ✅ 为 Raster 补充标记: ${imageGroup.data.imageId}`
                );
              }
            }

            if (imageGroup) {
              const raster = imageGroup.children.find(
                (c: any) =>
                  c.className === "Raster" || c instanceof (paper as any).Raster
              ) as paper.Raster | undefined;

              if (raster) {
                const ensuredImageId =
                  imageGroup.data?.imageId ||
                  (raster.data && raster.data.imageId) ||
                  `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

                // 🔥 防止重复添加同一个图片
                if (seenImageIds.has(ensuredImageId)) {
                  logger.drawing(`    ⏭️ 跳过已处理的图片: ${ensuredImageId}`);
                  return;
                }
                seenImageIds.add(ensuredImageId);

                if (!imageGroup.data) imageGroup.data = {};
                imageGroup.data.type = "image";
                imageGroup.data.imageId = ensuredImageId;

	                const sourceUrl =
	                  typeof raster.source === "string" ? raster.source.trim() : "";
	                const inlineDataUrl =
	                  sourceUrl &&
	                  (sourceUrl.startsWith("data:") || sourceUrl.startsWith("blob:"))
	                    ? sourceUrl
	                    : undefined;
	
	                const key = (() => {
	                  const fromData =
	                    typeof raster.data?.key === "string"
	                      ? normalizePersistableImageRef(raster.data.key)
	                      : "";
	                  const normalizedData = fromData.replace(/^\/+/, "");
	                  if (normalizedData && isAssetKeyRef(normalizedData)) return normalizedData;
	
	                  const fromSource = sourceUrl ? normalizePersistableImageRef(sourceUrl) : "";
	                  const normalizedSource = fromSource.replace(/^\/+/, "");
	                  if (normalizedSource && isAssetKeyRef(normalizedSource)) return normalizedSource;
	
	                  return undefined;
	                })();
	
	                const remoteUrl = (() => {
	                  const fromData =
	                    typeof raster.data?.remoteUrl === "string"
	                      ? normalizePersistableImageRef(raster.data.remoteUrl)
	                      : "";
	                  if (fromData && isRemoteUrl(fromData)) return fromData;
	
	                  const fromSource = sourceUrl ? normalizePersistableImageRef(sourceUrl) : "";
	                  if (fromSource && isRemoteUrl(fromSource)) return fromSource;
	
	                  return undefined;
	                })();
	
	                const persistedFromSource = (() => {
	                  const normalized = sourceUrl ? normalizePersistableImageRef(sourceUrl) : "";
	                  if (normalized && isPersistableImageRef(normalized)) return normalized;
	                  return undefined;
	                })();
	
	                const persistedRef = key || remoteUrl || persistedFromSource;
	
	                const metadataFromRaster = {
	                  originalWidth: raster.data?.originalWidth as
	                    | number
	                    | undefined,
	                  originalHeight: raster.data?.originalHeight as
	                    | number
	                    | undefined,
	                  fileName: raster.data?.fileName as string | undefined,
	                  uploadMethod: raster.data?.uploadMethod as string | undefined,
	                  aspectRatio: raster.data?.aspectRatio as number | undefined,
	                  remoteUrl,
	                  key,
	                };

                // 统一设置raster.data，提前补上id以便后续事件使用
	                raster.data = {
	                  ...(raster.data || {}),
	                  type: 'image',
	                  imageId: ensuredImageId,
	                  ...metadataFromRaster
	                };

	                const resolveRasterBounds = (): paper.Rectangle | null => {
	                  try {
	                    const b = raster.bounds as paper.Rectangle | undefined;
	                    if (b && b.width > 0 && b.height > 0) return b;
	                  } catch {}

	                  const raw = (raster.data as any)?.__tanvaBounds || (imageGroup.data as any)?.__tanvaBounds;
	                  if (!raw || typeof raw !== 'object') return null;
	                  const x = (raw as any)?.x;
	                  const y = (raw as any)?.y;
	                  const width = (raw as any)?.width;
	                  const height = (raw as any)?.height;
	                  const valid =
	                    typeof x === 'number' && Number.isFinite(x) &&
	                    typeof y === 'number' && Number.isFinite(y) &&
	                    typeof width === 'number' && Number.isFinite(width) &&
	                    typeof height === 'number' && Number.isFinite(height) &&
	                    width > 0 &&
	                    height > 0;
	                  if (!valid) return null;
	                  try {
	                    return new paper.Rectangle(x, y, width, height);
	                  } catch {
	                    return null;
	                  }
	                };

	                const ensureRasterHasBounds = (): paper.Rectangle | null => {
	                  const resolved = resolveRasterBounds();
	                  if (!resolved) return null;
	                  try {
	                    const b = raster.bounds as paper.Rectangle | undefined;
	                    if (!b || b.width <= 0 || b.height <= 0) {
	                      raster.bounds = resolved.clone();
	                    }
	                  } catch {}
	                  try {
	                    const b = raster.bounds as paper.Rectangle | undefined;
	                    if (b && b.width > 0 && b.height > 0) return b;
	                  } catch {}
	                  return resolved;
	                };

	                const buildImageInstance = () => {
	                  const boundsRect = ensureRasterHasBounds();
	                  if (!boundsRect || boundsRect.width <= 0 || boundsRect.height <= 0) return null;
	                  const computedMetadata = {
	                    ...metadataFromRaster,
	                    originalWidth: metadataFromRaster.originalWidth || boundsRect.width,
	                    originalHeight: metadataFromRaster.originalHeight || boundsRect.height,
	                    aspectRatio:
                      metadataFromRaster.aspectRatio ||
                      (boundsRect.height
                        ? boundsRect.width / boundsRect.height
                        : undefined),
	                    remoteUrl,
	                  };

	                  ensureImageGroupStructure({
	                    raster,
	                    imageId: ensuredImageId,
	                    group: imageGroup,
	                    bounds: boundsRect,
	                    metadata: computedMetadata,
	                    ensureImageRect: true,
	                    ensureSelectionArea: true
	                  });

                  try {
                    paper.view?.update();
                  } catch {}

	                  const resolvedUrl = persistedRef ?? inlineDataUrl ?? "";
	                  const resolvedSrc = persistedRef
	                    ? toRenderableImageSrc(persistedRef) || persistedRef
	                    : inlineDataUrl ?? resolvedUrl;
	                  const pendingUpload = !persistedRef;

                  // 获取图片原始尺寸（优先使用元数据中的原始尺寸，否则使用 raster 的原始尺寸）
                  const originalWidth =
                    computedMetadata.originalWidth ||
                    (raster as any).width ||
                    Math.round(boundsRect.width);
                  const originalHeight =
                    computedMetadata.originalHeight ||
                    (raster as any).height ||
                    Math.round(boundsRect.height);

	                  return {
	                    id: ensuredImageId,
	                    imageData: {
	                      id: ensuredImageId,
	                      url: resolvedUrl,
	                      key,
	                      src: resolvedSrc,
	                      fileName: computedMetadata.fileName,
	                      pendingUpload,
	                      width: Math.round(originalWidth),
	                      height: Math.round(originalHeight),
                    },
	                    bounds: {
	                      x: boundsRect.x,
	                      y: boundsRect.y,
	                      width: boundsRect.width,
	                      height: boundsRect.height
	                    },
                    isSelected: false,
                    visible: imageGroup.visible !== false,
                    layerId: layer?.name
	                  };
	                };

	                const hasValidBounds = (() => {
	                  const b = ensureRasterHasBounds();
	                  return !!b && b.width > 0 && b.height > 0;
	                })();

	                if (hasValidBounds) {
	                  const imageInstance = buildImageInstance();
	                  if (imageInstance) {
	                    imageInstances.push(imageInstance);
                  }
                } else {
                  // 尚未加载完成的Raster：先记录占位实例，待onLoad完成后再补齐尺寸与辅助元素
	                  const resolvedUrl = persistedRef ?? inlineDataUrl ?? "";
	                  const resolvedSrc = persistedRef
	                    ? toRenderableImageSrc(persistedRef) || persistedRef
	                    : inlineDataUrl ?? resolvedUrl;
	                  const pendingUpload = !persistedRef;

                  imageInstances.push({
                    id: ensuredImageId,
	                    imageData: {
	                      id: ensuredImageId,
	                      url: resolvedUrl,
	                      key,
	                      src: resolvedSrc,
	                      fileName: metadataFromRaster.fileName,
	                      pendingUpload,
	                    },
                    bounds: {
                      x: raster.position?.x ?? 0,
                      y: raster.position?.y ?? 0,
                      width: 0,
                      height: 0,
                    },
                    isSelected: false,
                    visible: imageGroup.visible !== false,
                    layerId: layer?.name,
                  });

                  ensureRasterRebuildOnLoad(raster, () => {
                    const loadedInstance = buildImageInstance();
                    if (!loadedInstance) return;

                    dcSetImageInstances((prev) => {
                      const updated = [...prev];
                      const index = updated.findIndex(
                        (img) => img.id === ensuredImageId
                      );
                      if (index >= 0) {
                        updated[index] = {
                          ...updated[index],
                          ...loadedInstance,
                          imageData: {
                            ...updated[index].imageData,
                            ...loadedInstance.imageData,
                          },
                        };
                      } else {
                        updated.push(loadedInstance);
                      }
                      try {
                        (window as any).tanvaImageInstances = updated;
                      } catch {}
                      return updated;
                    });
                    try {
                      paper.view?.update();
                    } catch {}
                  });
                }
              }
            }

            // ========== 处理文字 ==========
            if (
              item?.className === "PointText" ||
              item instanceof (paper as any).PointText
            ) {
              const pointText = item as any;
              // 跳过辅助文本
              if (pointText.data?.isHelper) return;

              // 图片组标题：不归文本工具接管；同时做一次修复/去重，避免保存后出现重复标题
              const groupId = pointText.data?.groupId;
              if (typeof groupId === "string" && groupId) {
                if (!pointText.data) pointText.data = {};
                pointText.data.type = "image-group-title";
                pointText.data.isHelper = false;
                try {
                  const nextTitle = formatImageGroupTitle(
                    String(pointText.content || "")
                  );
                  if (nextTitle && pointText.content !== nextTitle) {
                    pointText.content = nextTitle;
                  }
                } catch {}
                if (seenImageGroupTitles.has(groupId)) {
                  try {
                    pointText.remove();
                  } catch {}
                } else {
                  seenImageGroupTitles.add(groupId);
                }
                return;
              }

              // 只接管真正的文本工具文本；其他 PointText（未来可能的标注/刻度等）跳过
              if (pointText.data?.type && pointText.data.type !== "text") {
                return;
              }

              // 生成或使用已有的 text ID
              let textId = pointText.data?.textId;
              if (!textId) {
                textId = `text_${Date.now()}_${Math.random()
                  .toString(36)
                  .slice(2, 8)}`;
                if (!pointText.data) pointText.data = {};
                pointText.data.textId = textId;
              }

              // 确保设置 type 标记（关键！用于点击检测）
              if (!pointText.data.type) {
                pointText.data.type = "text";
              }

              // 提取样式信息
              const style = {
                fontFamily: pointText.fontFamily || "sans-serif",
                fontWeight:
                  pointText.fontWeight === "bold" ||
                  pointText.fontWeight === "700"
                    ? "bold"
                    : "normal",
                fontSize: pointText.fontSize || 24,
                color: pointText.fillColor
                  ? pointText.fillColor.toCSS(true)
                  : "#000000",
                align: "left",
                italic: pointText.fontStyle === "italic" || false,
              };

              // 构建文字实例
              textInstances.push({
                id: textId,
                paperText: pointText,
                isSelected: false,
                isEditing: false,
                style: style,
              });
            }

            // ========== 处理3D模型 ==========
            if (item?.data?.type === "3d-model" && item?.data?.modelId) {
              const model3DGroup = item;
              const modelId = model3DGroup.data.modelId;

              // 从group中查找占位符矩形来获取bounds
              const placeholder = model3DGroup.children?.find(
                (c: any) => c?.data?.isPlaceholder || c?.className === "Path"
              );

              if (placeholder && placeholder.bounds) {
                const b = placeholder.bounds as any;

                // 从data中恢复模型数据
                const stored = model3DGroup.data?.modelData || {};
                const resolvedUrl =
                  stored.url ||
                  model3DGroup.data?.url ||
                  model3DGroup.data?.path ||
                  "";
                const resolvedPath =
                  stored.path || model3DGroup.data?.path || resolvedUrl;
                const modelData = {
                  url: resolvedUrl,
                  path: resolvedPath,
                  key: stored.key ?? model3DGroup.data?.key,
                  format: stored.format || model3DGroup.data?.format || "glb",
                  fileName:
                    stored.fileName || model3DGroup.data?.fileName || "model",
                  fileSize: stored.fileSize ?? model3DGroup.data?.fileSize ?? 0,
                  defaultScale: stored.defaultScale ||
                    model3DGroup.data?.defaultScale || { x: 1, y: 1, z: 1 },
                  defaultRotation: stored.defaultRotation ||
                    model3DGroup.data?.defaultRotation || { x: 0, y: 0, z: 0 },
                  timestamp:
                    stored.timestamp ??
                    model3DGroup.data?.timestamp ??
                    Date.now(),
                  camera: stored.camera || model3DGroup.data?.camera,
                };

                try {
                  if (model3DGroup.data) {
                    model3DGroup.data.modelData = { ...modelData };
                    model3DGroup.data.url = modelData.url;
                    model3DGroup.data.path = modelData.path;
                    model3DGroup.data.key = modelData.key;
                    model3DGroup.data.format = modelData.format;
                    model3DGroup.data.fileName = modelData.fileName;
                    model3DGroup.data.fileSize = modelData.fileSize;
                    model3DGroup.data.defaultScale = modelData.defaultScale;
                    model3DGroup.data.defaultRotation =
                      modelData.defaultRotation;
                    model3DGroup.data.timestamp = modelData.timestamp;
                    model3DGroup.data.bounds = {
                      x: b.x,
                      y: b.y,
                      width: b.width,
                      height: b.height,
                    };
                    model3DGroup.data.layerId =
                      layer?.name ?? model3DGroup.data.layerId ?? null;
                    model3DGroup.data.camera = modelData.camera;
                  }
                } catch (error) {
                  console.warn("刷新3D模型数据失败:", error);
                }

                // 确保存在选择区域（用于点击检测）
                const hasSelectionArea = !!model3DGroup.children?.find(
                  (c: any) => c?.data?.type === "3d-model-selection-area"
                );
                if (!hasSelectionArea) {
                  try {
                    const selectionArea = new (paper as any).Path.Rectangle({
                      rectangle: new (paper as any).Rectangle(
                        b.x,
                        b.y,
                        b.width,
                        b.height
                      ),
                      fillColor: new (paper as any).Color(0, 0, 0, 0.001), // 几乎透明但可点击
                      strokeColor: null,
                      selected: false,
                      visible: true,
                    });
                    selectionArea.data = {
                      type: "3d-model-selection-area",
                      modelId: modelId,
                      isHelper: true,
                    };
                    model3DGroup.addChild(selectionArea);
                  } catch {}
                }

                // 构建3D模型实例
                model3DInstances.push({
                  id: modelId,
                  modelData: modelData,
                  bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
                  isSelected: false,
                  visible: model3DGroup.visible !== false,
                  layerId: layer?.name,
                });
              }
            }
          });
        });

        // 更新图片实例
        // 🔥 修复：只保留在 Paper.js 中实际存在的图片实例，移除已不存在的实例
        dcSetImageInstances((prev) => {
          const prevMap = new Map(prev.map((item) => [item.id, item]));
          const merged: typeof prev = [];

          imageInstances.forEach((instance) => {
            const previous = prevMap.get(instance.id);
            if (previous) {
              prevMap.delete(instance.id);
            }

            const boundsToUse =
              previous &&
              previous.bounds.width > 0 &&
              previous.bounds.height > 0
                ? previous.bounds
                : instance.bounds;

            merged.push({
              ...instance,
              ...previous,
              bounds: boundsToUse,
              imageData: {
                ...(instance.imageData || {}),
                ...(previous?.imageData || {}),
              },
              isSelected: false,
              visible: instance.visible,
            });
          });

          // 🔥 修复：不再保留遗留的旧实例，因为它们已经在 Paper.js 中不存在了
          const removedCount = prevMap.size;
          if (removedCount > 0) {
            logger.drawing(`🗑️ 清理了 ${removedCount} 个已不存在的图片实例`);
          }

          // 🔥 防止无限循环：如果数据没有实质变化，返回原数组引用
          if (merged.length === prev.length && removedCount === 0) {
            const hasChange = merged.some((m, i) => {
              const p = prev[i];
              if (!p || m.id !== p.id) return true;
              if (m.visible !== p.visible) return true;
              const mb = m.bounds, pb = p.bounds;
              if (mb.x !== pb.x || mb.y !== pb.y ||
                  mb.width !== pb.width || mb.height !== pb.height) return true;
              return false;
            });
            if (!hasChange) {
              return prev; // 返回原引用，避免触发重渲染
            }
          }

          try {
            (window as any).tanvaImageInstances = merged;
          } catch {}
          return merged;
        });
        // 只在有选中项时才清空，避免不必要的状态更新
        dcSetSelectedImageIds((prev) => prev.length > 0 ? [] : prev);
        if (imageInstances.length > 0) {
          logger.debug(
            `🧩 已从 Paper 恢复 ${imageInstances.length} 张图片实例`
          );
        } else {
          // 即使没有图片实例，也要确保清空状态
          logger.debug("🧩 已清空所有图片实例");
        }

        // 更新文字实例
        dcHydrateTextsFromPaperItems(textInstances);
        try {
          (window as any).tanvaTextItems = textInstances;
        } catch {}
        if (textInstances.length > 0) {
          logger.debug(`📝 已从 Paper 恢复 ${textInstances.length} 个文字实例`);
        }

        // 更新3D模型实例
        if (model3DInstances.length > 0) {
          dcSetModel3DInstances(model3DInstances);
          dcSetSelectedModel3DIds((prev) => prev.length > 0 ? [] : prev);
          try {
            (window as any).tanvaModel3DInstances = model3DInstances;
          } catch {}
          logger.debug(
            `🎮 已从 Paper 恢复 ${model3DInstances.length} 个3D模型实例`
          );
        }

        // 输出总结
        const total =
          imageInstances.length +
          textInstances.length +
          model3DInstances.length;
        if (total > 0) {
          logger.debug(
            `✅ 从 Paper.js 共恢复 ${total} 个实例（图片${imageInstances.length}，文字${textInstances.length}，3D${model3DInstances.length}）`
          );
        }
      } catch (e) {
        console.warn("从Paper重建实例失败:", e);
      }
    };

    let rafId: number | null = null;
    let isRebuilding = false; // 防重入标志
    const scheduleRebuild = () => {
      if (rafId !== null || isRebuilding) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (isRebuilding) return;
        isRebuilding = true;
        try {
          rebuildFromPaper();
        } finally {
          // 延迟重置标志，防止同一帧内的连续触发
          setTimeout(() => {
            isRebuilding = false;
          }, 100);
        }
      });
    };
    scheduleRebuildRef.current = scheduleRebuild;

    window.addEventListener(
      "paper-project-imported",
      scheduleRebuild as EventListener
    );
    window.addEventListener(
      "paper-project-changed",
      scheduleRebuild as EventListener
    );
    try {
      const importedAt = (window as any).__tanvaPaperImportedAt;
      if (importedAt) {
        scheduleRebuild();
        (window as any).__tanvaPaperImportedAt = null;
      }
    } catch {}
    return () => {
      scheduleRebuildRef.current = null;
      window.removeEventListener(
        "paper-project-imported",
        scheduleRebuild as EventListener
      );
      window.removeEventListener(
        "paper-project-changed",
        scheduleRebuild as EventListener
      );
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [
    dcClearAllSelections,
    dcHydrateTextsFromPaperItems,
    dcSetImageInstances,
    dcSetModel3DInstances,
    dcSetSelectedImageIds,
    dcSetSelectedModel3DIds,
  ]);

  useEffect(() => {
    const handlePaperReady = () => requestPaperRecovery("paper-ready");
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        requestPaperRecovery("pageshow");
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        requestPaperRecovery("visibility");
      }
    };

    window.addEventListener("paper-ready", handlePaperReady as EventListener);
    window.addEventListener("pageshow", handlePageShow as EventListener);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const timer = setTimeout(() => {
      requestPaperRecovery("project-enter");
    }, 300);

    return () => {
      window.removeEventListener("paper-ready", handlePaperReady as EventListener);
      window.removeEventListener("pageshow", handlePageShow as EventListener);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearTimeout(timer);
    };
  }, [projectId, requestPaperRecovery]);

  // 历史快速回放（仅图片 bounds）：避免 undo/redo 时全量重建导致全图闪烁
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent)?.detail as any;
      const images = detail?.images as ImageAssetSnapshot[] | undefined;
      if (!Array.isArray(images) || images.length === 0) return;
      try {
        dcApplyImageBoundsFromSnapshot?.(images);
      } catch {}
    };
    window.addEventListener(
      "history:apply-image-snapshot",
      handler as EventListener
    );
    return () =>
      window.removeEventListener(
        "history:apply-image-snapshot",
        handler as EventListener
      );
  }, [dcApplyImageBoundsFromSnapshot]);

  // 监听图层面板的选择事件
  const dcHandleLayerImageSelect = imageTool.handleImageSelect;
  const dcHandleLayerModel3DSelect = model3DTool.handleModel3DSelect;

  useEffect(() => {
    const handleLayerItemSelected = (event: CustomEvent) => {
      const { item, type, itemId } = event.detail;

      logger.debug("收到图层面板选择事件:", type, itemId);

      // 清除之前的所有选择
      dcClearAllSelections();

      // 根据类型进行相应的选择处理
      if (type === "image") {
        const imageData = item.data;
        if (imageData?.imageId) {
          dcHandleLayerImageSelect(imageData.imageId);
        }
      } else if (type === "model3d") {
        const modelData = item.data;
        if (modelData?.modelId) {
          dcHandleLayerModel3DSelect(modelData.modelId);
        }
      } else if (item instanceof paper.Path) {
        selectToolHandlePathSelect(item);
      }
    };

    // 添加事件监听器
    window.addEventListener(
      "layerItemSelected",
      handleLayerItemSelected as EventListener
    );

    return () => {
      // 清理事件监听器
      window.removeEventListener(
        "layerItemSelected",
        handleLayerItemSelected as EventListener
      );
    };
  }, [
    dcClearAllSelections,
    dcHandleLayerImageSelect,
    dcHandleLayerModel3DSelect,
    selectToolHandlePathSelect,
  ]);

  return (
    <>
      {/* 图片上传组件 */}
      <ImageUploadComponent
        onImageUploaded={imageTool.handleImageUploaded}
        onUploadError={imageTool.handleImageUploadError}
        trigger={imageTool.triggerImageUpload}
        onTriggerHandled={imageTool.handleUploadTriggerHandled}
        projectId={projectId}
      />

      {/* 快速图片上传组件（居中） */}
      <ImageUploadComponent
        onImageUploaded={quickImageUpload.handleQuickImageUploaded}
        onUploadError={quickImageUpload.handleQuickUploadError}
        trigger={quickImageUpload.triggerQuickUpload}
        onTriggerHandled={quickImageUpload.handleQuickUploadTriggerHandled}
        projectId={projectId}
      />

      {/* 3D模型上传组件 */}
      <Model3DUploadComponent
        onModel3DUploaded={model3DTool.handleModel3DUploaded}
        onUploadError={model3DTool.handleModel3DUploadError}
        trigger={model3DTool.triggerModel3DUpload}
        onTriggerHandled={model3DTool.handleModel3DUploadTriggerHandled}
        projectId={projectId}
      />

      {/* 自动对齐参考线渲染 */}
      <SnapGuideRenderer
        alignments={snapAlignment.activeAlignments}
        zoom={zoom}
      />

      {/* 图片UI覆盖层实例 */}
      {imageTool.imageInstances.map((image) => {
        return (
          <ImageContainer
            key={image.id}
            imageData={{
              id: image.id,
              url: image.imageData?.url,
              src: image.imageData?.src,
              localDataUrl: image.imageData?.localDataUrl,
              fileName: image.imageData?.fileName,
              pendingUpload: image.imageData?.pendingUpload,
              width: image.imageData?.width,
              height: image.imageData?.height,
            }}
            bounds={image.bounds}
            isSelected={imageTool.selectedImageIds.includes(image.id)}
            visible={image.visible}
            drawMode={drawMode}
            isSelectionDragging={selectionTool.isSelectionDragging}
            onSelect={() => imageTool.handleImageSelect(image.id)}
            onMove={(newPosition) =>
              imageTool.handleImageMove(image.id, newPosition)
            }
            onResize={(newBounds) =>
              imageTool.handleImageResize(image.id, newBounds)
            }
            onDelete={(imageId) => imageTool.handleImageDelete?.(imageId)}
            onToggleVisibility={(imageId) =>
              handleImageToggleVisibility(imageId)
            }
            getImageDataForEditing={imageTool.getImageDataForEditing}
            showIndividualTools={!isGroupSelection}
          />
        );
      })}

      {/* 3D模型渲染实例 */}
      {model3DTool.model3DInstances.map((model) => {
        return (
          <Model3DContainer
            key={model.id}
            modelData={model.modelData}
            modelId={model.id}
            bounds={model.bounds}
            isSelected={model.isSelected}
            visible={model.visible}
            drawMode={drawMode}
            isSelectionDragging={selectionTool.isSelectionDragging}
            onMove={(newPosition) =>
              model3DTool.handleModel3DMove(model.id, newPosition)
            }
            onResize={(newBounds) =>
              model3DTool.handleModel3DResize(model.id, newBounds)
            }
            onDeselect={() => model3DTool.handleModel3DDeselect()}
            onCameraChange={(camera) =>
              model3DTool.handleModel3DCameraChange(model.id, camera)
            }
            onDelete={() => model3DTool.handleModel3DDelete(model.id)}
            onCapture={() => handleModelCapture(model.id)}
            isCapturePending={!!modelCapturePending[model.id]}
            showIndividualTools={!isGroupSelection}
            onSelect={(addToSelection) =>
              handleModelSelectFromOverlay(model.id, !!addToSelection)
            }
          />
        );
      })}

      {showSelectionGroupToolbar && groupScreenBounds && (
        <SelectionGroupToolbar
          bounds={groupScreenBounds}
          selectedCount={groupSelectionCount}
          onCapture={hasPendingSelection ? undefined : handleGroupCapture}
          onGroupImages={hasPendingSelection ? undefined : handleGroupImages}
          canGroupImages={canGroupImages}
          onUngroupImages={hasPendingSelection ? undefined : handleUngroupImages}
          canUngroupImages={canUngroupImages}
          isCapturing={isGroupCapturePending}
        />
      )}

      {/* 文本选择框覆盖层 */}
      <TextSelectionOverlay
        textItems={simpleTextTool.textItems}
        selectedTextId={simpleTextTool.selectedTextId}
        editingTextId={simpleTextTool.editingTextId}
        isDragging={simpleTextTool.isDragging}
        isResizing={simpleTextTool.isResizing}
        onTextDragStart={simpleTextTool.startTextDrag}
        onTextDrag={simpleTextTool.dragText}
        onTextDragEnd={simpleTextTool.endTextDrag}
        onTextResizeStart={simpleTextTool.startTextResize}
        onTextResize={simpleTextTool.resizeTextDrag}
        onTextResizeEnd={simpleTextTool.endTextResize}
        onTextDoubleClick={simpleTextTool.startEditText}
      />

      {/* 简单文本编辑器 */}
      <SimpleTextEditor
        textItems={simpleTextTool.textItems}
        editingTextId={simpleTextTool.editingTextId}
        onUpdateContent={simpleTextTool.updateTextContent}
        onStopEdit={simpleTextTool.stopEditText}
      />

      {contextMenuState && contextMenuItems.length > 0 && (
        <ContextMenu
          x={contextMenuState.x}
          y={contextMenuState.y}
          items={contextMenuItems}
          onClose={closeContextMenu}
        />
      )}
    </>
  );
};

export default DrawingController;
