import React, {
  useRef,
  useCallback,
  useMemo,
  useState,
  useEffect,
} from "react";
import paper from "paper";
import { useAIChatStore } from "@/stores/aiChatStore";
import { useCanvasStore } from "@/stores";
import {
  Sparkles,
  EyeOff,
  Wand2,
  ArrowRightLeft,
  Rotate3d,
  Crop,
  ImageUp,
} from "lucide-react";
import { Button } from "../ui/button";
import ImagePreviewModal, { type ImageItem } from "../ui/ImagePreviewModal";
import backgroundRemovalService from "@/services/backgroundRemovalService";
import { LoadingSpinner } from "../ui/loading-spinner";
import { logger } from "@/utils/logger";
import { convert2Dto3D } from "@/services/convert2Dto3DService";
import { uploadToOSS } from "@/services/ossUploadService";
import { useProjectContentStore } from "@/stores/projectContentStore";
import type { Model3DData } from "@/services/model3DUploadService";
// optimizeHdImage 已弃用，改用 aiImageService.editImage
import ExpandImageSelector from "./ExpandImageSelector";
import { useToolStore } from "@/stores";
import aiImageService from "@/services/aiImageService";
import { useImageHistoryStore } from "@/stores/imageHistoryStore";
import { loadImageElement } from "@/utils/imageHelper";
import { imageUrlCache } from "@/services/imageUrlCache";
import { isGroup, isRaster } from "@/utils/paperCoords";

const HD_UPSCALE_RESOLUTION: "4k" = "4k";
const EXPAND_PRESET_PROMPT = "帮我扩展这张图的内容，填充周边空白区域";
const EXPAND_MODEL = "gemini-2.5-flash-image";
const EXPAND_PROVIDER = "banana-2.5";

type Bounds = { x: number; y: number; width: number; height: number };
const ensureDataUrlString = (
  imageData: string,
  mime: string = "image/png"
): string => {
  if (!imageData) return "";
  return imageData.startsWith("data:image")
    ? imageData
    : `data:${mime};base64,${imageData}`;
};

const normalizeImageSrc = (value?: string | null): string => {
  if (!value) return "";
  const trimmed = value.trim();
  // 允许同源的 proxy 资源（如 /api/assets/proxy?...），否则会被误判为 base64 导致空白
  if (
    /^data:image\//i.test(trimmed) ||
    /^https?:\/\//i.test(trimmed) ||
    /^blob:/i.test(trimmed) ||
    trimmed.startsWith("/api/") ||
    trimmed.startsWith("/assets/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../")
  ) {
    return trimmed;
  }
  return `data:image/png;base64,${trimmed}`;
};

const _composeExpandedImage = async (
  sourceDataUrl: string,
  originalBounds: Bounds,
  targetBounds: Bounds
): Promise<{ dataUrl: string; width: number; height: number }> => {
  if (!targetBounds.width || !targetBounds.height) {
    throw new Error("请选择有效的扩展区域");
  }

  const image = await loadImageElement(sourceDataUrl);
  const safeOriginalWidth = Math.max(1, originalBounds.width);
  const safeOriginalHeight = Math.max(1, originalBounds.height);

  const scaleX = image.width / safeOriginalWidth;
  const scaleY = image.height / safeOriginalHeight;
  const scale =
    Number.isFinite(scaleX) && Number.isFinite(scaleY)
      ? (scaleX + scaleY) / 2
      : Number.isFinite(scaleX)
      ? scaleX
      : Number.isFinite(scaleY)
      ? scaleY
      : 1;

  const canvasWidth = Math.max(1, Math.round(targetBounds.width * scale));
  const canvasHeight = Math.max(1, Math.round(targetBounds.height * scale));
  const offsetX = Math.round((originalBounds.x - targetBounds.x) * scale);
  const offsetY = Math.round((originalBounds.y - targetBounds.y) * scale);

  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("无法创建扩展画布");
  }

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.drawImage(image, offsetX, offsetY, image.width, image.height);

  return {
    dataUrl: canvas.toDataURL("image/png"),
    width: canvasWidth,
    height: canvasHeight,
  };
};

interface ImageData {
  id: string;
  url?: string;
  src?: string;
  fileName?: string;
  pendingUpload?: boolean;
  localDataUrl?: string;
  width?: number;  // 图片原始宽度
  height?: number; // 图片原始高度
}

interface ImageContainerProps {
  imageData: ImageData;
  bounds: { x: number; y: number; width: number; height: number }; // Paper.js世界坐标
  isSelected?: boolean;
  visible?: boolean; // 是否可见
  drawMode?: string; // 当前绘图模式
  isSelectionDragging?: boolean; // 是否正在拖拽选择框
  layerIndex?: number; // 图层索引，用于计算z-index
  onSelect?: () => void;
  onMove?: (newPosition: { x: number; y: number }) => void; // Paper.js坐标
  onResize?: (newBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => void; // Paper.js坐标
  onDelete?: (imageId: string) => void;
  onToggleVisibility?: (imageId: string) => void; // 切换图层可见性回调
  getImageDataForEditing?: (imageId: string) => string | null; // 获取高质量图像数据的函数
  showIndividualTools?: boolean;
}

const ImageContainer: React.FC<ImageContainerProps> = ({
  imageData,
  bounds,
  isSelected = false,
  visible = true,
  drawMode: _drawMode = "select",
  isSelectionDragging: _isSelectionDragging = false,
  layerIndex = 0,
  onSelect: _onSelect,
  onMove: _onMove,
  onResize: _onResize,
  onDelete: _onDelete,
  onToggleVisibility,
  getImageDataForEditing,
  showIndividualTools = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const enableVisibilityToggle = false; // Temporarily hide layer visibility control

  // 获取AI聊天状态
  const {
    setSourceImageForEditing,
    addImageForBlending,
    showDialog,
    sourceImageForEditing,
    sourceImagesForBlending,
  } = useAIChatStore();

  // 获取画布状态 - 用于监听画布移动变化
  const { zoom, panX, panY, isDragging: isCanvasDragging } = useCanvasStore();

  // 工具栏缩放逻辑：>=100% 保持标准大小，<100% 随画布缩放
  const currentZoom = zoom || 1;
  const showButtonText = currentZoom >= 1; // 100%及以上显示文字
  const toolbarScale = currentZoom >= 1 ? 1 : currentZoom; // >=100%固定为1，<100%跟随缩放

  const sharedButtonClass = showButtonText
    ? "px-2 py-1 h-7 rounded-md bg-transparent text-gray-600 text-xs transition-all duration-200 hover:bg-gray-100 hover:text-gray-800 flex items-center gap-1 whitespace-nowrap"
    : "px-1.5 py-1 h-7 rounded-md bg-transparent text-gray-600 transition-all duration-200 hover:bg-gray-100 hover:text-gray-800 flex items-center justify-center";
  const sharedIconClass = "w-3.5 h-3.5 flex-shrink-0";

  // 实时Paper.js坐标状态
  const [realTimeBounds, setRealTimeBounds] = useState(bounds);

  // 是否正在拖拽（图片拖拽/选择拖拽会通过 body class 标记；画布中键平移通过 store 标记）
  const [isBodyDragging, setIsBodyDragging] = useState(false);

  // 图片真实像素尺寸（通过加载图片获取）
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);

  // 预览模态框状态
  const [showPreview, setShowPreview] = useState(false);
  const [previewImageId, setPreviewImageId] = useState<string | null>(null);
  const [isRemovingBackground, setIsRemovingBackground] = useState(false);
  const [isConvertingTo3D, setIsConvertingTo3D] = useState(false);
  const [isExpandingImage, setIsExpandingImage] = useState(false);
  const [isOptimizingHd, setIsOptimizingHd] = useState(false);
  const [showExpandSelector, setShowExpandSelector] = useState(false);
  const [localPreviewTimestamp] = useState(() => Date.now());

  // 获取项目ID用于上传
  const projectId = useProjectContentStore((state) => state.projectId);
  const history = useImageHistoryStore((state) => state.history);
  const setDrawMode = useToolStore((state) => state.setDrawMode);

  const scopedHistory = useMemo(() => {
    if (!projectId) return history;
    return history.filter((item) => {
      const pid = item.projectId ?? null;
      return pid === projectId || pid === null;
    });
  }, [history, projectId]);

  const relatedHistoryImages = useMemo<ImageItem[]>(() => {
    return scopedHistory
      .filter((item) => !!item.src)
      .map((item) => ({
        id: item.id,
        src: normalizeImageSrc(item.src),
        title: item.title,
        timestamp: item.timestamp,
      }));
  }, [scopedHistory]);

  // 监听 body class：图片拖拽 / 选择框拖拽时隐藏文字与工具栏，避免“跟随不紧”观感
  useEffect(() => {
    if (typeof document === "undefined" || !document.body) return;

    const compute = () => {
      const classList = document.body.classList;
      return (
        classList.contains("tanva-canvas-dragging") ||
        classList.contains("tanva-selection-dragging")
      );
    };

    const update = () => setIsBodyDragging(compute());
    update();

    const observer = new MutationObserver(update);
    try {
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["class"],
      });
    } catch {
      // ignore
    }

    return () => {
      try { observer.disconnect(); } catch {}
    };
  }, []);

  const shouldHideUi = isCanvasDragging || isBodyDragging;

  // 将Paper.js世界坐标转换为屏幕坐标（改进版）
  const convertToScreenBounds = useCallback(
    (paperBounds: { x: number; y: number; width: number; height: number }) => {
      if (!paper.view) return paperBounds;

      try {
        const dpr = window.devicePixelRatio || 1;
        // 使用更精确的坐标转换
        const topLeft = paper.view.projectToView(
          new paper.Point(paperBounds.x, paperBounds.y)
        );
        const bottomRight = paper.view.projectToView(
          new paper.Point(
            paperBounds.x + paperBounds.width,
            paperBounds.y + paperBounds.height
          )
        );

        // 添加数值验证，防止NaN或无限值
        const result = {
          x: isFinite(topLeft.x) ? topLeft.x / dpr : paperBounds.x,
          y: isFinite(topLeft.y) ? topLeft.y / dpr : paperBounds.y,
          width: isFinite(bottomRight.x - topLeft.x)
            ? (bottomRight.x - topLeft.x) / dpr
            : paperBounds.width,
          height: isFinite(bottomRight.y - topLeft.y)
            ? (bottomRight.y - topLeft.y) / dpr
            : paperBounds.height,
        };

        return result;
      } catch (error) {
        console.warn("坐标转换失败，使用原始坐标:", error);
        return paperBounds;
      }
    },
    [zoom, panX, panY]
  ); // 添加画布状态依赖，确保画布变化时函数重新创建

  // 使用 ref 存储最新的 bounds，避免 getRealTimePaperBounds 依赖变化
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;

  // 使用 ref 存储最新的 realTimeBounds，避免闭包过期问题
  const realTimeBoundsRef = useRef(realTimeBounds);
  realTimeBoundsRef.current = realTimeBounds;

  // 从Paper.js获取实时坐标 - 使用 ref 避免依赖变化
  const getRealTimePaperBounds = useCallback(() => {
    try {
      // 首先尝试从所有图层中查找图片对象
      const imageGroup = paper.project?.layers?.flatMap((layer) =>
        layer.children.filter(
          (child) =>
            child.data?.type === "image" && child.data?.imageId === imageData.id
        )
      )[0];

      if (isGroup(imageGroup)) {
        const raster = imageGroup.children.find(
          (child) => isRaster(child)
        ) as paper.Raster;
        if (raster && raster.bounds && isFinite(raster.bounds.x)) {
          // 获取实际的边界信息，确保数值有效
          const realBounds = {
            x: Math.round(raster.bounds.x * 100) / 100, // 四舍五入到小数点后2位
            y: Math.round(raster.bounds.y * 100) / 100,
            width: Math.round(raster.bounds.width * 100) / 100,
            height: Math.round(raster.bounds.height * 100) / 100,
          };

          // 验证bounds是否合理
          if (realBounds.width > 0 && realBounds.height > 0) {
            return realBounds;
          }
        }
      }
    } catch (error) {
      console.warn("获取Paper.js实时坐标失败:", error);
    }

    return boundsRef.current; // 使用 ref 回退到props中的bounds
  }, [imageData.id]); // 只依赖 imageData.id，函数引用更稳定

  // 监听画布状态变化，强制重新计算坐标
  useEffect(() => {
    // 当画布状态变化时，强制重新计算屏幕坐标
    const newPaperBounds = getRealTimePaperBounds();
    setRealTimeBounds(newPaperBounds);
  }, [zoom, panX, panY, getRealTimePaperBounds]); // 直接监听画布状态变化

  // 实时同步Paper.js状态 - 只在选中时启用，使用节流减少更新频率
  useEffect(() => {
    // 只在选中时才需要实时同步
    if (!isSelected) return;

    let animationFrame: number | null = null;
    let isRunning = true;
    let lastUpdateTime = 0;
    const throttleMs = 8; // 尽量贴近高刷屏的跟随体验

    const updateRealTimeBounds = () => {
      if (!isRunning) return;

      const now = performance.now();
      if (now - lastUpdateTime < throttleMs) {
        animationFrame = requestAnimationFrame(updateRealTimeBounds);
        return;
      }
      lastUpdateTime = now;

      const paperBounds = getRealTimePaperBounds();
      const currentBounds = realTimeBoundsRef.current;

      // 以“视图像素”为基准做容差：zoom 越大，同样的世界坐标差在屏幕上越明显
      // 这里 world 单位近似是 device px，因此容差要除以 zoom，避免放大后出现明显“跟不上”
      const zoomFactor = Math.max(0.0001, Number((paper.view as any)?.zoom ?? 1) || 1);
      const toleranceWorld = 0.25 / zoomFactor;

      // 检查坐标是否发生变化 - 使用 ref 获取最新值
      const hasChanged =
        Math.abs(paperBounds.x - currentBounds.x) > toleranceWorld ||
        Math.abs(paperBounds.y - currentBounds.y) > toleranceWorld ||
        Math.abs(paperBounds.width - currentBounds.width) > toleranceWorld ||
        Math.abs(paperBounds.height - currentBounds.height) > toleranceWorld;

      if (hasChanged) {
        setRealTimeBounds(paperBounds);
      }

      // 继续下一帧
      if (isRunning) {
        animationFrame = requestAnimationFrame(updateRealTimeBounds);
      }
    };

    // 立即更新一次，然后开始循环
    const paperBounds = getRealTimePaperBounds();
    setRealTimeBounds(paperBounds);
    animationFrame = requestAnimationFrame(updateRealTimeBounds);

    return () => {
      isRunning = false;
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame);
      }
    };
  }, [isSelected, getRealTimePaperBounds]);

  // 同步Props bounds变化
  useEffect(() => {
    setRealTimeBounds(bounds);
  }, [bounds]);

  // 获取图片真实像素尺寸
  useEffect(() => {
    setNaturalSize(null);
    const src = imageData.url || imageData.src || imageData.localDataUrl;
    if (!src) return;

    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (w > 0 && h > 0) {
        setNaturalSize({ width: w, height: h });
      }
    };
    img.src = src;
  }, [imageData.url, imageData.src, imageData.localDataUrl]);

  // 使用实时坐标进行屏幕坐标转换
  const screenBounds = useMemo(() => {
    return convertToScreenBounds(realTimeBounds);
  }, [realTimeBounds, convertToScreenBounds, zoom, panX, panY]); // 添加画布状态依赖，确保完全响应画布变化

  const resolveImageDataUrl = useCallback(async (): Promise<string | null> => {
    // 首先检查缓存的 dataUrl
    const cachedDataUrl = imageUrlCache.getCachedDataUrl(
      imageData.id,
      projectId
    );
    if (cachedDataUrl) {
      return cachedDataUrl;
    }

    const ensureDataUrl = async (
      input: string | null
    ): Promise<string | null> => {
      if (!input) return null;
      if (input.startsWith("data:image/")) {
        return input;
      }

      // 对于远程URL，只在必要时才转换为Base64；仅为获得URL时应复用已有远程链接
      if (/^https?:\/\//i.test(input) || input.startsWith("blob:")) {
        try {
          const response = await fetch(input);
          const blob = await response.blob();
          return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              if (typeof reader.result === "string") {
                resolve(reader.result);
              } else {
                reject(new Error("无法读取图像数据"));
              }
            };
            reader.onerror = () =>
              reject(reader.error ?? new Error("读取图像数据失败"));
            reader.readAsDataURL(blob);
          });
        } catch (convertError) {
          console.warn(
            "⚠️ 无法转换远程图像为Base64，尝试使用Canvas数据",
            convertError
          );
          return null;
        }
      }

      return input;
    };

    let result: string | null = null;

    if (getImageDataForEditing) {
      result = await ensureDataUrl(getImageDataForEditing(imageData.id));
      if (result) {
        // 缓存结果
        imageUrlCache.updateDataUrl(imageData.id, result, projectId);
        return result;
      }
    }

    const urlSource = imageData.url || imageData.src || null;
    result = await ensureDataUrl(urlSource);
    if (result) {
      // 缓存结果
      imageUrlCache.updateDataUrl(imageData.id, result, projectId);
      return result;
    }

    console.warn("⚠️ 未找到原始图像数据，尝试从Canvas抓取");
    const imageGroup = paper.project?.layers?.flatMap((layer) =>
      layer.children.filter(
        (child) =>
          child.data?.type === "image" && child.data?.imageId === imageData.id
      )
    )[0];

    if (imageGroup) {
      const raster = imageGroup.children.find(
        (child) => isRaster(child)
      ) as paper.Raster;
      if (raster && raster.canvas) {
        const canvasData = raster.canvas.toDataURL("image/png");
        result = await ensureDataUrl(canvasData);
        if (result) {
          // 缓存结果
          imageUrlCache.updateDataUrl(imageData.id, result, projectId);
          return result;
        }
      }
    }

    return null;
  }, [
    getImageDataForEditing,
    imageData.id,
    imageData.url,
    imageData.src,
    projectId,
  ]);

  // 处理AI编辑按钮点击
  const handleAIEdit = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const run = async () => {
        const imageDataUrl = await resolveImageDataUrl();
        if (!imageDataUrl) {
          console.error("❌ 无法获取图像数据");
          return;
        }

        // 检查是否已有图片，如果有则添加到融合模式，否则设置为编辑图片
        const hasExistingImages =
          sourceImageForEditing || sourceImagesForBlending.length > 0;

        if (hasExistingImages) {
          // 如果有编辑图片，先将其转换为融合模式
          if (sourceImageForEditing) {
            addImageForBlending(sourceImageForEditing);
            setSourceImageForEditing(null);
            logger.debug("🎨 将编辑图像转换为融合模式");
          }

          // 已有图片：添加新图片到融合模式
          addImageForBlending(imageDataUrl);
          logger.debug("🎨 已添加图像到融合模式");
        } else {
          // 没有现有图片：设置为编辑图片
          setSourceImageForEditing(imageDataUrl);
          logger.debug("🎨 已设置图像为编辑模式");
        }

        showDialog();
      };

      run().catch((error) => {
        console.error("获取图像数据失败:", error);
      });
    },
    [
      resolveImageDataUrl,
      setSourceImageForEditing,
      addImageForBlending,
      showDialog,
      sourceImageForEditing,
      sourceImagesForBlending,
    ]
  );

  // 处理切换可见性按钮点击
  const handleToggleVisibility = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (onToggleVisibility) {
        onToggleVisibility(imageData.id);
        logger.debug("👁️‍🗨️ 切换图层可见性:", imageData.id);
      }
    },
    [imageData.id, onToggleVisibility]
  );

  const handleCreateFlowImageNode = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const run = async () => {
        const imageDataUrl = await resolveImageDataUrl();
        if (!imageDataUrl) {
          console.warn("⚠️ 无法获取图像数据，无法创建Flow节点");
          return;
        }
        const base64 = imageDataUrl.includes(",")
          ? imageDataUrl.split(",")[1]
          : imageDataUrl;
        window.dispatchEvent(
          new CustomEvent("flow:createImageNode", {
            detail: {
              imageData: base64,
              label: "Image",
              imageName: imageData.fileName || `图片 ${imageData.id}`,
            },
          })
        );
        logger.debug("🧩 已请求创建Flow Image节点");
      };

      run().catch((error) => {
        console.error("将图片发送到Flow失败:", error);
      });
    },
    [imageData.fileName, resolveImageDataUrl]
  );

  const handleBackgroundRemoval = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (isRemovingBackground) {
        return;
      }

      const execute = async () => {
        const baseImage = await resolveImageDataUrl();
        if (!baseImage) {
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message: "无法获取原图，无法抠图", type: "error" },
            })
          );
          return;
        }

        setIsRemovingBackground(true);
        try {
          logger.info("🎯 开始背景移除", { imageId: imageData.id });

          // 使用 Gemini 2.5 Flash 模型进行预处理（速度更快）
          const BG_REMOVAL_MODEL = "gemini-2.5-flash-image";
          const BG_REMOVAL_PROVIDER = "banana-2.5";

          logger.info("📷 Step 1: Gemini 2.5 预处理 - 背景换成纯色", {
            aiProvider: BG_REMOVAL_PROVIDER,
            model: BG_REMOVAL_MODEL
          });
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message: "🔄 正在预处理图片...", type: "info" },
            })
          );

          const editResult = await aiImageService.editImage({
            prompt: "只保留完整的主体，背景换成纯色",
            sourceImage: baseImage,
            model: BG_REMOVAL_MODEL,
            aiProvider: BG_REMOVAL_PROVIDER,
            outputFormat: "png",
            imageOnly: true,
          });

          if (!editResult.success || !editResult.data?.imageData) {
            logger.warn(
              "⚠️ Gemini 预处理失败，使用原图继续抠图",
              editResult.error
            );
            // 预处理失败时，继续使用原图进行抠图
          }

          const imageForRemoval =
            editResult.success && editResult.data?.imageData
              ? ensureDataUrlString(editResult.data.imageData, "image/png")
              : baseImage;

          if (editResult.success && editResult.data?.imageData) {
            logger.info("✅ Gemini 预处理完成，开始抠图算法");
            window.dispatchEvent(
              new CustomEvent("toast", {
                detail: { message: "🔄 正在精细抠图...", type: "info" },
              })
            );
          }

          // Step 2: 将预处理后的图片传给抠图算法
          logger.info("📷 Step 2: 抠图算法处理");
          const result = await backgroundRemovalService.removeBackground(
            imageForRemoval,
            "image/png",
            true
          );
          if (!result.success || !result.imageData) {
            throw new Error(result.error || "背景移除失败");
          }

          const centerPoint = {
            x: realTimeBounds.x + realTimeBounds.width / 2,
            y: realTimeBounds.y + realTimeBounds.height / 2,
          };

          const fileName = `background-removed-${Date.now()}.png`;
          window.dispatchEvent(
            new CustomEvent("triggerQuickImageUpload", {
              detail: {
                imageData: result.imageData,
                fileName,
                smartPosition: centerPoint,
                operationType: "background-removal",
                sourceImageId: imageData.id,
              },
            })
          );

          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message: "✨ 抠图完成，已生成新图", type: "success" },
            })
          );
          logger.info("✅ 背景移除完成", { imageId: imageData.id });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "背景移除失败";
          console.error("背景移除失败:", error);
          logger.error("❌ 背景移除失败", error);
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message, type: "error" },
            })
          );
        } finally {
          setIsRemovingBackground(false);
        }
      };

      execute().catch((error) => {
        console.error("抠图异常:", error);
        setIsRemovingBackground(false);
      });
    },
    [imageData.id, resolveImageDataUrl, isRemovingBackground, realTimeBounds]
  );

  // 处理2D转3D按钮点击
  const handleConvertTo3D = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (isConvertingTo3D) {
        return;
      }

      const execute = async () => {
        setIsConvertingTo3D(true);
        try {
          // 获取当前选中图片的URL，优先从Paper.js的raster获取
          let imageUrl: string;
          const imageGroup = paper.project?.layers?.flatMap((layer) =>
            layer.children.filter(
              (child) =>
                child.data?.type === "image" &&
                child.data?.imageId === imageData.id
            )
          )[0];

          let rasterSource: string | null = null;
          if (imageGroup) {
            const raster = imageGroup.children.find(
              (child) => isRaster(child)
            ) as paper.Raster | undefined;
            if (raster && raster.source) {
              rasterSource =
                typeof raster.source === "string" ? raster.source : null;
            }
          }

          const currentUrl = rasterSource || imageData.url || imageData.src;

          if (currentUrl && /^https?:\/\//i.test(currentUrl)) {
            imageUrl = currentUrl;
          } else {
            const imageDataUrl = await resolveImageDataUrl();
            if (!imageDataUrl) {
              throw new Error("无法获取当前图片的图像数据");
            }

            const response = await fetch(imageDataUrl);
            const blob = await response.blob();

            const uploadResult = await uploadToOSS(blob, {
              dir: projectId
                ? `projects/${projectId}/images/`
                : "uploads/images/",
              fileName: `2d-to-3d-${Date.now()}.png`,
              contentType: "image/png",
              projectId,
            });

            if (!uploadResult.success || !uploadResult.url) {
              throw new Error(uploadResult.error || "当前图片上传失败");
            }

            imageUrl = uploadResult.url;
          }

          if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
            throw new Error(`无效的图片URL: ${imageUrl}`);
          }

          const convertResult = await convert2Dto3D({ imageUrl });

          if (!convertResult.success || !convertResult.modelUrl) {
            throw new Error(convertResult.error || "2D转3D失败");
          }

          const modelUrl = convertResult.modelUrl;
          const fileName =
            modelUrl.split("/").pop() || `model-${Date.now()}.glb`;

          const model3DData: Model3DData = {
            url: modelUrl,
            format: "glb",
            fileName,
            fileSize: 0,
            defaultScale: { x: 1, y: 1, z: 1 },
            defaultRotation: { x: 0, y: 0, z: 0 },
            timestamp: Date.now(),
          };

          const modelWidth = realTimeBounds.width;
          const modelHeight = realTimeBounds.height;
          const spacing = 20;

          const modelStartX = realTimeBounds.x + realTimeBounds.width + spacing;
          const modelStartY = realTimeBounds.y;
          const modelEndX = modelStartX + modelWidth;
          const modelEndY = modelStartY + modelHeight;

          window.dispatchEvent(
            new CustomEvent("canvas:insert-model3d", {
              detail: {
                modelData: model3DData,
                size: {
                  width: modelWidth,
                  height: modelHeight,
                },
                position: {
                  start: { x: modelStartX, y: modelStartY },
                  end: { x: modelEndX, y: modelEndY },
                },
              },
            })
          );

          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: {
                message: "✨ 2D转3D完成，已生成3D模型",
                type: "success",
              },
            })
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : "2D转3D失败";
          logger.error("2D转3D失败", error);
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message, type: "error" },
            })
          );
        } finally {
          setIsConvertingTo3D(false);
        }
      };

      execute();
    },
    [
      imageData.id,
      imageData.url,
      imageData.src,
      resolveImageDataUrl,
      isConvertingTo3D,
      realTimeBounds,
      projectId,
    ]
  );

  // 处理扩图按钮点击
  const handleExpandImage = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isExpandingImage) return;
      setShowExpandSelector(true);
    },
    [isExpandingImage]
  );

  // 处理扩图选择完成（直接生成带空白画布并交给 Gemini 填充）
  const handleExpandSelect = useCallback(
    async (
      selectedBounds: { x: number; y: number; width: number; height: number },
      _expandRatios: { left: number; top: number; right: number; bottom: number }
    ) => {
      setShowExpandSelector(false);
      setIsExpandingImage(true);

      try {
        const selectedRight = selectedBounds.x + selectedBounds.width;
        const selectedBottom = selectedBounds.y + selectedBounds.height;
        const imageRight = realTimeBounds.x + realTimeBounds.width;
        const imageBottom = realTimeBounds.y + realTimeBounds.height;

        const hasExpandArea =
          selectedBounds.x < realTimeBounds.x - 0.5 ||
          selectedBounds.y < realTimeBounds.y - 0.5 ||
          selectedRight > imageRight + 0.5 ||
          selectedBottom > imageBottom + 0.5;

        if (!hasExpandArea) {
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: {
                message: "请拖出包含空白区的扩展范围后再尝试",
                type: "error",
              },
            })
          );
          return;
        }

        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message: "⏳ 正在准备扩图画布并发送给 Gemini...", type: "info" },
          })
        );

        const baseImageDataUrl = await resolveImageDataUrl();
        if (!baseImageDataUrl) {
          throw new Error("无法获取当前图片数据");
        }

        const composed = await _composeExpandedImage(
          baseImageDataUrl,
          realTimeBounds,
          selectedBounds
        );

        logger.info("🔁 调用 Gemini edit-image 进行扩图", {
          imageId: imageData.id,
          aiProvider: EXPAND_PROVIDER,
          model: EXPAND_MODEL,
          prompt: EXPAND_PRESET_PROMPT,
          composedSize: { width: composed.width, height: composed.height },
        });

        const editResult = await aiImageService.editImage({
          prompt: EXPAND_PRESET_PROMPT,
          sourceImage: composed.dataUrl,
          model: EXPAND_MODEL,
          aiProvider: EXPAND_PROVIDER,
          outputFormat: "png",
          imageOnly: true,
        });

        if (!editResult.success || !editResult.data?.imageData) {
          throw new Error(editResult.error?.message || "扩图失败");
        }

        const finalImageUrl = ensureDataUrlString(
          editResult.data.imageData,
          "image/png"
        );

        const originalCenter = {
          x: realTimeBounds.x + realTimeBounds.width / 2,
          y: realTimeBounds.y + realTimeBounds.height / 2,
        };
        const expandPlacementGap = Math.max(
          32,
          Math.min(120, realTimeBounds.width * 0.1)
        );
        const expandResultCenter = {
          x: originalCenter.x - realTimeBounds.width - expandPlacementGap,
          y: originalCenter.y,
        };

        window.dispatchEvent(
          new CustomEvent("triggerQuickImageUpload", {
            detail: {
              imageData: finalImageUrl,
              fileName: `expanded-${Date.now()}.png`,
              selectedImageBounds: selectedBounds,
              smartPosition: expandResultCenter,
              operationType: "expand-image",
              sourceImageId: imageData.id,
            },
          })
        );

        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message: "✨ 扩图完成，已生成新图", type: "success" },
          })
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "扩图失败";
        logger.error("扩图失败", error);
        window.dispatchEvent(
          new CustomEvent("toast", {
            detail: { message, type: "error" },
          })
        );
      } finally {
        setIsExpandingImage(false);
        setDrawMode("select");
      }
    },
    [resolveImageDataUrl, imageData.id, realTimeBounds, setDrawMode]
  );

  const handleOptimizeHdImage = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isOptimizingHd) return;

      const execute = async () => {
        setIsOptimizingHd(true);
        try {
          // 获取图片数据
          const baseImage = await resolveImageDataUrl();
          if (!baseImage) {
            throw new Error("无法获取原图");
          }

          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: {
                message: "⏳ 开始高清放大（4K），请稍候...",
                type: "info",
              },
            })
          );

          // 使用 Banana provider 进行高清放大（只有 Banana 支持 imageSize 参数）
          const HD_UPSCALE_MODEL = "gemini-3-pro-image-preview";
          const HD_UPSCALE_PROVIDER = "banana";

          logger.info("📷 高清放大 - 使用 Banana editImage (4K)", {
            aiProvider: HD_UPSCALE_PROVIDER,
            model: HD_UPSCALE_MODEL,
            imageSize: "4K"
          });

          const editResult = await aiImageService.editImage({
            prompt: "请将这张图片进行高清放大处理，提升分辨率到4K级别，保持原图的所有细节、颜色、构图和风格完全不变，只增强清晰度和分辨率，不要添加或修改任何内容",
            sourceImage: baseImage,
            model: HD_UPSCALE_MODEL,
            aiProvider: HD_UPSCALE_PROVIDER,
            outputFormat: "png",
            imageSize: "4K",
            imageOnly: true,
          });

          if (!editResult.success || !editResult.data?.imageData) {
            throw new Error(editResult.error?.message || "高清放大失败");
          }

          const resultImageData = editResult.data.imageData.startsWith("data:image")
            ? editResult.data.imageData
            : `data:image/png;base64,${editResult.data.imageData}`;

          // 直接下载 4K 图片，不加载到画布
          const fileName = `hd-4k-${Date.now()}.png`;
          const link = document.createElement("a");
          link.href = resultImageData;
          link.download = fileName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);

          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: {
                message: "✨ 高清放大完成（4K），已下载",
                type: "success",
              },
            })
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "高清放大失败";
          logger.error("高清放大失败", error);
          window.dispatchEvent(
            new CustomEvent("toast", {
              detail: { message, type: "error" },
            })
          );
        } finally {
          setIsOptimizingHd(false);
        }
      };

      execute();
    },
    [resolveImageDataUrl, imageData.id, isOptimizingHd, realTimeBounds]
  );

  // 处理扩图取消
  const handleExpandCancel = useCallback(() => {
    setShowExpandSelector(false);
    // 恢复画板的默认选择模式
    setDrawMode("select");
  }, [setDrawMode]);

  const basePreviewSrc = useMemo(() => {
    const candidate =
      getImageDataForEditing?.(imageData.id) ||
      imageData.url ||
      imageData.src ||
      imageData.localDataUrl;
    return normalizeImageSrc(candidate);
  }, [
    getImageDataForEditing,
    imageData.id,
    imageData.url,
    imageData.src,
    imageData.localDataUrl,
  ]);

  const previewCollection = useMemo<ImageItem[]>(() => {
    const mapBySrc = new Map<string, ImageItem>();

    // 判断文件名是否以.png结尾
    const isPngFileName = (title?: string): boolean => {
      if (!title) return false;
      return title.toLowerCase().endsWith(".png");
    };

    // 处理历史图片，优先保留非.png命名的图片
    // 只按URL去重，避免误判不同内容的图片为重复
    relatedHistoryImages.forEach((item) => {
      if (!item.src) return;
      const normalizedSrc = normalizeImageSrc(item.src);
      if (!normalizedSrc) return;

      const existing = mapBySrc.get(normalizedSrc);
      const currentIsPng = isPngFileName(item.title);

      // 如果URL相同，按URL去重
      if (existing) {
        const existingIsPng = isPngFileName(existing.title);

        // 优先保留非.png命名的图片
        if (currentIsPng && !existingIsPng) {
          // 当前是.png，已存在的是非.png，保留已存在的
          return;
        } else if (!currentIsPng && existingIsPng) {
          // 当前是非.png，已存在的是.png，替换为当前的
          mapBySrc.set(normalizedSrc, {
            ...item,
            src: normalizedSrc,
          });
        } else {
          // 两者都是.png或都不是.png，保留已存在的（避免重复）
          return;
        }
      } else {
        // 如果URL不同，认为是不同的图片，直接添加
        mapBySrc.set(normalizedSrc, {
          ...item,
          src: normalizedSrc,
        });
      }
    });

    // 处理当前选中的图片
    if (basePreviewSrc) {
      const currentItem: ImageItem = {
        id: imageData.id,
        src: basePreviewSrc,
        title: imageData.fileName || `图片 ${imageData.id}`,
        timestamp: localPreviewTimestamp,
      };
      const existing = mapBySrc.get(basePreviewSrc);
      const currentIsPng = isPngFileName(imageData.fileName);

      // 如果URL相同
      if (existing) {
        const existingIsPng = isPngFileName(existing.title);

        // 如果当前选中的是.png，且已存在非.png的，则隐藏当前选中的（不添加到集合）
        if (currentIsPng && !existingIsPng) {
          // 不添加，保留已存在的非.png版本，继续执行返回结果
        } else if (!currentIsPng && existingIsPng) {
          // 当前是非.png，已存在的是.png，替换为当前的
          mapBySrc.set(basePreviewSrc, currentItem);
        } else {
          // 两者都是.png或都不是.png，更新为当前选中的
          mapBySrc.set(basePreviewSrc, currentItem);
        }
      } else {
        // 如果URL不同，认为是不同的图片，直接添加
        mapBySrc.set(basePreviewSrc, currentItem);
      }
    }

    return Array.from(mapBySrc.values());
  }, [
    basePreviewSrc,
    imageData.fileName,
    imageData.id,
    relatedHistoryImages,
    localPreviewTimestamp,
  ]);

  const activePreviewId = previewImageId ?? imageData.id;
  const activePreviewSrc = useMemo(() => {
    if (!previewCollection.length) return "";
    const target = previewCollection.find(
      (item) => item.id === activePreviewId
    );
    return target?.src || previewCollection[0]?.src || "";
  }, [activePreviewId, previewCollection]);

  useEffect(() => {
    if (!showPreview) return;
    if (!previewCollection.length) return;
    const exists = previewCollection.some(
      (item) => item.id === activePreviewId
    );
    if (!exists) {
      setPreviewImageId(previewCollection[0].id);
    }
  }, [activePreviewId, previewCollection, showPreview]);
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ imageId?: string }>).detail;
      if (detail?.imageId === imageData.id) {
        setShowPreview(true);
        setPreviewImageId(imageData.id);
      }
    };
    window.addEventListener(
      "canvas:image-open-preview",
      handler as EventListener
    );
    return () =>
      window.removeEventListener(
        "canvas:image-open-preview",
        handler as EventListener
      );
  }, [imageData.id]);

  // 已简化 - 移除了所有鼠标事件处理逻辑，让Paper.js完全处理交互

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: screenBounds.width,
        height: screenBounds.height,
        transform: `translate3d(${screenBounds.x}px, ${screenBounds.y}px, 0)`,
        willChange: "transform",
        zIndex: 10 + layerIndex * 2 + (isSelected ? 1 : 0), // 大幅降低z-index，确保在对话框下方
        cursor: "default",
        userSelect: "none",
        pointerEvents: "none", // 让所有鼠标事件穿透到Paper.js
        display: visible ? "block" : "none", // 根据visible属性控制显示/隐藏
      }}
    >
      {/* 透明覆盖层，让交互穿透到Paper.js */}
      <div
        style={{
          width: "100%",
          height: "100%",
          backgroundColor: "transparent",
          pointerEvents: "none",
        }}
      />

      {/* 图片信息条 - 选中时显示在图片内部顶部，左上角显示名称，右上角显示分辨率 */}
      {isSelected && !showExpandSelector && !shouldHideUi && (
        <div
          style={{
            position: 'absolute',
            top: 4 * toolbarScale,
            left: 4 * toolbarScale,
            right: 4 * toolbarScale,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            minWidth: 0,
          }}
        >
          {/* 左侧：图片名称 */}
          <span
            style={{
              fontWeight: 500,
              fontSize: 10 * toolbarScale,
              color: '#fff',
              padding: `${2 * toolbarScale}px ${4 * toolbarScale}px`,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '60%',
            }}
            title={imageData.fileName || `图片 ${imageData.id}`}
          >
            {imageData.fileName || `图片 ${imageData.id}`}
          </span>
          {/* 右侧：分辨率 */}
          {naturalSize && (
            <span
              style={{
                fontSize: 10 * toolbarScale,
                color: '#fff',
                padding: `${2 * toolbarScale}px ${4 * toolbarScale}px`,
                marginLeft: 4 * toolbarScale,
                flexShrink: 0,
              }}
            >
              {`${naturalSize.width} × ${naturalSize.height}`}
            </span>
          )}
        </div>
      )}

      {/* 扩图选择器 - 截图时显示，隐藏小工具栏 */}
      {showExpandSelector && (
        <ExpandImageSelector
          imageBounds={realTimeBounds}
          imageId={imageData.id}
          imageUrl={imageData.url || imageData.src || ""}
          onSelect={handleExpandSelect}
          onCancel={handleExpandCancel}
        />
      )}

      {/* 图片操作按钮组 - 只在选中时显示，位于图片底部，截图时隐藏 */}
      {isSelected && showIndividualTools && !showExpandSelector && !shouldHideUi && (
        <div
          className="absolute"
          data-image-toolbar="true"
          style={{
            top: '100%',
            marginTop: 12 * toolbarScale,
            left: '50%',
            transform: `translateX(-50%) scale(${toolbarScale})`,
            transformOrigin: 'top center',
            zIndex: 30,
            pointerEvents: 'auto',
            willChange: 'transform',
          }}
        >
          <div className='flex items-center gap-2 px-2 py-2 rounded-[999px] bg-liquid-glass backdrop-blur-minimal backdrop-saturate-125 shadow-liquid-glass-lg border border-liquid-glass'>
            {/* 暂时隐藏：添加到AI对话框进行编辑按钮
            <Button
              variant='outline'
              size='sm'
              className={sharedButtonClass}
              onClick={handleAIEdit}
              title='添加到AI对话框进行编辑'
              style={sharedButtonStyle}
            >
              <Sparkles className={sharedIconClass} />
            </Button>
            */}

            <Button
              variant='ghost'
              size='sm'
              disabled={isRemovingBackground}
              className={sharedButtonClass}
              onClick={handleBackgroundRemoval}
              title={isRemovingBackground ? "正在抠图..." : "一键抠图"}
            >
              {isRemovingBackground ? (
                <LoadingSpinner size='sm' className='text-blue-600' />
              ) : (
                <Wand2 className={sharedIconClass} />
              )}
              {showButtonText && <span>一键抠图</span>}
            </Button>

            <Button
              variant='ghost'
              size='sm'
              disabled={isConvertingTo3D}
              className={sharedButtonClass}
              onClick={handleConvertTo3D}
              title={isConvertingTo3D ? "正在转换3D..." : "2D转3D"}
            >
              {isConvertingTo3D ? (
                <LoadingSpinner size='sm' className='text-blue-600' />
              ) : (
                <Rotate3d className={sharedIconClass} />
              )}
              {showButtonText && <span>2D转3D</span>}
            </Button>

            <Button
              variant='ghost'
              size='sm'
              disabled={isOptimizingHd}
              className={sharedButtonClass}
              onClick={handleOptimizeHdImage}
              title={isOptimizingHd ? "正在高清放大..." : "高清放大"}
            >
              {isOptimizingHd ? (
                <LoadingSpinner size='sm' className='text-blue-600' />
              ) : (
                <ImageUp className={sharedIconClass} />
              )}
              {showButtonText && <span>高清放大</span>}
            </Button>

            <Button
              variant='ghost'
              size='sm'
              disabled={isExpandingImage || showExpandSelector}
              className={sharedButtonClass}
              onClick={handleExpandImage}
              title={
                isExpandingImage
                  ? "正在扩图..."
                  : showExpandSelector
                  ? "请选择扩图区域"
                  : "图片拓展"
              }
            >
              {isExpandingImage ? (
                <LoadingSpinner size='sm' className='text-blue-600' />
              ) : (
                <Crop className={sharedIconClass} />
              )}
              {showButtonText && <span>图片拓展</span>}
            </Button>

            {enableVisibilityToggle && (
              <Button
                variant='ghost'
                size='sm'
                className={sharedButtonClass}
                onClick={handleToggleVisibility}
                title='隐藏图层（可在图层面板中恢复）'
              >
                <EyeOff className={sharedIconClass} />
              </Button>
            )}

            <Button
              variant='ghost'
              size='sm'
              className={sharedButtonClass}
              onClick={handleCreateFlowImageNode}
              title='生成节点'
            >
              <ArrowRightLeft className={sharedIconClass} />
              {showButtonText && <span>生成节点</span>}
            </Button>
          </div>
        </div>
      )}

      {/* 图片预览模态框 */}
      <ImagePreviewModal
        isOpen={showPreview}
        imageSrc={activePreviewSrc}
        imageTitle={imageData.fileName || `图片 ${imageData.id}`}
        onClose={() => {
          setShowPreview(false);
          setPreviewImageId(null);
        }}
        imageCollection={previewCollection}
        currentImageId={activePreviewId}
        onImageChange={(imageId: string) => setPreviewImageId(imageId)}
        collectionTitle='项目内图片'
      />
    </div>
  );
};

export default ImageContainer;
