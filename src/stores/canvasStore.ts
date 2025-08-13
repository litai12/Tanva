import { create } from 'zustand';

interface CanvasState {
  // 画布工具状态
  currentTool: string;
  currentColor: string;
  strokeWidth: number;
  
  // 画布数据
  geometryData: any;
  
  // 网格和坐标系统
  centerCoordinateSystem: boolean;
  
  // 操作方法
  setCurrentTool: (tool: string) => void;
  setCurrentColor: (color: string) => void;
  setStrokeWidth: (width: number) => void;
  setGeometryData: (data: any) => void;
  setCenterCoordinateSystem: (center: boolean) => void;
  clearCanvas: () => void;
}

export const useCanvasStore = create<CanvasState>((set) => ({
  // 初始状态
  currentTool: 'select',
  currentColor: '#000000',
  strokeWidth: 2,
  geometryData: null,
  centerCoordinateSystem: false,
  
  // 设置方法
  setCurrentTool: (tool) => set({ currentTool: tool }),
  setCurrentColor: (color) => set({ currentColor: color }),
  setStrokeWidth: (width) => set({ strokeWidth: width }),
  setGeometryData: (data) => set({ geometryData: data }),
  setCenterCoordinateSystem: (center) => set({ centerCoordinateSystem: center }),
  clearCanvas: () => set({ geometryData: null }),
}));