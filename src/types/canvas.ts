/**
 * 画布相关的类型定义
 * 用于图片工具、3D模型工具等功能的类型约束
 */

import type { ExtendedPath } from './paper';
import type { Model3DData } from '@/services/model3DUploadService';
import paper from 'paper';

// 2D图片实例类型
export interface StoredImageAsset {
  id: string;
  url: string;
  key?: string;
  fileName?: string;
  width?: number;
  height?: number;
  contentType?: string;
  src?: string;
  pendingUpload?: boolean;
  localDataUrl?: string;
}

export interface ImageInstance {
  id: string;
  imageData: StoredImageAsset;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  isSelected: boolean;
  visible: boolean;
  layerId?: string;
  selectionRect?: paper.Path;
}

// 3D模型实例类型
export interface Model3DInstance {
  id: string;
  modelData: Model3DData;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  isSelected: boolean;
  visible: boolean;
  selectionRect?: paper.Path;
  layerId?: string;
}

// 图片拖拽状态类型
export interface ImageDragState {
  isImageDragging: boolean;
  dragImageId: string | null;
  imageDragStartPoint: paper.Point | null;
  imageDragStartBounds: { x: number; y: number } | null;
}

// 图片调整大小状态类型
export interface ImageResizeState {
  isImageResizing: boolean;
  resizeImageId: string | null;
  resizeDirection: string | null;
  resizeStartBounds: paper.Rectangle | null;
  resizeStartPoint: paper.Point | null;
}

// 图片工具事件处理器类型
export interface ImageToolEventHandlers {
  onImageSelect?: (imageId: string) => void;
  onImageMultiSelect?: (imageIds: string[]) => void;  // 批量选择
  onImageDeselect?: () => void;
  onImageMove?: (imageId: string, newPosition: { x: number; y: number }) => void;
  onImageResize?: (imageId: string, newBounds: { x: number; y: number; width: number; height: number }) => void;
  onImageDelete?: (imageId: string) => void;
}

// 3D模型工具事件处理器类型
export interface Model3DToolEventHandlers {
  onModel3DSelect?: (modelId: string) => void;
  onModel3DMultiSelect?: (modelIds: string[]) => void;  // 批量选择
  onModel3DDeselect?: () => void;
  onModel3DMove?: (modelId: string, newPosition: { x: number; y: number }) => void;
  onModel3DResize?: (modelId: string, newBounds: { x: number; y: number; width: number; height: number }) => void;
}

// 绘图工具状态类型
export interface DrawingToolState {
  currentPath: ExtendedPath | null;
  isDrawing: boolean;
  initialClickPoint: paper.Point | null;
  hasMoved: boolean;
  dragThreshold: number;
}

// 绘图工具事件处理器类型
export interface DrawingToolEventHandlers {
  onPathCreate?: (path: ExtendedPath) => void;
  onPathComplete?: (path: ExtendedPath) => void;
  onDrawStart?: (drawMode: string) => void;
  onDrawEnd?: (drawMode: string) => void;
}

// 绘图上下文类型（用于在hooks间共享绘图相关的基础功能）
export interface DrawingContext {
  ensureDrawingLayer: () => paper.Layer;
  zoom: number;
}
