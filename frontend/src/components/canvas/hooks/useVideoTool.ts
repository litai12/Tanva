/**
 * 视频工具Hook
 * 处理视频上传、占位框创建、视频实例管理、选择、移动和调整大小等功能
 */

import { useCallback, useRef, useState } from "react";
import paper from "paper";
import { logger } from "@/utils/logger";
import { historyService } from "@/services/historyService";
import { paperSaveService } from "@/services/paperSaveService";
import { isGroup, isRaster } from "@/utils/paperCoords";
import { toRenderableImageSrc } from "@/utils/imageSource";
import type {
  VideoInstance,
  VideoDragState,
  VideoResizeState,
  VideoToolEventHandlers,
  DrawingContext,
  StoredVideoAsset,
} from "@/types/canvas";
import type { VideoAssetSnapshot } from "@/types/project";
import { useLayerStore } from "@/stores/layerStore";

interface UseVideoToolProps {
  context: DrawingContext;
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
  eventHandlers?: VideoToolEventHandlers;
}

export const useVideoTool = ({
  context,
  canvasRef,
  eventHandlers = {},
}: UseVideoToolProps) => {
  const { ensureDrawingLayer, zoom } = context;

  // 视频相关状态
  const [triggerVideoUpload, setTriggerVideoUpload] = useState(false);
  const currentPlaceholderRef = useRef<paper.Group | null>(null);
  const [videoInstances, setVideoInstances] = useState<VideoInstance[]>([]);
  const [selectedVideoIds, setSelectedVideoIds] = useState<string[]>([]);
  const [selectedPlaceholderId, setSelectedPlaceholderId] = useState<
    string | null
  >(null);
  const placeholdersRef = useRef<Map<string, paper.Group>>(new Map());

  // 视频拖拽状态
  const [videoDragState, setVideoDragState] = useState<VideoDragState>({
    isVideoDragging: false,
    dragVideoId: null,
    videoDragStartPoint: null,
    videoDragStartBounds: null,
    groupVideoIds: undefined,
    groupStartBounds: undefined,
  });

  // 视频调整大小状态
  const [videoResizeState, setVideoResizeState] = useState<VideoResizeState>({
    isVideoResizing: false,
    resizeVideoId: null,
    resizeDirection: null,
    resizeStartBounds: null,
    resizeStartPoint: null,
  });

  // ========== 创建视频占位框 ==========
  const createVideoPlaceholder = useCallback(
    (startPoint: paper.Point, endPoint: paper.Point) => {
      ensureDrawingLayer();

      // 计算占位框矩形
      const rect = new paper.Rectangle(startPoint, endPoint);
      const center = rect.center;
      const width = Math.abs(rect.width);
      const height = Math.abs(rect.height);

      // 最小尺寸限制
      const minSize = 100; // 视频占位框稍微大一点
      const finalWidth = Math.max(width, minSize);
      const finalHeight = Math.max(height, minSize);

      // 创建占位框边框（虚线矩形）
      const placeholder = new paper.Path.Rectangle({
        rectangle: new paper.Rectangle(
          center.subtract([finalWidth / 2, finalHeight / 2]),
          [finalWidth, finalHeight]
        ),
        strokeColor: new paper.Color("#8b5cf6"), // 紫色边框，与视频主题呼应
        strokeWidth: 1,
        dashArray: [8, 6],
        fillColor: new paper.Color(0.96, 0.94, 1, 0.8), // 淡紫色半透明背景
      });

      // 创建上传按钮背景（圆角矩形）
      const buttonSize = Math.min(finalWidth * 0.6, finalHeight * 0.3, 140);
      const buttonHeight = Math.min(45, finalHeight * 0.25);

      const buttonBg = new paper.Path.Rectangle({
        rectangle: new paper.Rectangle(
          center.subtract([buttonSize / 2, buttonHeight / 2]),
          [buttonSize, buttonHeight]
        ),
        fillColor: new paper.Color("#8b5cf6"), // 紫色
        strokeColor: new paper.Color("#7c3aed"), // 深紫色边框
        strokeWidth: 1,
      });

      // 创建播放图标（三角形）
      const iconSize = Math.min(16, buttonHeight * 0.4);
      const triangle = new paper.Path();
      triangle.add(new paper.Point(center.x - iconSize / 2, center.y - iconSize / 2));
      triangle.add(new paper.Point(center.x + iconSize / 2, center.y));
      triangle.add(new paper.Point(center.x - iconSize / 2, center.y + iconSize / 2));
      triangle.closePath();
      triangle.fillColor = new paper.Color("#fff");

      // 上传按钮组合
      const buttonGroup = new paper.Group([buttonBg, triangle]);
      buttonGroup.data = {
        uploadHotspotType: "video",
      };

      // 创建提示文字
      const textY = Math.round(center.y + buttonHeight / 2 + 25);
      const fontSize = Math.round(
        Math.min(14, finalWidth * 0.06, finalHeight * 0.08)
      );
      const text = new paper.PointText({
        point: new paper.Point(Math.round(center.x), textY),
        content: "点击上传视频",
        fontSize: fontSize,
        fillColor: new paper.Color("#7c3aed"),
        justification: "center",
      });

      // 生成唯一ID
      const placeholderId = `video-placeholder_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;

      // 创建组合
      const group = new paper.Group([placeholder, buttonGroup, text]);
      group.data = {
        type: "video-placeholder",
        placeholderId: placeholderId,
        bounds: {
          x: center.x - finalWidth / 2,
          y: center.y - finalHeight / 2,
          width: finalWidth,
          height: finalHeight,
        },
        isHelper: true,
        placeholderMinSize: minSize,
      };

      const attachPlaceholderMeta = (item: any) => {
        if (item) {
          item.data = {
            ...(item.data || {}),
            placeholderGroupId: placeholderId,
            placeholderType: "video",
            isHelper: true,
          };
        }
      };
      [placeholder, buttonGroup, buttonBg, triangle, text].forEach(
        attachPlaceholderMeta
      );

      // 按钮点击事件
      const triggerUpload = () => {
        logger.upload("🎬 点击视频上传按钮，触发上传");
        currentPlaceholderRef.current = group;
        setTriggerVideoUpload(true);
      };
      buttonGroup.onClick = triggerUpload;

      // 占位框点击选中
      placeholder.onClick = () => {
        setSelectedPlaceholderId(placeholderId);
        placeholder.strokeColor = new paper.Color("#7c3aed");
        placeholder.strokeWidth = 2;
      };

      // 存储占位框引用
      placeholdersRef.current.set(placeholderId, group);

      return group;
    },
    [ensureDrawingLayer]
  );

  // ========== 处理视频上传成功 ==========
  const handleVideoUploaded = useCallback(
    (
      asset: StoredVideoAsset,
      options?: { suppressAutoSave?: boolean; autoSaveReason?: string }
    ) => {
      const placeholder = currentPlaceholderRef.current;
      if (!placeholder || !placeholder.data?.bounds) {
        logger.error("没有找到视频占位框");
        return;
      }

      if (!asset || !asset.url) {
        logger.error("无有效视频资源");
        return;
      }

      const suppressAutoSave = Boolean(options?.suppressAutoSave);
      const autoSaveReason = options?.autoSaveReason || "video-uploaded";

      logger.upload("✅ 视频上传成功，创建视频实例");

      const paperBounds = placeholder.data.bounds;
      const videoId =
        asset.id ||
        `video_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      ensureDrawingLayer();

      // 创建视频占位符矩形（显示缩略图或占位符）
      const videoRect = new paper.Path.Rectangle({
        rectangle: new paper.Rectangle(
          paperBounds.x,
          paperBounds.y,
          paperBounds.width,
          paperBounds.height
        ),
        fillColor: new paper.Color(0.1, 0.1, 0.1, 0.9), // 深色背景
        strokeColor: new paper.Color("#8b5cf6"),
        strokeWidth: 2,
      });

      // 如果有缩略图，尝试加载
      if (asset.thumbnail) {
        const thumbnail = new paper.Raster();
        thumbnail.onLoad = () => {
          // 缩略图加载完成后调整大小和位置
          const aspectRatio = thumbnail.width / thumbnail.height;
          const rectAspectRatio = paperBounds.width / paperBounds.height;

          let finalBounds;
          if (aspectRatio > rectAspectRatio) {
            const newWidth = paperBounds.width;
            const newHeight = newWidth / aspectRatio;
            const yOffset = (paperBounds.height - newHeight) / 2;
            finalBounds = new paper.Rectangle(
              paperBounds.x,
              paperBounds.y + yOffset,
              newWidth,
              newHeight
            );
          } else {
            const newHeight = paperBounds.height;
            const newWidth = newHeight * aspectRatio;
            const xOffset = (paperBounds.width - newWidth) / 2;
            finalBounds = new paper.Rectangle(
              paperBounds.x + xOffset,
              paperBounds.y,
              newWidth,
              newHeight
            );
          }
          thumbnail.bounds = finalBounds;
        };
        thumbnail.source = toRenderableImageSrc(asset.thumbnail) || asset.thumbnail;
        videoRect.addChild(thumbnail);
      }

      // 添加播放按钮图标
      const playButtonSize = Math.min(paperBounds.width * 0.3, paperBounds.height * 0.3, 40);
      const playTriangle = new paper.Path();
      const centerX = paperBounds.x + paperBounds.width / 2;
      const centerY = paperBounds.y + paperBounds.height / 2;
      playTriangle.add(new paper.Point(centerX - playButtonSize / 2, centerY - playButtonSize / 2));
      playTriangle.add(new paper.Point(centerX + playButtonSize / 2, centerY));
      playTriangle.add(new paper.Point(centerX - playButtonSize / 2, centerY + playButtonSize / 2));
      playTriangle.closePath();
      playTriangle.fillColor = new paper.Color("#fff");
      playTriangle.opacity = 0.8;

      // 创建视频组
      const videoGroup = new paper.Group([videoRect, playTriangle]);
      videoGroup.data = {
        type: "video",
        videoId: videoId,
        isHelper: false,
      };

      // 添加选择元素
      addVideoSelectionElements(videoGroup, new paper.Rectangle(paperBounds), videoId);

      // 创建视频实例
      const newVideoInstance: VideoInstance = {
        id: videoId,
        videoData: {
          ...asset,
          id: videoId,
        },
        bounds: {
          x: paperBounds.x,
          y: paperBounds.y,
          width: paperBounds.width,
          height: paperBounds.height,
        },
        isSelected: false,
        visible: true,
        layerId: paper.project.activeLayer.name,
      };

      setVideoInstances((prev) => [...prev, newVideoInstance]);

      // 清理占位框
      placeholder.remove();
      currentPlaceholderRef.current = null;

      logger.upload("🎬 视频实例创建完成:", videoId);
      if (!suppressAutoSave) {
        try {
          paperSaveService.triggerAutoSave(autoSaveReason);
        } catch {}
      }
    },
    [ensureDrawingLayer]
  );

  // ========== 添加视频选择元素 ==========
  const addVideoSelectionElements = useCallback(
    (videoGroup: paper.Group, bounds: paper.Rectangle, videoId: string) => {
      // 添加选择区域（透明点击热区）
      const selectionArea = new paper.Path.Rectangle({
        rectangle: bounds,
        fillColor: new paper.Color(0, 0, 0, 0.001),
        strokeColor: null,
        visible: true,
        selected: false,
      });
      selectionArea.data = {
        type: "video-selection-area",
        videoId,
        isHelper: true,
      };
      videoGroup.addChild(selectionArea);

      // 添加选择框（默认隐藏）
      const selectionBorder = new paper.Path.Rectangle({
        rectangle: bounds,
        strokeColor: new paper.Color("#8b5cf6"),
        strokeWidth: 1,
        fillColor: null,
        selected: false,
        visible: false,
      });
      selectionBorder.data = {
        isSelectionBorder: true,
        isHelper: true,
      };
      videoGroup.addChild(selectionBorder);

      // 添加四个角的调整控制点
      const handleSize = 12;
      const handleColor = new paper.Color("#8b5cf6");

      const handles = [
        { direction: "nw", position: [bounds.left, bounds.top] },
        { direction: "ne", position: [bounds.right, bounds.top] },
        { direction: "sw", position: [bounds.left, bounds.bottom] },
        { direction: "se", position: [bounds.right, bounds.bottom] },
      ];

      handles.forEach(({ direction, position }) => {
        const handle = new paper.Path.Rectangle({
          point: [position[0] - handleSize / 2, position[1] - handleSize / 2],
          size: [handleSize, handleSize],
          fillColor: "white",
          strokeColor: handleColor,
          strokeWidth: 1,
          selected: false,
          visible: false,
        });
        handle.data = {
          isResizeHandle: true,
          direction,
          videoId,
          isHelper: true,
        };
        videoGroup.addChild(handle);
      });
    },
    []
  );

  // ========== 获取视频数据 ==========
  const getVideoDataForEditing = useCallback(
    (videoId: string): StoredVideoAsset | null => {
      const videoInstance = videoInstances.find((video) => video.id === videoId);
      if (!videoInstance) return null;
      return videoInstance.videoData;
    },
    [videoInstances]
  );

  // 检查图层是否可见
  const isLayerVisible = useCallback((videoId: string) => {
    const videoGroup = findVideoPaperItem(videoId);
    if (videoGroup) {
      const currentLayer = videoGroup.layer;
      if (currentLayer) {
        return currentLayer.visible;
      }
    }
    return true;
  }, []);

  // ========== 视频选择 ==========
  const updateVideoSelectionVisuals = useCallback((selectedIds: string[]) => {
    setVideoInstances((prev) =>
      prev.map((video) => {
        const isSelected = selectedIds.includes(video.id);
        const videoGroup = findVideoPaperItem(video.id);

        if (videoGroup && videoGroup.children) {
          videoGroup.children.forEach((child) => {
            if (child.data?.isSelectionBorder || child.data?.isResizeHandle) {
              child.visible = isSelected;
            }
          });
        }

        return {
          ...video,
          isSelected,
        };
      })
    );
    paper.view.update();
  }, []);

  const handleVideoSelect = useCallback(
    (videoId: string, addToSelection: boolean = false) => {
      if (!isLayerVisible(videoId)) {
        logger.debug("图层不可见，无法选中视频:", videoId);
        return;
      }

      if (addToSelection) {
        setSelectedVideoIds((prev) => {
          if (prev.includes(videoId)) {
            const newIds = prev.filter((id) => id !== videoId);
            updateVideoSelectionVisuals(newIds);
            return newIds;
          } else {
            const newIds = [...prev, videoId];
            updateVideoSelectionVisuals(newIds);
            return newIds;
          }
        });
      } else {
        setSelectedVideoIds([videoId]);
        updateVideoSelectionVisuals([videoId]);
      }

      eventHandlers.onVideoSelect?.(videoId);
    },
    [eventHandlers.onVideoSelect, isLayerVisible, updateVideoSelectionVisuals]
  );

  const handleVideoMultiSelect = useCallback(
    (videoIds: string[]) => {
      const visibleVideoIds = videoIds.filter((id) => isLayerVisible(id));
      logger.upload(`批量选中视频: ${visibleVideoIds.join(", ")}`);
      setSelectedVideoIds(visibleVideoIds);
      updateVideoSelectionVisuals(visibleVideoIds);

      if (eventHandlers.onVideoMultiSelect) {
        eventHandlers.onVideoMultiSelect(visibleVideoIds);
      }
    },
    [eventHandlers.onVideoMultiSelect, isLayerVisible, updateVideoSelectionVisuals]
  );

  const handleVideoDeselect = useCallback(() => {
    setSelectedVideoIds([]);
    updateVideoSelectionVisuals([]);
    eventHandlers.onVideoDeselect?.();
  }, [eventHandlers.onVideoDeselect, updateVideoSelectionVisuals]);

  // ========== 视频移动 ==========
  const applyVideoBoundsToPaper = useCallback(
    (videoId: string, bounds: { x: number; y: number; width: number; height: number }) => {
      const videoGroup = findVideoPaperItem(videoId);
      if (!videoGroup) return false;

      const rect = new paper.Rectangle(bounds.x, bounds.y, bounds.width, bounds.height);

      videoGroup.children?.forEach((child) => {
        if (child.data?.type === "video-selection-area") {
          child.bounds = rect.clone();
        } else if (child.data?.isSelectionBorder) {
          child.bounds = rect.clone();
        } else if (child.data?.isResizeHandle) {
          const direction = child.data.direction;
          let x = bounds.x;
          let y = bounds.y;
          if (direction === "ne" || direction === "se") x = bounds.x + bounds.width;
          if (direction === "sw" || direction === "se") y = bounds.y + bounds.height;
          child.position = new paper.Point(x, y);
        }
      });

      return true;
    },
    []
  );

  const applyVideoMoveToPaper = useCallback(
    (videoId: string, newPosition: { x: number; y: number }) => {
      const videoGroup = findVideoPaperItem(videoId);
      if (!videoGroup) return;

      const currentBounds = videoGroup.bounds;
      if (!currentBounds) return;

      const newBounds = {
        x: newPosition.x,
        y: newPosition.y,
        width: currentBounds.width,
        height: currentBounds.height,
      };

      applyVideoBoundsToPaper(videoId, newBounds);
    },
    [applyVideoBoundsToPaper]
  );

  const handleVideosMove = useCallback(
    (moves: Array<{ id: string; position: { x: number; y: number } }>) => {
      const validMoves = moves.filter(
        (m): m is { id: string; position: { x: number; y: number } } =>
          !!m?.id && !!m?.position
      );
      if (validMoves.length === 0) return;

      validMoves.forEach(({ id, position }) => {
        applyVideoMoveToPaper(id, position);
      });

      syncVideoGroupBlocksForVideoIds(validMoves.map((m) => m.id));
      paper.view.update();

      setVideoInstances((prev) =>
        prev.map((video) => {
          const move = validMoves.find((m) => m.id === video.id);
          if (!move) return video;
          return { ...video, bounds: { ...video.bounds, ...move.position } };
        })
      );

      validMoves.forEach(({ id, position }) => {
        eventHandlers.onVideoMove?.(id, position);
      });
    },
    [applyVideoMoveToPaper, eventHandlers.onVideoMove]
  );

  const handleVideoMove = useCallback(
    (videoId: string, newPosition: { x: number; y: number }) => {
      handleVideosMove([{ id: videoId, position: newPosition }]);
    },
    [handleVideosMove]
  );

  // ========== 视频调整大小 ==========
  const handleVideoResize = useCallback(
    (videoId: string, newBounds: { x: number; y: number; width: number; height: number }) => {
      const videoGroup = findVideoPaperItem(videoId);
      if (!videoGroup) return;

      applyVideoBoundsToPaper(videoId, newBounds);
      syncVideoGroupBlocksForVideoIds([videoId]);
      paper.view.update();

      setVideoInstances((prev) =>
        prev.map((video) => {
          if (video.id === videoId) {
            return { ...video, bounds: newBounds };
          }
          return video;
        })
      );
      eventHandlers.onVideoResize?.(videoId, newBounds);

      try {
        paperSaveService.triggerAutoSave();
      } catch {}
      try {
        historyService.commit("resize-video").catch(() => {});
      } catch {}
    },
    [eventHandlers.onVideoResize, applyVideoBoundsToPaper]
  );

  // ========== 视频删除 ==========
  const handleVideoDelete = useCallback(
    (videoId: string) => {
      logger.debug("🗑️ 开始删除视频:", videoId);

      // 从Paper.js中移除视频对象
      try {
        if (paper && paper.project) {
          const matches = paper.project.getItems({
            match: (item: any) => {
              const d = item?.data || {};
              return d.type === "video" && d.videoId === videoId;
            },
          }) as paper.Item[];

          matches.forEach((item) => {
            try {
              item.remove();
            } catch {}
          });
          syncVideoGroupBlocksForVideoIds([videoId]);
          paper.view.update();
          logger.debug("🗑️ 已从Paper.js中移除视频");
        }
      } catch (e) {
        console.warn("删除Paper对象时出错:", e);
      }

      // 从React状态中移除视频
      setVideoInstances((prev) => {
        const filtered = prev.filter((video) => video.id !== videoId);
        logger.debug("🗑️ 已从状态中移除视频，剩余视频数量:", filtered.length);
        return filtered;
      });

      // 清除选中状态
      if (selectedVideoIds.includes(videoId)) {
        setSelectedVideoIds((prev) => prev.filter((id) => id !== videoId));
        logger.debug("🗑️ 已清除选中状态");
      }

      eventHandlers.onVideoDelete?.(videoId);
      try {
        paperSaveService.triggerAutoSave();
      } catch {}
      historyService.commit("delete-video").catch(() => {});
    },
    [selectedVideoIds, eventHandlers.onVideoDelete]
  );

  // ========== 占位框管理 ==========
  const deletePlaceholder = useCallback(
    (placeholderId?: string) => {
      const idToDelete = placeholderId || selectedPlaceholderId;
      if (!idToDelete) return false;

      const placeholder = placeholdersRef.current.get(idToDelete);
      if (placeholder) {
        try {
          placeholder.remove();
          placeholdersRef.current.delete(idToDelete);
          if (selectedPlaceholderId === idToDelete) {
            setSelectedPlaceholderId(null);
          }
          if (
            currentPlaceholderRef.current?.data?.placeholderId === idToDelete
          ) {
            currentPlaceholderRef.current = null;
          }
          paper.view?.update();
          logger.debug("🗑️ 已删除视频占位框:", idToDelete);
          return true;
        } catch (e) {
          console.warn("删除占位框失败:", e);
        }
      }
      return false;
    },
    [selectedPlaceholderId]
  );

  const deselectPlaceholder = useCallback(() => {
    if (selectedPlaceholderId) {
      const placeholder = placeholdersRef.current.get(selectedPlaceholderId);
      if (placeholder) {
        const border = placeholder.children?.[0];
        if (border instanceof paper.Path) {
          border.strokeColor = new paper.Color("#8b5cf6");
          border.strokeWidth = 1;
        }
      }
      setSelectedPlaceholderId(null);
    }
  }, [selectedPlaceholderId]);

  // ========== 从快照恢复 ==========
  const hydrateFromSnapshot = useCallback(
    (snapshots: VideoAssetSnapshot[]) => {
      if (!Array.isArray(snapshots) || snapshots.length === 0) {
        setVideoInstances([]);
        setSelectedVideoIds([]);
        return;
      }

      // 清理当前Paper.js中的视频对象
      try {
        if (paper && paper.project) {
          const toRemove: paper.Item[] = [];
          (paper.project.layers || []).forEach((layer: any) => {
            const children = layer?.children || [];
            children.forEach((child: any) => {
              if (child?.data?.type === "video") {
                toRemove.push(child);
              }
            });
          });
          toRemove.forEach((item) => {
            try {
              item.remove();
            } catch {}
          });
        }
      } catch {}

      setVideoInstances([]);
      setSelectedVideoIds([]);

      snapshots.forEach((snap) => {
        if (!snap || !snap.url || !snap.bounds) return;

        if (snap.layerId) {
          try {
            useLayerStore.getState().activateLayer(snap.layerId);
          } catch {}
        }

        // 创建视频占位框
        const start = new paper.Point(snap.bounds.x, snap.bounds.y);
        const end = new paper.Point(
          snap.bounds.x + snap.bounds.width,
          snap.bounds.y + snap.bounds.height
        );
        const placeholder = createVideoPlaceholder(start, end);
        if (placeholder) {
          currentPlaceholderRef.current = placeholder;

          const asset: StoredVideoAsset = {
            id: snap.id,
            url: snap.url,
            thumbnail: snap.thumbnail,
            duration: snap.duration,
            width: snap.width,
            height: snap.height,
            fileName: snap.fileName,
            contentType: snap.contentType,
            taskId: snap.taskId,
            status: snap.status,
            sourceUrl: snap.sourceUrl,
            metadata: snap.metadata,
          };

          handleVideoUploaded(asset, { suppressAutoSave: true });
        }
      });

      setVideoInstances((prev) =>
        prev.map((video) => {
          const snap = snapshots.find((s) => s.id === video.id);
          if (!snap) return video;
          return {
            ...video,
            layerId: snap.layerId ?? video.layerId,
            bounds: {
              x: snap.bounds.x,
              y: snap.bounds.y,
              width: snap.bounds.width,
              height: snap.bounds.height,
            },
            videoData: {
              ...video.videoData,
              thumbnail: snap.thumbnail ?? video.videoData.thumbnail,
              duration: snap.duration ?? video.videoData.duration,
              width: snap.width ?? video.videoData.width,
              height: snap.height ?? video.videoData.height,
            },
          };
        })
      );
    },
    [createVideoPlaceholder, handleVideoUploaded]
  );

  return {
    // 状态
    videoInstances,
    selectedVideoIds,
    selectedVideoId: selectedVideoIds[0] || null,
    triggerVideoUpload,
    videoDragState,
    videoResizeState,

    // 占位框相关
    createVideoPlaceholder,
    currentPlaceholderRef,
    selectedPlaceholderId,
    deletePlaceholder,
    deselectPlaceholder,
    placeholdersRef,

    // 视频上传处理
    handleVideoUploaded,

    // 视频选择
    handleVideoSelect,
    handleVideoMultiSelect,
    handleVideoDeselect,

    // 视频移动和调整大小
    handleVideoMove,
    handleVideosMove,
    handleVideoResize,
    handleVideoDelete,

    // 状态设置器
    setVideoInstances,
    setSelectedVideoIds,
    setTriggerVideoUpload,
    setVideoDragState,
    setVideoResizeState,

    // 编辑功能
    getVideoDataForEditing,
    hydrateFromSnapshot,
  };
};

// ========== 辅助函数 ==========

// 查找视频Paper.js对象
function findVideoPaperItem(videoId: string): paper.Group | null {
  if (!paper?.project) return null;

  const items = paper.project.getItems({
    match: (item: any) => {
      const data = item?.data || {};
      return data.type === "video" && data.videoId === videoId;
    },
  }) as paper.Group[];

  return items.length > 0 ? items[0] : null;
}

// 同步视频组块（用于历史记录）
function syncVideoGroupBlocksForVideoIds(videoIds: string[]): void {
  // 实现同步逻辑，如果需要的话
  // 这里可以添加与历史记录相关的同步逻辑
}
