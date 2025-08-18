import { 
  useCurrentTool, 
  useCurrentColor, 
  useStrokeWidth, 
  useIsEraser,
  useSetDrawMode,
  useSetCurrentColor,
  useSetStrokeWidth,
  useToggleEraser
} from '@/stores';

/**
 * 工具栏状态管理自定义Hook
 * 使用单独选择器避免引用问题，优化性能和可维护性
 */
export const useToolbarState = () => {
  // 使用单独选择器，避免对象引用问题
  const drawMode = useCurrentTool();
  const currentColor = useCurrentColor();
  const strokeWidth = useStrokeWidth();
  const isEraser = useIsEraser();
  
  // 使用单独的 action 选择器
  const setDrawMode = useSetDrawMode();
  const setCurrentColor = useSetCurrentColor();
  const setStrokeWidth = useSetStrokeWidth();
  const toggleEraser = useToggleEraser();

  return {
    // 状态
    drawMode,
    currentColor,
    strokeWidth,
    isEraser,
    
    // 操作方法
    setDrawMode,
    setCurrentColor,
    setStrokeWidth,
    toggleEraser,
  };
};