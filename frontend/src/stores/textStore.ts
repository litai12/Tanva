/**
 * 文本工具状态管理
 * 管理文本实例、样式设置、编辑状态等
 */

// @ts-nocheck
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { logger } from '@/utils/logger';
import type { 
  TextInstance, 
  TextStyle, 
  TextToolState,
  TextHistoryRecord,
  TextOperation,
  CreateTextParams,
  DEFAULT_TEXT_STYLE,
  DEFAULT_TEXT_EDITOR_CONFIG,
  TextEditorConfig
} from '@/types/text';
import { DEFAULT_TEXT_STYLE as defaultStyle, DEFAULT_TEXT_EDITOR_CONFIG as defaultConfig } from '@/types/text';
import { v4 as uuidv4 } from 'uuid';
import paper from 'paper';

interface TextState {
  // 文本实例管理
  textInstances: Map<string, TextInstance>;
  selectedTextIds: Set<string>;
  
  // 工具状态
  toolState: TextToolState;
  
  // 当前文本样式设置
  currentStyle: TextStyle;
  
  // 编辑器配置
  editorConfig: TextEditorConfig;
  
  // 历史记录
  history: TextHistoryRecord[];
  historyIndex: number;
  maxHistorySize: number;
  
  // 基础操作方法
  createText: (params: CreateTextParams) => TextInstance;
  updateText: (textId: string, updates: Partial<TextInstance>) => void;
  deleteText: (textId: string) => void;
  getTextById: (textId: string) => TextInstance | undefined;
  getAllTexts: () => TextInstance[];
  
  // 选择操作
  selectText: (textId: string, multiSelect?: boolean) => void;
  deselectText: (textId?: string) => void;
  deselectAllTexts: () => void;
  isTextSelected: (textId: string) => boolean;
  getSelectedTexts: () => TextInstance[];
  
  // 编辑操作
  startEditText: (textId: string) => void;
  stopEditText: (textId?: string) => void;
  updateTextContent: (textId: string, content: string) => void;
  
  // 样式操作
  setCurrentStyle: (style: Partial<TextStyle>) => void;
  applyStyleToText: (textId: string, style: Partial<TextStyle>) => void;
  applyStyleToSelected: (style: Partial<TextStyle>) => void;
  resetStyleToDefault: (textId?: string) => void;
  
  // 位置和大小操作
  moveText: (textId: string, newPosition: { x: number; y: number }) => void;
  moveSelectedTexts: (deltaX: number, deltaY: number) => void;
  updateTextBounds: (textId: string, bounds: { x: number; y: number; width: number; height: number }) => void;
  
  // 工具状态管理
  setToolState: (updates: Partial<TextToolState>) => void;
  resetToolState: () => void;
  
  // 可见性控制
  setTextVisibility: (textId: string, visible: boolean) => void;
  toggleTextVisibility: (textId: string) => void;
  hideAllTexts: () => void;
  showAllTexts: () => void;
  
  // 图层管理
  moveTextToLayer: (textId: string, layerId: string) => void;
  getTextsByLayer: (layerId: string) => TextInstance[];
  
  // 历史记录
  addToHistory: (record: Omit<TextHistoryRecord, 'timestamp'>) => void;
  undo: () => boolean;
  redo: () => boolean;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clearHistory: () => void;
  
  // 编辑器配置
  updateEditorConfig: (config: Partial<TextEditorConfig>) => void;
  
  // 批量操作
  deleteSelectedTexts: () => void;
  duplicateText: (textId: string) => TextInstance | null;
  duplicateSelectedTexts: () => TextInstance[];
  
  // 查找和替换
  findTexts: (searchTerm: string, caseSensitive?: boolean) => TextInstance[];
  replaceInText: (textId: string, searchTerm: string, replaceTerm: string) => boolean;
  replaceInAllTexts: (searchTerm: string, replaceTerm: string) => number;
  
  // 导入导出
  exportTexts: () => any[];
  importTexts: (textsData: any[]) => void;
  
  // 重置状态
  reset: () => void;
}

// 默认工具状态
const defaultToolState: TextToolState = {
  isActive: false,
  activeTextId: null,
  isEditing: false,
  editingContent: '',
  isDragging: false,
  dragStartPoint: null,
  dragStartBounds: null,
  isResizing: false,
  resizeStartBounds: null,
  resizeDirection: null
};

export const useTextStore = create<TextState>()(
  subscribeWithSelector((set, get) => ({
    // 初始状态
    textInstances: new Map(),
    selectedTextIds: new Set(),
    toolState: { ...defaultToolState },
    currentStyle: { ...defaultStyle },
    editorConfig: { ...defaultConfig },
    history: [],
    historyIndex: -1,
    maxHistorySize: 50,

    // 创建文本
    createText: (params: CreateTextParams) => {
      const id = uuidv4();
      const style = { ...defaultStyle, ...params.style };
      
      const textInstance: TextInstance = {
        id,
        content: params.content,
        position: params.position,
        style,
        bounds: {
          x: params.position.x,
          y: params.position.y,
          width: 100, // 初始宽度，后续会根据内容调整
          height: style.fontSize * style.lineHeight
        },
        isSelected: false,
        isEditing: false,
        visible: true,
        layerId: params.layerId
      };

      set(state => {
        const newInstances = new Map(state.textInstances);
        newInstances.set(id, textInstance);
        
        // 添加到历史记录
        state.addToHistory({
          operation: TextOperation.CREATE,
          textId: id,
          beforeState: {},
          afterState: textInstance
        });
        
        return { textInstances: newInstances };
      });

      logger.debug(`📝 创建文本实例: ${id}`, { content: params.content, position: params.position });
      return textInstance;
    },

    // 更新文本
    updateText: (textId: string, updates: Partial<TextInstance>) => {
      set(state => {
        const instances = new Map(state.textInstances);
        const currentText = instances.get(textId);
        
        if (!currentText) {
          logger.warn(`⚠️ 尝试更新不存在的文本: ${textId}`);
          return state;
        }

        const beforeState = { ...currentText };
        const updatedText = { ...currentText, ...updates };
        instances.set(textId, updatedText);

        // 添加到历史记录
        state.addToHistory({
          operation: TextOperation.EDIT,
          textId,
          beforeState,
          afterState: updatedText
        });

        return { textInstances: instances };
      });
    },

    // 删除文本
    deleteText: (textId: string) => {
      set(state => {
        const instances = new Map(state.textInstances);
        const selectedIds = new Set(state.selectedTextIds);
        const textToDelete = instances.get(textId);
        
        if (!textToDelete) {
          logger.warn(`⚠️ 尝试删除不存在的文本: ${textId}`);
          return state;
        }

        // 从选择中移除
        selectedIds.delete(textId);
        
        // 从实例中移除
        instances.delete(textId);

        // 添加到历史记录
        state.addToHistory({
          operation: TextOperation.DELETE,
          textId,
          beforeState: textToDelete,
          afterState: {}
        });

        // 如果正在编辑这个文本，停止编辑
        const newToolState = { ...state.toolState };
        if (newToolState.activeTextId === textId) {
          newToolState.activeTextId = null;
          newToolState.isEditing = false;
          newToolState.editingContent = '';
        }

        logger.debug(`🗑️ 删除文本实例: ${textId}`);
        return { 
          textInstances: instances, 
          selectedTextIds: selectedIds,
          toolState: newToolState
        };
      });
    },

    // 获取文本实例
    getTextById: (textId: string) => {
      return get().textInstances.get(textId);
    },

    // 获取所有文本
    getAllTexts: () => {
      return Array.from(get().textInstances.values());
    },

    // 选择文本
    selectText: (textId: string, multiSelect = false) => {
      set(state => {
        const selectedIds = multiSelect ? new Set(state.selectedTextIds) : new Set<string>();
        selectedIds.add(textId);

        // 更新文本实例的选择状态
        const instances = new Map(state.textInstances);
        for (const [id, text] of instances) {
          const isSelected = selectedIds.has(id);
          if (text.isSelected !== isSelected) {
            instances.set(id, { ...text, isSelected });
          }
        }

        logger.debug(`✅ 选择文本: ${textId}`, { multiSelect, totalSelected: selectedIds.size });
        return { selectedTextIds: selectedIds, textInstances: instances };
      });
    },

    // 取消选择文本
    deselectText: (textId?: string) => {
      set(state => {
        const selectedIds = new Set(state.selectedTextIds);
        
        if (textId) {
          selectedIds.delete(textId);
        } else {
          selectedIds.clear();
        }

        // 更新文本实例的选择状态
        const instances = new Map(state.textInstances);
        for (const [id, text] of instances) {
          const isSelected = selectedIds.has(id);
          if (text.isSelected !== isSelected) {
            instances.set(id, { ...text, isSelected });
          }
        }

        return { selectedTextIds: selectedIds, textInstances: instances };
      });
    },

    // 取消选择所有文本
    deselectAllTexts: () => {
      get().deselectText();
    },

    // 检查文本是否被选中
    isTextSelected: (textId: string) => {
      return get().selectedTextIds.has(textId);
    },

    // 获取选中的文本
    getSelectedTexts: () => {
      const { textInstances, selectedTextIds } = get();
      return Array.from(selectedTextIds)
        .map(id => textInstances.get(id))
        .filter(Boolean) as TextInstance[];
    },

    // 开始编辑文本
    startEditText: (textId: string) => {
      const text = get().getTextById(textId);
      if (!text) {
        logger.warn(`⚠️ 尝试编辑不存在的文本: ${textId}`);
        return;
      }

      set(state => ({
        toolState: {
          ...state.toolState,
          activeTextId: textId,
          isEditing: true,
          editingContent: text.content
        }
      }));

      // 更新文本的编辑状态
      get().updateText(textId, { isEditing: true });
      
      logger.debug(`✏️ 开始编辑文本: ${textId}`);
    },

    // 停止编辑文本
    stopEditText: (textId?: string) => {
      const { toolState } = get();
      const targetTextId = textId || toolState.activeTextId;
      
      if (targetTextId) {
        // 更新文本内容
        if (toolState.editingContent !== undefined) {
          get().updateTextContent(targetTextId, toolState.editingContent);
        }
        
        // 更新文本的编辑状态
        get().updateText(targetTextId, { isEditing: false });
      }

      set(state => ({
        toolState: {
          ...state.toolState,
          activeTextId: null,
          isEditing: false,
          editingContent: ''
        }
      }));

      logger.debug(`⏹️ 停止编辑文本: ${targetTextId || 'none'}`);
    },

    // 更新文本内容
    updateTextContent: (textId: string, content: string) => {
      get().updateText(textId, { content });
      
      // 如果正在编辑这个文本，同步更新编辑内容
      set(state => {
        if (state.toolState.activeTextId === textId) {
          return {
            toolState: {
              ...state.toolState,
              editingContent: content
            }
          };
        }
        return state;
      });
    },

    // 设置当前样式
    setCurrentStyle: (style: Partial<TextStyle>) => {
      set(state => ({
        currentStyle: { ...state.currentStyle, ...style }
      }));
    },

    // 应用样式到文本
    applyStyleToText: (textId: string, style: Partial<TextStyle>) => {
      const text = get().getTextById(textId);
      if (!text) return;

      const newStyle = { ...text.style, ...style };
      get().updateText(textId, { style: newStyle });
    },

    // 应用样式到选中的文本
    applyStyleToSelected: (style: Partial<TextStyle>) => {
      const selectedTexts = get().getSelectedTexts();
      selectedTexts.forEach(text => {
        get().applyStyleToText(text.id, style);
      });
    },

    // 重置样式为默认
    resetStyleToDefault: (textId?: string) => {
      if (textId) {
        get().applyStyleToText(textId, defaultStyle);
      } else {
        get().applyStyleToSelected(defaultStyle);
      }
    },

    // 移动文本
    moveText: (textId: string, newPosition: { x: number; y: number }) => {
      get().updateText(textId, { 
        position: newPosition,
        bounds: {
          ...get().getTextById(textId)?.bounds || { x: 0, y: 0, width: 0, height: 0 },
          x: newPosition.x,
          y: newPosition.y
        }
      });
    },

    // 移动选中的文本
    moveSelectedTexts: (deltaX: number, deltaY: number) => {
      const selectedTexts = get().getSelectedTexts();
      selectedTexts.forEach(text => {
        const newPosition = {
          x: text.position.x + deltaX,
          y: text.position.y + deltaY
        };
        get().moveText(text.id, newPosition);
      });
    },

    // 更新文本边界
    updateTextBounds: (textId: string, bounds: { x: number; y: number; width: number; height: number }) => {
      get().updateText(textId, { 
        bounds,
        position: { x: bounds.x, y: bounds.y }
      });
    },

    // 设置工具状态
    setToolState: (updates: Partial<TextToolState>) => {
      set(state => ({
        toolState: { ...state.toolState, ...updates }
      }));
    },

    // 重置工具状态
    resetToolState: () => {
      set({ toolState: { ...defaultToolState } });
    },

    // 设置文本可见性
    setTextVisibility: (textId: string, visible: boolean) => {
      get().updateText(textId, { visible });
    },

    // 切换文本可见性
    toggleTextVisibility: (textId: string) => {
      const text = get().getTextById(textId);
      if (text) {
        get().setTextVisibility(textId, !text.visible);
      }
    },

    // 隐藏所有文本
    hideAllTexts: () => {
      const allTexts = get().getAllTexts();
      allTexts.forEach(text => {
        get().setTextVisibility(text.id, false);
      });
    },

    // 显示所有文本
    showAllTexts: () => {
      const allTexts = get().getAllTexts();
      allTexts.forEach(text => {
        get().setTextVisibility(text.id, true);
      });
    },

    // 移动文本到图层
    moveTextToLayer: (textId: string, layerId: string) => {
      get().updateText(textId, { layerId });
    },

    // 获取指定图层的文本
    getTextsByLayer: (layerId: string) => {
      const allTexts = get().getAllTexts();
      return allTexts.filter(text => text.layerId === layerId);
    },

    // 添加到历史记录
    addToHistory: (record: Omit<TextHistoryRecord, 'timestamp'>) => {
      set(state => {
        const newHistory = [...state.history];
        const newRecord: TextHistoryRecord = {
          ...record,
          timestamp: new Date()
        };

        // 如果当前不在历史记录末尾，删除后面的记录
        if (state.historyIndex < newHistory.length - 1) {
          newHistory.splice(state.historyIndex + 1);
        }

        // 添加新记录
        newHistory.push(newRecord);

        // 限制历史记录大小
        if (newHistory.length > state.maxHistorySize) {
          newHistory.shift();
        }

        return {
          history: newHistory,
          historyIndex: newHistory.length - 1
        };
      });
    },

    // 撤销
    undo: () => {
      const { history, historyIndex } = get();
      if (historyIndex < 0) return false;

      const record = history[historyIndex];
      // 这里应该实现撤销逻辑，恢复到beforeState
      // 简化版本，实际需要更复杂的实现
      
      set(state => ({
        historyIndex: state.historyIndex - 1
      }));

      return true;
    },

    // 重做
    redo: () => {
      const { history, historyIndex } = get();
      if (historyIndex >= history.length - 1) return false;

      const record = history[historyIndex + 1];
      // 这里应该实现重做逻辑，恢复到afterState
      // 简化版本，实际需要更复杂的实现

      set(state => ({
        historyIndex: state.historyIndex + 1
      }));

      return true;
    },

    // 检查是否可以撤销
    canUndo: () => {
      return get().historyIndex >= 0;
    },

    // 检查是否可以重做
    canRedo: () => {
      const { history, historyIndex } = get();
      return historyIndex < history.length - 1;
    },

    // 清空历史记录
    clearHistory: () => {
      set({ history: [], historyIndex: -1 });
    },

    // 更新编辑器配置
    updateEditorConfig: (config: Partial<TextEditorConfig>) => {
      set(state => ({
        editorConfig: { ...state.editorConfig, ...config }
      }));
    },

    // 删除选中的文本
    deleteSelectedTexts: () => {
      const selectedTexts = get().getSelectedTexts();
      selectedTexts.forEach(text => {
        get().deleteText(text.id);
      });
    },

    // 复制文本
    duplicateText: (textId: string) => {
      const originalText = get().getTextById(textId);
      if (!originalText) return null;

      const duplicateParams: CreateTextParams = {
        content: originalText.content,
        position: {
          x: originalText.position.x + 20,
          y: originalText.position.y + 20
        },
        style: { ...originalText.style },
        layerId: originalText.layerId
      };

      return get().createText(duplicateParams);
    },

    // 复制选中的文本
    duplicateSelectedTexts: () => {
      const selectedTexts = get().getSelectedTexts();
      return selectedTexts.map(text => get().duplicateText(text.id)).filter(Boolean) as TextInstance[];
    },

    // 查找文本
    findTexts: (searchTerm: string, caseSensitive = false) => {
      const allTexts = get().getAllTexts();
      const searchText = caseSensitive ? searchTerm : searchTerm.toLowerCase();
      
      return allTexts.filter(text => {
        const content = caseSensitive ? text.content : text.content.toLowerCase();
        return content.includes(searchText);
      });
    },

    // 在文本中替换
    replaceInText: (textId: string, searchTerm: string, replaceTerm: string) => {
      const text = get().getTextById(textId);
      if (!text) return false;

      const newContent = text.content.replace(new RegExp(searchTerm, 'g'), replaceTerm);
      if (newContent !== text.content) {
        get().updateTextContent(textId, newContent);
        return true;
      }
      return false;
    },

    // 在所有文本中替换
    replaceInAllTexts: (searchTerm: string, replaceTerm: string) => {
      const allTexts = get().getAllTexts();
      let replaceCount = 0;
      
      allTexts.forEach(text => {
        if (get().replaceInText(text.id, searchTerm, replaceTerm)) {
          replaceCount++;
        }
      });
      
      return replaceCount;
    },

    // 导出文本数据
    exportTexts: () => {
      const allTexts = get().getAllTexts();
      return allTexts.map(text => ({
        id: text.id,
        content: text.content,
        position: text.position,
        style: text.style,
        bounds: text.bounds,
        visible: text.visible,
        layerId: text.layerId
      }));
    },

    // 导入文本数据
    importTexts: (textsData: any[]) => {
      textsData.forEach(textData => {
        if (textData.content && textData.position) {
          get().createText({
            content: textData.content,
            position: textData.position,
            style: textData.style || defaultStyle,
            layerId: textData.layerId
          });
        }
      });
    },

    // 重置所有状态
    reset: () => {
      set({
        textInstances: new Map(),
        selectedTextIds: new Set(),
        toolState: { ...defaultToolState },
        currentStyle: { ...defaultStyle },
        editorConfig: { ...defaultConfig },
        history: [],
        historyIndex: -1
      });
      
      logger.debug('🔄 重置文本存储状态');
    }
  }))
);

// 性能优化：导出常用的选择器
export const useTextInstances = () => useTextStore(state => Array.from(state.textInstances.values()));
export const useSelectedTexts = () => useTextStore(state => state.getSelectedTexts());
export const useCurrentTextStyle = () => useTextStore(state => state.currentStyle);
export const useTextToolState = () => useTextStore(state => state.toolState);
export const useTextEditorConfig = () => useTextStore(state => state.editorConfig);

// 导出文本操作方法
export const useTextActions = () => useTextStore(state => ({
  createText: state.createText,
  updateText: state.updateText,
  deleteText: state.deleteText,
  selectText: state.selectText,
  deselectText: state.deselectText,
  startEditText: state.startEditText,
  stopEditText: state.stopEditText,
  applyStyleToText: state.applyStyleToText,
  applyStyleToSelected: state.applyStyleToSelected,
  moveText: state.moveText,
  setCurrentStyle: state.setCurrentStyle
}));
