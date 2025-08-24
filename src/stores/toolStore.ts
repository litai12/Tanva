import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { subscribeWithSelector } from 'zustand/middleware';

// 工具类型定义
export type DrawMode = 'select' | 'free' | 'line' | 'rect' | 'circle' | 'polyline' | 'text' | 'image' | '3d-model' | 'screenshot';

interface ToolState {
  // 当前激活工具
  drawMode: DrawMode;
  
  // 绘图属性
  currentColor: string;
  strokeWidth: number;
  isEraser: boolean;
  
  // 操作方法
  setDrawMode: (mode: DrawMode) => void;
  setCurrentColor: (color: string) => void;
  setStrokeWidth: (width: number) => void;
  toggleEraser: () => void;
  
  // 快捷切换工具
  nextDrawingTool: () => void;
}

// 绘图工具循环顺序
const DRAWING_TOOLS: DrawMode[] = ['free', 'line', 'rect', 'circle', 'polyline'];

export const useToolStore = create<ToolState>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        // 初始状态
        drawMode: 'select',
        currentColor: '#000000',
        strokeWidth: 2,
        isEraser: false,
        
        // 设置方法
        setDrawMode: (mode) => {
          console.log(`🔧 切换工具模式: ${get().drawMode} -> ${mode}`);
          // 切换到绘图模式时，自动关闭橡皮擦
          if (DRAWING_TOOLS.includes(mode)) {
            set({ drawMode: mode, isEraser: false });
          } else {
            set({ drawMode: mode });
          }
        },
        
        setCurrentColor: (color) => {
          set({ currentColor: color });
        },
        
        setStrokeWidth: (width) => {
          const validWidth = Math.max(1, Math.min(20, width)); // 限制范围 1-20
          set({ strokeWidth: validWidth });
        },
        
        toggleEraser: () => {
          const { isEraser } = get();
          if (isEraser) {
            // 如果当前是橡皮擦模式，关闭橡皮擦
            set({ isEraser: false });
          } else {
            // 如果当前不是橡皮擦模式，开启橡皮擦并切换到自由绘制模式
            set({ isEraser: true, drawMode: 'free' });
          }
        },
        
        // 快捷切换绘图工具（循环切换）
        nextDrawingTool: () => {
          const { drawMode } = get();
          const currentIndex = DRAWING_TOOLS.indexOf(drawMode);
          const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % DRAWING_TOOLS.length;
          const nextMode = DRAWING_TOOLS[nextIndex];
          
          console.log(`🔄 循环切换绘图工具: ${drawMode} -> ${nextMode}`);
          set({ drawMode: nextMode });
        },
      }),
      {
        name: 'tool-settings', // localStorage 键名
        // 持久化工具设置，但不包括橡皮擦状态（通常是临时的）
        partialize: (state) => ({
          drawMode: state.drawMode,
          currentColor: state.currentColor,
          strokeWidth: state.strokeWidth,
        }),
      }
    )
  )
);

// 性能优化：导出常用的选择器
export const useCurrentTool = () => useToolStore((state) => state.drawMode);
export const useDrawingProps = () => useToolStore((state) => ({
  currentColor: state.currentColor,
  strokeWidth: state.strokeWidth,
  isEraser: state.isEraser,
}));
export const useToolActions = () => useToolStore((state) => ({
  setDrawMode: state.setDrawMode,
  setCurrentColor: state.setCurrentColor,
  setStrokeWidth: state.setStrokeWidth,
  toggleEraser: state.toggleEraser,
  nextDrawingTool: state.nextDrawingTool,
}));