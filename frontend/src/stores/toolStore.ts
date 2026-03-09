import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { subscribeWithSelector } from 'zustand/middleware';
import { logger } from '@/utils/logger';
import { createSafeStorage } from './storageUtils';

// 工具类型定义
export type DrawMode = 'select' | 'marquee' | 'pointer' | 'free' | 'line' | 'rect' | 'circle' | 'polyline' | 'text' | 'image' | 'quick-image' | '3d-model' | 'screenshot';

interface ToolState {
  // 当前激活工具
  drawMode: DrawMode;

  // 绘图属性
  currentColor: string;
  fillColor: string;
  strokeWidth: number;
  isEraser: boolean;
  hasFill: boolean;

  // 操作方法
  setDrawMode: (mode: DrawMode) => void;
  setCurrentColor: (color: string) => void;
  setFillColor: (color: string) => void;
  setStrokeWidth: (width: number) => void;
  toggleEraser: () => void;
  toggleFill: () => void;

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
        currentColor: '#ff0000',
        fillColor: '#ffffff',
        strokeWidth: 2,
        isEraser: false,
        hasFill: false,

        // 设置方法
        setDrawMode: (mode) => {
          logger.debug(`🔧 切换工具模式: ${get().drawMode} -> ${mode}`);
          // 切换任意工具时，关闭橡皮擦，确保工具互斥
          set({ drawMode: mode, isEraser: false });
        },

        setCurrentColor: (color) => {
          set({ currentColor: color });
        },

        setFillColor: (color) => {
          set({ fillColor: color });
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

        toggleFill: () => {
          const { hasFill } = get();
          set({ hasFill: !hasFill });
        },

        // 快捷切换绘图工具（循环切换）
        nextDrawingTool: () => {
          const { drawMode } = get();
          const currentIndex = DRAWING_TOOLS.indexOf(drawMode);
          const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % DRAWING_TOOLS.length;
          const nextMode = DRAWING_TOOLS[nextIndex];

          logger.debug(`🔄 循环切换绘图工具: ${drawMode} -> ${nextMode}`);
          set({ drawMode: nextMode });
        },
      }),
      {
        name: 'tool-settings', // localStorage 键名
        storage: createJSONStorage<Partial<ToolState>>(() => createSafeStorage({ storageName: 'tool-settings' })),
        // 持久化工具设置，但不包括橡皮擦状态（通常是临时的）
        partialize: (state) => ({
          drawMode: state.drawMode,
          currentColor: state.currentColor,
          fillColor: state.fillColor,
          strokeWidth: state.strokeWidth,
          hasFill: state.hasFill,
        }) as Partial<ToolState>,
      }
    )
  )
);

// 性能优化：导出常用的选择器
export const useCurrentTool = () => useToolStore((state) => state.drawMode);
export const useDrawingProps = () => useToolStore((state) => ({
  currentColor: state.currentColor,
  fillColor: state.fillColor,
  strokeWidth: state.strokeWidth,
  isEraser: state.isEraser,
  hasFill: state.hasFill,
}));
export const useToolActions = () => useToolStore((state) => ({
  setDrawMode: state.setDrawMode,
  setCurrentColor: state.setCurrentColor,
  setFillColor: state.setFillColor,
  setStrokeWidth: state.setStrokeWidth,
  toggleEraser: state.toggleEraser,
  toggleFill: state.toggleFill,
  nextDrawingTool: state.nextDrawingTool,
}));
