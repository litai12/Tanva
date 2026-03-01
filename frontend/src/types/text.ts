/**
 * 文本工具相关的类型定义
 * 用于文本创建、编辑、样式管理等功能的类型约束
 */

import paper from 'paper';

// 文本实例类型
export interface TextInstance {
  id: string;
  content: string;
  position: {
    x: number;
    y: number;
  };
  style: TextStyle;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  isSelected: boolean;
  isEditing: boolean;
  visible: boolean;
  layerId?: string;
  paperItem?: paper.PointText; // Paper.js 文本对象引用
  selectionRect?: paper.Path; // 选择框
}

// 文本样式类型
export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontColor: string;
  fontWeight: 'normal' | 'bold' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';
  fontStyle: 'normal' | 'italic' | 'oblique';
  textDecoration: 'none' | 'underline' | 'line-through' | 'overline';
  textAlign: 'left' | 'center' | 'right' | 'justify';
  lineHeight: number; // 行高，通常是字体大小的倍数
  letterSpacing: number; // 字符间距，单位像素
  wordSpacing: number; // 单词间距，单位像素
  textTransform: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  opacity: number; // 透明度 0-1
  // 文本效果
  shadow?: TextShadow;
  stroke?: TextStroke;
  background?: TextBackground;
}

// 文本阴影类型
export interface TextShadow {
  enabled: boolean;
  color: string;
  offsetX: number;
  offsetY: number;
  blur: number;
  opacity: number;
}

// 文本描边类型
export interface TextStroke {
  enabled: boolean;
  color: string;
  width: number;
  opacity: number;
}

// 文本背景类型
export interface TextBackground {
  enabled: boolean;
  color: string;
  opacity: number;
  padding: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  borderRadius: number;
}

// 文本工具状态类型
export interface TextToolState {
  isActive: boolean;
  activeTextId: string | null;
  isEditing: boolean;
  editingContent: string;
  isDragging: boolean;
  dragStartPoint: paper.Point | null;
  dragStartBounds: { x: number; y: number } | null;
  isResizing: boolean;
  resizeStartBounds: paper.Rectangle | null;
  resizeDirection: string | null;
}

// 文本工具事件处理器类型
export interface TextToolEventHandlers {
  onTextCreate?: (textInstance: TextInstance) => void;
  onTextSelect?: (textId: string) => void;
  onTextMultiSelect?: (textIds: string[]) => void;
  onTextDeselect?: () => void;
  onTextEdit?: (textId: string, content: string) => void;
  onTextMove?: (textId: string, newPosition: { x: number; y: number }) => void;
  onTextResize?: (textId: string, newBounds: { x: number; y: number; width: number; height: number }) => void;
  onTextStyleChange?: (textId: string, newStyle: Partial<TextStyle>) => void;
  onTextDelete?: (textId: string) => void;
  onEditStart?: (textId: string) => void;
  onEditEnd?: (textId: string, finalContent: string) => void;
}

// 文本创建参数类型
export interface CreateTextParams {
  content: string;
  position: { x: number; y: number };
  style?: Partial<TextStyle>;
  layerId?: string;
}

// 文本编辑器配置类型
export interface TextEditorConfig {
  minFontSize: number;
  maxFontSize: number;
  defaultFontSize: number;
  defaultFontFamily: string;
  defaultColor: string;
  enableRichText: boolean;
  enableAutoResize: boolean;
  enableSpellCheck: boolean;
  placeholder: string;
}

// 文本格式化选项类型
export interface TextFormatOptions {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
  align?: 'left' | 'center' | 'right' | 'justify';
}

// 文本选择状态类型
export interface TextSelection {
  textId: string;
  start: number; // 选择开始位置
  end: number;   // 选择结束位置
  content: string; // 选中的文本内容
}

// 文本拖拽状态类型
export interface TextDragState {
  isTextDragging: boolean;
  dragTextId: string | null;
  textDragStartPoint: paper.Point | null;
  textDragStartBounds: { x: number; y: number } | null;
}

// 文本调整大小状态类型
export interface TextResizeState {
  isTextResizing: boolean;
  resizeTextId: string | null;
  resizeDirection: string | null;
  resizeStartBounds: paper.Rectangle | null;
  resizeStartPoint: paper.Point | null;
}

// 文本操作类型枚举
export enum TextOperation {
  CREATE = 'create',
  EDIT = 'edit',
  MOVE = 'move',
  RESIZE = 'resize',
  STYLE = 'style',
  DELETE = 'delete'
}

// 文本历史记录类型
export interface TextHistoryRecord {
  operation: TextOperation;
  textId: string;
  beforeState: Partial<TextInstance>;
  afterState: Partial<TextInstance>;
  timestamp: Date;
}

// 常用字体列表
export const COMMON_FONTS = [
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Georgia',
  'Courier New',
  'Verdana',
  'Tahoma',
  'Comic Sans MS',
  'Impact',
  'Arial Black',
  'Trebuchet MS',
  'Palatino',
  'Garamond',
  'Bookman',
  'Avant Garde',
  // 中文字体
  'Microsoft YaHei',
  'SimSun',
  'SimHei',
  'KaiTi',
  'FangSong',
  'LiSu',
  'YouYuan',
  // 设计师常用字体
  'Roboto',
  'Open Sans',
  'Lato',
  'Montserrat',
  'Source Sans Pro',
  'Poppins',
  'Oswald',
  'Raleway',
  'PT Sans',
  'Ubuntu'
];

// 默认文本样式
export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "微软雅黑", sans-serif',
  fontSize: 32,
  fontColor: '#000000',
  fontWeight: 'normal',
  fontStyle: 'normal',
  textDecoration: 'none',
  textAlign: 'left',
  lineHeight: 1.2,
  letterSpacing: 0,
  wordSpacing: 0,
  textTransform: 'none',
  opacity: 1,
  shadow: {
    enabled: false,
    color: '#000000',
    offsetX: 0,
    offsetY: 0,
    blur: 0,
    opacity: 0.5
  },
  stroke: {
    enabled: false,
    color: '#000000',
    width: 1,
    opacity: 1
  },
  background: {
    enabled: false,
    color: '#ffffff',
    opacity: 0.8,
    padding: {
      top: 4,
      right: 8,
      bottom: 4,
      left: 8
    },
    borderRadius: 4
  }
};

// 默认文本编辑器配置
export const DEFAULT_TEXT_EDITOR_CONFIG: TextEditorConfig = {
  minFontSize: 8,
  maxFontSize: 200,
  defaultFontSize: 32,
  defaultFontFamily: 'Arial',
  defaultColor: '#000000',
  enableRichText: true,
  enableAutoResize: true,
  enableSpellCheck: false,
  placeholder: '输入文本...'
};
