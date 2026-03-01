/**
 * Paper.js扩展类型定义
 * 补充Paper.js中缺失的类型定义
 */

import paper from 'paper';

// 扩展Paper.js Path类型
export interface ExtendedPath extends Omit<paper.Path, 'data'> {
  startPoint?: paper.Point;
  data?: PaperItemData;
}

// Paper.js项目数据类型
export interface PaperItemData {
  type?: 'image' | '3d-model' | 'drawing' | 'selection' | 'model3d-placeholder';
  imageId?: string;
  modelId?: string;
  tool?: string;
  isHelper?: boolean;
  isSelectionBorder?: boolean;
  isResizeHandle?: boolean;
  belongsTo?: string;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  buttonElements?: paper.Item[];
  textElement?: paper.PointText;
  parentPlaceholder?: paper.Path.Rectangle;
}

// 鼠标事件扩展类型
export interface PaperMouseEvent extends paper.MouseEvent {
  event: MouseEvent;
}

// 分组项目类型
export interface ExtendedGroup extends Omit<paper.Group, 'data'> {
  data?: PaperItemData;
}

// 栅格图像类型
export interface ExtendedRaster extends Omit<paper.Raster, 'data'> {
  data?: PaperItemData;
}

// 文本类型
export interface ExtendedPointText extends Omit<paper.PointText, 'data'> {
  data?: PaperItemData;
}

// Paper.js项目类型联合
export type ExtendedPaperItem = 
  | ExtendedPath 
  | ExtendedGroup 
  | ExtendedRaster 
  | ExtendedPointText 
  | paper.Item;