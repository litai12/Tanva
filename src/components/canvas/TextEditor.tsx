/**
 * 文本编辑器组件
 * 提供内联文本编辑和浮动工具栏功能
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { 
  Bold, 
  Italic, 
  Underline, 
  AlignLeft, 
  AlignCenter, 
  AlignRight,
  AlignJustify,
  Type,
  Palette,
  X,
  Check
} from 'lucide-react';
import { useTextStore, useTextActions, useCurrentTextStyle } from '@/stores/textStore';
import { useToolStore } from '@/stores/toolStore';
import { cn } from '@/lib/utils';
import type { TextStyle, TextFormatOptions } from '@/types/text';
import paper from 'paper';
import { projectToClient } from '@/utils/paperCoords';

interface TextEditorProps {
  className?: string;
}

const TextEditor: React.FC<TextEditorProps> = ({ className }) => {
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarPosition, setToolbarPosition] = useState({ x: 0, y: 0 });
  const [showColorPicker, setShowColorPicker] = useState(false);
  
  // Store hooks
  const toolState = useTextStore(state => state.toolState);
  const textInstances = useTextStore(state => state.textInstances);
  const currentStyle = useCurrentTextStyle();
  const textActions = useTextActions();
  const { setDrawMode, isEraser } = useToolStore(state => ({ 
    setDrawMode: state.setDrawMode, 
    isEraser: state.isEraser 
  }));
  
  // 获取当前编辑的文本
  const activeText = toolState.activeTextId ? textInstances.get(toolState.activeTextId) : null;
  
  // 编辑内容状态
  const [editingContent, setEditingContent] = useState('');
  const [selectionStart, setSelectionStart] = useState(0);
  const [selectionEnd, setSelectionEnd] = useState(0);

  // 同步编辑内容
  useEffect(() => {
    if (activeText && toolState.isEditing) {
      setEditingContent(activeText.content);
    }
  }, [activeText, toolState.isEditing]);

  // 聚焦文本区域
  useEffect(() => {
    if (toolState.isEditing && textAreaRef.current) {
      textAreaRef.current.focus();
      textAreaRef.current.select();
    }
  }, [toolState.isEditing]);

  // 计算工具栏位置
  const calculateToolbarPosition = useCallback(() => {
    if (!activeText || !activeText.paperItem || !paper.view || !paper.view.element) return;
    
    try {
      const bounds = activeText.paperItem.bounds;
      const canvasEl = paper.view.element as HTMLCanvasElement;
      const tl = projectToClient(canvasEl, bounds.topLeft);
      setToolbarPosition({
        x: tl.x,
        y: tl.y - 50 // 工具栏显示在文本上方
      });
    } catch (error) {
      console.warn('计算工具栏位置失败:', error);
    }
  }, [activeText]);

  // 更新工具栏位置
  useEffect(() => {
    if (toolState.isEditing && activeText && paper.view) {
      calculateToolbarPosition();
      
      // 监听画布变换事件，实时更新工具栏位置
      let frameHandler: (() => void) | null = null;
      
      if (paper.view) {
        frameHandler = () => {
          calculateToolbarPosition();
        };
        paper.view.onFrame = frameHandler;
      }
      
      return () => {
        if (paper.view && frameHandler) {
          paper.view.onFrame = null;
        }
      };
    }
  }, [toolState.isEditing, activeText]); // 移除calculateToolbarPosition依赖

  // 处理文本内容变化
  const handleContentChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = event.target.value;
    setEditingContent(newContent);
    
    // 实时更新文本内容
    if (activeText) {
      textActions.updateText(activeText.id, { content: newContent });
    }
  }, [activeText, textActions]);

  // 处理键盘事件
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      finishEditing();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelEditing();
    }
  }, []);

  // 完成编辑
  const finishEditing = useCallback(() => {
    if (activeText) {
      textActions.updateText(activeText.id, { 
        content: editingContent,
        isEditing: false 
      });
    }
    textActions.stopEditText();
    // 完成编辑后切换到选择工具（橡皮擦模式下不切换）
    if (!isEraser) {
      setDrawMode('select');
    }
  }, [activeText, editingContent, textActions, setDrawMode]);

  // 取消编辑
  const cancelEditing = useCallback(() => {
    if (activeText) {
      // 恢复原始内容
      textActions.updateText(activeText.id, { 
        content: activeText.content,
        isEditing: false 
      });
      setEditingContent(activeText.content);
    }
    textActions.stopEditText();
  }, [activeText, textActions]);

  // 应用文本格式
  const applyFormat = useCallback((format: TextFormatOptions) => {
    if (!activeText) return;
    
    const newStyle: Partial<TextStyle> = {};
    
    if (format.bold !== undefined) {
      newStyle.fontWeight = format.bold ? 'bold' : 'normal';
    }
    
    if (format.italic !== undefined) {
      newStyle.fontStyle = format.italic ? 'italic' : 'normal';
    }
    
    if (format.underline !== undefined) {
      newStyle.textDecoration = format.underline ? 'underline' : 'none';
    }
    
    if (format.color) {
      newStyle.fontColor = format.color;
    }
    
    if (format.fontSize) {
      newStyle.fontSize = format.fontSize;
    }
    
    if (format.fontFamily) {
      newStyle.fontFamily = format.fontFamily;
    }
    
    if (format.align) {
      newStyle.textAlign = format.align;
    }
    
    textActions.applyStyleToText(activeText.id, newStyle);
  }, [activeText, textActions]);

  // 检查当前格式状态
  const isFormatActive = useCallback((format: keyof TextFormatOptions): boolean => {
    if (!activeText) return false;
    
    const style = activeText.style;
    
    switch (format) {
      case 'bold':
        return style.fontWeight === 'bold';
      case 'italic':
        return style.fontStyle === 'italic';
      case 'underline':
        return style.textDecoration === 'underline';
      default:
        return false;
    }
  }, [activeText]);

  // 颜色选择器颜色选项
  const colorOptions = [
    '#000000', '#333333', '#666666', '#999999', '#CCCCCC', '#FFFFFF',
    '#FF0000', '#FF6600', '#FFCC00', '#00FF00', '#0066FF', '#6600FF',
    '#FF0066', '#FF6600', '#FFFF00', '#00FFFF', '#0000FF', '#FF00FF'
  ];

  // 如果没有激活的文本或不在编辑模式，不渲染
  if (!toolState.isEditing || !activeText) {
    return null;
  }

  return (
    <>
      {/* 内联文本编辑器 */}
      <div
        className="absolute z-50 pointer-events-auto"
        style={{
          left: activeText.position.x,
          top: activeText.position.y,
          transform: 'translate(-50%, -50%)'
        }}
      >
        <textarea
          ref={textAreaRef}
          value={editingContent}
          onChange={handleContentChange}
          onKeyDown={handleKeyDown}
          onBlur={finishEditing}
          className="resize-none border-2 border-blue-400 rounded-md p-2 bg-white shadow-lg min-w-[200px] min-h-[40px] font-inherit"
          style={{
            fontSize: activeText.style.fontSize,
            fontFamily: activeText.style.fontFamily,
            fontWeight: activeText.style.fontWeight,
            fontStyle: activeText.style.fontStyle,
            color: activeText.style.fontColor,
            textAlign: activeText.style.textAlign as any,
            lineHeight: activeText.style.lineHeight,
            letterSpacing: activeText.style.letterSpacing
          }}
          autoFocus
        />
      </div>

      {/* 浮动工具栏 */}
      <div
        ref={toolbarRef}
        className="fixed z-50 pointer-events-auto"
        style={{
          left: toolbarPosition.x,
          top: toolbarPosition.y
        }}
      >
        <div className="bg-white shadow-lg border border-gray-200 rounded-lg p-2 flex items-center gap-1">
          {/* 字体格式按钮 */}
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 w-8 p-0",
              isFormatActive('bold') && "bg-blue-100 text-blue-600"
            )}
            onClick={() => applyFormat({ bold: !isFormatActive('bold') })}
            title="加粗"
          >
            <Bold className="h-4 w-4" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 w-8 p-0",
              isFormatActive('italic') && "bg-blue-100 text-blue-600"
            )}
            onClick={() => applyFormat({ italic: !isFormatActive('italic') })}
            title="斜体"
          >
            <Italic className="h-4 w-4" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 w-8 p-0",
              isFormatActive('underline') && "bg-blue-100 text-blue-600"
            )}
            onClick={() => applyFormat({ underline: !isFormatActive('underline') })}
            title="下划线"
          >
            <Underline className="h-4 w-4" />
          </Button>

          <Separator orientation="vertical" className="h-6" />

          {/* 对齐按钮 */}
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 w-8 p-0",
              activeText.style.textAlign === 'left' && "bg-blue-100 text-blue-600"
            )}
            onClick={() => applyFormat({ align: 'left' })}
            title="左对齐"
          >
            <AlignLeft className="h-4 w-4" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 w-8 p-0",
              activeText.style.textAlign === 'center' && "bg-blue-100 text-blue-600"
            )}
            onClick={() => applyFormat({ align: 'center' })}
            title="居中对齐"
          >
            <AlignCenter className="h-4 w-4" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 w-8 p-0",
              activeText.style.textAlign === 'right' && "bg-blue-100 text-blue-600"
            )}
            onClick={() => applyFormat({ align: 'right' })}
            title="右对齐"
          >
            <AlignRight className="h-4 w-4" />
          </Button>

          <Separator orientation="vertical" className="h-6" />

          {/* 颜色选择器 */}
          <div className="relative">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setShowColorPicker(!showColorPicker)}
              title="文字颜色"
            >
              <div className="relative">
                <Palette className="h-4 w-4" />
                <div 
                  className="absolute bottom-0 left-0 w-4 h-1 rounded-sm"
                  style={{ backgroundColor: activeText.style.fontColor }}
                />
              </div>
            </Button>

            {/* 颜色选择面板 */}
            {showColorPicker && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg p-2 shadow-lg z-60">
                <div className="grid grid-cols-6 gap-1">
                  {colorOptions.map(color => (
                    <button
                      key={color}
                      className="w-6 h-6 rounded border border-gray-300 hover:border-gray-500"
                      style={{ backgroundColor: color }}
                      onClick={() => {
                        applyFormat({ color });
                        setShowColorPicker(false);
                      }}
                      title={color}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          <Separator orientation="vertical" className="h-6" />

          {/* 完成和取消按钮 */}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-green-600 hover:bg-green-100"
            onClick={finishEditing}
            title="完成编辑"
          >
            <Check className="h-4 w-4" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-red-600 hover:bg-red-100"
            onClick={cancelEditing}
            title="取消编辑"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 点击外部关闭颜色选择器 */}
      {showColorPicker && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowColorPicker(false)}
        />
      )}
    </>
  );
};

export default TextEditor;
